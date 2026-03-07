"""
Mission Control API — unified route file for the Mission Control frontend.

Endpoints:
- GET  /execution/current/{address}   Current execution flow state
- GET  /receipts/timeline/{address}   Memory Lane: date-grouped receipts
- GET  /receipts/{receipt_id}         Full forensic receipt (Level 3)
- GET  /opportunities/feed            Unified opportunity feed
- GET  /constraints/{address}         Load user constraints
- PUT  /constraints/{address}         Save user constraints
- GET  /policy/{address}              Load Circuit Board policy
- PUT  /policy/{address}              Save Circuit Board policy
- POST /emergency/pause               System-wide emergency pause
- POST /emergency/unpause             Clear emergency pause
- GET  /stream/{address}             Unified intelligence stream
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()

DATA_DIR = Path(__file__).resolve().parents[3] / "data"

# ---------------------------------------------------------------------------
# Lazy service accessors — each wrapped in try/except so the router always
# loads even when some services are not yet wired up.
# ---------------------------------------------------------------------------


def _vault_policy_svc():
    from app.services.vault_policy_service import get_vault_policy_service
    return get_vault_policy_service()


def _receipt_svc():
    from app.services.receipt_service import get_receipt_service
    return get_receipt_service()


def _guard_status(address: str) -> dict[str, Any]:
    from app.services.execution_guard import get_guard_status
    return get_guard_status(address)


def _autonomous_agent_state(address: str) -> dict[str, Any]:
    try:
        from app.services.autonomous_agent import get_autonomous_agent
        return get_autonomous_agent().get_agent_state(address)
    except Exception:
        return {"state": "unavailable"}


def _mainnet_oracle():
    from app.services.mainnet_oracle import get_oracle
    return get_oracle()


async def _strategy_recommendation(address: str, amount: float, risk: str):
    from app.services.strategy_recommendation_service import get_recommendation
    return await get_recommendation(address, amount, risk)


def _json_store(name: str):
    from app.services.json_store import JsonStore
    return JsonStore(name)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_json_file(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _step_status(present: bool, ok: bool | None = None) -> str:
    if not present:
        return "pending"
    if ok is None:
        return "complete"
    return "complete" if ok else "failed"


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ConstraintsPutRequest(BaseModel):
    risk_tolerance: int | None = Field(default=None, ge=0, le=100)
    venue_limits: dict[str, Any] | None = None
    rebalance_frequency: str | None = None
    strategy_whitelist: list[str] | None = None
    privacy_mode: str | None = None


class PolicyPutRequest(BaseModel):
    patch: dict[str, Any] = Field(default_factory=dict)


# ============================================================================
# 1. GET /execution/current/{address}
# ============================================================================

@router.get("/execution/current/{address}")
async def get_current_execution(address: str) -> dict[str, Any]:
    """Assemble the current execution flow state from multiple services."""
    steps: dict[str, dict[str, Any]] = {}

    # -- intent (latest receipt gives us the most recent intent) --
    try:
        svc = _receipt_svc()
        user_receipts = await svc.get_user_receipts(address)
        latest = user_receipts[-1] if user_receipts else None
    except Exception:
        user_receipts = []
        latest = None

    steps["intent"] = {
        "status": "complete" if latest else "pending",
        "summary": latest.get("action_type", "unknown") if latest else None,
        "timestamp": latest.get("timestamp") if latest else None,
    }

    # -- policy --
    try:
        policy = _vault_policy_svc().get_policy(address, create_if_missing=False)
    except Exception:
        policy = None

    steps["policy"] = {
        "status": "complete" if policy else "pending",
        "profile_id": (policy or {}).get("profile_id"),
        "mode": (policy or {}).get("execution_policy", {}).get("mode"),
    }

    # -- proof_package (derive from latest receipt proof_hash) --
    proof_hash = (latest or {}).get("proof_hash")
    steps["proof_package"] = {
        "status": "complete" if proof_hash else "pending",
        "proof_hash": proof_hash,
    }

    # -- agent --
    agent_state = _autonomous_agent_state(address)
    agent_running = agent_state.get("state") in ("running", "monitoring")
    steps["agent"] = {
        "status": "complete" if agent_running else "waiting",
        "state": agent_state.get("state", "stopped"),
        "checks": agent_state.get("checks_completed", 0),
        "actions": agent_state.get("actions_taken", 0),
    }

    # -- strategy --
    has_strategy = bool((policy or {}).get("strategy_permissions"))
    steps["strategy"] = {
        "status": "complete" if has_strategy else "pending",
    }

    # -- execution gate --
    try:
        guard = _guard_status(address)
    except Exception:
        guard = {}

    paused = guard.get("emergency_pause", False)
    steps["execution"] = {
        "status": "failed" if paused else ("complete" if policy else "pending"),
        "emergency_pause": paused,
        "policy_hash": guard.get("policy_hash"),
        "cooldown_seconds": guard.get("cooldown_seconds"),
        "daily_notional_spent_wei": guard.get("daily_notional_spent_wei", 0),
    }

    # -- receipt --
    steps["receipt"] = {
        "status": "complete" if latest else "pending",
        "receipt_id": (latest or {}).get("receipt_id"),
        "on_chain": (latest or {}).get("on_chain", False),
    }

    return {
        "address": address,
        "timestamp": _now_iso(),
        "steps": steps,
    }


# ============================================================================
# 2. GET /receipts/timeline/{address}
# ============================================================================

@router.get("/receipts/timeline/{address}")
async def get_receipts_timeline(
    address: str,
    from_date: str | None = Query(None, description="ISO date lower bound"),
    to_date: str | None = Query(None, description="ISO date upper bound"),
    type: str = Query("all", description="Filter: all|gate|execute|deposit|warning"),
    limit: int = Query(50, ge=1, le=500),
) -> dict[str, Any]:
    """Memory Lane — date-grouped receipts for the Mission Control timeline."""
    items: list[dict[str, Any]] = []

    # -- in-memory receipts from ReceiptService --
    try:
        svc = _receipt_svc()
        mem_receipts = await svc.get_user_receipts(address)
        for r in mem_receipts:
            items.append(_normalize_receipt(r, source="receipt_service"))
    except Exception as exc:
        logger.debug("receipt_service unavailable: %s", exc)

    # -- orchestration_receipts.json --
    orch_raw = _load_json_file(DATA_DIR / "orchestration_receipts.json")
    if isinstance(orch_raw, dict):
        receipts_map = orch_raw.get("receipts", orch_raw)
        addr_lower = (address or "").strip().lower()
        for _rid, r in receipts_map.items():
            if not isinstance(r, dict):
                continue
            r_user = (r.get("user") or "").strip().lower()
            if r_user and r_user != addr_lower and not addr_lower.endswith(r_user.lstrip("0x")):
                continue
            items.append(_normalize_receipt(r, source="orchestration"))

    # -- decision_events.json --
    events_raw = _load_json_file(DATA_DIR / "decision_events.json")
    if isinstance(events_raw, list):
        addr_lower = (address or "").strip().lower()
        for ev in events_raw:
            if not isinstance(ev, dict):
                continue
            ev_user = (ev.get("user_address") or "").strip().lower()
            if ev_user and ev_user != addr_lower and not addr_lower.endswith(ev_user.lstrip("0x")):
                continue
            items.append({
                "receipt_id": str(ev.get("id", "")),
                "timestamp": ev.get("created_at", ""),
                "type": _map_event_type(ev.get("event_type", "")),
                "strategy_name": ev.get("model_name", ev.get("gate", "")),
                "gate_status": ev.get("outcome", ""),
                "trust_delta": 0,
                "intent_summary": ev.get("failure_reason") or ev.get("event_type", ""),
                "hashes": {
                    "intent": ev.get("metadata", {}).get("commitment_hash", ""),
                    "policy": "",
                    "execution": ev.get("l3_tx_hash") or ev.get("l2_tx_hash") or "",
                    "receipt": "",
                },
                "source": "decision_event",
            })

    # -- filters --
    if type != "all":
        items = [i for i in items if i.get("type") == type]

    if from_date:
        items = [i for i in items if (i.get("timestamp") or "") >= from_date]
    if to_date:
        items = [i for i in items if (i.get("timestamp") or "") <= to_date]

    items.sort(key=lambda i: i.get("timestamp", ""), reverse=True)
    items = items[:limit]

    # -- group by date --
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        day = (item.get("timestamp") or "")[:10] or "unknown"
        grouped[day].append(item)

    timeline = [
        {"date": day, "receipts": recs}
        for day, recs in sorted(grouped.items(), reverse=True)
    ]

    return {
        "address": address,
        "total": len(items),
        "timeline": timeline,
    }


def _normalize_receipt(r: dict, source: str) -> dict[str, Any]:
    action = r.get("action_type") or r.get("proof_type") or r.get("action") or "unknown"
    return {
        "receipt_id": r.get("receipt_id", ""),
        "timestamp": r.get("timestamp", ""),
        "type": _map_action_type(action),
        "strategy_name": r.get("threshold_or_model") or r.get("constraints_hash") or action,
        "gate_status": "pass" if r.get("on_chain") else r.get("result", "pending"),
        "trust_delta": 0,
        "intent_summary": f"{action} — {r.get('amount', '')}",
        "hashes": {
            "intent": r.get("constraints_hash") or r.get("proof_hash") or "",
            "policy": "",
            "execution": r.get("tx_hash", ""),
            "receipt": r.get("receipt_id", ""),
        },
        "source": source,
    }


def _map_action_type(action: str) -> str:
    action_lower = action.lower()
    if "deposit" in action_lower or "deploy" in action_lower:
        return "deposit"
    if "gate" in action_lower or "proof" in action_lower:
        return "gate"
    if "withdraw" in action_lower:
        return "execute"
    if "warning" in action_lower or "fail" in action_lower:
        return "warning"
    return "execute"


def _map_event_type(event_type: str) -> str:
    if "fail" in event_type:
        return "warning"
    if "gate" in event_type or "proof" in event_type:
        return "gate"
    return "execute"


# ============================================================================
# 3. GET /receipts/{receipt_id}
# ============================================================================

@router.get("/receipts/{receipt_id}")
async def get_receipt_detail(receipt_id: str) -> dict[str, Any]:
    """Full forensic receipt — Level 3 detail view."""
    # Check in-memory receipt service
    try:
        svc = _receipt_svc()
        receipt = await svc.get_receipt(receipt_id)
        if receipt:
            return {"receipt": receipt, "level": 3, "source": "receipt_service"}
    except Exception:
        pass

    # Check orchestration_receipts.json
    orch_raw = _load_json_file(DATA_DIR / "orchestration_receipts.json")
    if isinstance(orch_raw, dict):
        receipts_map = orch_raw.get("receipts", orch_raw)
        if receipt_id in receipts_map:
            return {"receipt": receipts_map[receipt_id], "level": 3, "source": "orchestration"}

    # Check decision_events.json by id
    events_raw = _load_json_file(DATA_DIR / "decision_events.json")
    if isinstance(events_raw, list):
        for ev in events_raw:
            if str(ev.get("id")) == receipt_id:
                return {"receipt": ev, "level": 3, "source": "decision_event"}

    raise HTTPException(status_code=404, detail="Receipt not found")


# ============================================================================
# 4. GET /opportunities/feed
# ============================================================================

@router.get("/opportunities/feed")
async def get_opportunity_feed(
    venue: str | None = Query(None, description="ekubo|lending|staking"),
    risk: str | None = Query(None, description="low|medium|high"),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Unified opportunity feed merging oracle data and LLM recommendations."""
    opportunities: list[dict[str, Any]] = []

    # -- oracle market data --
    try:
        oracle = _mainnet_oracle()
        snapshot = oracle.get_latest_snapshot()
        if snapshot:
            snap_dict = snapshot.to_dict()
            ekubo = snap_dict.get("ekubo", {})
            jediswap = snap_dict.get("jediswap", {})

            opportunities.append({
                "id": "ekubo_eth_usdc",
                "venue": "ekubo",
                "pair": "ETH/USDC",
                "apy_bps": ekubo.get("apy_bps", 0),
                "tvl": ekubo.get("tvl", 0),
                "volume_24h": ekubo.get("volume_24h", 0),
                "risk_level": "medium" if ekubo.get("volatility_bps", 0) > 300 else "low",
                "composite_score": _composite_score(ekubo.get("apy_bps", 0), ekubo.get("volatility_bps", 0)),
                "source": "oracle",
                "snapshot_ts": snap_dict.get("timestamp"),
            })
            opportunities.append({
                "id": "jediswap_eth_usdc",
                "venue": "ekubo",
                "pair": "ETH/USDC (JediSwap)",
                "apy_bps": jediswap.get("apy_bps", 0),
                "tvl": jediswap.get("tvl", 0),
                "volume_24h": jediswap.get("volume_24h", 0),
                "risk_level": "low" if jediswap.get("volatility_bps", 0) <= 300 else "medium",
                "composite_score": _composite_score(jediswap.get("apy_bps", 0), jediswap.get("volatility_bps", 0)),
                "source": "oracle",
                "snapshot_ts": snap_dict.get("timestamp"),
            })
    except Exception as exc:
        logger.debug("oracle unavailable for opportunity feed: %s", exc)

    # -- LLM strategy recommendations --
    try:
        rec = await _strategy_recommendation("0x0", 1000.0, "balanced")
        for pool in rec.get("recommended_pools", []):
            opp_id = pool.get("pool_id", "")
            if any(o["id"] == opp_id for o in opportunities):
                continue
            apy_bps = int(pool.get("expected_apy", 0) * 10000)
            risk_score = pool.get("risk_score", 50)
            opportunities.append({
                "id": opp_id,
                "venue": "ekubo",
                "pair": pool.get("pair", ""),
                "apy_bps": apy_bps,
                "tvl": 0,
                "volume_24h": 0,
                "risk_level": "low" if risk_score < 30 else ("high" if risk_score > 60 else "medium"),
                "composite_score": _composite_score(apy_bps, int(risk_score * 5)),
                "source": "llm",
                "ai_reasoning": rec.get("ai_reasoning", ""),
            })
    except Exception as exc:
        logger.debug("strategy recommendation unavailable: %s", exc)

    # -- filters --
    if venue:
        opportunities = [o for o in opportunities if o.get("venue") == venue]
    if risk:
        opportunities = [o for o in opportunities if o.get("risk_level") == risk]

    opportunities.sort(key=lambda o: o.get("composite_score", 0), reverse=True)
    opportunities = opportunities[:limit]

    return {
        "opportunities": opportunities,
        "count": len(opportunities),
        "timestamp": _now_iso(),
    }


