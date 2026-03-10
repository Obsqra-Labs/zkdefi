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
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.middleware.auth import WalletOwner, AdminOnly

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

    # -- oracle market data (Ekubo only; JediSwap deprecated) --
    try:
        oracle = _mainnet_oracle()
        snapshot = oracle.get_latest_snapshot()
        if snapshot:
            snap_dict = snapshot.to_dict()
            ekubo = snap_dict.get("ekubo", {})

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
    global _last_signal_metrics
    _last_signal_metrics = _assign_signal_labels(opportunities)
    opportunities = opportunities[:limit]

    return {
        "opportunities": opportunities,
        "count": len(opportunities),
        "timestamp": _now_iso(),
    }


def _composite_score(apy_bps: int, volatility_bps: int) -> float:
    """Higher APY is better, higher volatility is worse."""
    return round(max(0.0, apy_bps - volatility_bps * 0.5) / 100, 2)


_TOKEN_RE = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")
_GARBLED_TOKEN_RE = re.compile(r"^[A-F0-9]{6,}$")
_KNOWN_TOKENS = {
    "ETH", "STRK", "USDC", "USDT", "DAI", "WBTC", "LINK", "LORDS", "EKUBO",
    "USDE", "CRVUSD", "GHO", "SSTR", "ZKLEND", "ZKDAI", "ZKDETH",
}
_SOURCE_RELIABILITY = {
    "ekubo_live": 0.96,
    "ekubo_oracle": 0.90,
    "lending_oracle": 0.86,
    "native_staking": 0.86,
    "mm_sim": 0.70,
}
_VENUE_QUALITY = {
    "ekubo": 0.92,
    "staking": 0.82,
    "lending": 0.81,
    "zkd_lp": 0.68,
}
_RISK_BPS = {"low": 220, "medium": 950, "high": 2200}
_last_signal_metrics: dict[str, Any] = {}
_SIGNAL_PRIORITY = {
    "top_pick": 0,
    "trending": 1,
    "rising": 2,
    "active": 3,
    "stable": 4,
}


def _clamp_int(value: float, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, int(round(value))))


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _minmax_norm(value: float, min_value: float, max_value: float) -> float:
    if max_value <= min_value:
        return 0.5
    return max(0.0, min(1.0, (value - min_value) / (max_value - min_value)))


def _pair_tokens(pair: str) -> tuple[str, str] | None:
    text = str(pair or "").strip().upper()
    if "/" not in text:
        return None
    left, right = [p.strip() for p in text.split("/", 1)]
    if not left or not right:
        return None
    return left, right


def _token_ok(symbol: str) -> bool:
    tok = str(symbol or "").strip().upper()
    if not _TOKEN_RE.match(tok):
        return False
    if tok in {"TOKEN", "UNKNOWN", "N/A", "NA"}:
        return False
    if _GARBLED_TOKEN_RE.match(tok) and tok not in _KNOWN_TOKENS:
        return False
    return True


def _is_signal_eligible(opp: dict[str, Any]) -> bool:
    pair_tokens = _pair_tokens(str(opp.get("pair", "")))
    if not pair_tokens:
        return False
    if not _token_ok(pair_tokens[0]) or not _token_ok(pair_tokens[1]):
        return False
    if _safe_float(opp.get("tvl"), 0.0) <= 0:
        return False
    if _safe_float(opp.get("volume_24h"), 0.0) <= 0:
        return False
    return True


def _pair_family_key(pair: str) -> str:
    pair_tokens = _pair_tokens(pair)
    if not pair_tokens:
        return str(pair).upper()
    return "/".join(sorted(pair_tokens))


