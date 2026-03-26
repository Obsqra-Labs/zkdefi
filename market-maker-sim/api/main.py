from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from bots.onchain_engine import OnChainEngine
from bots.chain_reader import (
    ETH, STRK, ZKDETH, ZKDAI, EKUBO_CORE, EKUBO_POSITIONS, EKUBO_ROUTER,
    build_default_pools, get_token_balance,
)
from bots.wallet_manager import WalletManager
from bots.agent_runner import AgentFleetRunner
from config.agents import build_fleet_profiles
from config.settings import settings

logger = logging.getLogger(__name__)

app = FastAPI(title="zkDeFi Market Maker", version="3.0.0")

origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Wallet + Engine ──────────────────────────────────────────────────────────
wallet = WalletManager(
    rpc_url=settings.rpc_url,
    account_address=settings.bot_account_address,
    private_key=settings.bot_private_key,
)

engine = OnChainEngine(
    poll_interval_sec=settings.poll_interval_sec,
    rpc_url=settings.rpc_url,
    pools=build_default_pools(),
    wallet=wallet,
    swap_interval_sec=settings.swap_bot_interval_sec,
    swap_min_amount=settings.swap_bot_min_amount,
    swap_max_amount=settings.swap_bot_max_amount,
    swap_enabled_on_start=settings.swap_bot_enabled_on_start,
    lp_interval_sec=settings.lp_bot_interval_sec,
    lp_amount0=settings.lp_bot_amount0,
    lp_amount1=settings.lp_bot_amount1,
    lp_tick_width=settings.lp_bot_tick_width,
    lp_max_positions_per_pool=settings.lp_bot_max_positions_per_pool,
    lp_rebalance_enabled=settings.lp_bot_rebalance_enabled,
    lp_stale_threshold_pct=settings.lp_bot_stale_threshold_pct,
    lp_enabled_on_start=settings.lp_bot_enabled_on_start,
    limit_interval_sec=settings.limit_bot_interval_sec,
    limit_amount=settings.limit_bot_amount,
    limit_enabled_on_start=settings.limit_bot_enabled_on_start,
    coordination_enabled=settings.coordination_enabled,
    coordination_cycle_sec=settings.coordination_cycle_sec,
    coordination_min_active_lp_per_pair=settings.coordination_min_active_lp_per_pair,
    coordination_max_actions_per_cycle=settings.coordination_max_actions_per_cycle,
    coordination_auto_close_stale=settings.coordination_auto_close_stale,
    coordination_auto_recenter=settings.coordination_auto_recenter,
    coordination_limit_support_enabled=settings.coordination_limit_support_enabled,
    coordination_target_pairs=settings.coordination_target_pairs,
    coordination_volume_ramp_enabled=settings.coordination_volume_ramp_enabled,
    coordination_max_swap_actions_per_cycle=settings.coordination_max_swap_actions_per_cycle,
    coordination_coverage_boost_enabled=settings.coordination_coverage_boost_enabled,
    coordination_min_pool_coverage_ratio=settings.coordination_min_pool_coverage_ratio,
    coordination_max_coverage_swap_actions_per_cycle=settings.coordination_max_coverage_swap_actions_per_cycle,
    coordination_min_swap_size_multiplier=settings.coordination_min_swap_size_multiplier,
    coordination_max_swap_size_multiplier=settings.coordination_max_swap_size_multiplier,
    coordination_primary_volume_pairs=settings.coordination_primary_volume_pairs,
    coordination_volume_targets_usd=settings.coordination_volume_targets_usd,
)

# ── Agent Fleet ──────────────────────────────────────────────────────────────
fleet_max_agents = max(1, min(10, int(os.getenv("FLEET_MAX_AGENTS", "10"))))
fleet_profiles = build_fleet_profiles(max_agents=fleet_max_agents)
fleet = AgentFleetRunner(
    profiles=fleet_profiles,
    pools=build_default_pools(),
    rpc_url=settings.rpc_url,
)


async def require_admin(x_admin_key: str | None = Header(default=None)) -> None:
    if x_admin_key != settings.admin_api_key:
        raise HTTPException(status_code=401, detail="Admin key invalid")


