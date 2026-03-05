"""
Yield Collection Service — Phase D

Reads accrued fees from Ekubo LP positions, optionally harvests them on-chain,
and records yield events in the SQLite ledger.

Pipeline:
  1. Read all positions from ekubo_lp_service JSON store
  2. For each position, query Ekubo Positions contract `get_token_info` to read amounts
  3. Estimate uncollected fees as (current_amounts - deposited_amounts)
  4. Optionally call `collect_fees` to harvest on-chain
  5. Record yield events in vault_yield_events table

Depends on:
  - ekubo_executor.EkuboContractExecutor (get_token_info, collect_fees)
  - ekubo_lp_service (list_positions, _load_positions)
  - ledger_service.LedgerService (vault_yield_events)
  - real_pool_aggregator._TOKEN_META (price/decimals)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

from app.services.real_pool_aggregator import _TOKEN_SYMBOLS, _TOKEN_META

logger = logging.getLogger(__name__)


# ── Data structures ─────────────────────────────────────────────────────

@dataclass
class PositionYield:
    """Yield info for a single LP position."""
    position_id: str
    pair: str
    token0: str
    token1: str
    deposited0: int         # original deposit (wei)
    deposited1: int
    current0: int           # current amounts in position (wei)
    current1: int
    fees0_est: int          # estimated uncollected fees (wei)
    fees1_est: int
    fees0_usd: float
    fees1_usd: float
    total_fees_usd: float
    apr_est: float          # annualised estimate based on position age
    status: str             # "read" | "harvested" | "error"
    harvest_tx: str | None
    error: str | None
    lower_tick: int = 0     # position tick range lower bound
    upper_tick: int = 0     # position tick range upper bound

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class YieldSnapshot:
    """Aggregated yield snapshot across all positions."""
    timestamp: str
    owner: str
    positions: list[PositionYield]
    total_fees_usd: float
    total_positions: int
    harvested_count: int

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["positions"] = [p.to_dict() for p in self.positions]
        return d


# ── Helpers ─────────────────────────────────────────────────────────────

def _sym_for_addr(addr: str) -> str:
    norm = str(addr).strip().lower()
    if norm.startswith("0x"):
        norm = f"0x{norm[2:].lstrip('0') or '0'}"
    for k, v in _TOKEN_SYMBOLS.items():
        key = str(k).lower()
        if key.startswith("0x"):
            key = f"0x{key[2:].lstrip('0') or '0'}"
        if key == norm:
            return v
    return "UNKNOWN"


def _wei_to_usd(amount_wei: int, symbol: str) -> float:
    meta = _TOKEN_META.get(symbol)
    if not meta:
        return 0.0
    decimals, price_usd = meta
    return (amount_wei / (10 ** decimals)) * price_usd


def _pair_name(token0: str, token1: str) -> str:
    return f"{_sym_for_addr(token0)}/{_sym_for_addr(token1)}"


# ── Core yield reader ──────────────────────────────────────────────────

async def read_yield_for_owner(
    owner: str,
    harvest: bool = False,
) -> YieldSnapshot:
    """
    Read all LP positions for `owner`, estimate uncollected fees,
    and optionally harvest them on-chain.

    Args:
        owner: Position owner address
        harvest: If True, call collect_fees on-chain for each position
    """
    from app.services.ekubo_lp_service import list_positions as lp_list_positions

    positions_raw = lp_list_positions(owner)
    results: list[PositionYield] = []
    total_fees = 0.0
    harvested_count = 0

    for pos in positions_raw:
        pos_id = str(pos.get("position_id", ""))
        token0 = str(pos.get("token0", ""))
        token1 = str(pos.get("token1", ""))
        status_raw = str(pos.get("status") or "")
        if status_raw == "active_empty" and (not token0 or not token1):
            continue
        deposited0 = int(pos.get("amount0") or 0)
        deposited1 = int(pos.get("amount1") or 0)
        lower_tick = int(pos.get("lower_tick") or 0)
        upper_tick = int(pos.get("upper_tick") or 0)
        fee_tier = int(pos.get("fee_tier") or 3000)
        pair = _pair_name(token0, token1)
        if status_raw == "active_empty" and pair == "UNKNOWN/UNKNOWN":
            continue

        # Try to read current token amounts + accrued fees from on-chain
        current0, current1, onchain_fees0, onchain_fees1, read_ok, read_err = await _read_on_chain_amounts(
            pos_id, token0, token1, fee_tier, lower_tick, upper_tick
        )

        if not read_ok:
            # Fall back to estimate from APR
            apr_est = float(pos.get("estimated_fees_apr") or 0)
            # If APR is zero, use a sensible default based on fee tier
            if apr_est <= 0:
                _default_aprs = {100: 2.0, 500: 5.0, 3000: 12.0, 10000: 25.0}
                apr_est = _default_aprs.get(fee_tier, 8.0)
            created_at = pos.get("created_at", "")
            age_days = _position_age_days(created_at)
            fees0_est, fees1_est = _estimate_fees_from_apr(
                deposited0, deposited1, apr_est, age_days
            )
        else:
            # Use the actual accrued fees from on-chain (not amount delta)
            fees0_est = onchain_fees0
            fees1_est = onchain_fees1

        sym0 = _sym_for_addr(token0)
        sym1 = _sym_for_addr(token1)
        fees0_usd = _wei_to_usd(fees0_est, sym0)
        fees1_usd = _wei_to_usd(fees1_est, sym1)
        total_fees_pos = fees0_usd + fees1_usd
        total_fees += total_fees_pos

        # APR estimate
        deposit_usd = _wei_to_usd(deposited0, sym0) + _wei_to_usd(deposited1, sym1)
        age_days_val = _position_age_days(pos.get("created_at", ""))
        if deposit_usd > 0 and age_days_val > 0:
            apr_est_val = (total_fees_pos / deposit_usd) * (365.0 / age_days_val) * 100.0
        else:
            apr_est_val = float(pos.get("estimated_fees_apr") or 0)

        harvest_tx: str | None = None
        status = "read"

        if harvest and total_fees_pos > 0:
            harvest_tx = await _harvest_position(
                pos_id, token0, token1, lower_tick, upper_tick
            )
            if harvest_tx:
                status = "harvested"
                harvested_count += 1
                _record_yield_event(owner, pos_id, fees0_est + fees1_est, harvest_tx)

        if read_err and not harvest:
            status = "estimated"  # used APR-based estimate

        results.append(PositionYield(
            position_id=pos_id,
            pair=pair,
            token0=token0,
            token1=token1,
            deposited0=deposited0,
            deposited1=deposited1,
            current0=current0 if read_ok else deposited0,
            current1=current1 if read_ok else deposited1,
            fees0_est=fees0_est,
            fees1_est=fees1_est,
            fees0_usd=round(fees0_usd, 4),
            fees1_usd=round(fees1_usd, 4),
            total_fees_usd=round(total_fees_pos, 4),
            apr_est=round(apr_est_val, 2),
            status=status,
            harvest_tx=harvest_tx,
            error=read_err,
            lower_tick=lower_tick,
            upper_tick=upper_tick,
        ))

    return YieldSnapshot(
        timestamp=datetime.now(timezone.utc).isoformat(),
        owner=owner,
        positions=results,
        total_fees_usd=round(total_fees, 4),
        total_positions=len(results),
        harvested_count=harvested_count,
    )


# ── On-chain reading ───────────────────────────────────────────────────

async def _read_on_chain_amounts(
    position_id: str,
    token0: str,
    token1: str,
    fee_tier: int,
    lower_tick: int,
    upper_tick: int,
) -> tuple[int, int, int, int, bool, str | None]:
    """
    Read current token amounts + accrued fees from Ekubo Positions contract.
    Returns (amount0, amount1, fees0, fees1, success, error_msg).

    First tries get_token_info_raw (direct addresses + fee_tier),
    falls back to get_token_info (pair-name based).
    """
    try:
        from app.services.ekubo_executor import EkuboContractExecutor

        executor = EkuboContractExecutor()
        pos_id_int = int(position_id, 16) if position_id.startswith("0x") else int(position_id)

        # Prefer raw method (no _PAIR_DEFAULTS dependency)
        result = await executor.get_token_info_raw(
            position_id=pos_id_int,
            token0=token0,
            token1=token1,
            fee_tier=fee_tier,
            lower_tick=lower_tick,
            upper_tick=upper_tick,
        )

        if result.get("success"):
            return (
                int(result.get("amount0", 0)),
                int(result.get("amount1", 0)),
                int(result.get("fees0", 0)),
                int(result.get("fees1", 0)),
                True,
                None,
            )

        # Fallback: try pair-name method
        pair = _pair_name(token0, token1)
        result2 = await executor.get_token_info(
            position_id=pos_id_int,
            pair=pair,
            lower_tick=lower_tick,
            upper_tick=upper_tick,
        )
        if result2.get("success"):
            return (
                int(result2.get("amount0", 0)),
                int(result2.get("amount1", 0)),
                int(result2.get("fees0", 0)),
                int(result2.get("fees1", 0)),
                True,
                None,
            )

        return 0, 0, 0, 0, False, result.get("error", "get_token_info returned failure")

    except Exception as e:
        # Expected for positions with token addresses not in _PAIR_DEFAULTS
        return 0, 0, 0, 0, False, str(e)


async def _harvest_position(
    position_id: str,
    token0: str,
    token1: str,
    lower_tick: int,
    upper_tick: int,
) -> str | None:
    """Call collect_fees on Ekubo Positions contract. Returns tx hash or None."""
    try:
        from app.services.ekubo_executor import EkuboContractExecutor

        pair = _pair_name(token0, token1)
        executor = EkuboContractExecutor()

        if not executor._is_configured():
            logger.info("Executor not configured (no private key); skip harvest")
            return None

        result = await executor.collect_fees(
            position_id=int(position_id, 16) if position_id.startswith("0x") else int(position_id),
            pair=pair,
            lower_tick=lower_tick,
            upper_tick=upper_tick,
        )
        return result.get("tx_hash") if result.get("success") else None

    except Exception as e:
        logger.warning("Harvest failed for %s: %s", position_id, e)
        return None


# ── APR-based fee estimation (fallback when on-chain read fails) ────────

def _position_age_days(created_at: str) -> float:
    """Calculate position age in days from ISO timestamp."""
    if not created_at:
        return 1.0  # default 1 day
    try:
        if created_at.endswith("Z"):
            created_at = created_at[:-1] + "+00:00"
        dt = datetime.fromisoformat(created_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        return max(delta.total_seconds() / 86400.0, 0.001)
    except Exception:
        return 1.0


def _estimate_fees_from_apr(
    deposited0: int,
    deposited1: int,
    apr_pct: float,
    age_days: float,
) -> tuple[int, int]:
    """
    Estimate accrued fees using APR and position age.
    Assumes fees accrue proportionally to deposited amounts.
    """
    if apr_pct <= 0 or age_days <= 0:
        return 0, 0
    daily_rate = apr_pct / 100.0 / 365.0
    factor = daily_rate * age_days
    return int(deposited0 * factor), int(deposited1 * factor)


# ── Ledger recording ───────────────────────────────────────────────────

def _record_yield_event(
    user_address: str,
    position_id: str,
    amount_wei: int,
    harvest_tx: str,
) -> None:
    """Insert a yield event into the ledger."""
    try:
        from app.services.ledger_service import get_ledger_service
        ledger = get_ledger_service()
        if not ledger.enabled:
            return
        import sqlite3
        now = int(time.time())
        conn = ledger._db_connect()
        try:
            conn.execute(
                "INSERT INTO vault_yield_events "
                "(user_address, allocation_id, amount_wei, harvest_tx_hash, harvested_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_address.lower(), position_id, str(amount_wei), harvest_tx, now),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        logger.warning("Record yield event failed: %s", e)