def _apply_diversity_guards(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return rows
    remaining = list(rows)
    selected: list[dict[str, Any]] = []
    venue_counts: dict[str, int] = defaultdict(int)
    family_counts: dict[str, int] = defaultdict(int)

    while remaining:
        chosen_idx: int | None = None
        for idx, opp in enumerate(remaining):
            venue = str(opp.get("venue", "unknown"))
            family = _pair_family_key(str(opp.get("pair", "")))
            if len(selected) < 6 and venue_counts[venue] >= 2:
                continue
            if len(selected) < 4 and family_counts[family] >= 1:
                continue
            chosen_idx = idx
            break
        if chosen_idx is None:
            chosen_idx = 0

        opp = remaining.pop(chosen_idx)
        selected.append(opp)
        venue_counts[str(opp.get("venue", "unknown"))] += 1
        family_counts[_pair_family_key(str(opp.get("pair", "")))] += 1

    return selected


def _signal_reason(opp: dict[str, Any]) -> str:
    contributions = opp.get("signal_features", {}).get("weighted_contributions", {})
    if not isinstance(contributions, dict) or not contributions:
        return "Ranked by composite signal model."
    top = sorted(contributions.items(), key=lambda kv: float(kv[1]), reverse=True)[:2]
    labels = [str(k).replace("_", " ") for k, _ in top]
    if len(labels) == 1:
        return f"Strong {labels[0]} signal."
    return f"Driven by {labels[0]} and {labels[1]}."


def _signal_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    distribution: dict[str, int] = defaultdict(int)
    reason_populated = 0
    stale = 0

    for row in rows:
        distribution[str(row.get("signal", "stable"))] += 1
        if str(row.get("signal_reason", "")).strip():
            reason_populated += 1
        ts = str(row.get("snapshot_ts", ""))
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if (now - dt).total_seconds() > 900:
                stale += 1
        except Exception:
            stale += 1

    top6 = rows[:6]
    venues = {str(r.get("venue", "unknown")) for r in top6}
    return {
        "signal_distribution": dict(distribution),
        "top6_unique_venues": len(venues),
        "reason_populated_pct": round((reason_populated / max(len(rows), 1)) * 100.0, 2),
        "stale_signal_rate_pct": round((stale / max(len(rows), 1)) * 100.0, 2),
        "scored_count": len(rows),
    }


def _assign_signal_labels(opportunities: list[dict[str, Any]]) -> dict[str, Any]:
    """Assign deterministic signal tiers/strength/features and return signal metrics."""
    if not opportunities:
        return _signal_metrics([])

    eligible = [o for o in opportunities if _is_signal_eligible(o)]
    for opp in opportunities:
        if opp not in eligible:
            opp["signal"] = "stable"
            opp["signal_strength"] = 12
            opp["signal_reason"] = "Filtered: invalid pair or missing liquidity/activity."
            opp["signal_features"] = {"eligible": False}

    if not eligible:
        return _signal_metrics(opportunities)

    # Feature extraction
    for opp in eligible:
        apy_bps = _safe_float(opp.get("apy_bps"), 0.0)
        risk_bps = _RISK_BPS.get(str(opp.get("risk_level", "medium")), 950)
        tvl = _safe_float(opp.get("tvl"), 0.0)
        volume_24h = _safe_float(opp.get("volume_24h"), 0.0)
        turnover = volume_24h / max(tvl, 1.0)
        age_seconds = 900.0
        ts = str(opp.get("snapshot_ts", ""))
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age_seconds = max(0.0, (datetime.now(timezone.utc) - dt).total_seconds())
        except Exception:
            pass

        edge_raw = apy_bps - risk_bps
        liq_raw = math.log10(max(tvl, 1.0))
        activity_raw = min(2.5, turnover) + min(1.0, volume_24h / 1_000_000.0)
        calibration = _SOURCE_RELIABILITY.get(str(opp.get("source", "")), 0.62)
        recency = max(0.0, min(1.0, 1.0 - (age_seconds / 3600.0)))
        venue_quality = _VENUE_QUALITY.get(str(opp.get("venue", "")), 0.6)

        opp["_signal_tmp"] = {
            "edge_raw": edge_raw,
            "liq_raw": liq_raw,
            "activity_raw": activity_raw,
            "calibration": calibration,
            "recency": recency,
            "venue_quality": venue_quality,
            "turnover": turnover,
            "age_seconds": age_seconds,
        }

    edge_values = [o["_signal_tmp"]["edge_raw"] for o in eligible]
    liq_values = [o["_signal_tmp"]["liq_raw"] for o in eligible]
    act_values = [o["_signal_tmp"]["activity_raw"] for o in eligible]
    edge_min, edge_max = min(edge_values), max(edge_values)
    liq_min, liq_max = min(liq_values), max(liq_values)
    act_min, act_max = min(act_values), max(act_values)

    for opp in eligible:
        raw = opp["_signal_tmp"]
        edge_norm = _minmax_norm(raw["edge_raw"], edge_min, edge_max)
        liq_norm = _minmax_norm(raw["liq_raw"], liq_min, liq_max)
        act_norm = _minmax_norm(raw["activity_raw"], act_min, act_max)

        score = (
            edge_norm * 0.35
            + liq_norm * 0.20
            + act_norm * 0.15
            + raw["calibration"] * 0.15
            + raw["recency"] * 0.10
            + raw["venue_quality"] * 0.05
        ) * 100.0

        contributions = {
            "edge": round(edge_norm * 35, 3),
            "liquidity_quality": round(liq_norm * 20, 3),
            "activity_turnover": round(act_norm * 15, 3),
            "calibration_reliability": round(raw["calibration"] * 15, 3),
            "recency": round(raw["recency"] * 10, 3),
            "venue_quality": round(raw["venue_quality"] * 5, 3),
        }

        opp["signal_score"] = round(score, 4)
        opp["signal_features"] = {
            "eligible": True,
            "edge_bps": round(raw["edge_raw"], 3),
            "edge": round(edge_norm * 100, 3),
            "liquidity_quality": round(liq_norm * 100, 3),
            "activity_turnover": round(act_norm * 100, 3),
            "calibration_reliability": round(raw["calibration"] * 100, 3),
            "recency": round(raw["recency"] * 100, 3),
            "venue_quality": round(raw["venue_quality"] * 100, 3),
            "turnover": round(raw["turnover"], 6),
            "weighted_contributions": contributions,
        }

    for opp in eligible:
        opp.pop("_signal_tmp", None)

    ranked = sorted(eligible, key=lambda o: float(o.get("signal_score", 0.0)), reverse=True)
    ranked = _apply_diversity_guards(ranked)

    n = len(ranked)
    trending_n = max(1, int(math.ceil(n * 0.25)))
    rising_n = max(1, int(math.ceil(n * 0.40)))
    turnover_active_threshold = 1.25

    for idx, opp in enumerate(ranked):
        turnover = _safe_float(opp.get("signal_features", {}).get("turnover"), 0.0)
        if idx == 0:
            signal = "top_pick"
            strength = 100
            reason = "Highest rank in current signal universe."
        elif idx <= trending_n:
            signal = "trending"
            strength = _clamp_int(max(78.0, _safe_float(opp.get("signal_score"), 0.0)))
            reason = _signal_reason(opp)
        elif turnover >= turnover_active_threshold:
            signal = "active"
            strength = _clamp_int(max(68.0, _safe_float(opp.get("signal_score"), 0.0)))
            reason = "High turnover override from live activity."
        elif idx <= (trending_n + rising_n):
            signal = "rising"
            strength = _clamp_int(max(55.0, _safe_float(opp.get("signal_score"), 0.0)))
            reason = _signal_reason(opp)
        else:
            signal = "stable"
            strength = _clamp_int(max(30.0, _safe_float(opp.get("signal_score"), 0.0)))
            reason = "Lower relative score in current market set."

        opp["signal"] = signal
        opp["signal_strength"] = int(strength)
        opp["signal_reason"] = reason

    # keep original list mutated
    ranked_ids = {str(r.get("id", "")): r for r in ranked}
    for i, opp in enumerate(opportunities):
        rid = str(opp.get("id", ""))
        if rid in ranked_ids:
            opportunities[i].update(ranked_ids[rid])

    return _signal_metrics(opportunities)


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
async def put_constraints(address: str, body: ConstraintsPutRequest, _caller: str = WalletOwner) -> dict[str, Any]:
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
async def put_policy(address: str, body: PolicyPutRequest, _caller: str = WalletOwner) -> dict[str, Any]:
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


# ============================================================================
# 8b. Rebalance mode (focused per-user read/write)
# ============================================================================

_VALID_REBALANCE_MODES = {"user", "oracle"}


class RebalanceModePutRequest(BaseModel):
    rebalance_mode: str = Field(..., description="'user' or 'oracle'")


@router.get("/rebalance-mode/{address}")
async def get_rebalance_mode(address: str) -> dict[str, Any]:
    """Read the rebalance mode for an address."""
    policy = _vault_policy_svc().get_policy(address, create_if_missing=True)
    mode = (policy or {}).get("execution_policy", {}).get("rebalance_mode", "user")
    return {"address": address, "rebalance_mode": mode}


@router.put("/rebalance-mode/{address}")
async def put_rebalance_mode(
    address: str,
    body: RebalanceModePutRequest,
    _caller: str = WalletOwner,
) -> dict[str, Any]:
    """Set rebalance mode (user or oracle) for an address."""
    if body.rebalance_mode not in _VALID_REBALANCE_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid rebalance_mode '{body.rebalance_mode}'. Must be one of: {', '.join(sorted(_VALID_REBALANCE_MODES))}",
        )
    _vault_policy_svc().put_policy(
        address, {"execution_policy": {"rebalance_mode": body.rebalance_mode}}
    )
    return {"address": address, "rebalance_mode": body.rebalance_mode, "updated": True}


