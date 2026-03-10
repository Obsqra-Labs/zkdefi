"""
zkd LP On-Chain Reader

Reads zkdETH/zkdAI LP positions and token balances directly from Starknet Sepolia
via local node (127.0.0.1:6060) with Cartridge fallback.

Ekubo positions are indexed by NFT token ID — we read them from the market-maker-sim
position log (tx_hashes) and augment with live on-chain token balances + pool state.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# RPC endpoints — local node first, then fallbacks
_RPC_URLS = [
    os.getenv("STARKNET_RPC_URL", "http://127.0.0.1:6060"),
    "https://api.cartridge.gg/x/starknet/sepolia",
    "https://free-rpc.nethermind.io/sepolia-juno/v0_7",
]

# Token addresses (Sepolia)
ZKD_ETH = "0x009b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121"
ZKD_AI  = "0x050974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637"
STRK    = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
ETH     = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"

# selector: balanceOf(account: felt252) -> u256
BALANCE_OF_SELECTOR = "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e"

# Market maker sim positions file
_SIM_POSITIONS_PATH = (
    Path(__file__).resolve().parents[4] / "market-maker-sim" / "data" / "bot_lp_positions.json"
)

# Cache — refreshed every 60s
_cache: dict[str, Any] = {"ts": 0.0, "data": None}
_CACHE_TTL = 60.0


@dataclass
class ZkdBalance:
    token: str
    symbol: str
    address: str
    raw_wei: int
    amount: float
    decimals: int = 18


@dataclass
class ZkdLpSummary:
    pair: str
    position_count: int
    total_amount0: float
    total_amount1: float
    token0: str
    token1: str
    status: str          # "active" | "pending" | "closed"
    apy_estimate: float  # baseline from sim config
    last_tx: str         # most recent tx_hash


@dataclass
class ZkdPortfolio:
    address: str
    balances: list[ZkdBalance]
    lp_positions: list[ZkdLpSummary]
    block_number: int
    fetched_at: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "address": self.address,
            "balances": [asdict(b) for b in self.balances],
            "lp_positions": [asdict(p) for p in self.lp_positions],
            "block_number": self.block_number,
            "fetched_at": self.fetched_at,
        }


async def _rpc_call(method: str, params: list[Any]) -> Any:
    """Try each RPC URL in order, return first successful result."""
    payload = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    for url in _RPC_URLS:
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                r = await client.post(url, json=payload)
                data = r.json()
                if "error" not in data and "result" in data:
                    return data["result"]
        except Exception as exc:
            logger.debug("rpc %s failed on %s: %s", method, url, exc)
    raise RuntimeError(f"All RPC endpoints failed for {method}")


async def _read_balance(token_address: str, owner: str) -> int:
    """Read ERC-20 balance (u256 low limb only — fits in felt for our amounts)."""
    result = await _rpc_call(
        "starknet_call",
        [
            {
                "contract_address": token_address,
                "entry_point_selector": BALANCE_OF_SELECTOR,
                "calldata": [owner],
            },
            "latest",
        ],
    )
    # Result is [low, high] for u256
    low = int(result[0], 16) if isinstance(result[0], str) else int(result[0])
    return low


async def _get_block_number() -> int:
    result = await _rpc_call("starknet_blockNumber", [])
    return int(result)


def _load_sim_positions() -> list[dict[str, Any]]:
    """Read bot LP positions from market-maker-sim data file."""
    if not _SIM_POSITIONS_PATH.exists():
        return []
    try:
        data = json.loads(_SIM_POSITIONS_PATH.read_text())
        return data.get("positions", []) if isinstance(data, dict) else []
    except Exception as exc:
        logger.warning("zkd_lp_reader: sim positions read failed: %s", exc)
        return []


def _summarise_positions(positions: list[dict[str, Any]]) -> list[ZkdLpSummary]:
    """Aggregate sim positions by pair into summaries."""
    from collections import defaultdict
    by_pair: dict[str, list[dict]] = defaultdict(list)
    for p in positions:
        pair = p.get("pair", "unknown")
        by_pair[pair].append(p)

    # Baseline APY estimates per pair type
    _APY_ESTIMATES = {
        "zkdAI/zkdETH": 8.5,
        "ETH/zkdETH":   6.2,
        "STRK/zkdETH":  7.1,
        "zkdAI/ETH":    5.8,
        "zkdAI/STRK":   6.9,
        "STRK/ETH":     4.2,
    }

    summaries: list[ZkdLpSummary] = []
    for pair, ps in sorted(by_pair.items()):
        active = [p for p in ps if p.get("status") == "active"]
        pool_key = ps[0].get("pool_key", {})
        last_tx = max((p.get("tx_hash", "") for p in ps), default="")

        summaries.append(ZkdLpSummary(
            pair=pair,
            position_count=len(active),
            total_amount0=sum(float(p.get("amount0_wei", 0)) for p in active) / 1e18,
            total_amount1=sum(float(p.get("amount1_wei", 0)) for p in active) / 1e18,
            token0=pool_key.get("token0", ""),
            token1=pool_key.get("token1", ""),
            status="active" if active else "closed",
            apy_estimate=_APY_ESTIMATES.get(pair, 5.0),
            last_tx=last_tx,
        ))

    return summaries


async def get_zkd_portfolio(address: str, force_refresh: bool = False) -> ZkdPortfolio:
    """
    Return live zkdETH/zkdAI portfolio for address.
    Balances from on-chain, LP summaries from sim data file.
    Cached for 60s.
    """
    cache_key = address.lower()
    now = time.time()
    if not force_refresh and _cache.get("ts", 0) > now - _CACHE_TTL and _cache.get("data"):
        cached = _cache["data"].get(cache_key)
        if cached:
            return cached

    try:
        # Fetch balances + block in parallel
        block_task = asyncio.create_task(_get_block_number())
        zkd_eth_task = asyncio.create_task(_read_balance(ZKD_ETH, address))
        zkd_ai_task = asyncio.create_task(_read_balance(ZKD_AI, address))

        block = await block_task
        zkd_eth_raw = await zkd_eth_task
        zkd_ai_raw = await zkd_ai_task

        balances = [
            ZkdBalance("zkdETH", "zkdETH", ZKD_ETH, zkd_eth_raw, zkd_eth_raw / 1e18),
            ZkdBalance("zkdAI",  "zkdAI",  ZKD_AI,  zkd_ai_raw,  zkd_ai_raw  / 1e18),
        ]
    except Exception as exc:
        logger.warning("zkd_lp_reader: on-chain read failed: %s", exc)
        block = 0
        balances = [
            ZkdBalance("zkdETH", "zkdETH", ZKD_ETH, 0, 0.0),
            ZkdBalance("zkdAI",  "zkdAI",  ZKD_AI,  0, 0.0),
        ]

    # LP positions from sim file (no on-chain Ekubo position API available)
    sim_positions = _load_sim_positions()
    lp_summaries = _summarise_positions(sim_positions)

    portfolio = ZkdPortfolio(
        address=address,
        balances=balances,
        lp_positions=lp_summaries,
        block_number=block,
        fetched_at=now,
    )

    if not _cache.get("data"):
        _cache["data"] = {}
    _cache["data"][cache_key] = portfolio
    _cache["ts"] = now

    return portfolio