@app.on_event("startup")
async def startup() -> None:
    fleet_enabled = os.getenv("FLEET_ENABLED", "true").lower() in ("true", "1", "yes")

    # When fleet is enabled, disable the engine's own swap/lp/limit bots
    # to avoid nonce contention (fleet agents handle all trading).
    if fleet_enabled:
        engine.set_startup_flags(swap=False, lp=False, limit=False)

    await engine.start()
    logger.info("On-chain engine started (poll every %.1fs)", settings.poll_interval_sec)

    # Start agent fleet in background (non-blocking so server can serve health)
    if fleet_enabled:
        engine.fleet = fleet

        async def _launch_fleet() -> None:
            try:
                started = await fleet.start_all()
                logger.info("Agent fleet started: %d agents (%s)", len(started), ", ".join(started))
            except Exception as exc:
                logger.error("Fleet startup failed: %s", exc)

        asyncio.create_task(_launch_fleet())
    else:
        logger.info("Agent fleet disabled (set FLEET_ENABLED=true to enable)")


@app.on_event("shutdown")
async def shutdown() -> None:
    await fleet.stop_all()
    await engine.stop()


# ── Public endpoints ─────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "zkdefi-market-maker", "mode": "real-activity"}


@app.get("/public/state")
async def get_public_state() -> dict[str, Any]:
    """Real-time on-chain state + bot activity for all tracked pools."""
    return await engine.snapshot()


@app.get("/public/events")
async def get_public_events(limit: int = 100) -> dict[str, Any]:
    """Recent events (price changes, bot transactions, pool discoveries)."""
    return {"items": await engine.recent_events(limit=limit)}


@app.get("/public/apy")
async def get_apy() -> dict[str, Any]:
    """Real APY computed from on-chain fee accrual."""
    if engine.apy_tracker:
        return engine.apy_tracker.status()
    return {"tracked_positions": 0, "weighted_apy_pct": 0.0}


@app.get("/public/contracts")
async def get_contracts() -> dict[str, Any]:
    """Return deployed token and Ekubo contract addresses."""
    addr_file = Path(__file__).parent.parent / "deployed_addresses.json"
    if addr_file.is_file():
        data = json.loads(addr_file.read_text())
    else:
        data = {}
    # Always include Ekubo infra addresses
    data.update({
        "ekubo_core": "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384",
        "ekubo_positions": "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5",
        "ekubo_router": "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763",
        "network": "sepolia",
    })
    return data


@app.get("/public/pools")
async def get_pools() -> dict[str, Any]:
    """Detailed per-pool state from on-chain reads."""
    snap = await engine.snapshot()
    return {
        "block_number": snap.get("block_number", 0),
        "pools": snap.get("pools", []),
        "data_quality": snap.get("data_quality", "loading"),
    }


@app.get("/public/positions")
async def get_positions() -> dict[str, Any]:
    """Return known LP positions from local state (see MM_SIM_EKUBO_POSITIONS_PATH)."""
    pos_file = Path(settings.ekubo_positions_path).expanduser()
    if not pos_file.is_file():
        pos_file = Path(__file__).resolve().parent.parent / "data" / "ekubo_positions.json"
    if pos_file.is_file():
        data = json.loads(pos_file.read_text())
        positions = data.get("positions", [])
        # Filter to active ones with real NFT IDs
        active = [p for p in positions if p.get("ekubo_nft_id") and p.get("status") not in ("closed", "removed")]
        return {"positions": active, "total": len(active)}
    return {"positions": [], "total": 0}


# ── WebSocket ────────────────────────────────────────────────────────────────
@app.websocket("/ws/public")
async def public_ws(socket: WebSocket) -> None:
    await socket.accept()
    try:
        while True:
            state = await engine.snapshot()
            events = await engine.recent_events(limit=15)
            await socket.send_json({"type": "state", "state": state, "events": events})
            await asyncio.sleep(settings.poll_interval_sec)
    except WebSocketDisconnect:
        return


# ── Admin: Bot control ───────────────────────────────────────────────────────

@app.get("/admin/state", dependencies=[Depends(require_admin)])
async def admin_state() -> dict[str, Any]:
    state = await engine.snapshot()
    controls = await engine.admin_state()
    return {"ok": True, "state": state, "controls": controls}