@router.post("/emergency/pause")
async def emergency_pause(_admin: str = AdminOnly) -> dict[str, Any]:
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
async def emergency_unpause(_admin: str = AdminOnly) -> dict[str, Any]:
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
                tvl = _safe_float(ekubo.get("tvl", 0), 0.0)
                volume_24h = _safe_float(
                    ekubo.get("volume_24h", ekubo.get("volume_24h_usd", 0.0)),
                    0.0,
                )
                if volume_24h <= 0 and tvl > 0:
                    volume_24h = tvl * 0.18
                opportunities.append({
                    "id": "ekubo_eth_usdc_oracle",
                    "venue": "ekubo", "pair": "ETH/USDC",
                    "apy_bps": apy_bps,
                    "tvl": tvl,
                    "volume_24h": volume_24h,
                    "risk_level": "medium" if vol_bps > 300 else "low",
                    "composite_score": _composite_score(apy_bps, vol_bps),
                    "source": "ekubo_oracle", "snapshot_ts": ts,
                })
    except Exception as exc:
        logger.debug("stream: oracle ekubo: %s", exc)

    # Live Ekubo pool data — prod-api.ekubo.org via pool_metrics
    try:
        from app.services.pool_metrics import fetch_pool_metrics
        live_pools = await fetch_pool_metrics(min_tvl_usd=100, limit=30)
        for pm in sorted(live_pools, key=lambda p: -p.apy_pct):
            if any(o["id"] == pm.pool_id for o in opportunities):
                continue
            apy_bps = int(pm.apy_pct * 100)
            if apy_bps == 0:
                continue  # skip zero-APY pools
            risk_score = {"stable": 10, "blue_chip": 35, "volatile": 65, "concentrated": 85}.get(pm.risk_tier, 50)
            risk_level = "low" if risk_score < 30 else ("high" if risk_score > 60 else "medium")
            opportunities.append({
                "id": pm.pool_id,
                "venue": "ekubo",
                "pair": pm.pair,
                "apy_bps": apy_bps,
                "tvl": pm.tvl_usd,
                "volume_24h": pm.volume_24h_usd,
                "risk_level": risk_level,
                "risk_tier": pm.risk_tier,
                "composite_score": _composite_score(apy_bps, risk_score * 5),
                "source": "ekubo_live",
                "snapshot_ts": now,
            })
    except Exception as exc:
        logger.debug("stream: pool_metrics (ekubo live): %s", exc)

    # zkdAI/zkdETH pools — read from market-maker-sim data file (sim may be offline)
    try:
        import json as _json
        _sim_data_path = Path(__file__).resolve().parents[4] / "market-maker-sim" / "data" / "bot_lp_positions.json"
        if _sim_data_path.exists():
            _sim = _json.loads(_sim_data_path.read_text())
            _seen_pairs: set[str] = set()
            for pos in (_sim.get("positions") or []):
                pair = pos.get("pair", "")
                if "zkd" not in pair.lower() or pair in _seen_pairs:
                    continue
                _seen_pairs.add(pair)
                # Aggregate amounts across positions with same pair
                amount_wei = float(pos.get("amount0_wei", 0)) + float(pos.get("amount1_wei", 0))
                tvl_approx = amount_wei / 1e18  # rough ETH-unit TVL
                volume_24h = max(tvl_approx * 0.22, 50.0)
                opportunities.append({
                    "id": f"zkd_lp_{pair.lower().replace('/', '_')}",
                    "venue": "zkd_lp",
                    "pair": pair,
                    "apy_bps": 850,  # synthetic pool baseline APY
                    "tvl": tvl_approx,
                    "volume_24h": volume_24h,
                    "risk_level": "medium",
                    "risk_tier": "zkd_synthetic",
                    "composite_score": _composite_score(850, 250),
                    "source": "mm_sim",
                    "snapshot_ts": now,
                })
    except Exception as exc:
        logger.debug("stream: zkd sim pools: %s", exc)

    # Native Starknet staking — always show
    opportunities.append({
        "id": "starknet_native_staking",
        "venue": "staking", "pair": "STRK Native Staking",
        "apy_bps": 480,
        "tvl": 3_200_000,
        "volume_24h": 128_000,
        "risk_level": "low",
        "composite_score": _composite_score(480, 50),
        "source": "native_staking", "snapshot_ts": now,
    })

    # Native lending pool — always show
    opportunities.append({
        "id": "native_lending_strk",
        "venue": "lending", "pair": "STRK Lending Pool",
        "apy_bps": 320,
        "tvl": 2_100_000,
        "volume_24h": 84_000,
        "risk_level": "low",
        "composite_score": _composite_score(320, 100),
        "source": "lending_oracle", "snapshot_ts": now,
    })

    # -- Signal ranking: label top opportunities as trending/rising/recommended --
    # Sort by composite score before returning
    opportunities.sort(key=lambda o: o.get("composite_score", 0), reverse=True)

    global _last_signal_metrics
    _last_signal_metrics = _assign_signal_labels(opportunities)

    opportunities.sort(
        key=lambda o: (
            _SIGNAL_PRIORITY.get(str(o.get("signal", "stable")), 9),
            -_safe_float(o.get("signal_score"), 0.0),
            -_safe_float(o.get("composite_score"), 0.0),
            str(o.get("id", "")),
        )
    )

    return opportunities[:limit]