def _composite_score(apy_bps: int, volatility_bps: int) -> float:
    """Higher APY is better, higher volatility is worse."""
    return round(max(0.0, apy_bps - volatility_bps * 0.5) / 100, 2)


# ============================================================================
# 5–6. Constraints CRUD
# ============================================================================

@router.get("/constraints/{address}")
async def get_constraints(address: str) -> dict[str, Any]:
    """Load user constraints from vault policy."""
    try:
        policy = _vault_policy_svc().get_policy(address, create_if_missing=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not policy:
        raise HTTPException(status_code=400, detail="Invalid address")

    rb = policy.get("risk_budget", {})
    ep = policy.get("execution_policy", {})
    pp = policy.get("privacy_policy", {})

    return {
        "address": address,
        "risk_tolerance": _drawdown_to_tolerance(rb.get("max_drawdown_bps", 1500)),
        "venue_limits": {
            "venues": policy.get("venue_allowlist", []),
            "max_position_pct": rb.get("max_position_pct", 35),
        },
        "rebalance_frequency": _cooldown_to_frequency(ep.get("cooldown_seconds", 300)),
        "strategy_whitelist": ep.get("allowed_strategies", []),
        "privacy_mode": pp.get("preset", "unlinkable_basic"),
        "raw_policy": policy,
    }


@router.put("/constraints/{address}")
async def put_constraints(address: str, body: ConstraintsPutRequest) -> dict[str, Any]:
    """Save user constraints by patching the vault policy."""
    patch: dict[str, Any] = {}

    if body.risk_tolerance is not None:
        drawdown = _tolerance_to_drawdown(body.risk_tolerance)
        patch["risk_budget"] = {"max_drawdown_bps": drawdown}

    if body.venue_limits is not None:
        venues = body.venue_limits.get("venues")
        if isinstance(venues, list):
            patch["venue_allowlist"] = venues
        max_pos = body.venue_limits.get("max_position_pct")
        if isinstance(max_pos, int):
            patch.setdefault("risk_budget", {})["max_position_pct"] = max_pos

    if body.rebalance_frequency is not None:
        cooldown = _frequency_to_cooldown(body.rebalance_frequency)
        patch.setdefault("execution_policy", {})["cooldown_seconds"] = cooldown

    if body.strategy_whitelist is not None:
        patch.setdefault("execution_policy", {})["allowed_strategies"] = body.strategy_whitelist

    if body.privacy_mode is not None:
        patch["privacy_policy"] = {"preset": body.privacy_mode}

    try:
        updated = _vault_policy_svc().put_policy(address, patch)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"address": address, "updated": True, "policy": updated}


