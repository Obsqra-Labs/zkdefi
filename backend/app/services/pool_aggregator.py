"""
Pool Aggregator Service

Fetches and caches pool data from multiple DEXs on Starknet Sepolia:
- Ekubo (LP positions)
- JediSwap (LP positions)
- Vesu (Lending)
"""

from typing import List, Dict, Optional
from datetime import datetime
import asyncio
import logging
from app.services.zkml_pool_evaluator import PoolMetrics


logger = logging.getLogger(__name__)


class PoolAggregator:
    """Fetch and aggregate pool data from multiple DEXs"""
    
    # Sepolia contract addresses
    EKUBO_CORE = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
    EKUBO_POSITIONS = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"
    
    JEDISWAP_ROUTER = "0x00000000000000000000000000000000000000000000000000"  # TBD
    
    VESU_LENDING = "0x00000000000000000000000000000000000000000000000000"  # TBD
    
    # Token addresses on Sepolia
    TOKENS = {
        "STRK": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31eae7d16e2d616e2b524bf199c0fb",
        "ETH": "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        "USDC": "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
        "DAI": "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0ecc77cb62e",
    }
    
    def __init__(self, rpc_endpoint: str = None):
        self.rpc_endpoint = rpc_endpoint or "https://sepolia.rpc.starknet.rs"
        self.cache: Dict[str, List[PoolMetrics]] = {}
        self.cache_timestamp: Dict[str, datetime] = {}
        self.cache_duration_seconds = 300  # 5 min cache
    
    async def fetch_all_pools(self, use_cache: bool = True) -> List[PoolMetrics]:
        """
        Fetch all available pools from all DEXs.
        Returns combined list of pools.
        """
        
        cache_key = "all_pools"
        
        # Check cache
        if use_cache and cache_key in self.cache:
            if self._is_cache_valid(cache_key):
                logger.info("Using cached pool data")
                return self.cache[cache_key]
        
        pools = []
        
        # Fetch from each DEX in parallel
        try:
            ekubo_pools = await self._fetch_ekubo_pools()
            pools.extend(ekubo_pools)
            logger.info(f"Fetched {len(ekubo_pools)} Ekubo pools")
        except Exception as e:
            logger.error(f"Failed to fetch Ekubo pools: {e}")
        
        try:
            jediswap_pools = await self._fetch_jediswap_pools()
            pools.extend(jediswap_pools)
            logger.info(f"Fetched {len(jediswap_pools)} JediSwap pools")
        except Exception as e:
            logger.error(f"Failed to fetch JediSwap pools: {e}")
        
        try:
            vesu_pools = await self._fetch_vesu_pools()
            pools.extend(vesu_pools)
            logger.info(f"Fetched {len(vesu_pools)} Vesu pools")
        except Exception as e:
            logger.error(f"Failed to fetch Vesu pools: {e}")
        
        # Cache results
        self.cache[cache_key] = pools
        self.cache_timestamp[cache_key] = datetime.now()
        
        return pools
    
    async def _fetch_ekubo_pools(self) -> List[PoolMetrics]:
        """Fetch Ekubo LP pools from Sepolia"""
        
        # In MVP: Return mock data based on observed Ekubo Sepolia state
        # In production: Query Ekubo subgraph or RPC
        
        pools = [
            PoolMetrics(
                pool_id="ekubo_eth_usdc_030",
                dex="EKUBO",
                pair="ETH/USDC",
                liquidity_usd=250_000,  # Observed on Sepolia
                volume_24h=45_000,
                fee_tier=0.30,
                price=2_500,  # ETH price
                timestamp=datetime.now(),
            ),
            PoolMetrics(
                pool_id="ekubo_eth_usdc_100",
                dex="EKUBO",
                pair="ETH/USDC",
                liquidity_usd=150_000,
                volume_24h=25_000,
                fee_tier=1.00,
                price=2_500,
                timestamp=datetime.now(),
            ),
            PoolMetrics(
                pool_id="ekubo_strk_usdc_030",
                dex="EKUBO",
                pair="STRK/USDC",
                liquidity_usd=180_000,
                volume_24h=35_000,
                fee_tier=0.30,
                price=0.85,  # STRK price
                timestamp=datetime.now(),
            ),
            PoolMetrics(
                pool_id="ekubo_strk_eth_030",
                dex="EKUBO",
                pair="STRK/ETH",
                liquidity_usd=120_000,
                volume_24h=20_000,
                fee_tier=0.30,
                price=0.00034,  # STRK/ETH ratio
                timestamp=datetime.now(),
            ),
            PoolMetrics(
                pool_id="ekubo_usdc_dai_005",
                dex="EKUBO",
                pair="USDC/DAI",
                liquidity_usd=300_000,
                volume_24h=80_000,
                fee_tier=0.05,
                price=1.001,  # Stable pair
                timestamp=datetime.now(),
            ),
        ]
        
        return pools
    
    async def _fetch_jediswap_pools(self) -> List[PoolMetrics]:
        """Fetch JediSwap pools from Sepolia"""
        
        # TODO: Verify JediSwap is active on Sepolia
        # For now returning empty, can add if available
        
        pools = [
            # Placeholder - uncomment if JediSwap is available
            # PoolMetrics(
            #     pool_id="jediswap_eth_usdc",
            #     dex="JEDISWAP",
            #     pair="ETH/USDC",
            #     liquidity_usd=100_000,
            #     volume_24h=15_000,
            #     fee_tier=0.30,
            #     price=2_500,
            #     timestamp=datetime.now(),
            # ),
        ]
        
        return pools
    
    async def _fetch_vesu_pools(self) -> List[PoolMetrics]:
        """Fetch Vesu lending pools from Sepolia"""
        
        # Vesu is a lending protocol (not LP)
        # Represented as "yield" pools
        
        pools = [
            PoolMetrics(
                pool_id="vesu_usdc_lending",
                dex="VESU",
                pair="USDC",
                liquidity_usd=500_000,  # Total USDC supplied
                volume_24h=0,  # N/A for lending
                fee_tier=0.0,  # No fee, interest-based
                price=1.0,  # Stablecoin
                timestamp=datetime.now(),
            ),
            PoolMetrics(
                pool_id="vesu_dai_lending",
                dex="VESU",
                pair="DAI",
                liquidity_usd=200_000,
                volume_24h=0,
                fee_tier=0.0,
                price=1.001,
                timestamp=datetime.now(),
            ),
            PoolMetrics(
                pool_id="vesu_eth_lending",
                dex="VESU",
                pair="ETH",
                liquidity_usd=150_000,
                volume_24h=0,
                fee_tier=0.0,
                price=2_500,
                timestamp=datetime.now(),
            ),
        ]
        
        return pools
    
    def _is_cache_valid(self, cache_key: str) -> bool:
        """Check if cached data is still fresh"""
        if cache_key not in self.cache_timestamp:
            return False
        
        age = (datetime.now() - self.cache_timestamp[cache_key]).total_seconds()
        return age < self.cache_duration_seconds
    
    def invalidate_cache(self):
        """Clear all cached pool data"""
        self.cache.clear()
        self.cache_timestamp.clear()


# Singleton instance
_pool_aggregator_instance: Optional[PoolAggregator] = None


def get_pool_aggregator(rpc_endpoint: str = None) -> PoolAggregator:
    """Get or create singleton pool aggregator"""
    global _pool_aggregator_instance
    
    if _pool_aggregator_instance is None:
        _pool_aggregator_instance = PoolAggregator(rpc_endpoint)
    
    return _pool_aggregator_instance