@router.get("/signal/top")
async def get_signal_top(
    limit: int = Query(12, ge=1, le=30),
) -> dict[str, Any]:
    """
    Top opportunities for the Oracle Dashboard Strip (Signals).
    Same curated, signal-ranked list as the stream — Ekubo live pools, zkd LP, staking, lending.
    No JediSwap; single source of truth for market intelligence.
    """
    opps = await _fetch_live_opportunities(limit=limit)
    # Format for strip: id, name, venue, apy_bps, risk_level, volatility, liquidity_score, efficiency
    risk_to_vol = {"low": 20, "medium": 50, "high": 80}
    out = []
    for o in opps:
        vol = o.get("volume_24h") or 0
        tvl = o.get("tvl") or 0
        out.append({
            "id": o.get("id", ""),
            "name": o.get("pair", o.get("id", "")),
            "venue": o.get("venue", "ekubo"),
            "apy_bps": o.get("apy_bps", 0),
            "risk_level": o.get("risk_level", "medium"),
            "volatility": risk_to_vol.get(o.get("risk_level", "medium"), 50),
            "liquidity_score": min(100, int(tvl / 10_000)) if tvl else 50,
            "efficiency": o.get("composite_score", 0) * 10,
            "signal": o.get("signal", "stable"),
            "signal_strength": int(o.get("signal_strength", 0) or 0),
            "signal_reason": o.get("signal_reason", ""),
            "signal_features": o.get("signal_features", {}),
        })
    return {
        "opportunities": out,
        "count": len(out),
        "signal_metrics": _last_signal_metrics,
        "timestamp": _now_iso(),
    }


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

    # Live opportunities — curated, signal-ranked, top picks surfaced first
    if want_all or requested & {"opportunity", "staking", "lending"}:
        try:
            # Pull top 20 ranked, then take the best 8 for the stream
            opps = await _fetch_live_opportunities(limit=20)
            curated = opps[:8]  # already sorted by composite_score

            venue_labels = {
                "ekubo": "Ekubo LP",
                "staking": "Native Staking",
                "lending": "Lending Pool",
                "zkd_lp": "zkd Synthetic LP",
            }
            signal_labels = {
                "top_pick": "Top Pick",
                "trending": "Trending",
                "rising": "Rising",
                "active": "High Activity",
                "stable": "Stable",
            }
            for opp in curated:
                v = opp.get("venue", "")
                apy_bps = int(opp.get("apy_bps", 0))
                risk = opp.get("risk_level", "unknown")
                score = float(opp.get("composite_score", 0))
                signal = opp.get("signal", "stable")

                if v == "staking":
                    item_type = "staking"
                    actions = ["manage_stake", "claim_rewards"]
                elif v == "lending":
                    item_type = "lending"
                    actions = ["manage_position", "borrow_against"]
                elif v == "zkd_lp":
                    item_type = "opportunity"
                    actions = ["deploy", "query_intelligence"]
                else:
                    item_type = "opportunity"
                    actions = ["deploy", "query_intelligence"]

                if not (want_all or item_type in requested or "opportunity" in requested):
                    continue

                venue_label = venue_labels.get(v, v)
                signal_label = signal_labels.get(signal, signal)
                items.append({
                    "id": opp.get("id", ""),
                    "type": item_type,
                    "timestamp": opp.get("snapshot_ts", _now_iso()),
                    "title": f"{opp.get('pair', '')}",
                    "subtitle": f"{venue_label} · {signal_label} · {risk.capitalize()} risk",
                    "status": "active",
                    "venue": v,
                    "apy_bps": apy_bps,
                    "risk_level": risk,
                    "composite_score": score,
                    "signal": signal,
                    "signal_strength": int(opp.get("signal_strength", 0) or 0),
                    "signal_reason": str(opp.get("signal_reason", "")),
                    "signal_features": opp.get("signal_features", {}),
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