def _drawdown_to_tolerance(bps: int) -> int:
    """Map max_drawdown_bps to a 0-100 risk_tolerance scale."""
    if bps <= 900:
        return 25
    if bps <= 1500:
        return 50
    if bps <= 2500:
        return 75
    return 90


def _tolerance_to_drawdown(tolerance: int) -> int:
    if tolerance <= 30:
        return 900
    if tolerance <= 55:
        return 1500
    if tolerance <= 80:
        return 2500
    return 3500


def _cooldown_to_frequency(seconds: int) -> str:
    if seconds <= 60:
        return "realtime"
    if seconds <= 300:
        return "5min"
    if seconds <= 900:
        return "15min"
    if seconds <= 3600:
        return "hourly"
    return "daily"


def _frequency_to_cooldown(freq: str) -> int:
    return {
        "realtime": 30,
        "5min": 300,
        "15min": 900,
        "hourly": 3600,
        "daily": 86400,
    }.get(freq, 300)


# ============================================================================
# 7–8. Policy CRUD (Circuit Board)
# ============================================================================

@router.get("/policy/{address}")
async def get_policy(address: str) -> dict[str, Any]:
    """Load active Circuit Board policy for an address."""
    try:
        policy = _vault_policy_svc().get_policy(address, create_if_missing=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not policy:
        raise HTTPException(status_code=400, detail="Invalid address")

    from app.services.vault_policy_service import VaultPolicyService
    return {
        "address": address,
        "policy": policy,
        "policy_hash": VaultPolicyService.policy_hash(policy),
    }


@router.put("/policy/{address}")
async def put_policy(address: str, body: PolicyPutRequest) -> dict[str, Any]:
    """Save (patch-merge) Circuit Board policy."""
    try:
        updated = _vault_policy_svc().put_policy(address, body.patch)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    from app.services.vault_policy_service import VaultPolicyService
    return {
        "address": address,
        "updated": True,
        "policy": updated,
        "policy_hash": VaultPolicyService.policy_hash(updated),
    }


# ============================================================================
# 9–10. Emergency pause / unpause
# ============================================================================

@router.post("/emergency/pause")
async def emergency_pause() -> dict[str, Any]:
    """Set emergency_pause=true across ALL user policies (system-wide)."""
    svc = _vault_policy_svc()

    from app.services.vault_policy_service import _read_all, _write_all
    policies = _read_all()
    affected = 0
    for addr, pol in policies.items():
        ep = pol.setdefault("execution_policy", {})
        if not ep.get("emergency_pause"):
            ep["emergency_pause"] = True
            pol["updated_at"] = _now_iso()
            affected += 1
    _write_all(policies)

    return {
        "action": "pause",
        "affected_policies": affected,
        "timestamp": _now_iso(),
    }


@router.post("/emergency/unpause")
async def emergency_unpause() -> dict[str, Any]:
    """Clear emergency_pause across ALL user policies."""
    svc = _vault_policy_svc()

    from app.services.vault_policy_service import _read_all, _write_all
    policies = _read_all()
    affected = 0
    for addr, pol in policies.items():
        ep = pol.get("execution_policy", {})
        if ep.get("emergency_pause"):
            ep["emergency_pause"] = False
            pol["updated_at"] = _now_iso()
            affected += 1
    _write_all(policies)

    return {
        "action": "unpause",
        "affected_policies": affected,
        "timestamp": _now_iso(),
    }


# ============================================================================
# ============================================================================
# 11. GET /stream/{address} — Unified Intelligence Stream
# ============================================================================

async def _fetch_live_opportunities(limit: int = 15) -> list[dict]:
    """Pull live opportunities from oracle + strategy service. Never calls FastAPI endpoints."""
    opportunities: list[dict] = []
    now = _now_iso()

    # Ekubo LP via oracle snapshot
    try:
        oracle = _mainnet_oracle()
        snapshot = oracle.get_latest_snapshot()
        if snapshot:
            snap_dict = snapshot.to_dict() if hasattr(snapshot, "to_dict") else {}
            ekubo = snap_dict.get("ekubo", {})
            ts = snap_dict.get("timestamp", now)
            apy_bps = int(ekubo.get("apy_bps", 0))
            vol_bps = int(ekubo.get("volatility_bps", 0))
            if apy_bps > 0:
                opportunities.append({
                    "id": "ekubo_eth_usdc_oracle",
                    "venue": "ekubo", "pair": "ETH/USDC",
                    "apy_bps": apy_bps, "tvl": ekubo.get("tvl", 0),
                    "risk_level": "medium" if vol_bps > 300 else "low",
                    "composite_score": _composite_score(apy_bps, vol_bps),
                    "source": "ekubo_oracle", "snapshot_ts": ts,
                })
    except Exception as exc:
        logger.debug("stream: oracle ekubo: %s", exc)

    # Strategy pool aggregator — pull from pool_analyzer directly
    try:
        from app.services.pool_analyzer import analyze_pools
        pools = await analyze_pools("balanced")
        for pool in (pools or []):
            pool_id = getattr(pool, "pool_id", "")
            if not pool_id or any(o["id"] == pool_id for o in opportunities):
                continue
            raw_protocol = getattr(pool, "protocol", "ekubo")
            protocol = (raw_protocol.value if hasattr(raw_protocol, "value") else str(raw_protocol)).lower()
            apy_bps = int(float(getattr(pool, "expected_apy", 0)) * 10000)
            rs = float(getattr(pool, "risk_score", 50))
            pair = getattr(pool, "pair", pool_id)
            tvl = getattr(pool, "liquidity_usd", 0) or getattr(pool, "tvl", 0)
            venue = "ekubo" if "ekubo" in protocol or "jedi" in protocol else (
                "lending" if "vesu" in protocol or "lending" in protocol else protocol
            )
            opportunities.append({
                "id": pool_id,
                "venue": venue,
                "pair": pair,
                "apy_bps": apy_bps,
                "tvl": tvl,
                "risk_level": "low" if rs < 30 else ("high" if rs > 60 else "medium"),
                "composite_score": _composite_score(apy_bps, int(rs * 5)),
                "source": "pool_analyzer",
                "snapshot_ts": now,
            })
    except Exception as exc:
        logger.debug("stream: pool_analyzer: %s", exc)

    # Native Starknet staking — always show
    opportunities.append({
        "id": "starknet_native_staking",
        "venue": "staking", "pair": "STRK Native Staking",
        "apy_bps": 480, "tvl": 0,
        "risk_level": "low",
        "composite_score": _composite_score(480, 50),
        "source": "native_staking", "snapshot_ts": now,
    })

    # Native lending pool — always show
    opportunities.append({
        "id": "native_lending_strk",
        "venue": "lending", "pair": "STRK Lending Pool",
        "apy_bps": 320, "tvl": 0,
        "risk_level": "low",
        "composite_score": _composite_score(320, 100),
        "source": "lending_oracle", "snapshot_ts": now,
    })

    opportunities.sort(key=lambda o: o.get("composite_score", 0), reverse=True)
    return opportunities[:limit]


@router.get("/stream/{address}")
async def get_unified_stream(
    address: str,
    types: str = Query(
        "all",
        description="Comma-separated: receipt,decision,opportunity,policy,privacy,governance,system,lending,staking",
    ),
    limit: int = Query(30, ge=1, le=200),
) -> dict[str, Any]:
    """Unified intelligence stream — live opportunities + receipts + governance."""
    items: list[dict[str, Any]] = []
    requested = set(types.split(",")) if types != "all" else {"all"}
    want_all = "all" in requested
    lim = int(limit)

    # Receipts + historical events
    if want_all or requested & {"receipt", "decision", "policy", "privacy", "system"}:
        try:
            timeline_resp = await get_receipts_timeline(address, type="all", limit=lim)
            for day_group in timeline_resp.get("timeline", []):
                for r in day_group.get("receipts", []):
                    item_type = _stream_type_from_receipt(r)
                    if want_all or item_type in requested:
                        items.append({
                            "id": r.get("receipt_id", ""),
                            "type": item_type,
                            "timestamp": r.get("timestamp", ""),
                            "title": r.get("intent_summary", ""),
                            "subtitle": r.get("strategy_name", ""),
                            "status": r.get("gate_status", ""),
                            "trust_delta": r.get("trust_delta", 0),
                            "hashes": r.get("hashes", {}),
                            "source": r.get("source", ""),
                            "actions": _actions_for_type(item_type),
                        })
        except Exception as exc:
            logger.debug("stream: receipts: %s", exc)

    # Live opportunities — Ekubo LP, Staking, Lending
    if want_all or requested & {"opportunity", "staking", "lending"}:
        try:
            opps = await _fetch_live_opportunities(limit=min(lim, 15))
            venue_labels = {"ekubo": "Ekubo LP", "staking": "Native Staking", "lending": "Lending Pool"}
            for opp in opps:
                v = opp.get("venue", "")
                apy_bps = int(opp.get("apy_bps", 0))
                risk = opp.get("risk_level", "unknown")
                score = float(opp.get("composite_score", 0))
                # Map venue to stream item type
                if v == "staking":
                    item_type = "staking"
                    actions = ["manage_stake", "claim_rewards"]
                elif v == "lending":
                    item_type = "lending"
                    actions = ["manage_position", "borrow_against"]
                else:
                    item_type = "opportunity"
                    actions = ["deploy", "query_intelligence"]

                if not (want_all or item_type in requested or "opportunity" in requested):
                    continue

                items.append({
                    "id": opp.get("id", ""),
                    "type": item_type,
                    "timestamp": opp.get("snapshot_ts", _now_iso()),
                    "title": f"{opp.get('pair', '')} — {apy_bps / 100:.1f}% APY",
                    "subtitle": f"{venue_labels.get(v, v)} · Risk: {risk}",
                    "status": "active",
                    "venue": v,
                    "apy_bps": apy_bps,
                    "risk_level": risk,
                    "composite_score": score,
                    "source": opp.get("source", "oracle"),
                    "actions": actions,
                })
        except Exception as exc:
            logger.warning("stream: opportunities: %s", exc)

    # Governance proposals
    if want_all or "governance" in requested:
        try:
            proposals_raw = _load_json_file(DATA_DIR / "dao_proposals.json")
            if isinstance(proposals_raw, list):
                for prop in proposals_raw:
                    if not isinstance(prop, dict):
                        continue
                    items.append({
                        "id": f"gov-{prop.get('id', '')}",
                        "type": "governance",
                        "timestamp": prop.get("created_at", ""),
                        "title": f"Proposal #{prop.get('id', '')}: {prop.get('description', '')}",
                        "subtitle": f"Type: {prop.get('proposal_type', '')} · Status: {prop.get('status', '')}",
                        "status": prop.get("status", ""),
                        "actions": ["open_governance"],
                    })
        except Exception as exc:
            logger.debug("stream: governance: %s", exc)

    items.sort(key=lambda i: i.get("timestamp", ""), reverse=True)
    return {
        "address": address,
        "items": items[:lim],
        "count": len(items[:lim]),
        "timestamp": _now_iso(),
    }



def _stream_type_from_receipt(r: dict) -> str:
    """Map a receipt/event to a stream item type."""
    source = r.get("source", "")
    rtype = r.get("type", "")
    intent = (r.get("intent_summary") or "").lower()

    if "privacy" in intent or "commitment" in intent or "shield" in intent or "nullifier" in intent:
        return "privacy"
    if source == "decision_event":
        if rtype == "warning":
            return "policy"
        return "decision"
    if rtype == "gate":
        return "policy"
    if "lend" in intent or "supply" in intent or "borrow" in intent or "repay" in intent:
        return "lending"
    if "stak" in intent or "delegat" in intent:
        return "staking"
    if rtype == "warning":
        return "system"
    return "receipt"


def _actions_for_type(item_type: str) -> list[str]:
    """Return available actions for a stream item type."""
    return {
        "receipt": ["inspect", "export"],
        "decision": ["override", "adjust_limit"],
        "opportunity": ["deploy", "create_rule"],
        "policy": ["view_policy", "edit_circuit_board"],
        "privacy": ["inspect_proof", "view_l3"],
        "governance": ["open_governance"],
        "system": ["view_explorer"],
        "lending": ["manage_position", "borrow_against"],
        "staking": ["manage_stake", "claim_rewards"],
    }.get(item_type, ["inspect"])
