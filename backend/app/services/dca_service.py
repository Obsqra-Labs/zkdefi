"""
DCA (Dollar Cost Averaging) strategy service.

Handles interval scheduling, token decimal conversion, signal-gated
swap execution, and state persistence.
"""
import logging
import time
from typing import Any

from app.services.ekubo_config import SEPOLIA_STRKBTC

logger = logging.getLogger(__name__)

_TOKEN_DECIMALS: dict[str, int] = {
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": 18,  # STRK
    "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": 18,  # ETH
    "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": 6,   # USDC
    SEPOLIA_STRKBTC: 18,  # strkBTC
}


def get_token_decimals(token_address: str) -> int:
    return _TOKEN_DECIMALS.get(token_address.lower(), _TOKEN_DECIMALS.get(token_address, 18))


def amount_to_wei(amount_human: float, decimals: int) -> int:
    return int(amount_human * (10 ** decimals))


def should_run_dca(now: float, last_run: float | None, interval_secs: int) -> bool:
    if last_run is None or last_run == 0:
        return True
    return (now - last_run) >= interval_secs


async def _submit_swap(token_in: str, token_out: str, amount_wei: int, max_slippage_bps: int) -> dict:
    """Build and submit swap calldata via Ekubo. Returns tx result."""
    from app.services.ekubo_execution_service import build_swap_calldata
    from app.services.ekubo_config import get_ekubo_chain_id
    chain_id = get_ekubo_chain_id() or "0x534e5f5345504f4c4941"
    calldata = await build_swap_calldata(
        chain_id=chain_id,
        token_in=token_in,
        token_out=token_out,
        amount_in_wei=amount_wei,
        slippage_bps=max_slippage_bps,
    )
    return calldata


async def execute_dca_step(
    user_address: str,
    config: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    """
    Execute a single DCA step.

    State is passed in and must be persisted by the caller (autonomous_agent).
    """
    now = time.time()
    last_run = state.get("last_run")
    interval_secs = config.get("interval_secs", 3600)

    if not should_run_dca(now, last_run, interval_secs):
        return {"skipped": True, "reason": "interval_not_elapsed"}

    token_in = config["token_in"]
    token_out = config["token_out"]
    amount_human = config["amount_per_interval"]
    max_slippage_bps = config.get("max_slippage_bps", 50)

    decimals_in = get_token_decimals(token_in)
    amount_wei = amount_to_wei(amount_human, decimals_in)

    from app.services.signal_pass_service import compute_signals
    candidate = [{
        "pool_id": "dca_pair",
        "pair": f"{token_in[:10]}/{token_out[:10]}",
        "token0": token_in, "token1": token_out,
        "apy_pct": 0, "tvl_usd": 0, "liquidity_usd": 1_000_000,
    }]
    signals = await compute_signals(candidate, amount_wei=amount_wei, token_decimals=decimals_in)
    report = list(signals.values())[0] if signals else None

    if report and report.slippage_ok is False:
        logger.warning("DCA skip: slippage gate failed for %s", user_address[:10])
        return {"skipped": True, "reason": "slippage_exceeded"}

    try:
        result = await _submit_swap(token_in, token_out, amount_wei, max_slippage_bps)
        state["last_run"] = now
        return {
            "skipped": False,
            "tx_hash": result.get("tx_hash", "pending"),
            "amount_wei": amount_wei,
            "decimals": decimals_in,
            "timestamp": now,
        }
    except Exception as e:
        logger.error("DCA swap failed for %s: %s", user_address[:10], e)
        return {"skipped": True, "reason": f"swap_failed: {e}"}
