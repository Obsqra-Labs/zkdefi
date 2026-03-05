"""
Position Monitoring Worker

Continuously monitors deployed LP positions and alerts when:
- Position goes out of range
- Impermanent loss exceeds threshold
- APY drops significantly below expected
- Liquidity drains below safe level

Runs as background worker via PM2 or as async task.
"""

import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


class PositionMonitor:
    """Monitor LP positions for risk events."""
    
    def __init__(self, poll_interval_seconds: int = 300):
        """
        Initialize position monitor.
        
        Args:
            poll_interval_seconds: How often to check positions (default 5min)
        """
        self.poll_interval = poll_interval_seconds
        self.running = False
    
    async def check_position_health(self, position: Dict[str, Any]) -> Dict[str, Any]:
        """
        Check if a single position is healthy.
        
        Returns:
            dict with 'healthy', 'alerts', 'metrics'
        """
        alerts = []
        
        # Check 1: Out of range (for concentrated liquidity)
        if position.get("is_concentrated", False):
            current_price = position.get("current_price", 0)
            lower_bound = position.get("lower_bound", 0)
            upper_bound = position.get("upper_bound", 0)
            
            if current_price < lower_bound or current_price > upper_bound:
                alerts.append({
                    "severity": "high",
                    "type": "out_of_range",
                    "message": f"Position out of range: price {current_price} outside [{lower_bound}, {upper_bound}]",
                    "action": "recenter_position",
                })
        
        # Check 2: IL threshold
        il_pct = position.get("impermanent_loss_pct", 0)
        il_threshold = position.get("il_threshold", 5.0)
        if il_pct > il_threshold:
            alerts.append({
                "severity": "medium",
                "type": "high_il",
                "message": f"Impermanent loss {il_pct:.2f}% exceeds threshold {il_threshold}%",
                "action": "consider_exit",
            })
        
        # Check 3: APY drop
        realized_apy = position.get("realized_apy_pct", 0)
        expected_apy = position.get("expected_apy_pct", 0)
        if realized_apy < expected_apy * 0.5:  # APY dropped >50%
            alerts.append({
                "severity": "medium",
                "type": "apy_drop",
                "message": f"Realized APY {realized_apy:.2f}% << expected {expected_apy:.2f}%",
                "action": "review_strategy",
            })
        
        # Check 4: Liquidity drain
        tvl = position.get("pool_tvl_usd", 0)
        min_tvl = position.get("min_safe_tvl", 10000)
        if tvl < min_tvl:
            alerts.append({
                "severity": "high",
                "type": "low_liquidity",
                "message": f"Pool TVL ${tvl:,.0f} below safe minimum ${min_tvl:,.0f}",
                "action": "exit_position",
            })
        
        return {
            "healthy": len(alerts) == 0,
            "alerts": alerts,
            "metrics": {
                "position_id": position.get("position_id"),
                "pool": position.get("pool"),
                "current_value": position.get("current_value", 0),
                "il_pct": il_pct,
                "realized_apy": realized_apy,
            },
        }
    
    async def get_user_positions(self, user_address: str) -> List[Dict[str, Any]]:
        """
        Fetch all active positions for a user.
        
        In production: query Starknet contracts via RPC
        For now: query ledger for active allocations
        """
        try:
            from app.services.ledger_service import get_ledger_service
            ledger = get_ledger_service()
            
            # Get active allocations from ledger
            # NOTE: This is a simplified version. Real implementation would query contracts.
            allocations = ledger.get_vault_allocations(user_address, status="active")
            
            positions = []
            for alloc in allocations:
                positions.append({
                    "position_id": alloc.get("id"),
                    "user_address": user_address,
                    "pool": alloc.get("pool_id"),
                    "pair": alloc.get("pair"),
                    "amount": alloc.get("amount"),
                    "current_value": alloc.get("amount"),  # TODO: Fetch from contract
                    "is_concentrated": True,
                    "current_price": 0,  # TODO: Fetch from Ekubo
                    "lower_bound": 0,  # TODO: Fetch from position
                    "upper_bound": 0,  # TODO: Fetch from position
                    "impermanent_loss_pct": 0,  # TODO: Calculate
                    "realized_apy_pct": 0,  # TODO: Calculate from fees earned
                    "expected_apy_pct": 10,  # TODO: Get from allocation metadata
                    "pool_tvl_usd": 100000,  # TODO: Fetch from Ekubo
                    "min_safe_tvl": 10000,
                })
            
            return positions
            
        except Exception as e:
            logger.error(f"Failed to fetch positions for {user_address}: {e}")
            return []
    
    async def process_alerts(self, user_address: str, alerts: List[Dict[str, Any]]):
        """
        Process and store alerts for a user.
        
        Creates receipts for high-severity alerts so they appear in activity log.
        """
        if not alerts:
            return
        
        try:
            from app.services.receipt_service import get_receipt_service
            receipt_svc = get_receipt_service()
            
            for alert in alerts:
                if alert["severity"] == "high":
                    receipt_svc.record_receipt(
                        user_address=user_address,
                        action_type="position_alert",
                        amount_wei=0,
                        proof_hash="",
                        metadata={
                            "alert_type": alert["type"],
                            "message": alert["message"],
                            "action": alert["action"],
                            "timestamp": datetime.utcnow().isoformat() + "Z",
                        },
                    )
                    logger.warning(f"[{user_address}] {alert['message']}")
        
        except Exception as e:
            logger.error(f"Failed to process alerts: {e}")
    
    async def monitor_user(self, user_address: str):
        """Monitor all positions for a single user."""
        positions = await self.get_user_positions(user_address)
        
        if not positions:
            return
        
        logger.info(f"Monitoring {len(positions)} positions for {user_address}")
        
        all_alerts = []
        for position in positions:
            health = await self.check_position_health(position)
            if not health["healthy"]:
                all_alerts.extend(health["alerts"])
                logger.info(
                    f"Position {position['pool']} unhealthy: {len(health['alerts'])} alerts"
                )
        
        if all_alerts:
            await self.process_alerts(user_address, all_alerts)
    
    async def get_all_users_with_positions(self) -> List[str]:
        """Get list of all users with active positions."""
        try:
            from app.services.ledger_service import get_ledger_service
            ledger = get_ledger_service()
            
            # Get unique users with active allocations
            users = ledger.get_users_with_active_positions()
            return users
            
        except Exception as e:
            logger.error(f"Failed to get users: {e}")
            return []
    
    async def run_monitoring_cycle(self):
        """Run one monitoring cycle for all users."""
        try:
            users = await self.get_all_users_with_positions()
            
            if not users:
                logger.debug("No users with active positions")
                return
            
            logger.info(f"Monitoring cycle: {len(users)} users")
            
            for user in users:
                try:
                    await self.monitor_user(user)
                except Exception as e:
                    logger.error(f"Failed to monitor user {user}: {e}")
            
            logger.info("Monitoring cycle complete")
            
        except Exception as e:
            logger.error(f"Monitoring cycle failed: {e}")
    
    async def start(self):
        """Start the monitoring loop."""
        self.running = True
        logger.info(f"Position monitor starting (poll interval: {self.poll_interval}s)")
        
        while self.running:
            try:
                await self.run_monitoring_cycle()
            except Exception as e:
                logger.error(f"Monitoring cycle error: {e}", exc_info=True)
            
            # Wait before next cycle
            await asyncio.sleep(self.poll_interval)
    
    def stop(self):
        """Stop the monitoring loop."""
        logger.info("Position monitor stopping")
        self.running = False


# Singleton instance
_monitor: PositionMonitor | None = None


def get_position_monitor() -> PositionMonitor:
    """Get the singleton position monitor instance."""
    global _monitor
    if _monitor is None:
        _monitor = PositionMonitor(poll_interval_seconds=300)  # 5 minutes
    return _monitor


async def start_position_monitor():
    """Start the position monitor as a background task."""
    monitor = get_position_monitor()
    await monitor.start()


if __name__ == "__main__":
    # Run standalone
    import sys
    
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    
    logger.info("Starting position monitor worker")
    
    try:
        asyncio.run(start_position_monitor())
    except KeyboardInterrupt:
        logger.info("Shutting down position monitor")
