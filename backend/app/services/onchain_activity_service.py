"""
On-Chain Activity Service — queries real Starknet mainnet data.

Bridges the gap between the position scanner (current state) and the
reputation system (historical activity) by combining:
  1. Position scanner: current DeFi positions (Vesu, Endur, Nostra, wallet)
  2. Starknet RPC: account nonce (transaction count)
  3. Starknet RPC: StarkGate deposit events (bridge history)

Caches results for 5 minutes to avoid hammering free RPCs.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

STARKNET_MAINNET_RPC = os.getenv(
    "STARKNET_MAINNET_RPC_URL",
    "https://rpc.starknet.lava.build:443",
)

_CACHE_TTL = 300  # 5 minutes
_EVENT_LOOKBACK_BLOCKS = 50_000  # ~3-4 days on Starknet mainnet

# ─── Verified contracts (from receiptos/config/) ─────────────────────────────

STARKGATE_ETH_BRIDGE = "0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82"
STARKGATE_DEPOSIT_SELECTOR = "0x282f521c69b2bc696552b9e141009d3c84f2df75e2e7b7716644d31e60f23b1"

EKUBO_CORE = "0x0280d63e837e70ebdee7f7f2b314c6f24b4bbe6dd59dbfcc5038d07cdbe2e0f2"
VESU_CORE = "0x00a84a2a04e4254e3b917afc7204d688c694b3e60e5e1c3c0e41c86cac42a87e"

# Event selectors for tx history analysis
_TX_EXECUTED_SELECTOR = "0x1dcde06aabdbca2f80aa51392b345d7549d7757aa855f7e37f5d335ac8243b1"
_AVNU_SWAP_SELECTOR = "0xe316f0d9d2a3affa97de1d99bb2aac0538e2666d0d8545545ead241ef0ccab"

# Known Starknet protocol contracts (int addresses for leading-zero-safe comparison)
_PROTOCOL_BY_ADDR: Dict[int, str] = {
    0x04270219D365D6B017231B52E92B3FB5D7C8378B05E9ABC97724537A80E93B0F: "AVNU",
    0x0280D63E837E70EBDEE7F7F2B314C6F24B4BBE6DD59DBFCC5038D07CDBE2E0F2: "Ekubo",
    0x00A84A2A04E4254E3B917AFC7204D688C694B3E60E5E1C3C0E41C86CAC42A87E: "Vesu",
    0x073314940630FD6DCDA0D772D4C972C4E0A9946BEF9DABF4EF84EDA8EF542B82: "StarkGate",
    0x041FD22B238FA21CFCF5DD45A8548974D8263B3A531A60388411C5E230F97023: "mySwap",
    0x010884171BAF1914EDC28D7AFB619B40A4051CFAE78A094A55D230F19E944A28: "JediSwap",
    0x05DD3D2F4429AF886CD1A3B08289DBCEA99A294197E9EB43B0E0325B4B: "Ekubo",  # Ekubo positions NFT
}


# ─── Data types ───────────────────────────────────────────────────────────────

@dataclass
class BridgeDeposit:
    """A single StarkGate ETH bridge deposit."""
    block_number: int = 0
    l1_sender: str = ""
    l2_recipient: str = ""
    amount_raw: int = 0
    amount_eth: float = 0.0
    tx_hash: str = ""


@dataclass
class OnChainActivity:
    """Aggregated on-chain activity for a wallet."""
    # Identity
    wallet_address: str = ""
    # Transaction count from nonce
    starknet_nonce: int = 0
    # Bridge activity
    bridge_deposits: List[BridgeDeposit] = field(default_factory=list)
    bridge_deposit_count: int = 0
    bridge_total_eth: float = 0.0
    # Position-derived stats
    collateral_eth: float = 0.0  # total lending/staking position value in ETH
    total_value_usd: float = 0.0
    protocol_count: int = 0
    position_count: int = 0
    protocols_active: List[str] = field(default_factory=list)
    # Lending breakdown
    lending_value_usd: float = 0.0
    staking_value_usd: float = 0.0
    wallet_value_usd: float = 0.0
    # Transaction history
    first_tx_timestamp: int = 0
    account_age_days: int = 0
    swap_count: int = 0
    tx_hashes: List[str] = field(default_factory=list)
    # Metadata
    fetched_at: float = 0.0
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "wallet_address": self.wallet_address,
            "starknet_nonce": self.starknet_nonce,
            "bridge_deposit_count": self.bridge_deposit_count,
            "bridge_total_eth": round(self.bridge_total_eth, 6),
            "bridge_deposits": [
                {
                    "block_number": d.block_number,
                    "l1_sender": d.l1_sender,
                    "amount_eth": round(d.amount_eth, 6),
                    "tx_hash": d.tx_hash,
                }
                for d in self.bridge_deposits[:20]  # cap at 20 for response size
            ],
            "collateral_eth": round(self.collateral_eth, 6),
            "total_value_usd": round(self.total_value_usd, 2),
            "protocol_count": self.protocol_count,
            "position_count": self.position_count,
            "protocols_active": self.protocols_active,
            "lending_value_usd": round(self.lending_value_usd, 2),
            "staking_value_usd": round(self.staking_value_usd, 2),
            "wallet_value_usd": round(self.wallet_value_usd, 2),
            "first_tx_timestamp": self.first_tx_timestamp,
            "account_age_days": self.account_age_days,
            "swap_count": self.swap_count,
            "fetched_at": self.fetched_at,
            "errors": self.errors,
        }


# ─── Address normalization ────────────────────────────────────────────────────

def _normalize_felt(hex_str: str) -> str:
    """Normalize a hex felt to 0x + 64 hex digits (left-padded)."""
    raw = hex_str.strip().lower()
    if raw.startswith("0x"):
        raw = raw[2:]
    return "0x" + raw.zfill(64)


# ─── RPC helpers ──────────────────────────────────────────────────────────────

async def _rpc_call(client: httpx.AsyncClient, method: str, params: Any) -> Any:
    """Make a single Starknet JSON-RPC call."""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1,
    }
    resp = await client.post(STARKNET_MAINNET_RPC, json=payload)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"RPC error: {data['error']}")
    return data.get("result")


async def _get_nonce(client: httpx.AsyncClient, address: str) -> int:
    """Get account nonce (proxy for outbound transaction count)."""
    result = await _rpc_call(client, "starknet_getNonce", {
        "block_id": "latest",
        "contract_address": address,
    })
    return int(result, 16) if result else 0


async def _get_block_number(client: httpx.AsyncClient) -> int:
    """Get current block number."""
    result = await _rpc_call(client, "starknet_blockNumber", [])
    return int(result) if result else 0


async def _get_bridge_deposits(
    client: httpx.AsyncClient,
    wallet: str,
    from_block: int,
    to_block: int,
) -> List[BridgeDeposit]:
    """
    Query StarkGate ETH bridge for deposits to this wallet.

    Uses starknet_getEvents with key filtering:
      key[0] = deposit selector
      key[1] = [] (any token)
      key[2] = [] (any l1_sender)
      key[3] = [wallet] (specific l2_recipient)
    """
    deposits: List[BridgeDeposit] = []
    wallet_norm = _normalize_felt(wallet)

    continuation_token: Optional[str] = None
    pages_fetched = 0
    max_pages = 5  # safety limit

    while pages_fetched < max_pages:
        filter_params: Dict[str, Any] = {
            "from_block": {"block_number": from_block},
            "to_block": {"block_number": to_block},
            "address": STARKGATE_ETH_BRIDGE,
            "keys": [
                [STARKGATE_DEPOSIT_SELECTOR],  # event selector
                [],   # any token_name
                [],   # any l1_sender
                [wallet_norm],  # specific l2_recipient
            ],
            "chunk_size": 100,
        }
        if continuation_token:
            filter_params["continuation_token"] = continuation_token

        result = await _rpc_call(client, "starknet_getEvents", {"filter": filter_params})
        events = result.get("events", []) if isinstance(result, dict) else []

        for event in events:
            try:
                data_fields = event.get("data", [])
                keys_fields = event.get("keys", [])
                # data: [amount_low, amount_high]
                amount_low = int(data_fields[0], 16) if len(data_fields) > 0 else 0
                amount_high = int(data_fields[1], 16) if len(data_fields) > 1 else 0
                amount_raw = amount_low + (amount_high << 128)
                amount_eth = amount_raw / 1e18

                l1_sender = keys_fields[2] if len(keys_fields) > 2 else ""

                deposits.append(BridgeDeposit(
                    block_number=event.get("block_number", 0),
                    l1_sender=l1_sender,
                    l2_recipient=wallet_norm,
                    amount_raw=amount_raw,
                    amount_eth=amount_eth,
                    tx_hash=event.get("transaction_hash", ""),
                ))
            except (IndexError, ValueError, TypeError) as exc:
                logger.debug("Skipping malformed bridge event: %s", exc)

        continuation_token = result.get("continuation_token") if isinstance(result, dict) else None
        pages_fetched += 1
        if not continuation_token:
            break

    return deposits


# ─── Starknet transaction history analysis ────────────────────────────────────

async def _analyze_starknet_history(
    client: httpx.AsyncClient,
    wallet: str,
    current_block: int,
    activity: OnChainActivity,
) -> None:
    """
    Analyze Starknet transaction history for real account age, protocol
    detection, and swap counting.

    1. Find ``transaction_executed`` events emitted by the account.
    2. Get the first block's timestamp → real account age.
    3. Sample a few tx receipts to detect interacted protocols.
    """
    try:
        # Use a generous lookback. Free RPCs silently return empty
        # results when the block range is too wide (>~150K on most).
        _HISTORY_LOOKBACK = 100_000
        from_block = max(0, current_block - _HISTORY_LOOKBACK) if current_block > 0 else 0

        # Step 1 — get transaction_executed events from this account
        result = await _rpc_call(client, "starknet_getEvents", {
            "filter": {
                "from_block": {"block_number": from_block},
                "to_block": "latest",
                "address": wallet,
                "keys": [[_TX_EXECUTED_SELECTOR]],
                "chunk_size": 100,
            }
        })

        events = result.get("events", []) if isinstance(result, dict) else []
        if not events:
            return

        # Deduplicate tx hashes preserving order
        tx_hashes: List[str] = list(dict.fromkeys(
            e.get("transaction_hash", "") for e in events if e.get("transaction_hash")
        ))
        activity.tx_hashes = tx_hashes

        first_block = events[0].get("block_number", 0)

        # Step 2 — real account age from first block's timestamp
        if first_block > 0:
            block_data = await _rpc_call(
                client,
                "starknet_getBlockWithTxHashes",
                {"block_id": {"block_number": first_block}},
            )
            if isinstance(block_data, dict) and block_data.get("timestamp"):
                activity.first_tx_timestamp = int(block_data["timestamp"])
                activity.account_age_days = max(
                    0, (int(time.time()) - activity.first_tx_timestamp) // 86400
                )

        # Step 3 — sample receipts for protocol detection
        sample_idx = [0]
        if len(tx_hashes) > 2:
            sample_idx.append(len(tx_hashes) // 2)
        if len(tx_hashes) > 1:
            sample_idx.append(len(tx_hashes) - 1)
        sample_hashes = [tx_hashes[i] for i in sample_idx if i < len(tx_hashes)]

        detected_protocols: set[str] = set()
        swap_count = 0

        receipts = await asyncio.gather(
            *[
                _rpc_call(client, "starknet_getTransactionReceipt", {"transaction_hash": h})
                for h in sample_hashes
            ],
            return_exceptions=True,
        )

        for receipt in receipts:
            if isinstance(receipt, Exception) or not isinstance(receipt, dict):
                continue
            for event in receipt.get("events", []):
                from_addr = event.get("from_address", "")
                try:
                    addr_int = int(from_addr, 16)
                    proto = _PROTOCOL_BY_ADDR.get(addr_int)
                    if proto:
                        detected_protocols.add(proto)
                except (ValueError, TypeError):
                    continue

                # Count AVNU swap completion events
                keys = event.get("keys", [])
                if keys and keys[0] == _AVNU_SWAP_SELECTOR:
                    swap_count += 1

        # Scale swap count by sample ratio (approximate)
        if sample_hashes and len(tx_hashes) > len(sample_hashes):
            swap_count = int(swap_count * len(tx_hashes) / len(sample_hashes))
        activity.swap_count = swap_count

        # Merge with protocols from position scanner (set later)
        if detected_protocols:
            existing = set(activity.protocols_active)
            existing.update(detected_protocols)
            activity.protocols_active = sorted(existing)
            activity.protocol_count = max(activity.protocol_count, len(activity.protocols_active))

    except Exception as exc:
        activity.errors.append(f"tx_history: {exc}")


# ─── Position scanner integration ────────────────────────────────────────────

async def _get_position_stats(wallet: str) -> Dict[str, Any]:
    """Extract collateral and protocol stats from position scanner."""
    try:
        from app.services.position_scanner import scan_portfolio
        snapshot = await asyncio.wait_for(scan_portfolio(wallet), timeout=10.0)

        lending_usd = 0.0
        staking_usd = 0.0
        wallet_usd = 0.0

        for pos in snapshot.positions:
            if pos.position_type in ("lending", "borrowing"):
                lending_usd += pos.value_usd
            elif pos.position_type == "staking":
                staking_usd += pos.value_usd
            elif pos.position_type == "token":
                wallet_usd += pos.value_usd

        return {
            "total_value_usd": snapshot.total_value_usd,
            "protocol_count": snapshot.protocol_count,
            "position_count": snapshot.position_count,
            "protocols_found": snapshot.protocols_found,
            "lending_value_usd": lending_usd,
            "staking_value_usd": staking_usd,
            "wallet_value_usd": wallet_usd,
            "defi_positions_value_usd": snapshot.defi_positions_value_usd,
        }
    except asyncio.TimeoutError:
        logger.warning("Position scanner timed out for %s", wallet[:20])
        return {}
    except Exception as exc:
        logger.warning("Position scanner failed for %s: %s", wallet[:20], exc)
        return {}


# ─── Main service ─────────────────────────────────────────────────────────────

_activity_cache: Dict[str, tuple[OnChainActivity, float]] = {}


async def get_onchain_activity(wallet_address: str) -> OnChainActivity:
    """
    Fetch real on-chain activity for a wallet from Starknet mainnet.

    Combines:
    - Starknet nonce (real transaction count)
    - StarkGate bridge deposit events (real bridge history)
    - Position scanner (real DeFi positions & collateral)

    Results are cached for 5 minutes.
    """
    wallet = wallet_address.strip().lower()
    now = time.time()

    # Check cache
    cached = _activity_cache.get(wallet)
    if cached:
        activity, ts = cached
        if now - ts < _CACHE_TTL:
            return activity

    activity = OnChainActivity(wallet_address=wallet, fetched_at=now)

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Get current block number for lookback calculation
        try:
            current_block = await _get_block_number(client)
            from_block = max(0, current_block - _EVENT_LOOKBACK_BLOCKS)
        except Exception as exc:
            activity.errors.append(f"block_number: {exc}")
            current_block = 0
            from_block = 0

        # Run nonce, bridge events, position scanner, and tx history in parallel
        nonce_task = asyncio.create_task(_safe_nonce(client, wallet, activity))
        bridge_task = asyncio.create_task(
            _safe_bridge(client, wallet, from_block, current_block, activity)
        )
        position_task = asyncio.create_task(_get_position_stats(wallet))
        history_task = asyncio.create_task(
            _safe_history(client, wallet, current_block, activity)
        )

        await asyncio.gather(
            nonce_task, bridge_task, position_task, history_task,
            return_exceptions=True,
        )

        # Merge position stats (preserving protocols detected by tx history)
        pos_stats = position_task.result() if not position_task.cancelled() else {}
        if isinstance(pos_stats, dict) and pos_stats:
            activity.total_value_usd = pos_stats.get("total_value_usd", 0.0)
            activity.position_count = pos_stats.get("position_count", 0)
            activity.lending_value_usd = pos_stats.get("lending_value_usd", 0.0)
            activity.staking_value_usd = pos_stats.get("staking_value_usd", 0.0)
            activity.wallet_value_usd = pos_stats.get("wallet_value_usd", 0.0)

            # Merge protocols from position scanner with tx-history-detected ones
            scanner_protos = set(pos_stats.get("protocols_found", []))
            existing_protos = set(activity.protocols_active)
            merged = sorted(existing_protos | scanner_protos)
            activity.protocols_active = merged
            activity.protocol_count = max(
                pos_stats.get("protocol_count", 0), len(merged)
            )
            activity.lending_value_usd = pos_stats.get("lending_value_usd", 0.0)
            activity.staking_value_usd = pos_stats.get("staking_value_usd", 0.0)
            activity.wallet_value_usd = pos_stats.get("wallet_value_usd", 0.0)

            # Compute collateral_eth: lending + staking positions value / ETH price
            defi_usd = pos_stats.get("defi_positions_value_usd", 0.0)
            eth_price = await _get_eth_price()
            if eth_price > 0:
                activity.collateral_eth = defi_usd / eth_price
            else:
                activity.collateral_eth = defi_usd / 2500.0  # fallback estimate

    # Cache result
    _activity_cache[wallet] = (activity, now)
    return activity


async def _safe_nonce(
    client: httpx.AsyncClient,
    wallet: str,
    activity: OnChainActivity,
) -> None:
    """Fetch nonce with error handling."""
    try:
        activity.starknet_nonce = await _get_nonce(client, wallet)
    except Exception as exc:
        activity.errors.append(f"nonce: {exc}")


async def _safe_bridge(
    client: httpx.AsyncClient,
    wallet: str,
    from_block: int,
    to_block: int,
    activity: OnChainActivity,
) -> None:
    """Fetch bridge deposits with error handling."""
    if to_block <= 0:
        return
    try:
        deposits = await _get_bridge_deposits(client, wallet, from_block, to_block)
        activity.bridge_deposits = deposits
        activity.bridge_deposit_count = len(deposits)
        activity.bridge_total_eth = sum(d.amount_eth for d in deposits)
    except Exception as exc:
        activity.errors.append(f"bridge: {exc}")


async def _safe_history(
    client: httpx.AsyncClient,
    wallet: str,
    current_block: int,
    activity: OnChainActivity,
) -> None:
    """Analyze tx history with error handling."""
    try:
        await _analyze_starknet_history(client, wallet, current_block, activity)
    except Exception as exc:
        activity.errors.append(f"history: {exc}")


# ─── ETH price helper ────────────────────────────────────────────────────────

_eth_price_cache: tuple[float, float] = (0.0, 0.0)  # (price, timestamp)
_ETH_PRICE_TTL = 300  # 5 minutes


async def _get_eth_price() -> float:
    """Get current ETH price from CoinGecko (cached 5 min)."""
    global _eth_price_cache
    price, ts = _eth_price_cache
    if price > 0 and time.time() - ts < _ETH_PRICE_TTL:
        return price

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": "ethereum", "vs_currencies": "usd"},
            )
            data = resp.json()
            price = float(data.get("ethereum", {}).get("usd", 0))
            if price > 0:
                _eth_price_cache = (price, time.time())
            return price
    except Exception:
        return _eth_price_cache[0] if _eth_price_cache[0] > 0 else 0.0


# ─── Convenience: enrich reputation data ─────────────────────────────────────

async def enrich_reputation_data(
    address: str,
    current_rep: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Enrich reputation response with real on-chain data.

    Overwrites synthetic fields with real data when available:
    - transaction_count: real Starknet nonce
    - collateral_eth: real DeFi position value
    - total_volume_eth: position value + bridge volume as proxy
    - on_chain: full on-chain activity breakdown

    Returns a new dict with merged data (does not mutate current_rep).
    """
    activity = await get_onchain_activity(address)
    enriched = dict(current_rep)

    # Override transaction count with real nonce if higher
    current_tx = int(enriched.get("transaction_count", 0))
    if activity.starknet_nonce > current_tx:
        enriched["transaction_count"] = activity.starknet_nonce

    # Override collateral with real position data if higher than stored
    current_collateral = float(enriched.get("collateral_eth", 0))
    if activity.collateral_eth > current_collateral:
        enriched["collateral_eth"] = round(activity.collateral_eth, 6)

    # Override volume with position-based estimate if higher
    # Volume proxy: total DeFi position value + bridge deposits (conservative estimate)
    current_volume = float(enriched.get("total_volume_eth", 0))
    real_volume = activity.collateral_eth + activity.bridge_total_eth
    if real_volume > current_volume:
        enriched["total_volume_eth"] = round(real_volume, 6)

    # Add on-chain activity section
    enriched["on_chain"] = activity.to_dict()

    return enriched
