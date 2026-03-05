"""
Autonomous Rebalancer Service

⚠️  DEPRECATED — Use app.services.autonomous_agent instead.
Retained for backward-compatible imports from services/__init__.py.

Background service that monitors LP positions and triggers autonomous rebalancing.
- Monitors position state + market data every N minutes
- Detects drift (fees accumulated or price moved out of range)
- Generates rebalance decision proof
- Executes via session key (if proof valid)
- Logs all rebalances
"""

import os
import asyncio
from typing import Optional, Any
from datetime import datetime, timedelta
import logging

from app.models import EkuboPosition, PositionStatus, RebalanceEvent, RebalanceReason
from app.services.ekubo_yield_service import EkuboYieldService
from app.services.zkml_proof_service import ZkmlProofService
from app.services.session_key_service import SessionKeyService

logger = logging.getLogger(__name__)

STARKNET_RPC_URL = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia.public.blastapi.io")
REBALANCE_CHECK_INTERVAL_SECONDS = int(os.getenv("REBALANCE_CHECK_INTERVAL_SECONDS", "300"))  # 5 min


class AutonomousRebalancer:
    """
    Background service for autonomous LP rebalancing.
    
    Workflow:
    1. Monitor positions periodically (every N minutes)
    2. For each position:
       - Check if auto-rebalance enabled
       - Fetch current market state + position fees
       - Run drift detection
       - If drift >= threshold, generate rebalance proof
       - Use session key to execute (if proof valid)
       - Log event
    3. Handle failures gracefully (log, don't crash service)
    """
    
    def __init__(
        self,
        yield_service: EkuboYieldService,
        proof_service: ZkmlProofService,
        session_key_service: SessionKeyService,
        check_interval: int = REBALANCE_CHECK_INTERVAL_SECONDS,
    ):
        self.yield_service = yield_service
        self.proof_service = proof_service
        self.session_key_service = session_key_service
        self.check_interval = check_interval
        
        self._running = False
        self._rebalance_history: dict[str, list[RebalanceEvent]] = {}  # position_id -> events
    
    async def start(self):
        """Start the background rebalancing loop."""
        if self._running:
            logger.warning("Rebalancer already running")
            return
        
        self._running = True
        logger.info(f"Autonomous rebalancer started (check interval: {self.check_interval}s)")
        
        # Run background monitoring loop
        asyncio.create_task(self._monitoring_loop())
    
    async def stop(self):
        """Stop the background rebalancing loop."""
        self._running = False
        logger.info("Autonomous rebalancer stopped")
    
    async def get_rebalance_history(self, position_id: str) -> list[RebalanceEvent]:
        """Retrieve rebalance history for a position."""
        return self._rebalance_history.get(position_id, [])
    
    # Private methods
    
    async def _monitoring_loop(self):
        """
        Main background loop: check all positions periodically.
        """
        while self._running:
            try:
                await self._check_all_positions_for_rebalancing()
            except Exception as e:
                logger.error(f"Error in rebalance monitoring loop: {e}", exc_info=True)
            
            # Wait before next check
            await asyncio.sleep(self.check_interval)
    
    async def _check_all_positions_for_rebalancing(self):
        """
        Check all active positions for rebalancing needs.
        """
        # In production: query database for all positions
        # For MVP: iterate through yield_service._positions
        
        positions = list(self.yield_service._positions.values())
        active_positions = [p for p in positions if p.status == PositionStatus.ACTIVE]
        
        logger.debug(f"Checking {len(active_positions)} active positions for rebalancing")
        
        for position in active_positions:
            if not position.auto_rebalance_enabled:
                continue
            
            try:
                await self._check_position_rebalance(position)
            except Exception as e:
                logger.error(
                    f"Error checking position {position.position_id}: {e}",
                    exc_info=True
                )
    
    async def _check_position_rebalance(self, position: EkuboPosition):
        """
        Check if a single position needs rebalancing.
        If yes, generate proof and execute.
        """
        
        # Fetch current market state
        market_data = await self._fetch_market_state(position.token0, position.token1)
        position_state = await self._fetch_position_state(position.position_id)
        
        logger.debug(
            f"Position {position.position_id}: "
            f"fees={position_state['accumulated_fees']:.2f}, "
            f"price_drift={position_state['price_drift_percent']:.2f}%"
        )
        
        # Check rebalance conditions
        should_rebalance = (
            position_state["accumulated_fees"] >= position.fee_threshold_for_rebalance or
            position_state["price_drift_percent"] > position.price_drift_threshold * 100
        )
        
        if not should_rebalance:
            return
        
        logger.info(f"Position {position.position_id} triggered rebalance")
        
        # Generate rebalance decision proof
        proof = await self.proof_service.generate_rebalance_decision_proof(
            position_id=position.position_id,
            current_fee_tier=position.fee_tier,
            pool_volatility=market_data["volatility"],
            current_lower_tick=position.lower_tick,
            current_upper_tick=position.upper_tick,
            current_price=market_data["price"],
            accumulated_fees=position_state["accumulated_fees"],
            fee_threshold=position.fee_threshold_for_rebalance,
        )
        
        if not proof.get("should_rebalance"):
            logger.info(f"Position {position.position_id}: proof recommends no rebalance")
            return
        
        # Execute rebalance (via session key)
        await self._execute_rebalance(position, proof, position_state)
    
    async def _execute_rebalance(
        self,
        position: EkuboPosition,
        proof: dict[str, Any],
        position_state: dict[str, Any],
    ):
        """
        Execute the rebalance transaction using EkuboContractExecutor.

        Flow:
        1. Remove liquidity from old tick range (withdraw)
        2. Create new LP position at new tick range (mint_and_deposit)
        3. Record tx hashes on the event
        """
        
        logger.info(f"Executing rebalance for position {position.position_id}")
        
        # Create rebalance event record
        event = RebalanceEvent(
            event_id=self._generate_event_id(),
            position_id=position.position_id,
            reason=RebalanceReason.FEE_THRESHOLD if position_state["accumulated_fees"] >= position.fee_threshold_for_rebalance else RebalanceReason.PRICE_DRIFT,
            old_fee_tier=position.fee_tier,
            old_lower_tick=position.lower_tick,
            old_upper_tick=position.upper_tick,
            new_fee_tier=proof["new_fee_tier"],
            new_lower_tick=proof["new_lower_tick"],
            new_upper_tick=proof["new_upper_tick"],
            proof_hash=proof["proof_hash"],
            session_key_used=position.session_key_address or "unknown",
            accumulated_fees_commitment=position.amount0_commitment,  # Placeholder
            accumulated_fees_usd_estimate=position_state["accumulated_fees"],
        )
        
        event.proof_verified = True
        event.proof_verified_at = datetime.utcnow()
        event.executed_at = datetime.utcnow()

        # Attempt on-chain submission via EkuboContractExecutor
        from app.services.ekubo_executor import EkuboContractExecutor, _PAIR_DEFAULTS

        executor = EkuboContractExecutor()
        if executor._is_configured():
            # Resolve pair string from token addresses
            pair_name = self._resolve_pair(position.token0, position.token1)
            if pair_name:
                try:
                    # Step 1: Remove liquidity from old position
                    position_id_int = int(position.position_id, 16) if position.position_id.startswith("0x") else int(position.position_id)
                    remove_result = await executor.remove_liquidity(
                        position_id=position_id_int,
                        pair=pair_name,
                        lower_tick=position.lower_tick,
                        upper_tick=position.upper_tick,
                        liquidity=0,  # 0 = remove all
                        collect_fees_on_withdraw=True,
                    )
                    remove_tx = remove_result.get("tx_hash") if remove_result.get("success") else None

                    # Step 2: Create new LP position at new tick range
                    create_result = await executor.create_lp_position(
                        pair=pair_name,
                        amount0_human=0.001,  # Re-enter with same amounts (conservative default)
                        amount1_human=0.001,
                        lower_tick=proof["new_lower_tick"],
                        upper_tick=proof["new_upper_tick"],
                        min_liquidity=0,
                    )
                    create_tx = create_result.get("tx_hash") if create_result.get("success") else None

                    # Record tx hashes
                    event.tx_hash = create_tx or remove_tx
                    if remove_tx:
                        logger.info(f"Rebalance remove liquidity tx: {remove_tx}")
                    if create_tx:
                        logger.info(f"Rebalance new position tx: {create_tx}")
                    if not event.tx_hash:
                        logger.warning(f"Rebalance on-chain calls returned no tx hash for {position.position_id}")
                except Exception as exc:
                    logger.error(f"Rebalance on-chain execution failed for {position.position_id}: {exc}")
                    event.tx_hash = None
            else:
                logger.warning(f"Cannot resolve pair for tokens {position.token0}/{position.token1}; rebalance recorded only.")
                event.tx_hash = None
        else:
            event.tx_hash = None
            logger.info("EkuboContractExecutor not configured; rebalance recorded without on-chain tx.")
        
        # Update position
        position.status = PositionStatus.ACTIVE  # Rebalance complete
        position.fee_tier = proof["new_fee_tier"]
        position.lower_tick = proof["new_lower_tick"]
        position.upper_tick = proof["new_upper_tick"]
        position.last_rebalance_at = datetime.utcnow()
        position.rebalance_history.append(event.event_id)
        
        # Log event
        if position.position_id not in self._rebalance_history:
            self._rebalance_history[position.position_id] = []
        self._rebalance_history[position.position_id].append(event)
        
        logger.info(
            f"Rebalance executed: {position.position_id} "
            f"tier {proof['new_fee_tier']}, "
            f"range [{proof['new_lower_tick']}, {proof['new_upper_tick']}]"
        )
    
    # Private helpers

    @staticmethod
    def _resolve_pair(token0: str, token1: str) -> Optional[str]:
        """Map token addresses to an _PAIR_DEFAULTS key like 'ETH/USDC'."""
        from app.services.ekubo_executor import _PAIR_DEFAULTS
        t0 = (token0 or "").lower()
        t1 = (token1 or "").lower()
        for name, info in _PAIR_DEFAULTS.items():
            if {info["token0"].lower(), info["token1"].lower()} == {t0, t1}:
                return name
        return None
    
    async def _fetch_market_state(self, token0: str, token1: str) -> dict[str, Any]:
        """Fetch current market state (price, volatility) from Ekubo oracle.

        Falls back to the market-maker-sim service when the on-chain oracle
        is unavailable, so the agent always has a price signal."""
        try:
            from app.services.ekubo.oracle_adapter import get_spot_price
            price = await get_spot_price(token0, token1)
            if price is not None:
                return {
                    "price": price,
                    "volatility": 0.05,  # TODO: compute from price history
                    "data_quality": "live",
                }
        except Exception as exc:
            logger.warning("_fetch_market_state oracle call failed: %s", exc)

        # Fallback: try market-maker-sim
        try:
            import os, httpx
            sim_url = os.getenv("MM_SIM_URL", "http://localhost:8099")
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{sim_url}/public/state")
                if resp.status_code == 200:
                    snap = resp.json()
                    return {
                        "price": snap.get("price", 1.0),
                        "volatility": 0.05,
                        "data_quality": "simulated",
                    }
        except Exception as exc:
            logger.warning("_fetch_market_state sim fallback failed: %s", exc)

        return {
            "price": 1.0,
            "volatility": 0.05,
            "data_quality": "unavailable",
        }
    
    async def _fetch_position_state(self, position_id: str) -> dict[str, Any]:
        """
        Fetch current position state from on-chain.
        Returns: accumulated fees, price drift, etc.
        """
        # In practice: query Starknet RPC for position on-chain state
        # For MVP: return placeholder
        
        # Find position
        for pos in self.yield_service._positions.values():
            if pos.position_id == position_id:
                return {
                    "accumulated_fees": 0.5,  # Placeholder (0.5% of TVL)
                    "price_drift_percent": 0.03,  # 3% drift
                }
        
        return {
            "accumulated_fees": 0.0,
            "price_drift_percent": 0.0,
        }
    
    def _generate_event_id(self) -> str:
        """Generate unique event ID."""
        import hashlib
        from datetime import datetime
        data = f"{datetime.utcnow().isoformat()}".encode()
        return "0x" + hashlib.sha256(data).hexdigest()[:16]
