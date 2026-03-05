"""
Market Data Polling Worker

Continuously polls market data from Ekubo and updates strategy rankings.

Features:
- Fetches latest pool metrics every 60s
- Updates strategy intelligence service with new data
- Tracks price history for volatility calculation
- Detects significant market changes and triggers alerts

Runs as background worker via PM2 or as async task.
"""

import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


class MarketPoller:
    """Poll market data and update strategies."""
    
    def __init__(self, poll_interval_seconds: int = 60):
        """
        Initialize market poller.
        
        Args:
            poll_interval_seconds: How often to poll (default 60s)
        """
        self.poll_interval = poll_interval_seconds
        self.running = False
        self.last_snapshot_time = None
        self.price_history: Dict[str, List[Dict[str, Any]]] = {}
    
    async def fetch_market_surface(self) -> List[Dict[str, Any]]:
        """Fetch current market surface from Ekubo."""
        try:
            from app.services.market_surface_service import get_market_surface
            
            surface = await get_market_surface(
                user_address="0x0",  # System poll
                risk_profile="balanced",
                limit=50,
            )
            
            opportunities = surface.get("opportunities", [])
            logger.debug(f"Fetched {len(opportunities)} opportunities from market surface")
            
            return opportunities
            
        except Exception as e:
            logger.error(f"Failed to fetch market surface: {e}")
            return []
    
    def record_price(self, pool_id: str, price: float, timestamp: str):
        """Record price for historical volatility calculation."""
        if pool_id not in self.price_history:
            self.price_history[pool_id] = []
        
        self.price_history[pool_id].append({
            "price": price,
            "timestamp": timestamp,
        })
        
        # Keep only last 24 hours of data (assuming 60s intervals = 1440 points)
        if len(self.price_history[pool_id]) > 1440:
            self.price_history[pool_id] = self.price_history[pool_id][-1440:]
    
    def calculate_volatility(self, pool_id: str) -> float:
        """Calculate realized volatility from price history."""
        history = self.price_history.get(pool_id, [])
        
        if len(history) < 2:
            return 0.0
        
        prices = [p["price"] for p in history]
        
        # Simple volatility: standard deviation of returns
        returns = []
        for i in range(1, len(prices)):
            if prices[i-1] > 0:
                ret = (prices[i] - prices[i-1]) / prices[i-1]
                returns.append(ret)
        
        if not returns:
            return 0.0
        
        mean_return = sum(returns) / len(returns)
        variance = sum((r - mean_return) ** 2 for r in returns) / len(returns)
        volatility = (variance ** 0.5) * 100  # As percentage
        
        return volatility
    
    async def update_strategy(self, opportunity: Dict[str, Any]):
        """Update or create strategy from opportunity data."""
        try:
            from app.services.strategy_intelligence_service import get_strategy_intelligence_service
            
            intelligence_svc = get_strategy_intelligence_service()
            
            pool_id = opportunity.get("best_venue") or opportunity.get("pool_id") or opportunity.get("pair")
            
            if not pool_id:
                return
            
            # Record price for volatility tracking
            # Note: Real implementation would extract actual price from pool
            self.record_price(pool_id, 1.0, datetime.utcnow().isoformat() + "Z")
            
            # Calculate realized volatility
            volatility = self.calculate_volatility(pool_id)
            
            # Create genome factors from opportunity data
            from app.models.strategy import GenomeFactors
            
            genome = GenomeFactors(
                yield_score=opportunity.get("estimated_apy_pct", 0),
                risk_score=opportunity.get("risk_score", 50),
                volatility_score=volatility or opportunity.get("volatility", 25),
                liquidity_score=min(100, (opportunity.get("tvl_usd", 0) / 1000)),  # Scale TVL to 0-100
                efficiency_score=opportunity.get("estimated_apy_pct", 0) / max(1, opportunity.get("risk_score", 50)) * 10,
            )
            
            # Update or create strategy
            strategy = intelligence_svc.create_or_update_strategy(
                pool_id=pool_id,
                protocol="ekubo",
                genome=genome,
                pair=opportunity.get("pair", pool_id),
                tvl_usd=opportunity.get("tvl_usd", 0),
                fee_tier=opportunity.get("fee_tier", "0.3%"),
            )
            
            logger.debug(f"Updated strategy {pool_id}: genome_composite={genome.composite_score:.2f}")
            
        except Exception as e:
            logger.error(f"Failed to update strategy for {opportunity.get('pair')}: {e}")
    
    async def detect_market_changes(self, opportunities: List[Dict[str, Any]]):
        """Detect significant market changes and create alerts."""
        # TODO: Implement change detection
        # - APY spikes/drops >20%
        # - TVL drains >50%
        # - New high-yield opportunities
        # - Risk score increases >30 points
        pass
    
    async def run_poll_cycle(self):
        """Run one polling cycle."""
        try:
            timestamp = datetime.utcnow().isoformat() + "Z"
            
            # Fetch market data
            opportunities = await self.fetch_market_surface()
            
            if not opportunities:
                logger.warning("No opportunities fetched from market surface")
                return
            
            logger.info(f"Polling cycle: {len(opportunities)} opportunities")
            
            # Update strategies
            update_tasks = [self.update_strategy(opp) for opp in opportunities]
            await asyncio.gather(*update_tasks, return_exceptions=True)
            
            # Detect significant changes
            await self.detect_market_changes(opportunities)
            
            self.last_snapshot_time = timestamp
            logger.info(f"Poll cycle complete at {timestamp}")
            
        except Exception as e:
            logger.error(f"Poll cycle failed: {e}", exc_info=True)
    
    async def start(self):
        """Start the polling loop."""
        self.running = True
        logger.info(f"Market poller starting (poll interval: {self.poll_interval}s)")
        
        # Run first cycle immediately
        await self.run_poll_cycle()
        
        while self.running:
            try:
                # Wait before next cycle
                await asyncio.sleep(self.poll_interval)
                
                await self.run_poll_cycle()
                
            except Exception as e:
                logger.error(f"Polling loop error: {e}", exc_info=True)
                # Continue loop even if one cycle fails
    
    def stop(self):
        """Stop the polling loop."""
        logger.info("Market poller stopping")
        self.running = False


# Singleton instance
_poller: MarketPoller | None = None


def get_market_poller() -> MarketPoller:
    """Get the singleton market poller instance."""
    global _poller
    if _poller is None:
        _poller = MarketPoller(poll_interval_seconds=60)
    return _poller


async def start_market_poller():
    """Start the market poller as a background task."""
    poller = get_market_poller()
    await poller.start()


if __name__ == "__main__":
    # Run standalone
    import sys
    
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    
    logger.info("Starting market poller worker")
    
    try:
        asyncio.run(start_market_poller())
    except KeyboardInterrupt:
        logger.info("Shutting down market poller")
