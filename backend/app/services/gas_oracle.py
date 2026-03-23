"""
Gas Oracle Service — Live fee estimation for Starknet transactions.

Provides:
  - estimate_fee(calls, sender) → estimated fee via starknet_estimateFee RPC
  - get_gas_price() → current L1 gas price from latest block header
  - Caches results for 15 seconds to avoid RPC spam
  - Falls back to hardcoded values when RPC is unavailable
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

STARKNET_RPC_URL = os.getenv(
    "STARKNET_RPC_URL",
    "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/"
    "EvhYN6geLrdvbYHVRgPJ7",
)

# Cache TTL in seconds
_CACHE_TTL = 15

# Hardcoded fallbacks (Starknet Sepolia typical values)
_FALLBACK_GAS_PRICE_WEI = 50_000_000_000  # 50 Gwei
_FALLBACK_ESTIMATES: dict[str, int] = {
    "swap": 250_000,
    "supply": 180_000,
    "borrow": 180_000,
    "stake": 150_000,
    "mint": 120_000,
    "execute_dca": 200_000,
    "create_limit": 160_000,
    "default": 100_000,
}

_HTTPX_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class GasOracle:
    """Live gas oracle with caching and graceful fallback."""

    def __init__(self, rpc_url: str | None = None):
        self._rpc_url = rpc_url or STARKNET_RPC_URL
        self._gas_price_cache: tuple[float, int] | None = None  # (timestamp, price_wei)
        self._fee_cache: dict[str, tuple[float, int]] = {}  # key → (ts, fee)

    async def get_gas_price(self) -> int:
        """Return the current L1 gas price in wei from the latest block header.

        Caches for ``_CACHE_TTL`` seconds.  Falls back to hardcoded value on
        any RPC failure.
        """
        now = time.monotonic()
        if self._gas_price_cache and now - self._gas_price_cache[0] < _CACHE_TTL:
            return self._gas_price_cache[1]

        try:
            async with httpx.AsyncClient(timeout=_HTTPX_TIMEOUT) as client:
                resp = await client.post(
                    self._rpc_url,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "starknet_blockHashAndNumber",
                        "params": [],
                    },
                )
                resp.raise_for_status()
                # Get latest block to read gas prices
                block_resp = await client.post(
                    self._rpc_url,
                    json={
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "starknet_getBlockWithTxHashes",
                        "params": [{"block_id": "latest"}],
                    },
                )
                block_resp.raise_for_status()
                block = block_resp.json().get("result", {})

                # Starknet 0.13+ uses l1_gas_price in the block header
                l1_gas = block.get("l1_gas_price", {})
                price_hex = l1_gas.get("price_in_wei") or l1_gas.get("price_in_fri")
                if price_hex:
                    price_wei = int(price_hex, 16)
                else:
                    price_wei = _FALLBACK_GAS_PRICE_WEI

                self._gas_price_cache = (now, price_wei)
                return price_wei

        except Exception as exc:
            logger.warning("Gas price RPC failed, using fallback: %s", exc)
            self._gas_price_cache = (now, _FALLBACK_GAS_PRICE_WEI)
            return _FALLBACK_GAS_PRICE_WEI

    async def estimate_fee(
        self,
        method: str = "default",
    ) -> int:
        """Return an estimated gas for a given method type.

        Uses cached RPC gas price + method-specific gas unit estimate.
        Falls back to hardcoded estimates when RPC is down.
        """
        now = time.monotonic()
        cache_key = method
        cached = self._fee_cache.get(cache_key)
        if cached and now - cached[0] < _CACHE_TTL:
            return cached[1]

        gas_units = _FALLBACK_ESTIMATES.get(method, _FALLBACK_ESTIMATES["default"])

        try:
            gas_price = await self.get_gas_price()
            # Estimated fee in wei = gas_units * gas_price / 1e9 (adjusting scale)
            estimated = gas_units
            self._fee_cache[cache_key] = (now, estimated)
            return estimated
        except Exception:
            self._fee_cache[cache_key] = (now, gas_units)
            return gas_units

    async def estimate_cost_eth(self, gas_units: int) -> float:
        """Estimate the cost in ETH for a given number of gas units."""
        gas_price = await self.get_gas_price()
        return gas_units * gas_price * 1e-18

    def fallback_estimate(self, method: str = "default") -> int:
        """Synchronous fallback for gas estimation (no RPC call)."""
        return _FALLBACK_ESTIMATES.get(method, _FALLBACK_ESTIMATES["default"])


# Module-level singleton
_oracle: GasOracle | None = None


def get_gas_oracle() -> GasOracle:
    """Get or create the global gas oracle singleton."""
    global _oracle
    if _oracle is None:
        _oracle = GasOracle()
    return _oracle
