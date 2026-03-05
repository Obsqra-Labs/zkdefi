"""
Pool Data Collector - Fetch real pool metrics from Starknet RPC or APIs
"""

from datetime import datetime
from typing import List, Optional
import httpx
import logging
from app.services.zkml.pool_evaluator import PoolMetrics


logger = logging.getLogger(__name__)


class PoolDataCollector:
    """
    Collect real pool data from various sources:
    - Ekubo API or RPC
    - JediSwap API or RPC
    - Vesu lending rates
    """
    
    def __init__(self, rpc_url: str = "https://sepolia.rpc.starknet.io"):
        self.rpc_url = rpc_url
        self.client = httpx.AsyncClient(timeout=10.0)
    
    async def get_ekubo_pools(self) -> List[PoolMetrics]:
        """
        Fetch Ekubo pools and their current metrics from live pool_metrics.
        Falls back to mock data if the live fetch fails.
        """
        try:
            from app.services.pool_metrics import fetch_pool_metrics
            live_pools = await fetch_pool_metrics(min_tvl_usd=0.0, limit=30)
            if live_pools:
                pools = []
                for p in live_pools:
                    tokens = [t.strip() for t in p.pair.split("/")]
                    t0 = tokens[0] if tokens else "TOKEN0"
                    t1 = tokens[1] if len(tokens) > 1 else "TOKEN1"
                    pools.append(
                        PoolMetrics(
                            pool_id=p.pool_id,
                            name=f"Ekubo {p.pair} {p.fee_ratio*100:.2f}%",
                            protocol="ekubo",
                            liquidity_usd=p.tvl_usd,
                            volume_24h_usd=p.volume_24h_usd,
                            fee_tier=p.fee_ratio,
                            price_std_dev_24h=0.08,  # TODO: compute from price history
                            slippage_at_1000usd=0.015,  # TODO: compute from pool depth
                            token0=t0,
                            token1=t1,
                            current_apy=p.apy_pct / 100.0,  # PoolMetric is %, PoolMetrics expects decimal
                            timestamp=datetime.now(),
                        )
                    )
                logger.info(f"Fetched {len(pools)} live Ekubo pools")
                return pools
        except Exception as exc:
            logger.warning(f"Live Ekubo pool fetch failed, using mock: {exc}")

        # Fallback mock data
        pools = [
            PoolMetrics(
                pool_id="ekubo_eth_usdc_003",
                name="Ekubo ETH/USDC 0.3%",
                protocol="ekubo",
                liquidity_usd=500_000,
                volume_24h_usd=150_000,
                fee_tier=0.003,
                price_std_dev_24h=0.08,
                slippage_at_1000usd=0.015,
                token0="ETH",
                token1="USDC",
                current_apy=0.18,
                timestamp=datetime.now(),
            ),
            PoolMetrics(
                pool_id="ekubo_eth_usdc_001",
                name="Ekubo ETH/USDC 0.01%",
                protocol="ekubo",
                liquidity_usd=300_000,
                volume_24h_usd=50_000,
                fee_tier=0.0001,
                price_std_dev_24h=0.08,
                slippage_at_1000usd=0.008,
                token0="ETH",
                token1="USDC",
                current_apy=0.05,
                timestamp=datetime.now(),
            ),
            PoolMetrics(
                pool_id="ekubo_strk_usdc",
                name="Ekubo STRK/USDC 0.3%",
                protocol="ekubo",
                liquidity_usd=400_000,
                volume_24h_usd=200_000,
                fee_tier=0.003,
                price_std_dev_24h=0.12,
                slippage_at_1000usd=0.025,
                token0="STRK",
                token1="USDC",
                current_apy=0.25,
                timestamp=datetime.now(),
            ),
        ]
        
        logger.info(f"Fetched {len(pools)} Ekubo pools (mock fallback)")
        return pools
    
    async def get_jediswap_pools(self) -> List[PoolMetrics]:
        """
        Fetch JediSwap pools and their metrics
        For MVP: Mock data only
        """
        pools = [
            PoolMetrics(
                pool_id="jediswap_eth_usdc",
                name="JediSwap ETH/USDC",
                protocol="jediswap",
                liquidity_usd=250_000,
                volume_24h_usd=80_000,
                fee_tier=0.003,
                price_std_dev_24h=0.08,
                slippage_at_1000usd=0.02,
                token0="ETH",
                token1="USDC",
                current_apy=0.15,
                timestamp=datetime.now(),
            ),
        ]
        
        logger.info(f"Fetched {len(pools)} JediSwap pools")
        return pools
    
    async def get_vesu_rates(self) -> dict:
        """
        Get Vesu lending rates
        For MVP: Mock rates, real rates come from Vesu RPC calls
        """
        rates = {
            "usdc": {
                "pool_id": "vesu_usdc",
                "name": "Vesu USDC Lending",
                "protocol": "vesu",
                "apy": 0.04,  # 4% APY
                "liquidity_usd": 1_000_000,
                "risk_score": 15,
            },
            "strk": {
                "pool_id": "vesu_strk",
                "name": "Vesu STRK Lending",
                "protocol": "vesu",
                "apy": 0.03,  # 3% APY
                "liquidity_usd": 800_000,
                "risk_score": 20,
            },
        }
        
        logger.info(f"Fetched Vesu rates for {len(rates)} assets")
        return rates
    
    async def get_all_pools(self) -> tuple[List[PoolMetrics], dict]:
        """
        Fetch all available pools and rates
        Returns: (lp_pools, yield_rates)
        """
        try:
            ekubo = await self.get_ekubo_pools()
            jediswap = await self.get_jediswap_pools()
            vesu = await self.get_vesu_rates()
            
            all_pools = ekubo + jediswap
            
            # Convert Vesu rates to PoolMetrics for evaluation
            vesu_pools = [
                PoolMetrics(
                    pool_id=rate["pool_id"],
                    name=rate["name"],
                    protocol="vesu",
                    liquidity_usd=rate["liquidity_usd"],
                    volume_24h_usd=rate["liquidity_usd"] * 0.1,  # Estimate
                    fee_tier=0.0,
                    price_std_dev_24h=0.02,  # Very stable (lending)
                    slippage_at_1000usd=0.0,  # No slippage (lending)
                    token0=token,
                    token1="USD",
                    current_apy=rate["apy"],
                    timestamp=datetime.now(),
                )
                for token, rate in vesu.items()
            ]
            
            all_pools.extend(vesu_pools)
            
            return all_pools, vesu
        
        except Exception as e:
            logger.error(f"Error fetching pool data: {str(e)}")
            # Return empty lists on error
            return [], {}
    
    async def get_pool_metrics_by_amount(
        self,
        pool_id: str,
        amount: float,
    ) -> Optional[dict]:
        """
        Get detailed metrics for a specific amount in a pool
        Useful for calculating exact slippage
        """
        # For MVP: Return mock slippage
        # Real implementation would calculate from pool state
        return {
            "pool_id": pool_id,
            "amount": amount,
            "expected_out": amount * 0.99,  # 1% slippage estimate
            "slippage": 0.01,
        }


async def test_pool_collector():
    """Test the collector"""
    collector = PoolDataCollector()
    
    pools, vesu_rates = await collector.get_all_pools()
    
    print(f"Total pools found: {len(pools)}")
    for pool in pools:
        print(f"  - {pool.name}: APY {pool.current_apy:.1%}")
    
    print(f"\nVesu rates:")
    for asset, rate in vesu_rates.items():
        print(f"  - {asset}: {rate['apy']:.1%}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(test_pool_collector())
