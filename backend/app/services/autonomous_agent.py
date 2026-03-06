"""
Autonomous Agent Service

Background service that monitors user positions and autonomously triggers
rebalancing actions when conditions are met. All actions are gated by zkML proofs.

Trigger mechanisms:
1. Timer-based: Periodic portfolio checks
2. Oracle-triggered: Price threshold breaches
3. Webhook-triggered: External events
"""
import asyncio
import logging
from typing import Any
from datetime import datetime
from enum import Enum

from app.services.agent_rebalancer import get_rebalancer, RebalanceStatus
from app.services.mainnet_oracle import MainnetOracle

logger = logging.getLogger(__name__)


class AgentState(str, Enum):
    """States for the autonomous agent."""
    STOPPED = "stopped"
    RUNNING = "running"
    PAUSED = "paused"
    ERROR = "error"


class MonitoringConfig:
    """Configuration for autonomous monitoring."""
    
    def __init__(
        self,
        interval_seconds: int = 900,  # 15 minutes default
        risk_threshold: int = 50,
        min_rebalance_amount: int = 100000000000000000,  # 0.1 ETH in wei
        max_actions_per_hour: int = 4,
        enable_oracle_triggers: bool = True,
        price_change_threshold_pct: float = 5.0,
    ):
        self.interval_seconds = interval_seconds
        self.risk_threshold = risk_threshold
        self.min_rebalance_amount = min_rebalance_amount
        self.max_actions_per_hour = max_actions_per_hour
        self.enable_oracle_triggers = enable_oracle_triggers
        self.price_change_threshold_pct = price_change_threshold_pct


