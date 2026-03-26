from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Load .env before reading os.getenv — must run before Settings instantiation
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(_env_path, override=False)
except ImportError:
    pass


def _csv_list(raw: str) -> list[str]:
    return [item.strip() for item in str(raw or "").split(",") if item.strip()]


def _pair_targets(raw: str) -> dict[str, float]:
    """
    Parse comma-separated pair targets like:
      "zkdAI/zkdETH:200000,STRK/zkdETH:75000"
    """
    out: dict[str, float] = {}
    for item in _csv_list(raw):
        if ":" not in item:
            continue
        pair, value = item.split(":", 1)
        key = pair.strip().lower()
        if not key:
            continue
        try:
            target = float(value.strip())
        except ValueError:
            continue
        if target > 0:
            out[key] = target
    return out


@dataclass(frozen=True)
class Settings:
    app_host: str = os.getenv("MM_SIM_HOST", "0.0.0.0")
    app_port: int = int(os.getenv("MM_SIM_PORT", "8099"))
    admin_api_key: str = os.getenv("MM_SIM_ADMIN_KEY", "dev-admin-key")
    cors_origins: str = os.getenv("MM_SIM_CORS", "http://localhost:3001,http://127.0.0.1:3001,https://zkde.fi")
    ekubo_chain_id: str = os.getenv("MM_SIM_EKUBO_CHAIN_ID", "0x534e5f4d41494f")
    frontend_embed_path: str = os.getenv("MM_SIM_FRONTEND_EMBED_PATH", "/mvp/simulator")

    # On-chain config
    rpc_url: str = os.getenv(
        "STARKNET_RPC_URL_V08",
        os.getenv("STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia"),
    )
    poll_interval_sec: float = float(os.getenv("MM_SIM_POLL_INTERVAL_SEC", "10.0"))

    # Optional JSON file for /public/positions (Ekubo LP NFT state). Default: local data dir.
    # In the zkdefi monorepo you can set this to ../backend/data/ekubo_positions.json
    ekubo_positions_path: str = (
        p.strip()
        if (p := os.getenv("MM_SIM_EKUBO_POSITIONS_PATH", "").strip())
        else str(Path(__file__).resolve().parent.parent / "data" / "ekubo_positions.json")
    )

    # ── Bot wallet(s) ────────────────────────────────────────────────────────
    # Primary bot account (executes swaps, LP, limit orders on Sepolia)
    bot_account_address: str = os.getenv(
        "BOT_ACCOUNT_ADDRESS",
        os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS", ""),
    )
    bot_private_key: str = os.getenv(
        "BOT_PRIVATE_KEY",
        os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY", ""),
    )

    # ── Bot behaviour ────────────────────────────────────────────────────────
    # Swap bot: interval and per-swap amount range (human-readable token units)
    swap_bot_enabled_on_start: bool = os.getenv("SWAP_BOT_ENABLED_ON_START", "true").lower() in ("true", "1", "yes")
    swap_bot_interval_sec: float = float(os.getenv("SWAP_BOT_INTERVAL_SEC", "25"))
    swap_bot_min_amount: float = float(os.getenv("SWAP_BOT_MIN_AMOUNT", "0.002"))
    swap_bot_max_amount: float = float(os.getenv("SWAP_BOT_MAX_AMOUNT", "0.02"))

    # LP bot: interval and position size
    lp_bot_enabled_on_start: bool = os.getenv("LP_BOT_ENABLED_ON_START", "true").lower() in ("true", "1", "yes")
    lp_bot_interval_sec: float = float(os.getenv("LP_BOT_INTERVAL_SEC", "300"))
    lp_bot_amount0: float = float(os.getenv("LP_BOT_AMOUNT0", "0.005"))
    lp_bot_amount1: float = float(os.getenv("LP_BOT_AMOUNT1", "0.005"))
    lp_bot_tick_width: int = int(os.getenv("LP_BOT_TICK_WIDTH", "20000"))
    lp_bot_max_positions_per_pool: int = int(os.getenv("LP_BOT_MAX_POSITIONS_PER_POOL", "10"))
    lp_bot_rebalance_enabled: bool = os.getenv("LP_BOT_REBALANCE_ENABLED", "true").lower() in ("true", "1", "yes")
    lp_bot_stale_threshold_pct: float = float(os.getenv("LP_BOT_STALE_THRESHOLD_PCT", "50"))

    # Limit order bot: interval and size
    limit_bot_enabled_on_start: bool = os.getenv("LIMIT_BOT_ENABLED_ON_START", "true").lower() in ("true", "1", "yes")
    limit_bot_interval_sec: float = float(os.getenv("LIMIT_BOT_INTERVAL_SEC", "180"))
    limit_bot_amount: float = float(os.getenv("LIMIT_BOT_AMOUNT", "0.002"))

    # Pair coordination policy (safe liquidity coverage + recenter automation).
    coordination_enabled: bool = os.getenv("MM_SIM_COORD_ENABLED", "true").lower() in ("true", "1", "yes")
    coordination_cycle_sec: float = float(os.getenv("MM_SIM_COORD_CYCLE_SEC", "180"))
    coordination_min_active_lp_per_pair: int = int(os.getenv("MM_SIM_COORD_MIN_ACTIVE_LP_PER_PAIR", "1"))
    coordination_max_actions_per_cycle: int = int(os.getenv("MM_SIM_COORD_MAX_ACTIONS_PER_CYCLE", "4"))
    coordination_auto_close_stale: bool = os.getenv("MM_SIM_COORD_AUTO_CLOSE_STALE", "true").lower() in ("true", "1", "yes")
    coordination_auto_recenter: bool = os.getenv("MM_SIM_COORD_AUTO_RECENTER", "true").lower() in ("true", "1", "yes")
    coordination_limit_support_enabled: bool = os.getenv("MM_SIM_COORD_LIMIT_SUPPORT_ENABLED", "true").lower() in ("true", "1", "yes")
    coordination_target_pairs: list[str] = field(default_factory=lambda: _csv_list(os.getenv("MM_SIM_COORD_TARGET_PAIRS", "")))
    coordination_volume_ramp_enabled: bool = os.getenv("MM_SIM_COORD_VOLUME_RAMP_ENABLED", "true").lower() in ("true", "1", "yes")
    coordination_max_swap_actions_per_cycle: int = int(os.getenv("MM_SIM_COORD_MAX_SWAP_ACTIONS_PER_CYCLE", "3"))
    coordination_coverage_boost_enabled: bool = os.getenv("MM_SIM_COORD_COVERAGE_BOOST_ENABLED", "true").lower() in ("true", "1", "yes")
    coordination_min_pool_coverage_ratio: float = float(os.getenv("MM_SIM_COORD_MIN_POOL_COVERAGE_RATIO", "0.8"))
    coordination_max_coverage_swap_actions_per_cycle: int = int(os.getenv("MM_SIM_COORD_MAX_COVERAGE_SWAP_ACTIONS_PER_CYCLE", "2"))
    coordination_min_swap_size_multiplier: float = float(os.getenv("MM_SIM_COORD_MIN_SWAP_SIZE_MULTIPLIER", "1.0"))
    coordination_max_swap_size_multiplier: float = float(os.getenv("MM_SIM_COORD_MAX_SWAP_SIZE_MULTIPLIER", "6.0"))
    coordination_primary_volume_pairs: list[str] = field(default_factory=lambda: _csv_list(os.getenv("MM_SIM_COORD_PRIMARY_VOLUME_PAIRS", "zkdAI/zkdETH")))
    coordination_volume_targets_usd: dict[str, float] = field(
        default_factory=lambda: _pair_targets(
            os.getenv(
                "MM_SIM_COORD_VOLUME_TARGETS_USD",
                "zkdAI/zkdETH:200000,STRK/zkdETH:75000,zkdAI/STRK:75000",
            )
        )
    )

    # Legacy sim settings (kept for backwards compat but no longer drive the engine)
    tick_interval_sec: float = float(os.getenv("MM_SIM_TICK_INTERVAL_SEC", "1.0"))
    start_price: float = float(os.getenv("MM_SIM_START_PRICE", "2000"))
    start_peg: float = float(os.getenv("MM_SIM_PEG_PRICE", "2000"))
    start_tvl_usd: float = float(os.getenv("MM_SIM_START_TVL", "750000"))
    start_liquidity_zkdeth: float = float(os.getenv("MM_SIM_START_ZKDETH", "250"))
    start_liquidity_zkdai: float = float(os.getenv("MM_SIM_START_ZKDAI", "500000"))


settings = Settings()
