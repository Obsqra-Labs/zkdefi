"""
Performance Tracker Service

Tracks LP position earnings, APY, Sharpe ratio, max drawdown.
- Subscribes to on-chain position and fee events
- Reconstructs position history from events
- Calculates metrics (APY, Sharpe, drawdown)
- Exposes API for dashboard
"""

import os
from typing import Optional, Any
from datetime import datetime, timedelta
from collections import deque
import logging
import statistics

from app.models import PerformanceMetrics, PerformanceSummary, RebalanceEvent

logger = logging.getLogger(__name__)

STARKNET_RPC_URL = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia.public.blastapi.io")


class PerformanceTracker:
    """
    Service for tracking LP position performance.
    
    Architecture:
    1. Subscribe to on-chain events (fees accumulated, rebalances)
    2. Maintain position history (snapshots at each event)
    3. Calculate metrics on-demand:
       - APY: total fees / TVL / days * 365
       - Sharpe: return / volatility
       - Max drawdown: peak-to-trough decline
    4. Cache results, invalidate on new events
    """
    
    def __init__(self, rpc_url: str | None = None):
        self.rpc_url = rpc_url or STARKNET_RPC_URL
        
        # Position snapshots: position_id -> deque of (timestamp, fees, tvl, price)
        self._position_history: dict[str, deque] = {}
        
        # Metrics cache: position_id -> metrics
        self._metrics_cache: dict[str, PerformanceMetrics] = {}
    
    async def record_fee_accrual(
        self,
        position_id: str,
        fees_earned: float,
        tvl: float,
        current_price: float,
    ):
        """
        Record a fee accrual event (called when position earns fees).
        """
        if position_id not in self._position_history:
            self._position_history[position_id] = deque(maxlen=1000)  # Keep 1000 snapshots
        
        snapshot = {
            "timestamp": datetime.now(timezone.utc),
            "fees_earned": fees_earned,
            "tvl": tvl,
            "price": current_price,
        }
        
        self._position_history[position_id].append(snapshot)
        
        # Invalidate cache
        if position_id in self._metrics_cache:
            del self._metrics_cache[position_id]
        
        logger.debug(f"Recorded fee accrual for position {position_id}: {fees_earned}")
    
    async def record_rebalance(
        self,
        position_id: str,
        event: RebalanceEvent,
    ):
        """
        Record a rebalance event.
        Used to track rebalance history in performance.
        """
        # Invalidate cache
        if position_id in self._metrics_cache:
            del self._metrics_cache[position_id]
        
        logger.debug(f"Recorded rebalance for position {position_id}")
    
    async def get_metrics(self, position_id: str) -> Optional[PerformanceMetrics]:
        """
        Calculate and return performance metrics for a position.
        Uses cache if available.
        """
        
        # Return cached if available
        if position_id in self._metrics_cache:
            return self._metrics_cache[position_id]
        
        # No history
        if position_id not in self._position_history or len(self._position_history[position_id]) == 0:
            return None
        
        history = self._position_history[position_id]
        
        # Calculate metrics
        metrics = await self._calculate_metrics(position_id, history)
        
        # Cache
        self._metrics_cache[position_id] = metrics
        
        return metrics
    
    async def get_summary(
        self,
        position_id: str,
        current_tvl: float,
        current_price: float,
    ) -> Optional[PerformanceSummary]:
        """
        Get user-facing performance summary.
        Combines position + metrics + current state.
        """
        
        metrics = await self.get_metrics(position_id)
        if not metrics:
            return None
        
        # Get latest snapshot for entry value
        history = self._position_history[position_id]
        if len(history) == 0:
            return None
        
        first_snapshot = list(history)[0]
        last_snapshot = list(history)[-1]
        
        entry_tvl = first_snapshot["tvl"]
        entry_price = first_snapshot["price"]
        
        # Calculate PnL (simple: current price vs entry price)
        price_change_percent = ((current_price - entry_price) / entry_price) * 100
        
        # Estimate current value (TVL + accumulated fees)
        fees_earned_estimate = last_snapshot["fees_earned"]
        current_value_est = current_tvl + fees_earned_estimate
        
        return PerformanceSummary(
            position_id=position_id,
            token_pair="ETH-USDC",  # TODO: fetch from position
            current_value_usd=current_value_est,
            entry_value_usd=entry_tvl,
            pnl_usd=fees_earned_estimate,
            pnl_percent=price_change_percent,
            fees_earned_usd=fees_earned_estimate,
            apy=metrics.apy,
            sharpe_ratio=metrics.sharpe_ratio,
            max_drawdown=metrics.max_drawdown,
            auto_rebalances_count=metrics.total_rebalances,
            last_action=metrics.last_rebalance_at,
            is_in_range=True,  # TODO: fetch from position
        )
    
    # Private helpers
    
    async def _calculate_metrics(
        self,
        position_id: str,
        history: deque,
    ) -> PerformanceMetrics:
        """
        Calculate all performance metrics from history.
        """
        
        # Convert to list for easier processing
        snapshots = list(history)
        
        if len(snapshots) < 2:
            # Not enough data
            return PerformanceMetrics(
                position_id=position_id,
                total_fees_earned_commitment="0x...",
            )
        
        # Extract time series
        timestamps = [s["timestamp"] for s in snapshots]
        fees = [s["fees_earned"] for s in snapshots]
        tvls = [s["tvl"] for s in snapshots]
        
        # Time span
        time_span_days = (timestamps[-1] - timestamps[0]).total_seconds() / (24 * 3600)
        
        if time_span_days == 0:
            time_span_days = 1  # Avoid division by zero
        
        # Total fees (last - first)
        total_fees = fees[-1] - fees[0]
        
        # APY = (fees / average_tvl) / days * 365
        avg_tvl = statistics.mean(tvls) if tvls else 1
        apy = (total_fees / avg_tvl / time_span_days * 365) if avg_tvl > 0 else 0
        
        # Daily fee returns (for volatility calculation)
        daily_fees = []
        for i in range(1, len(fees)):
            daily_fee = fees[i] - fees[i-1]
            daily_fees.append(daily_fee)
        
        # Volatility of daily fees
        if len(daily_fees) > 1:
            volatility = statistics.stdev(daily_fees) if len(daily_fees) > 1 else 0
        else:
            volatility = 0
        
        # Sharpe ratio = return / volatility
        sharpe = (total_fees / time_span_days / (volatility + 0.0001)) if volatility > 0 else 0
        
        # Max drawdown
        peak = 0
        max_dd = 0
        for fee in fees:
            if fee > peak:
                peak = fee
            dd = (peak - fee) / (peak + 1)  # Avoid division by zero
            if dd > max_dd:
                max_dd = dd
        
        return PerformanceMetrics(
            position_id=position_id,
            total_fees_earned_commitment="0x...",  # Placeholder
            total_fees_earned_usd_estimate=total_fees,
            apy=apy,
            apy_30d=None,  # TODO: calculate last 30 days
            apy_7d=None,   # TODO: calculate last 7 days
            sharpe_ratio=sharpe,
            max_drawdown=max_dd,
            volatility=volatility,
            total_rebalances=0,  # TODO: count from events
            tracking_start=timestamps[0],
            tracking_updated_at=datetime.now(timezone.utc),
        )
