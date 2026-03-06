"""
Mainnet Data Collector — fetches real on-chain data for ML model training.

Data sources:
  - Ekubo mainnet API (prod-api.ekubo.org) — pool TVL, volume, fees, depth
  - DefiLlama (yields.llama.fi) — APY timeseries for Starknet pools
  - Nethermind free mainnet RPC — block data, wallet histories, events
  - Ekubo Sepolia API — for Sepolia pool data (via existing ekubo_client)

Outputs timestamped JSON datasets in backend/app/data/training_datasets/.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "training_datasets"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Mainnet data sources
EKUBO_MAINNET_API = os.getenv("EKUBO_MAINNET_API", "https://mainnet-api.ekubo.org")
EKUBO_SEPOLIA_API = os.getenv("EKUBO_API_BASE", "https://prod-api.ekubo.org")
DEFI_LLAMA_YIELDS = "https://yields.llama.fi/pools"
STARKNET_MAINNET_RPC = os.getenv("STARKNET_MAINNET_RPC_URL", "https://free-rpc.nethermind.io/mainnet-juno/v0_7")
STARKNET_SEPOLIA_RPC = os.getenv("STARKNET_RPC_URL", "http://127.0.0.1:6060")


@dataclass
class PoolSample:
    """Single pool data point for yield_forecast / anomaly_detector training."""
    pool_id: str
    dex: str  # ekubo | jediswap
    network: str  # mainnet | sepolia
    timestamp: int
    tvl_usd: float
    volume_24h_usd: float
    fee_tier_bps: float
    current_apr: float
    apr_7d_avg: float
    apr_30d_avg: float
    apr_trend_7d: float
    apr_volatility_7d: float
    utilization_ratio: float
    tick_concentration: float
    num_positions: int
    time_since_last_rebalance_hours: float
    # Anomaly features
    tvl_stability: float
    liquidity_concentration: float
    price_impact_bps: float
    deployer_reputation: float
    volume_pattern: float
    fee_anomaly: float
    large_withdrawal_pct: float
    smart_money_flow: float
    # Labels (will be computed during training)
    yield_label: str = ""
    anomaly_label: str = ""


@dataclass
class WalletSample:
    """Single wallet data point for creditworthiness training."""
    address: str
    network: str
    timestamp: int
    eth_balance: float
    tx_count: int
    unique_contracts: int
    defi_protocol_count: int
    total_value_locked: float
    loan_to_value_ratio: float
    liquidation_count: int
    avg_position_duration_days: float
    transaction_frequency: float
    smart_contract_diversity: float
    gas_efficiency_score: float
    flash_loan_usage: int
    governance_participation: int
    bridge_activity: int
    nft_holdings_count: int
    account_age_days: float
    max_single_tx_value: float
    staking_participation: int
    credit_label: str = ""


@dataclass
class CollectionResult:
    """Result from a collection run."""
    pool_samples: list[PoolSample] = field(default_factory=list)
    wallet_samples: list[WalletSample] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    timestamp: int = 0
    duration_seconds: float = 0.0

    def summary(self) -> dict:
        return {
            "pool_samples": len(self.pool_samples),
            "wallet_samples": len(self.wallet_samples),
            "errors": len(self.errors),
            "timestamp": self.timestamp,
            "duration_seconds": round(self.duration_seconds, 2),
        }


class MainnetDataCollector:
    """Collects real data from Starknet mainnet + Sepolia for model training."""

    def __init__(self):
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    # ── Pool Data Collection ──────────────────────────────────────────

    async def collect_ekubo_mainnet_pools(self) -> list[PoolSample]:
        """Fetch pool data from Ekubo mainnet API."""
        client = await self._get_client()
        samples = []
        try:
            # Get top pools by TVL
            resp = await client.get(
                f"{EKUBO_MAINNET_API}/overview/pools",
                params={"limit": 100},
            )
            if resp.status_code != 200:
                # Try alternate endpoint
                resp = await client.get(f"{EKUBO_MAINNET_API}/pools")

            if resp.status_code == 200:
                pools = resp.json()
                if isinstance(pools, dict):
                    pools = pools.get("pools", pools.get("data", []))

                now = int(time.time())
                for pool in pools[:100]:
                    try:
                        sample = self._parse_ekubo_pool(pool, "mainnet", now)
                        if sample:
                            samples.append(sample)
                    except Exception as e:
                        logger.debug("Skip pool: %s", e)

            logger.info("Collected %d Ekubo mainnet pool samples", len(samples))
        except Exception as e:
            logger.warning("Ekubo mainnet fetch failed: %s", e)

        return samples

    async def collect_ekubo_sepolia_pools(self) -> list[PoolSample]:
        """Fetch pool data from Ekubo Sepolia API."""
        client = await self._get_client()
        samples = []
        try:
            resp = await client.get(
                f"{EKUBO_SEPOLIA_API}/overview/pools",
                params={"limit": 50},
            )
            if resp.status_code != 200:
                resp = await client.get(f"{EKUBO_SEPOLIA_API}/pools")

            if resp.status_code == 200:
                pools = resp.json()
                if isinstance(pools, dict):
                    pools = pools.get("pools", pools.get("data", []))

                now = int(time.time())
                for pool in pools[:50]:
                    try:
                        sample = self._parse_ekubo_pool(pool, "sepolia", now)
                        if sample:
                            samples.append(sample)
                    except Exception as e:
                        logger.debug("Skip sepolia pool: %s", e)

            logger.info("Collected %d Ekubo Sepolia pool samples", len(samples))
        except Exception as e:
            logger.warning("Ekubo Sepolia fetch failed: %s", e)

        return samples

    async def collect_defi_llama_yields(self) -> list[PoolSample]:
        """Fetch Starknet pool yields from DefiLlama."""
        client = await self._get_client()
        samples = []
        try:
            resp = await client.get(DEFI_LLAMA_YIELDS)
            if resp.status_code == 200:
                data = resp.json()
                pools = data.get("data", [])

                # Filter to Starknet pools only
                starknet_pools = [
                    p for p in pools
                    if p.get("chain", "").lower() == "starknet"
                ]

                now = int(time.time())
                for pool in starknet_pools[:200]:
                    try:
                        sample = self._parse_llama_pool(pool, now)
                        if sample:
                            samples.append(sample)
                    except Exception as e:
                        logger.debug("Skip llama pool: %s", e)

            logger.info("Collected %d DefiLlama Starknet pool samples", len(samples))
        except Exception as e:
            logger.warning("DefiLlama fetch failed: %s", e)

        return samples

    def _parse_ekubo_pool(self, pool: dict, network: str, timestamp: int) -> PoolSample | None:
        """Parse an Ekubo API pool response into a PoolSample."""
        tvl = float(pool.get("tvlUSD", pool.get("tvl_usd", pool.get("tvl", 0))))
        if tvl < 100:  # Skip dust pools
            return None

        volume = float(pool.get("volume24hUSD", pool.get("volume_24h", pool.get("volume", 0))))
        fee_bps = float(pool.get("fee", pool.get("feeBps", pool.get("fee_tier", 30)))) * 100 \
            if float(pool.get("fee", pool.get("feeBps", pool.get("fee_tier", 0.003)))) < 1 \
            else float(pool.get("fee", pool.get("feeBps", pool.get("fee_tier", 30))))

        # APR estimation: annualized fee revenue / TVL
        daily_fees = volume * fee_bps / 10000
        apr = (daily_fees * 365 / tvl * 100) if tvl > 0 else 0

        num_positions = int(pool.get("numPositions", pool.get("positions", pool.get("num_positions", 10))))
        utilization = min(1.0, volume / tvl) if tvl > 0 else 0

        return PoolSample(
            pool_id=str(pool.get("id", pool.get("pool_key", pool.get("address", "unknown")))),
            dex="ekubo",
            network=network,
            timestamp=timestamp,
            tvl_usd=tvl,
            volume_24h_usd=volume,
            fee_tier_bps=fee_bps,
            current_apr=apr,
            apr_7d_avg=apr * 0.95,           # Approximate: slight decay
            apr_30d_avg=apr * 0.9,
            apr_trend_7d=0.0,                # Would need historical data
            apr_volatility_7d=apr * 0.1,     # Estimate 10% volatility
            utilization_ratio=utilization,
            tick_concentration=float(pool.get("tickConcentration", pool.get("concentration", 0.6))),
            num_positions=num_positions,
            time_since_last_rebalance_hours=24.0,  # Default
            # Anomaly features
            tvl_stability=min(1.0, tvl / 1_000_000) if tvl > 0 else 0,
            liquidity_concentration=float(pool.get("tickConcentration", pool.get("concentration", 0.6))),
            price_impact_bps=max(1, 10000 / tvl) if tvl > 0 else 500,
            deployer_reputation=0.8 if network == "mainnet" else 0.5,
            volume_pattern=min(1.0, volume / (tvl * 0.1)) if tvl > 0 else 0,
            fee_anomaly=0.1,  # Low by default
            large_withdrawal_pct=0.05,
            smart_money_flow=0.1,
        )

    def _parse_llama_pool(self, pool: dict, timestamp: int) -> PoolSample | None:
        """Parse a DefiLlama pool into a PoolSample."""
        tvl = float(pool.get("tvlUsd", 0))
        if tvl < 100:
            return None

        apy = float(pool.get("apy", 0))
        apy_7d = float(pool.get("apyMean7d", apy))
        apy_30d = float(pool.get("apyMean30d", apy))

        return PoolSample(
            pool_id=str(pool.get("pool", "unknown")),
            dex=str(pool.get("project", "unknown")),
            network="mainnet",
            timestamp=timestamp,
            tvl_usd=tvl,
            volume_24h_usd=float(pool.get("volumeUsd1d", tvl * 0.05)),
            fee_tier_bps=30,  # Default, not always available
            current_apr=apy,
            apr_7d_avg=apy_7d,
            apr_30d_avg=apy_30d,
            apr_trend_7d=apy - apy_7d,
            apr_volatility_7d=abs(apy - apy_7d) * 0.5,
            utilization_ratio=float(pool.get("volumeUsd1d", 0)) / tvl if tvl > 0 else 0,
            tick_concentration=0.5,  # Not available from DefiLlama
            num_positions=10,
            time_since_last_rebalance_hours=24.0,
            tvl_stability=min(1.0, tvl / 1_000_000),
            liquidity_concentration=0.5,
            price_impact_bps=max(1, 10000 / tvl) if tvl > 0 else 500,
            deployer_reputation=0.8,
            volume_pattern=0.5,
            fee_anomaly=float(pool.get("ilRisk", "no") == "yes") * 0.5,
            large_withdrawal_pct=0.05,
            smart_money_flow=0.0,
        )

    # ── Wallet Data Collection ────────────────────────────────────────

    async def collect_wallet_samples_from_rpc(
        self, rpc_url: str | None = None, sample_count: int = 100
    ) -> list[WalletSample]:
        """
        Collect wallet samples from Starknet RPC by scanning recent blocks.
        Extracts unique sender addresses and fetches their on-chain metrics.
        """
        rpc = rpc_url or STARKNET_SEPOLIA_RPC
        client = await self._get_client()
        samples = []
        seen_addresses: set[str] = set()

        try:
            # Get latest block number
            resp = await client.post(rpc, json={
                "jsonrpc": "2.0", "method": "starknet_blockNumber", "params": [], "id": 1
            })
            if resp.status_code != 200:
                logger.warning("RPC block number failed: %s", resp.status_code)
                return samples

            block_num = resp.json().get("result", 0)
            logger.info("Latest block: %d, scanning for wallet data...", block_num)

            # Scan recent blocks for unique addresses
            blocks_to_scan = min(50, block_num)
            for offset in range(blocks_to_scan):
                if len(seen_addresses) >= sample_count:
                    break

                block_id = block_num - offset
                try:
                    resp = await client.post(rpc, json={
                        "jsonrpc": "2.0",
                        "method": "starknet_getBlockWithTxs",
                        "params": [{"block_number": block_id}],
                        "id": 1
                    })
                    if resp.status_code != 200:
                        continue

                    block_data = resp.json().get("result", {})
                    txs = block_data.get("transactions", [])
                    block_ts = int(block_data.get("timestamp", time.time()))

                    for tx in txs:
                        sender = tx.get("sender_address", "")
                        if sender and sender not in seen_addresses:
                            seen_addresses.add(sender)
                            # Build wallet sample from block context
                            sample = WalletSample(
                                address=sender,
                                network="sepolia" if "sepolia" in rpc.lower() or "6060" in rpc else "mainnet",
                                timestamp=block_ts,
                                eth_balance=0.0,  # Can't know without starknet_call
                                tx_count=len([t for t in txs if t.get("sender_address") == sender]),
                                unique_contracts=len(set(
                                    t.get("calldata", [""])[0] for t in txs
                                    if t.get("sender_address") == sender and t.get("calldata")
                                )),
                                defi_protocol_count=0,
                                total_value_locked=0.0,
                                loan_to_value_ratio=0.0,
                                liquidation_count=0,
                                avg_position_duration_days=0.0,
                                transaction_frequency=float(len([
                                    t for t in txs if t.get("sender_address") == sender
                                ])),
                                smart_contract_diversity=0.0,
                                gas_efficiency_score=0.5,
                                flash_loan_usage=0,
                                governance_participation=0,
                                bridge_activity=0,
                                nft_holdings_count=0,
                                account_age_days=0.0,
                                max_single_tx_value=0.0,
                                staking_participation=0,
                            )
                            samples.append(sample)

                except Exception as e:
                    logger.debug("Block %d scan error: %s", block_id, e)

            logger.info("Collected %d wallet samples from RPC (%s)", len(samples), rpc)
        except Exception as e:
            logger.warning("Wallet collection failed: %s", e)

        return samples

    # ── Full Collection Run ───────────────────────────────────────────

    async def collect_all(self) -> CollectionResult:
        """
        Run a full collection cycle from all available sources.
        Returns a CollectionResult with pool + wallet samples.
        """
        t0 = time.monotonic()
        result = CollectionResult(timestamp=int(time.time()))

        # Collect pool data in parallel
        pool_tasks = [
            self.collect_ekubo_mainnet_pools(),
            self.collect_ekubo_sepolia_pools(),
            self.collect_defi_llama_yields(),
        ]
        pool_results = await asyncio.gather(*pool_tasks, return_exceptions=True)

        for task_result in pool_results:
            if isinstance(task_result, Exception):
                result.errors.append(str(task_result))
            elif isinstance(task_result, list):
                result.pool_samples.extend(task_result)

        # Collect wallet data from Sepolia (local Juno)
        try:
            wallets = await self.collect_wallet_samples_from_rpc(STARKNET_SEPOLIA_RPC, sample_count=100)
            result.wallet_samples.extend(wallets)
        except Exception as e:
            result.errors.append(f"Sepolia wallet collection: {e}")

        # Try mainnet wallet data too
        try:
            mainnet_wallets = await self.collect_wallet_samples_from_rpc(STARKNET_MAINNET_RPC, sample_count=50)
            result.wallet_samples.extend(mainnet_wallets)
        except Exception as e:
            result.errors.append(f"Mainnet wallet collection: {e}")

        result.duration_seconds = time.monotonic() - t0

        # Save to disk
        self._save_result(result)

        logger.info(
            "Collection complete: %d pool samples, %d wallet samples, %d errors in %.1fs",
            len(result.pool_samples), len(result.wallet_samples),
            len(result.errors), result.duration_seconds,
        )

        return result

    def _save_result(self, result: CollectionResult) -> Path:
        """Save collection result to timestamped JSON file."""
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        out_path = DATA_DIR / f"collection_{ts}.json"
        data = {
            "metadata": result.summary(),
            "pool_samples": [asdict(s) for s in result.pool_samples],
            "wallet_samples": [asdict(s) for s in result.wallet_samples],
            "errors": result.errors,
        }
        out_path.write_text(json.dumps(data, indent=2))
        logger.info("Saved collection to %s", out_path)
        return out_path

    def load_latest_dataset(self) -> dict | None:
        """Load the most recent collection from disk."""
        files = sorted(DATA_DIR.glob("collection_*.json"), reverse=True)
        if not files:
            return None
        return json.loads(files[0].read_text())

    def load_all_datasets(self) -> list[dict]:
        """Load all collection files and merge samples."""
        files = sorted(DATA_DIR.glob("collection_*.json"))
        return [json.loads(f.read_text()) for f in files]


# Singleton
_collector: MainnetDataCollector | None = None


def get_data_collector() -> MainnetDataCollector:
    global _collector
    if _collector is None:
        _collector = MainnetDataCollector()
    return _collector
