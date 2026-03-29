"""
Position Scanner — reads per-wallet DeFi positions from Starknet mainnet.

Supports:
  • Vesu     — REST API  (api.vesu.xyz/positions?walletAddress=...)
  • Endur    — On-chain   ERC-20 balance_of on xSTRK / xWBTC / xLBTC / …
  • Nostra   — On-chain   ERC-20 balance_of on interest-bearing iTokens
  • Ekubo    — On-chain   positions NFT (custom contract, enumeration via indexer)
  • Wallet   — On-chain   native token balances (ETH, STRK, USDC, USDT, …)

Design:
  - Landing page lane only — reads mainnet, never writes
  - All reads are idempotent; cached 60 s per wallet
  - Returns a unified PortfolioSnapshot that feeds into:
      1. Reputation onboarding (seed identity with real positions)
      2. Paper-trade Capital OS (show "what the agent would do" with your money)
      3. zkML creditworthiness model (real features, not synthetic)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from starknet_py.hash.selector import get_selector_from_name

logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

STARKNET_MAINNET_RPC = os.getenv(
    "STARKNET_MAINNET_RPC_URL",
    "https://rpc.starknet.lava.build:443",
)

VESU_POSITIONS_URL = "https://api.vesu.xyz/positions"

# RPC call budget per scan (avoid hammering free RPCs)
_MAX_RPC_CALLS = 30

# Cache TTL in seconds
_CACHE_TTL = int(os.getenv("POSITION_SCANNER_CACHE_TTL", "60"))

# ─── Known mainnet token contracts ────────────────────────────────────────────

WALLET_TOKENS: Dict[str, Dict[str, Any]] = {
    "ETH": {
        "address": "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        "decimals": 18,
        "coingecko_id": "ethereum",
    },
    "STRK": {
        "address": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        "decimals": 18,
        "coingecko_id": "starknet",
    },
    "USDC": {
        "address": "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
        "decimals": 6,
        "coingecko_id": "usd-coin",
    },
    "USDT": {
        "address": "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
        "decimals": 6,
        "coingecko_id": "tether",
    },
    "DAI": {
        "address": "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3",
        "decimals": 18,
        "coingecko_id": "dai",
    },
    "WBTC": {
        "address": "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
        "decimals": 8,
        "coingecko_id": "wrapped-bitcoin",
    },
    "wstETH": {
        "address": "0x042b8f0484674ca266ac5d08e4ac6a3fe65bd3129795def2dca5c34ecc5f96d2",
        "decimals": 18,
        "coingecko_id": "wrapped-steth",
    },
}

# ─── Endur liquid-staking receipt tokens ───────────────────────────────────────

ENDUR_TOKENS: Dict[str, Dict[str, Any]] = {
    "xSTRK": {
        "address": "0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a",
        "decimals": 18,
        "underlying": "STRK",
        "protocol": "endur",
    },
    # Endur also has xWBTC, xLBTC, etc. — add as they gain TVL
}

# ─── Nostra interest-bearing tokens (iTokens / lending receipts) ──────────────

NOSTRA_TOKENS: Dict[str, Dict[str, Any]] = {
    "nETH": {
        "address": "0x07170f54dd61ae85377f75131359e3f4a12677589f7ec4c13526c4cd8476c8c7",
        "decimals": 18,
        "underlying": "ETH",
        "protocol": "nostra",
    },
    "nUSDC": {
        "address": "0x06726ec97bae4e28efa8993a8e0853bd4bad0bd71de44c23a1cd651b026b00e7",
        "decimals": 6,
        "underlying": "USDC",
        "protocol": "nostra",
    },
    "nUSDT": {
        "address": "0x0453c4c996f1047d9370f824d68145bd5e7ce12d00437140ad02181e1d11dc83",
        "decimals": 6,
        "underlying": "USDT",
        "protocol": "nostra",
    },
    "nSTRK": {
        "address": "0x04b11c750ae92c13fdcbe514f9c47ba6f8266c81014501baa8346d3b8c0a3145",
        "decimals": 18,
        "underlying": "STRK",
        "protocol": "nostra",
    },
    "nWBTC": {
        "address": "0x07788bc687f203b6451f2a82e842b27f39c7cae697dace12edfb86c9b1c12f3d",
        "decimals": 8,
        "underlying": "WBTC",
        "protocol": "nostra",
    },
}


# ─── Data types ───────────────────────────────────────────────────────────────

@dataclass
class Position:
    """A single DeFi position held by a wallet."""
    protocol: str           # "vesu" | "endur" | "nostra" | "ekubo" | "wallet"
    position_type: str      # "lending" | "staking" | "lp" | "borrowing" | "token"
    asset_symbol: str       # "ETH", "USDC", "xSTRK", ...
    amount_raw: int = 0     # raw on-chain amount (before decimals)
    amount: float = 0.0     # human-readable amount
    decimals: int = 18
    value_usd: float = 0.0  # estimated USD value (0 if price unavailable)
    pool_name: str = ""     # e.g. "Genesis" for Vesu
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PortfolioSnapshot:
    """Complete portfolio state for a wallet at a point in time."""
    wallet_address: str
    scanned_at: str = ""
    positions: List[Position] = field(default_factory=list)
    total_value_usd: float = 0.0
    protocol_count: int = 0
    position_count: int = 0
    protocols_found: List[str] = field(default_factory=list)
    snapshot_hash: str = ""     # SHA-256 of canonical JSON — for proof binding
    scan_duration_ms: float = 0.0
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return d

    def compute_hash(self) -> str:
        """Deterministic hash of the portfolio snapshot for proof binding."""
        canon = json.dumps(
            {
                "wallet": self.wallet_address,
                "scanned_at": self.scanned_at,
                "positions": [
                    {
                        "protocol": p.protocol,
                        "type": p.position_type,
                        "asset": p.asset_symbol,
                        "amount_raw": p.amount_raw,
                    }
                    for p in self.positions
                ],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return "0x" + hashlib.sha256(canon.encode()).hexdigest()


# ─── RPC helper ───────────────────────────────────────────────────────────────

_BALANCE_OF_SELECTOR = hex(get_selector_from_name("balance_of"))


# RPC error codes that are permanent (no point retrying)
_PERMANENT_RPC_ERRORS = {20, 21}  # 20 = Contract not found, 21 = entrypoint does not exist

# Cache of contract addresses known to be invalid (avoid repeated calls)
_bad_contracts: Dict[str, float] = {}  # address -> timestamp
_BAD_CONTRACT_TTL = 300  # 5 min


class _RpcClient:
    """Thin starknet_call wrapper with connection reuse, timeout, and concurrency."""

    def __init__(self, rpc_url: str, timeout: float = 3.0):
        self.rpc_url = rpc_url
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None
        self._call_count = 0
        # Semaphore to limit concurrent RPC calls (free RPCs rate-limit aggressively)
        self._sem = asyncio.Semaphore(6)

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def balance_of(self, token_contract: str, wallet: str) -> Optional[int]:
        """Call balance_of(wallet) -> u256 (low, high). Retries once on transient errors."""
        if self._call_count >= _MAX_RPC_CALLS:
            logger.warning("RPC budget exhausted (%d/%d)", self._call_count, _MAX_RPC_CALLS)
            return None

        # Skip contracts known to be invalid (negative cache)
        now = time.time()
        bad_ts = _bad_contracts.get(token_contract)
        if bad_ts and now - bad_ts < _BAD_CONTRACT_TTL:
            return None

        self._call_count += 1

        async with self._sem:
            for attempt in range(2):
                try:
                    client = await self._get_client()
                    payload = {
                        "jsonrpc": "2.0",
                        "method": "starknet_call",
                        "id": self._call_count,
                        "params": [
                            {
                                "contract_address": token_contract,
                                "entry_point_selector": _BALANCE_OF_SELECTOR,
                                "calldata": [wallet],
                            },
                            "latest",
                        ],
                    }
                    resp = await client.post(self.rpc_url, json=payload)
                    data = resp.json()
                    if "result" not in data:
                        err = data.get("error", {})
                        err_code = err.get("code", 0)
                        logger.debug("RPC error for %s: %s", token_contract[:20], err)
                        # Don't retry permanent errors (contract not found, no entrypoint)
                        if err_code in _PERMANENT_RPC_ERRORS:
                            _bad_contracts[token_contract] = time.time()
                            return None
                        if attempt == 0:
                            await asyncio.sleep(0.1)
                            continue
                        return None
                    result = data["result"]
                    low = int(result[0], 16)
                    high = int(result[1], 16) if len(result) > 1 else 0
                    return low + high * (2 ** 128)
                except Exception as exc:
                    logger.debug("balance_of(%s) attempt=%d: %s", token_contract[:20], attempt, exc)
                    # Don't retry timeouts — they'll just timeout again
                    _bad_contracts[token_contract] = time.time()
                    return None

    async def batch_balance_of(
        self, tokens: Dict[str, str], wallet: str
    ) -> Dict[str, Optional[int]]:
        """
        Execute multiple balance_of calls concurrently (individual requests).
        tokens: {label: contract_address}
        Returns: {label: balance_int_or_None}
        """
        if not tokens:
            return {}

        async def _one(label: str, contract: str) -> tuple[str, Optional[int]]:
            bal = await self.balance_of(contract, wallet)
            return label, bal

        tasks = [_one(label, addr) for label, addr in tokens.items()]
        results_list = await asyncio.gather(*tasks, return_exceptions=True)

        results: Dict[str, Optional[int]] = {}
        for item in results_list:
            if isinstance(item, Exception):
                continue
            label, bal = item
            results[label] = bal
        return results


# ─── Price helper ─────────────────────────────────────────────────────────────

_price_cache: Dict[str, tuple] = {}  # symbol -> (price_usd, timestamp)
_PRICE_TTL = 300  # 5 min


async def _fetch_prices() -> Dict[str, float]:
    """Fetch USD prices for known tokens via CoinGecko (free tier)."""
    now = time.time()

    # Return cache if fresh
    if _price_cache and all(now - ts < _PRICE_TTL for _, ts in _price_cache.values()):
        return {sym: price for sym, (price, _) in _price_cache.items()}

    ids = []
    id_to_sym = {}
    for sym, info in WALLET_TOKENS.items():
        cg_id = info.get("coingecko_id")
        if cg_id:
            ids.append(cg_id)
            id_to_sym[cg_id] = sym

    prices: Dict[str, float] = {}
    if not ids:
        return prices

    try:
        base = os.getenv("COINGECKO_API_BASE", "https://api.coingecko.com/api/v3")
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base}/simple/price",
                params={"ids": ",".join(ids), "vs_currencies": "usd"},
            )
            data = resp.json()
            for cg_id, sym in id_to_sym.items():
                usd = data.get(cg_id, {}).get("usd")
                if usd is not None:
                    prices[sym] = float(usd)
                    _price_cache[sym] = (float(usd), now)
    except Exception as exc:
        logger.warning("Price fetch failed: %s", exc)
        # Fall back to cached values
        for sym, (price, _) in _price_cache.items():
            prices[sym] = price

    return prices


# ─── Protocol scanners ────────────────────────────────────────────────────────

async def _scan_vesu(wallet: str) -> tuple[List[Position], List[str]]:
    """Read Vesu lending/borrowing positions via REST API."""
    positions: List[Position] = []
    errors: List[str] = []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(VESU_POSITIONS_URL, params={"walletAddress": wallet})
            if resp.status_code != 200:
                errors.append(f"vesu: HTTP {resp.status_code}")
                return positions, errors
            data = resp.json()
            for p in data.get("data", []):
                coll = p.get("collateral", {})
                coll_shares = p.get("collateralShares", {})
                debt = p.get("debt")
                pool = p.get("pool", {})
                pos_type = p.get("type", "earn")  # "earn" or "borrow"

                # Parse collateral value
                coll_value_raw = coll_shares.get("value", "0") if coll_shares else "0"
                coll_decimals = coll_shares.get("decimals", 18) if coll_shares else 18
                coll_symbol = coll.get("symbol", "?")
                coll_amount_raw = int(coll_value_raw)
                coll_amount = coll_amount_raw / (10 ** coll_decimals) if coll_decimals else 0

                # Parse USD price from Vesu
                usd_price_obj = coll.get("usdPrice", {})
                usd_price = 0.0
                if usd_price_obj:
                    usd_val = int(usd_price_obj.get("value", "0"))
                    usd_dec = usd_price_obj.get("decimals", 18)
                    usd_price = usd_val / (10 ** usd_dec) if usd_dec else 0

                value_usd = coll_amount * usd_price

                if coll_amount_raw > 0:
                    positions.append(Position(
                        protocol="vesu",
                        position_type="lending" if pos_type == "earn" else "borrowing",
                        asset_symbol=coll_symbol,
                        amount_raw=coll_amount_raw,
                        amount=coll_amount,
                        decimals=coll_decimals,
                        value_usd=value_usd,
                        pool_name=pool.get("name", ""),
                        extra={
                            "pool_id": pool.get("id", ""),
                            "is_deprecated": p.get("isDeprecated", False),
                            "protocol_version": p.get("protocolVersion", ""),
                        },
                    ))

                # Also record debt positions separately
                if debt and pos_type == "borrow":
                    debt_shares = p.get("debtShares", {})
                    if debt_shares:
                        debt_raw = int(debt_shares.get("value", "0"))
                        debt_dec = debt_shares.get("decimals", 18)
                        debt_amount = debt_raw / (10 ** debt_dec) if debt_dec else 0
                        debt_usd_obj = debt.get("usdPrice", {})
                        debt_usd = 0.0
                        if debt_usd_obj:
                            dv = int(debt_usd_obj.get("value", "0"))
                            dd = debt_usd_obj.get("decimals", 18)
                            debt_usd = (dv / (10 ** dd)) * debt_amount if dd else 0
                        if debt_raw > 0:
                            positions.append(Position(
                                protocol="vesu",
                                position_type="borrowing",
                                asset_symbol=debt.get("symbol", "?"),
                                amount_raw=debt_raw,
                                amount=debt_amount,
                                decimals=debt_dec,
                                value_usd=-debt_usd,  # negative = liability
                                pool_name=pool.get("name", ""),
                            ))
    except Exception as exc:
        errors.append(f"vesu: {exc}")
    return positions, errors


async def _scan_endur(wallet: str, rpc: _RpcClient) -> tuple[List[Position], List[str]]:
    """Read Endur liquid staking positions via batched on-chain balance_of."""
    positions: List[Position] = []
    errors: List[str] = []
    try:
        token_addrs = {sym: info["address"] for sym, info in ENDUR_TOKENS.items()}
        balances = await rpc.batch_balance_of(token_addrs, wallet)
        for sym, bal in balances.items():
            if bal is not None and bal > 0:
                info = ENDUR_TOKENS[sym]
                dec = info["decimals"]
                positions.append(Position(
                    protocol="endur",
                    position_type="staking",
                    asset_symbol=sym,
                    amount_raw=bal,
                    amount=bal / (10 ** dec),
                    decimals=dec,
                    extra={"underlying": info.get("underlying", "")},
                ))
    except Exception as exc:
        errors.append(f"endur: {exc}")
    return positions, errors


async def _scan_nostra(wallet: str, rpc: _RpcClient) -> tuple[List[Position], List[str]]:
    """Read Nostra lending positions via batched on-chain iToken balance_of."""
    positions: List[Position] = []
    errors: List[str] = []
    try:
        token_addrs = {sym: info["address"] for sym, info in NOSTRA_TOKENS.items()}
        balances = await rpc.batch_balance_of(token_addrs, wallet)
        for sym, bal in balances.items():
            if bal is not None and bal > 0:
                info = NOSTRA_TOKENS[sym]
                dec = info["decimals"]
                positions.append(Position(
                    protocol="nostra",
                    position_type="lending",
                    asset_symbol=sym,
                    amount_raw=bal,
                    amount=bal / (10 ** dec),
                    decimals=dec,
                    extra={"underlying": info.get("underlying", "")},
                ))
    except Exception as exc:
        errors.append(f"nostra: {exc}")
    return positions, errors


async def _scan_wallet_tokens(wallet: str, rpc: _RpcClient) -> tuple[List[Position], List[str]]:
    """Read plain token balances (ETH, STRK, USDC, etc.) via batched RPC."""
    positions: List[Position] = []
    errors: List[str] = []
    try:
        token_addrs = {sym: info["address"] for sym, info in WALLET_TOKENS.items()}
        balances = await rpc.batch_balance_of(token_addrs, wallet)
        for sym, bal in balances.items():
            if bal is not None and bal > 0:
                info = WALLET_TOKENS[sym]
                dec = info["decimals"]
                positions.append(Position(
                    protocol="wallet",
                    position_type="token",
                    asset_symbol=sym,
                    amount_raw=bal,
                    amount=bal / (10 ** dec),
                    decimals=dec,
                ))
    except Exception as exc:
        errors.append(f"wallet: {exc}")
    return positions, errors


# ─── Main scanner ─────────────────────────────────────────────────────────────

_snapshot_cache: Dict[str, tuple] = {}  # wallet -> (PortfolioSnapshot, timestamp)
_summary_refresh_tasks: Dict[str, asyncio.Task] = {}


def _snapshot_to_summary(snapshot: PortfolioSnapshot) -> Dict[str, Any]:
    return {
        "wallet_address": snapshot.wallet_address,
        "total_value_usd": snapshot.total_value_usd,
        "protocol_count": snapshot.protocol_count,
        "position_count": snapshot.position_count,
        "protocols_found": snapshot.protocols_found,
        "snapshot_hash": snapshot.snapshot_hash,
        "scanned_at": snapshot.scanned_at,
    }


def get_cached_portfolio_summary(wallet_address: str) -> Optional[Dict[str, Any]]:
    wallet = wallet_address.strip().lower()
    cached_entry = _snapshot_cache.get(wallet)
    if not cached_entry:
        return None
    snapshot, _ = cached_entry
    return _snapshot_to_summary(snapshot)


async def get_portfolio_summary_best_effort(
    wallet_address: str,
    *,
    timeout_s: float = 0.75,
) -> Optional[Dict[str, Any]]:
    wallet = wallet_address.strip().lower()
    cached_summary = get_cached_portfolio_summary(wallet)
    if cached_summary is not None:
        return cached_summary

    try:
        snapshot = await asyncio.wait_for(scan_portfolio(wallet), timeout=timeout_s)
        return _snapshot_to_summary(snapshot)
    except asyncio.TimeoutError:
        existing_task = _summary_refresh_tasks.get(wallet)
        if existing_task is None or existing_task.done():
            _summary_refresh_tasks[wallet] = asyncio.create_task(_refresh_portfolio_summary(wallet))
        logger.info("Portfolio summary timed out for %s; returning without snapshot", wallet[:20])
        return None
    except Exception:
        logger.exception("Portfolio summary fetch failed for %s", wallet[:20])
        return None


async def _refresh_portfolio_summary(wallet_address: str) -> None:
    try:
        await scan_portfolio(wallet_address)
    except Exception:
        logger.exception("Background portfolio refresh failed for %s", wallet_address[:20])
    finally:
        _summary_refresh_tasks.pop(wallet_address, None)


async def scan_portfolio(wallet_address: str, *, skip_cache: bool = False) -> PortfolioSnapshot:
    """
    Scan all supported protocols for positions held by wallet_address.

    Returns a PortfolioSnapshot with positions, USD values, and a
    deterministic snapshot_hash suitable for proof binding.
    """
    wallet = wallet_address.strip().lower()
    now = time.time()

    # Check cache
    if not skip_cache and wallet in _snapshot_cache:
        cached, ts = _snapshot_cache[wallet]
        if now - ts < _CACHE_TTL:
            return cached

    t0 = time.time()
    rpc = _RpcClient(STARKNET_MAINNET_RPC)
    all_positions: List[Position] = []
    all_errors: List[str] = []

    try:
        # Run all protocol scanners concurrently
        results = await asyncio.gather(
            _scan_vesu(wallet),
            _scan_endur(wallet, rpc),
            _scan_nostra(wallet, rpc),
            _scan_wallet_tokens(wallet, rpc),
            return_exceptions=True,
        )

        for result in results:
            if isinstance(result, Exception):
                all_errors.append(str(result))
                continue
            positions, errors = result
            all_positions.extend(positions)
            all_errors.extend(errors)

    finally:
        await rpc.close()

    # Fetch prices and compute USD values for on-chain positions (Vesu already has USD)
    prices = await _fetch_prices()
    for pos in all_positions:
        if pos.value_usd == 0.0 and pos.amount > 0:
            # Try to price via underlying or direct symbol
            underlying = pos.extra.get("underlying", pos.asset_symbol)
            price = prices.get(underlying, 0.0)
            if price > 0:
                pos.value_usd = pos.amount * price

    # Build snapshot
    protocols_found = sorted(set(p.protocol for p in all_positions if p.protocol != "wallet"))
    total_usd = sum(p.value_usd for p in all_positions)
    duration_ms = (time.time() - t0) * 1000

    snapshot = PortfolioSnapshot(
        wallet_address=wallet,
        scanned_at=datetime.now(timezone.utc).isoformat(),
        positions=all_positions,
        total_value_usd=total_usd,
        protocol_count=len(protocols_found),
        position_count=len([p for p in all_positions if p.protocol != "wallet"]),
        protocols_found=protocols_found,
        scan_duration_ms=round(duration_ms, 1),
        errors=all_errors,
    )
    snapshot.snapshot_hash = snapshot.compute_hash()

    # Cache
    _snapshot_cache[wallet] = (snapshot, time.time())

    logger.info(
        "Portfolio scan: wallet=%s positions=%d protocols=%s tvl=$%.2f duration=%.0fms",
        wallet[:20],
        snapshot.position_count,
        protocols_found,
        total_usd,
        duration_ms,
    )
    return snapshot


# ─── Singleton ────────────────────────────────────────────────────────────────

_scanner_instance = None


def get_position_scanner():
    """Module-level access point (for consistency with other services)."""
    return scan_portfolio  # It's a standalone async function, not a class
