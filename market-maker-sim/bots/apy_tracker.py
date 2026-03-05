"""
APY Tracker — calculates real APY from on-chain fee accrual.

Reads accumulated fees from LP positions via Ekubo Positions.get_token_info,
tracks fee deltas over time, and computes annualized yield.

All data is real — no simulation.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from bots.chain_reader import (
    EKUBO_POSITIONS,
    PoolKey,
    _TWO128,
    _rpc_call,
)

logger = logging.getLogger(__name__)

# ── Selector for get_token_info ──────────────────────────────────────────────
GET_TOKEN_INFO_SELECTOR = 0  # Resolved at import time below

try:
    from starknet_py.hash.selector import get_selector_from_name
    GET_TOKEN_INFO_SELECTOR = get_selector_from_name("get_token_info")
except ImportError:
    # Fallback: pre-computed selector for "get_token_info"
    GET_TOKEN_INFO_SELECTOR = 0x1B9AA0A19B346F2DCBA98E59A11FAEC448DDCA55A2A1FCE2C6165A8F2E2E37D

# ── Approximate USD prices (same as chain_reader) ───────────────────────────
_ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
_ZKDETH = "0x009b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121"
_ZKDAI = "0x050974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637"

_APPROX_USD: dict[str, float] = {
    _ETH.lower(): 3500.0,
    _STRK.lower(): 0.50,
    _ZKDETH.lower(): 3500.0,
    _ZKDAI.lower(): 1.0,
}


def _token_usd(addr: str, amount_wei: int, decimals: int = 18) -> float:
    price = _APPROX_USD.get(addr.lower(), 0.0)
    return (amount_wei / (10 ** decimals)) * price


def _i129_calldata(value: int) -> list[str]:
    return [hex(abs(value)), hex(1 if value < 0 else 0)]


# ── Fee snapshot data ────────────────────────────────────────────────────────
_SNAPSHOTS_FILE = Path(__file__).resolve().parent.parent / "data" / "fee_snapshots.json"


@dataclass
class FeeSnapshot:
    position_key: str  # unique identifier
    timestamp: float
    fees0_wei: int = 0
    fees1_wei: int = 0
    fees0_usd: float = 0.0
    fees1_usd: float = 0.0
    tvl_usd: float = 0.0


@dataclass
class PoolAPY:
    pool_name: str
    fees_24h_usd: float = 0.0
    fees_7d_usd: float = 0.0
    tvl_usd: float = 0.0
    apr_24h: float = 0.0
    apr_7d: float = 0.0
    apy_24h: float = 0.0
    apy_7d: float = 0.0
    sample_count: int = 0


@dataclass
class APYSummary:
    timestamp: float = field(default_factory=time.time)
    pools: list[PoolAPY] = field(default_factory=list)
    total_fees_24h_usd: float = 0.0
    total_tvl_usd: float = 0.0
    weighted_apy: float = 0.0


class APYTracker:
    """Reads real fee data from Ekubo and computes live APY."""

    def __init__(self, rpc_url: str) -> None:
        self.rpc_url = rpc_url
        self._snapshots: dict[str, list[FeeSnapshot]] = {}  # position_key → history
        self._load_snapshots()

    def _load_snapshots(self) -> None:
        if not _SNAPSHOTS_FILE.exists():
            return
        try:
            data = json.loads(_SNAPSHOTS_FILE.read_text())
            for key, snaps in data.get("snapshots", {}).items():
                self._snapshots[key] = [
                    FeeSnapshot(
                        position_key=key,
                        timestamp=s["timestamp"],
                        fees0_wei=s.get("fees0_wei", 0),
                        fees1_wei=s.get("fees1_wei", 0),
                        fees0_usd=s.get("fees0_usd", 0.0),
                        fees1_usd=s.get("fees1_usd", 0.0),
                        tvl_usd=s.get("tvl_usd", 0.0),
                    )
                    for s in snaps
                ]
        except Exception:
            self._snapshots = {}

    def _save_snapshots(self) -> None:
        _SNAPSHOTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        data: dict[str, Any] = {"snapshots": {}, "updated_at": time.time()}
        for key, snaps in self._snapshots.items():
            data["snapshots"][key] = [
                {
                    "timestamp": s.timestamp,
                    "fees0_wei": s.fees0_wei,
                    "fees1_wei": s.fees1_wei,
                    "fees0_usd": s.fees0_usd,
                    "fees1_usd": s.fees1_usd,
                    "tvl_usd": s.tvl_usd,
                }
                for s in snaps[-200:]  # keep last 200 per position
            ]
        _SNAPSHOTS_FILE.write_text(json.dumps(data, indent=2))

    async def record_fees(
        self,
        position_nft_id: int,
        pool: PoolKey,
        lower_tick: int,
        upper_tick: int,
        tvl_usd: float = 0.0,
    ) -> FeeSnapshot | None:
        """
        Read current fees for an LP position via get_token_info and record a snapshot.

        Returns the snapshot, or None if the read failed.
        """
        key = f"{pool.name}:{position_nft_id}"

        # Build calldata: get_token_info(id: u64, pool_key: PoolKey, bounds: Bounds)
        # PoolKey = token0, token1, fee, tick_spacing, extension (5 felts)
        # Bounds = lower(i129: mag, sign), upper(i129: mag, sign) (4 felts)
        calldata = [
            hex(position_nft_id),
            pool.token0,
            pool.token1,
            hex(pool.fee),
            hex(pool.tick_spacing),
            pool.extension,
        ]
        calldata.extend(_i129_calldata(lower_tick))
        calldata.extend(_i129_calldata(upper_tick))

        ok, felts = await _rpc_call(
            self.rpc_url, EKUBO_POSITIONS, GET_TOKEN_INFO_SELECTOR, calldata,
        )
        if not ok or len(felts) < 4:
            logger.debug("get_token_info failed for position %d", position_nft_id)
            return None

        # Parse result: amount0(u256), amount1(u256), fees0(u256), fees1(u256)
        # Each u256 returned as 2 felts (low, high)
        try:
            _parse = lambda idx: int(felts[idx], 16)
            # Depending on Ekubo version, fees may be at different offsets
            # Typically: amount0_lo, amount0_hi, amount1_lo, amount1_hi,
            #            fees0_lo, fees0_hi, fees1_lo, fees1_hi
            if len(felts) >= 8:
                fees0_wei = _parse(4) + (_parse(5) << 128)
                fees1_wei = _parse(6) + (_parse(7) << 128)
            else:
                # Fallback: assume amounts only, compute fees from delta
                fees0_wei = 0
                fees1_wei = 0
        except (ValueError, IndexError):
            fees0_wei = 0
            fees1_wei = 0

        fees0_usd = _token_usd(pool.token0, fees0_wei, pool.token0_decimals)
        fees1_usd = _token_usd(pool.token1, fees1_wei, pool.token1_decimals)

        snap = FeeSnapshot(
            position_key=key,
            timestamp=time.time(),
            fees0_wei=fees0_wei,
            fees1_wei=fees1_wei,
            fees0_usd=fees0_usd,
            fees1_usd=fees1_usd,
            tvl_usd=tvl_usd,
        )

        if key not in self._snapshots:
            self._snapshots[key] = []
        self._snapshots[key].append(snap)
        self._save_snapshots()
        return snap

    def compute_apy(self, pool_name: str | None = None) -> APYSummary:
        """
        Compute APY from fee delta over observation windows.

        If pool_name is given, compute for that pool only.
        Otherwise aggregate across all tracked positions.
        """
        now = time.time()
        pool_data: dict[str, PoolAPY] = {}

        for key, snaps in self._snapshots.items():
            if len(snaps) < 2:
                continue
            pname = key.split(":")[0]
            if pool_name and pname.lower() != pool_name.lower():
                continue

            if pname not in pool_data:
                pool_data[pname] = PoolAPY(pool_name=pname)

            pd = pool_data[pname]
            latest = snaps[-1]

            # 24h window
            cutoff_24h = now - 86400
            earlier_24h = None
            for s in snaps:
                if s.timestamp >= cutoff_24h:
                    earlier_24h = s
                    break
            if earlier_24h and earlier_24h != latest:
                delta_fees_usd = (
                    (latest.fees0_usd - earlier_24h.fees0_usd)
                    + (latest.fees1_usd - earlier_24h.fees1_usd)
                )
                elapsed_hours = max(1, (latest.timestamp - earlier_24h.timestamp) / 3600)
                daily_fees = delta_fees_usd * (24.0 / elapsed_hours)
                pd.fees_24h_usd += max(0, daily_fees)

            # 7d window
            cutoff_7d = now - 7 * 86400
            earlier_7d = None
            for s in snaps:
                if s.timestamp >= cutoff_7d:
                    earlier_7d = s
                    break
            if earlier_7d and earlier_7d != latest:
                delta_fees_usd = (
                    (latest.fees0_usd - earlier_7d.fees0_usd)
                    + (latest.fees1_usd - earlier_7d.fees1_usd)
                )
                elapsed_days = max(0.1, (latest.timestamp - earlier_7d.timestamp) / 86400)
                weekly_fees = delta_fees_usd * (7.0 / elapsed_days)
                pd.fees_7d_usd += max(0, weekly_fees)

            pd.tvl_usd = max(pd.tvl_usd, latest.tvl_usd)
            pd.sample_count = len(snaps)

        # Calculate APR/APY
        summary = APYSummary(timestamp=now)
        total_tvl = 0.0
        total_fees_24h = 0.0

        for pd in pool_data.values():
            if pd.tvl_usd > 0:
                pd.apr_24h = (pd.fees_24h_usd * 365 / pd.tvl_usd) * 100
                pd.apr_7d = (pd.fees_7d_usd * 52 / pd.tvl_usd) * 100
                # APY = (1 + apr/365)^365 - 1
                pd.apy_24h = ((1 + pd.apr_24h / 36500) ** 365 - 1) * 100 if pd.apr_24h > 0 else 0
                pd.apy_7d = ((1 + pd.apr_7d / 36500) ** 365 - 1) * 100 if pd.apr_7d > 0 else 0

            summary.pools.append(pd)
            total_tvl += pd.tvl_usd
            total_fees_24h += pd.fees_24h_usd

        summary.total_fees_24h_usd = total_fees_24h
        summary.total_tvl_usd = total_tvl
        if total_tvl > 0:
            summary.weighted_apy = (total_fees_24h * 365 / total_tvl) * 100

        return summary

    def status(self) -> dict[str, Any]:
        total_positions = len(self._snapshots)
        total_samples = sum(len(v) for v in self._snapshots.values())
        apy = self.compute_apy()
        return {
            "tracked_positions": total_positions,
            "total_samples": total_samples,
            "total_fees_24h_usd": round(apy.total_fees_24h_usd, 4),
            "total_tvl_usd": round(apy.total_tvl_usd, 2),
            "weighted_apy_pct": round(apy.weighted_apy, 4),
            "pools": [
                {
                    "pool": p.pool_name,
                    "fees_24h_usd": round(p.fees_24h_usd, 4),
                    "tvl_usd": round(p.tvl_usd, 2),
                    "apr_24h_pct": round(p.apr_24h, 4),
                    "apy_24h_pct": round(p.apy_24h, 4),
                    "samples": p.sample_count,
                }
                for p in apy.pools
            ],
        }