class AutonomousAgent:
    """
    Background agent that monitors positions and triggers actions automatically.
    
    Flow:
    1. Fetch current positions and market data
    2. Check if rebalancing thresholds are breached
    3. If yes, create proposal and run zkML gates
    4. If zkML passes, prepare and execute with session key
    """
    
    def __init__(self):
        self._agents: dict[str, dict[str, Any]] = {}  # user_address -> agent state
        self._tasks: dict[str, asyncio.Task] = {}  # user_address -> background task
        self._rebalancer = get_rebalancer()
        self._oracle = MainnetOracle()
    
    def get_agent_state(self, user_address: str) -> dict[str, Any]:
        """Get the state of an autonomous agent for a user."""
        if user_address not in self._agents:
            return {
                "state": AgentState.STOPPED.value,
                "user_address": user_address,
                "running": False,
            }
        return self._agents[user_address]
    
    def is_running(self, user_address: str) -> bool:
        """Check if autonomous agent is running for user."""
        state = self._agents.get(user_address, {})
        return state.get("state") == AgentState.RUNNING.value
    
    async def start(
        self,
        user_address: str,
        session_id: str,
        config: MonitoringConfig | None = None
    ) -> dict[str, Any]:
        """
        Start the autonomous agent for a user.
        
        Requires an active session key for delegated execution.
        """
        if self.is_running(user_address):
            return {
                "success": False,
                "error": "Agent already running",
                "state": self._agents[user_address]
            }
        
        if config is None:
            config = MonitoringConfig()
        
        # Initialize agent state
        self._agents[user_address] = {
            "state": AgentState.RUNNING.value,
            "user_address": user_address,
            "session_id": session_id,
            "config": {
                "interval_seconds": config.interval_seconds,
                "risk_threshold": config.risk_threshold,
                "min_rebalance_amount": config.min_rebalance_amount,
                "max_actions_per_hour": config.max_actions_per_hour,
            },
            "started_at": datetime.utcnow().isoformat(),
            "last_check": None,
            "checks_count": 0,
            "actions_taken": 0,
            "last_action": None,
            "errors": [],
            "running": True,
        }
        
        # Start background monitoring task
        task = asyncio.create_task(
            self._monitor_loop(user_address, session_id, config)
        )
        self._tasks[user_address] = task
        
        logger.info(f"Started autonomous agent for {user_address[:10]}...")
        
        return {
            "success": True,
            "state": self._agents[user_address],
            "message": f"Autonomous agent started with {config.interval_seconds}s interval"
        }
    
    async def stop(self, user_address: str) -> dict[str, Any]:
        """Stop the autonomous agent for a user."""
        if user_address not in self._agents:
            return {
                "success": False,
                "error": "Agent not found"
            }
        
        # Cancel the background task
        if user_address in self._tasks:
            self._tasks[user_address].cancel()
            try:
                await self._tasks[user_address]
            except asyncio.CancelledError:
                pass
            del self._tasks[user_address]
        
        # Update state
        self._agents[user_address]["state"] = AgentState.STOPPED.value
        self._agents[user_address]["running"] = False
        self._agents[user_address]["stopped_at"] = datetime.utcnow().isoformat()
        
        logger.info(f"Stopped autonomous agent for {user_address[:10]}...")
        
        return {
            "success": True,
            "state": self._agents[user_address],
            "message": "Autonomous agent stopped"
        }
    
    async def pause(self, user_address: str) -> dict[str, Any]:
        """Pause the autonomous agent (keeps state but stops checks)."""
        if user_address not in self._agents:
            return {"success": False, "error": "Agent not found"}
        
        self._agents[user_address]["state"] = AgentState.PAUSED.value
        
        return {
            "success": True,
            "state": self._agents[user_address],
            "message": "Autonomous agent paused"
        }
    
    async def resume(self, user_address: str) -> dict[str, Any]:
        """Resume a paused autonomous agent."""
        if user_address not in self._agents:
            return {"success": False, "error": "Agent not found"}
        
        self._agents[user_address]["state"] = AgentState.RUNNING.value
        
        return {
            "success": True,
            "state": self._agents[user_address],
            "message": "Autonomous agent resumed"
        }
    
    async def _monitor_loop(
        self,
        user_address: str,
        session_id: str,
        config: MonitoringConfig
    ):
        """
        Main monitoring loop.
        
        Runs every interval_seconds, checks conditions, and triggers actions.
        """
        logger.info(f"Monitoring loop started for {user_address[:10]}...")
        
        while True:
            try:
                agent_state = self._agents.get(user_address, {})
                
                # Check if we should continue
                if agent_state.get("state") == AgentState.STOPPED.value:
                    break
                
                # Skip if paused
                if agent_state.get("state") == AgentState.PAUSED.value:
                    await asyncio.sleep(config.interval_seconds)
                    continue
                
                # Perform check
                await self._perform_check(user_address, session_id, config)
                
                # Update last check time
                self._agents[user_address]["last_check"] = datetime.utcnow().isoformat()
                self._agents[user_address]["checks_count"] += 1
                
                # Wait for next interval
                await asyncio.sleep(config.interval_seconds)
                
            except asyncio.CancelledError:
                logger.info(f"Monitoring loop cancelled for {user_address[:10]}...")
                break
            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                if user_address in self._agents:
                    self._agents[user_address]["errors"].append({
                        "time": datetime.utcnow().isoformat(),
                        "error": str(e)
                    })
                    # Keep only last 10 errors
                    self._agents[user_address]["errors"] = self._agents[user_address]["errors"][-10:]
                await asyncio.sleep(config.interval_seconds)
    
    async def _perform_check(
        self,
        user_address: str,
        session_id: str,
        config: MonitoringConfig
    ):
        """
        Perform a single monitoring check.
        
        1. Analyze portfolio
        2. If thresholds breached, propose rebalance
        3. Run zkML gates
        4. If passed, execute
        """
        logger.debug(f"Performing check for {user_address[:10]}...")
        
        try:
            # 1. Analyze portfolio
            analysis = await self._rebalancer.analyze_portfolio(
                user_address=user_address,
                positions={1: 50, 2: 30, 3: 20}  # Default positions for demo
            )
            
            # 2. Check if rebalancing is needed
            if not analysis.get("should_rebalance", False):
                logger.debug(f"No rebalance needed for {user_address[:10]}")
                return
            
            logger.info(f"Rebalance suggested for {user_address[:10]}: {analysis.get('suggestions', [])}")
            
            # 3. Create proposal
            suggestions = analysis.get("suggestions", [])
            if not suggestions:
                return
            
            suggestion = suggestions[0]  # Take first suggestion
            
            proposal = await self._rebalancer.propose_rebalance(
                user_address=user_address,
                from_protocol=suggestion.get("from_protocol", 1),
                to_protocol=suggestion.get("to_protocol", 2),
                amount=suggestion.get("amount", config.min_rebalance_amount),
                reason=f"Autonomous: {suggestion.get('reason', 'threshold breach')}"
            )
            
            proposal_id = proposal.proposal_id
            logger.info(f"Created proposal {proposal_id} for {user_address[:10]}")
            
            # 4. Run zkML gates
            portfolio_features = analysis.get("portfolio_features", [0] * 8)
            zkml_result = await self._rebalancer.check_zkml_gates(
                proposal_id=proposal_id,
                portfolio_features=portfolio_features
            )
            
            if not zkml_result.get("can_proceed", False):
                logger.info(f"zkML gate rejected proposal {proposal_id}")
                return
            
            logger.info(f"zkML gate passed for proposal {proposal_id}")
            
            # 5. Prepare execution
            prep_result = await self._rebalancer.prepare_execution(
                proposal_id=proposal_id,
                session_id=session_id
            )
            
            if not prep_result.get("ready_to_execute", False):
                logger.warning(f"Preparation failed for proposal {proposal_id}")
                return
            
            # 6. Execute
            exec_result = await self._rebalancer.execute_rebalance(
                proposal_id=proposal_id,
                session_id=session_id
            )
            
            # 7. Update agent state
            if user_address in self._agents:
                self._agents[user_address]["actions_taken"] += 1
                self._agents[user_address]["last_action"] = {
                    "proposal_id": proposal_id,
                    "tx_hash": exec_result.get("tx_hash"),
                    "timestamp": datetime.utcnow().isoformat(),
                    "from_protocol": suggestion.get("from_protocol"),
                    "to_protocol": suggestion.get("to_protocol"),
                    "amount": suggestion.get("amount"),
                }
            
            logger.info(f"Executed rebalance {proposal_id}: tx={exec_result.get('tx_hash')}")
            
        except Exception as e:
            logger.error(f"Check failed for {user_address[:10]}: {e}")
            raise
    
    def get_all_agents(self) -> list[dict[str, Any]]:
        """Get status of all autonomous agents."""
        return list(self._agents.values())


# Singleton instance
_autonomous_agent: AutonomousAgent | None = None


def get_autonomous_agent() -> AutonomousAgent:
    """Get or create the autonomous agent singleton."""
    global _autonomous_agent
    if _autonomous_agent is None:
        _autonomous_agent = AutonomousAgent()
    return _autonomous_agent