@app.post("/admin/bots/{bot_name}", dependencies=[Depends(require_admin)])
async def toggle_bot(bot_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Start/stop a real activity bot: swap, lp, limit."""
    enabled = bool(payload.get("enabled", True))
    try:
        result = await engine.set_bot(bot_name=bot_name, enabled=enabled)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "message": f"Bot {bot_name} {'started' if enabled else 'stopped'}", "result": result}


@app.post("/admin/trigger/swap", dependencies=[Depends(require_admin)])
async def trigger_swap(payload: dict[str, Any]) -> dict[str, Any]:
    """Execute a single real swap immediately."""
    pair = payload.get("pair")
    try:
        result = await engine.trigger_swap(pair=pair)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "message": "Swap executed", "result": result}


@app.post("/admin/trigger/lp", dependencies=[Depends(require_admin)])
async def trigger_lp(payload: dict[str, Any]) -> dict[str, Any]:
    """Create a real LP position immediately."""
    pair = payload.get("pair")
    try:
        result = await engine.trigger_lp(pair=pair)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "message": "LP position created", "result": result}


@app.post("/admin/trigger/limit", dependencies=[Depends(require_admin)])
async def trigger_limit(payload: dict[str, Any]) -> dict[str, Any]:
    """Place a real limit order immediately."""
    pair = payload.get("pair")
    try:
        result = await engine.trigger_limit_order(pair=pair)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "message": "Limit order placed", "result": result}


@app.post("/admin/trigger/collect-fees", dependencies=[Depends(require_admin)])
async def trigger_collect_fees() -> dict[str, Any]:
    """Collect fees from all LP positions."""
    try:
        result = await engine.collect_fees()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "message": "Fee collection triggered", "result": result}


@app.get("/admin/fees/policy", dependencies=[Depends(require_admin)])
async def get_fee_policy() -> dict[str, Any]:
    policy = await engine.get_fee_policy()
    return {"ok": True, "policy": policy}


@app.post("/admin/fees/policy", dependencies=[Depends(require_admin)])
async def set_fee_policy(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        policy = await engine.set_fee_policy(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "message": "Fee policy updated", "policy": policy}


@app.get("/admin/coordination/policy", dependencies=[Depends(require_admin)])
async def get_coordination_policy() -> dict[str, Any]:
    policy = await engine.get_coordination_policy()
    return {"ok": True, "policy": policy}


@app.post("/admin/coordination/policy", dependencies=[Depends(require_admin)])
async def set_coordination_policy(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        policy = await engine.set_coordination_policy(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "message": "Coordination policy updated", "policy": policy}


@app.post("/admin/coordination/run", dependencies=[Depends(require_admin)])
async def run_coordination_cycle() -> dict[str, Any]:
    result = await engine.run_coordination_cycle()
    return {"ok": True, "message": "Coordination cycle executed", "result": result}


@app.post("/admin/trade", dependencies=[Depends(require_admin)])
async def force_trade(payload: dict[str, Any]) -> dict[str, Any]:
    """Execute a real swap on a specific pair (or display override if no wallet)."""
    pair = str(payload.get("pair") or payload.get("pool") or "STRK/ETH")
    side = str(payload.get("side") or "buy")
    notional = float(payload.get("notional_usd") or payload.get("notional") or 0)
    try:
        result = await engine.manual_trade(pair=pair, side=side, notional_usd=notional)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "message": "Trade executed", "result": result}


@app.post("/admin/scenarios/trigger", dependencies=[Depends(require_admin)])
async def trigger_scenario(payload: dict[str, Any]) -> dict[str, Any]:
    scenario = str(payload.get("scenario") or "")
    severity = float(payload.get("severity") or 0.2)
    duration_ticks = int(payload.get("duration_ticks") or 30)
    try:
        result = await engine.trigger_scenario(scenario=scenario, severity=severity, duration_ticks=duration_ticks)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "message": "Scenario triggered", "result": result}


@app.post("/admin/peg", dependencies=[Depends(require_admin)])
async def set_peg(payload: dict[str, Any]) -> dict[str, Any]:
    """Apply a price bias overlay for a synthetic pair."""
    peg_price = float(payload.get("peg_price", 0.0))
    if peg_price <= 0:
        raise HTTPException(status_code=400, detail="peg_price must be > 0")
    snap = await engine.snapshot()
    pool = None
    for candidate in snap.get("pools", []):
        if str(candidate.get("name", "")).lower() in {"zkdai/zkdeth", "zkdeth/zkdai"}:
            pool = candidate
            break
    current = float(pool.get("price", 0.0)) if pool else 0.0
    bias_bps = ((peg_price - current) / max(current, 0.001)) * 10_000.0 if current > 0 else 0.0
    await engine.set_pair_override("zkdai/zkdeth", price_bias_bps=bias_bps)
    return {"ok": True, "message": "Peg bias applied", "bias_bps": round(bias_bps, 2)}


@app.post("/admin/pair/{pair_key:path}", dependencies=[Depends(require_admin)])
async def set_pair_state(pair_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    reset = bool(payload.get("reset", False))
    price_bias_bps = float(payload.get("price_bias_bps", 0.0))
    tvl_delta_usd = float(payload.get("tvl_delta_usd", 0.0))
    volume_delta_usd = float(payload.get("volume_delta_usd", 0.0))
    result = await engine.set_pair_override(
        pair_key=pair_key,
        price_bias_bps=price_bias_bps,
        tvl_delta_usd=tvl_delta_usd,
        volume_delta_usd=volume_delta_usd,
        reset=reset,
    )
    return {"ok": True, "message": "Pair override updated", "result": result}


@app.get("/admin/wallet", dependencies=[Depends(require_admin)])
async def wallet_info() -> dict[str, Any]:
    """Check bot wallet connection and balances."""
    if not wallet.configured:
        return {"ok": False, "error": "Bot wallet not configured"}
    conn = await wallet.connect_test()
    if not conn.get("ok"):
        return {"ok": False, "error": conn.get("error", "Connection failed")}

    # Fetch real token balances
    tokens = {
        "ETH": {"address": ETH, "decimals": 18},
        "STRK": {"address": STRK, "decimals": 18},
        "zkdETH": {"address": ZKDETH, "decimals": 18},
        "zkdAI": {"address": ZKDAI, "decimals": 18},
    }
    balances: dict[str, Any] = {}
    for sym, info in tokens.items():
        try:
            raw = await wallet.get_balance(info["address"])
            balances[sym] = {
                "raw": str(raw),
                "formatted": round(raw / (10 ** info["decimals"]), 6),
                "address": info["address"],
            }
        except Exception:
            balances[sym] = {"raw": "0", "formatted": 0.0, "address": info["address"]}

    return {
        "ok": True,
        "wallet": {
            **conn,
            "balances": balances,
        },
    }


# ── Tokenomics ──────────────────────────────────────────────────────────────
_TOKENOMICS_CACHE: dict[str, Any] = {}
_TOKENOMICS_TS: float = 0.0

@app.get("/public/tokenomics")
async def get_tokenomics() -> dict[str, Any]:
    """Return zkdETH and zkdAI token information + on-chain stats."""
    global _TOKENOMICS_CACHE, _TOKENOMICS_TS
    now = time.time()
    # Cache for 30s to avoid spam
    if _TOKENOMICS_CACHE and (now - _TOKENOMICS_TS) < 30:
        return _TOKENOMICS_CACHE

    rpc = settings.rpc_url
    bot_addr = settings.bot_account_address

    tokens_info = {
        "zkdETH": {
            "symbol": "zkdETH",
            "name": "zkDeFi Wrapped ETH",
            "address": ZKDETH,
            "decimals": 18,
            "description": "Yield-bearing synthetic ETH on Starknet. Backed by concentrated LP positions across Ekubo pools.",
            "type": "synthetic_yield",
            "peg_target": "ETH",
        },
        "zkdAI": {
            "symbol": "zkdAI",
            "name": "zkDeFi AI Stablecoin",
            "address": ZKDAI,
            "decimals": 18,
            "description": "AI-managed stablecoin pegged to $1. Collateralized by diversified DeFi positions.",
            "type": "stablecoin",
            "peg_target": "USD",
        },
    }

    for sym, info in tokens_info.items():
        try:
            # Bot's holdings
            bot_bal = await get_token_balance(rpc, info["address"], bot_addr) if bot_addr else 0
            # Core contract holdings (in pools)
            core_bal = await get_token_balance(rpc, info["address"], EKUBO_CORE)
            info["bot_balance_raw"] = str(bot_bal)
            info["bot_balance"] = round(bot_bal / (10 ** info["decimals"]), 4)
            info["in_pools_raw"] = str(core_bal)
            info["in_pools"] = round(core_bal / (10 ** info["decimals"]), 4)
            info["circulating"] = round((bot_bal + core_bal) / (10 ** info["decimals"]), 4)
        except Exception as exc:
            info["error"] = str(exc)

    # Get pool prices for zkdETH and zkdAI
    snap = await engine.snapshot()
    for pool in snap.get("pools", []):
        name = (pool.get("name") or "").lower()
        if "zkdeth" in name and "zkdai" in name:
            tokens_info["zkdETH"]["pool_price_vs_zkdai"] = pool.get("price")
            tokens_info["zkdAI"]["pool_price_vs_zkdeth"] = 1.0 / pool.get("price", 1) if pool.get("price") else None
        elif "zkdeth" in name and ("eth" in name and "zkd" not in name.replace("zkdeth", "")):
            tokens_info["zkdETH"]["pool_price_vs_eth"] = pool.get("price")
        elif "zkdai" in name and "strk" in name:
            tokens_info["zkdAI"]["pool_price_vs_strk"] = pool.get("price")

    result = {
        "tokens": tokens_info,
        "infrastructure": {
            "ekubo_core": EKUBO_CORE,
            "ekubo_positions": EKUBO_POSITIONS,
            "ekubo_router": EKUBO_ROUTER,
            "network": "starknet-sepolia",
        },
        "updated_at": now,
    }
    _TOKENOMICS_CACHE = result
    _TOKENOMICS_TS = now
    return result


@app.get("/public/agent")
async def get_agent_stats() -> dict[str, Any]:
    """Comprehensive agent/bot statistics for the dashboard."""
    snap = await engine.snapshot()
    bots = snap.get("bots", {})
    events = await engine.recent_events(limit=500)

    # Compute per-bot tx history
    tx_history: dict[str, list[dict]] = {"swap": [], "lp": [], "limit": []}
    event_history: dict[str, list[dict]] = {"swap": [], "lp": [], "limit": []}
    for ev in events:
        cat = ev.get("category", "")
        payload = ev.get("payload", {})
        item = {
            "ts": ev.get("ts"),
            "message": ev.get("message"),
            "pair": payload.get("pair"),
            "success": payload.get("success"),
            "tx_hash": payload.get("tx_hash"),
            "error": payload.get("error"),
            "source": payload.get("source", "system"),
            "action": payload.get("action"),
            "side": payload.get("side"),
            "tick": payload.get("tick"),
        }
        if cat == "trade" and payload.get("tx_hash"):
            tx_history["swap"].append({
                "ts": ev.get("ts"), "tx_hash": payload.get("tx_hash"),
                "pair": payload.get("pair"), "success": payload.get("success"),
            })
            event_history["swap"].append(item)
        elif cat == "trade":
            event_history["swap"].append(item)
        elif cat == "lp" and payload.get("tx_hash"):
            tx_history["lp"].append({
                "ts": ev.get("ts"), "tx_hash": payload.get("tx_hash"),
                "pair": payload.get("pair"), "success": payload.get("success"),
            })
            event_history["lp"].append(item)
        elif cat == "lp":
            event_history["lp"].append(item)
        elif cat == "limit" and payload.get("tx_hash"):
            tx_history["limit"].append({
                "ts": ev.get("ts"), "tx_hash": payload.get("tx_hash"),
                "pair": payload.get("pair"), "success": payload.get("success"),
                "side": payload.get("side"), "tick": payload.get("tick"),
            })
            event_history["limit"].append(item)
        elif cat == "limit":
            event_history["limit"].append(item)

    presets = {
        "swap": {
            "interval_sec": settings.swap_bot_interval_sec,
            "min_amount": settings.swap_bot_min_amount,
            "max_amount": settings.swap_bot_max_amount,
            "behavior_profile": "degen/retail/whale mix",
        },
        "lp": {
            "interval_sec": settings.lp_bot_interval_sec,
            "amount0": settings.lp_bot_amount0,
            "amount1": settings.lp_bot_amount1,
            "tick_width": settings.lp_bot_tick_width,
        },
        "limit": {
            "interval_sec": settings.limit_bot_interval_sec,
            "amount": settings.limit_bot_amount,
            "spread_mode": "concentrated single-tick",
        },
    }
    intents = {
        "swap": "Generate volume and fee flow while diversifying trade behavior.",
        "lp": "Maintain concentrated liquidity and harvest LP fees.",
        "limit": "Place directional liquidity as synthetic limit orders for depth.",
    }

    # Success rates
    def rate(bot_data: dict) -> float:
        total = bot_data.get("total", 0)
        succ = bot_data.get("successful", 0)
        return round((succ / total * 100) if total > 0 else 0, 1)

    total_txs = sum(b.get("total", 0) for b in bots.values() if isinstance(b, dict))
    total_success = sum(b.get("successful", 0) for b in bots.values() if isinstance(b, dict))

    return {
        "summary": {
            "total_transactions": total_txs,
            "total_successful": total_success,
            "overall_success_rate": round((total_success / total_txs * 100) if total_txs > 0 else 0, 1),
            "active_bots": sum(1 for b in bots.values() if isinstance(b, dict) and b.get("enabled")),
            "wallet_address": settings.bot_account_address,
        },
        "bots": {
            name: {
                **data,
                "success_rate": rate(data),
            }
            for name, data in bots.items()
            if isinstance(data, dict)
        },
        "tx_history": tx_history,
        "event_history": {
            k: v[-60:]
            for k, v in event_history.items()
        },
        "intents": intents,
        "presets": presets,
        "apy": snap.get("apy", {}),
        "coordination": snap.get("coordination", {}),
        "coordination_policy": snap.get("coordination_policy", {}),
        "uptime_polls": snap.get("poll_count", 0),
    }


# ── Fleet endpoints ─────────────────────────────────────────────────────────

@app.get("/public/fleet")
async def get_fleet_status() -> dict[str, Any]:
    """Public fleet overview — all agents, aggregate volume, per-pair stats."""
    return fleet.fleet_status()


@app.get("/admin/fleet", dependencies=[Depends(require_admin)])
async def admin_fleet() -> dict[str, Any]:
    """Detailed fleet state for admin dashboard."""
    return {"ok": True, "fleet": fleet.fleet_status()}


@app.post("/admin/fleet/start", dependencies=[Depends(require_admin)])
async def fleet_start_all() -> dict[str, Any]:
    """Start all agents in the fleet (non-blocking, agents stagger in)."""
    engine.fleet = fleet

    async def _bg_start() -> None:
        try:
            started = await fleet.start_all()
            logger.info("Fleet started (admin): %d agents", len(started))
        except Exception as exc:
            logger.error("Fleet start error: %s", exc)

    asyncio.create_task(_bg_start())
    return {"ok": True, "message": "Fleet starting (agents will stagger in)", "total_agents": len(fleet.agents)}


@app.post("/admin/fleet/stop", dependencies=[Depends(require_admin)])
async def fleet_stop_all() -> dict[str, Any]:
    """Stop all agents in the fleet."""
    await fleet.stop_all()
    return {"ok": True, "message": "All agents stopped"}


@app.post("/admin/fleet/agent/{agent_id}/start", dependencies=[Depends(require_admin)])
async def fleet_start_agent(agent_id: int) -> dict[str, Any]:
    """Start a specific agent by ID."""
    result = await fleet.start_agent(agent_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "Not found"))
    return result


@app.post("/admin/fleet/agent/{agent_id}/stop", dependencies=[Depends(require_admin)])
async def fleet_stop_agent(agent_id: int) -> dict[str, Any]:
    """Stop a specific agent by ID."""
    result = await fleet.stop_agent(agent_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "Not found"))
    return result


# ── Static dashboards (kept for backwards compat) ───────────────────────────
@app.get("/dashboard")
async def dashboard_root() -> FileResponse:
    return FileResponse("dashboard/public.html")


@app.get("/dashboard/admin")
async def dashboard_admin() -> FileResponse:
    return FileResponse("dashboard/admin.html")


@app.get("/dashboard/public")
async def dashboard_public() -> FileResponse:
    return FileResponse("dashboard/public.html")


@app.get("/dashboard/fleet")
async def dashboard_fleet() -> FileResponse:
    return FileResponse("dashboard/fleet.html")
