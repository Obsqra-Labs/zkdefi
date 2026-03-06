"""
Autonomous Rebalancer Monitor
Monitors positions and triggers rebalancing based on pre-configured constraints
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Tuple
from app.services.model_registry_service import AutonomousRebalancerConfig

logger = logging.getLogger(__name__)

class RebalancePosition:
    """Represents a position that might need rebalancing"""
    
    def __init__(self, position_id: str, current_apy: float, optimal_apy: float, 
                 current_fee_tier: int, optimal_fee_tier: int, pool_utilization: float,
                 last_rebalance_time: Optional[datetime] = None):
        self.position_id = position_id
        self.current_apy = current_apy
        self.optimal_apy = optimal_apy
        self.current_fee_tier = current_fee_tier
        self.optimal_fee_tier = optimal_fee_tier
        self.pool_utilization = pool_utilization
        self.last_rebalance_time = last_rebalance_time or datetime.now(timezone.utc)
        self.hours_since_rebalance = self._calculate_hours_since_rebalance()
    
    def _calculate_hours_since_rebalance(self) -> float:
        return (datetime.now(timezone.utc) - self.last_rebalance_time).total_seconds() / 3600


class AutonomousRebalancerMonitor:
    """Monitors positions and determines if rebalancing should occur"""
    
    def __init__(self):
        self.config = AutonomousRebalancerConfig()
        self.rebalance_history: List[dict] = []
        self.is_running = False
    
    async def monitor_position(self, position: RebalancePosition) -> Tuple[bool, str, dict]:
        """
        Monitor a single position for rebalancing opportunity
        
        Returns: (should_rebalance, reason, details)
        """
        should_rebalance, reason = self.config.should_rebalance(
            current_apy=position.current_apy,
            potential_apy=position.optimal_apy,
            current_fee_tier=position.current_fee_tier,
            optimal_fee_tier=position.optimal_fee_tier,
            pool_utilization=position.pool_utilization,
            hours_since_last_rebalance=position.hours_since_rebalance
        )
        
        details = {
            "position_id": position.position_id,
            "current_apy": position.current_apy,
            "optimal_apy": position.optimal_apy,
            "apy_improvement": position.optimal_apy - position.current_apy,
            "current_fee_tier": position.current_fee_tier,
            "optimal_fee_tier": position.optimal_fee_tier,
            "fee_spread": abs(position.optimal_fee_tier - position.current_fee_tier),
            "pool_utilization": position.pool_utilization,
            "hours_since_rebalance": position.hours_since_rebalance,
            "reason": reason,
            "should_rebalance": should_rebalance,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        
        if should_rebalance:
            self.rebalance_history.append(details)
            logger.info(f"Rebalance triggered for {position.position_id}: {reason}")
        
        return should_rebalance, reason, details
    
    async def monitor_positions(self, positions: List[RebalancePosition]) -> List[Tuple[str, bool, str, dict]]:
        """Monitor multiple positions concurrently"""
        tasks = [self.monitor_position(pos) for pos in positions]
        results = await asyncio.gather(*tasks)
        
        return [
            (pos.position_id, should_rebalance, reason, details)
            for pos, (should_rebalance, reason, details) in zip(positions, results)
        ]
    
    def get_rebalance_history(self, limit: int = 100) -> List[dict]:
        """Get recent rebalance history"""
        return self.rebalance_history[-limit:]
    
    def get_stats(self) -> dict:
        """Get monitor statistics"""
        return {
            "total_rebalances_triggered": len(self.rebalance_history),
            "is_running": self.is_running,
            "config": {
                "apy_threshold": self.config.apy_threshold,
                "fee_tier_spread_bps": self.config.fee_tier_spread_bps,
                "utilization_ratio_threshold": self.config.utilization_ratio_threshold,
                "min_rebalance_interval_hours": self.config.min_rebalance_interval_hours,
            }
        }
