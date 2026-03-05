"""
Autonomous Agent Service

Background service that monitors user positions and autonomously triggers
rebalancing actions when conditions are met. All actions are gated by zkML proofs
and constrained by the user's vault policy (risk budget, strategy permissions,
execution policy).

Trigger mechanisms:
1. Timer-based: Periodic portfolio checks
2. Oracle-triggered: Price threshold breaches
3. Webhook-triggered: External events
"""
import asyncio
import logging
from typing import Any
from datetime import datetime, timezone
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
        interval_seconds: int = 900,
        risk_threshold: int = 50,
        min_rebalance_amount: int = 100000000000000000,
        max_actions_per_hour: int = 4,
        enable_oracle_triggers: bool = True,
        price_change_threshold_pct: float = 5.0,
        strategy_type: str = "rebalance",
        metadata: dict | None = None,
    ):
        self.interval_seconds = interval_seconds
        self.risk_threshold = risk_threshold
        self.min_rebalance_amount = min_rebalance_amount
        self.max_actions_per_hour = max_actions_per_hour
        self.enable_oracle_triggers = enable_oracle_triggers
        self.price_change_threshold_pct = price_change_threshold_pct
        self.strategy_type = strategy_type
        self.metadata = metadata or {}


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
        from app.services.json_store import JsonStore
        self._store = JsonStore("autonomous_agents")
        self._agents: dict[str, dict[str, Any]] = self._store.all()  # restore from disk
        self._tasks: dict[str, asyncio.Task] = {}  # runtime only (not persisted)
        self._rebalancer = get_rebalancer()
        self._oracle = MainnetOracle()

    def _persist(self, user_address: str) -> None:
        """Flush current agent state to disk."""
        if user_address in self._agents:
            self._store.set(user_address, self._agents[user_address])
    
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
            "started_at": datetime.now(timezone.utc).isoformat(),
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
        self._persist(user_address)
        
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
        self._agents[user_address]["stopped_at"] = datetime.now(timezone.utc).isoformat()
        self._persist(user_address)
        
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
        self._persist(user_address)
        
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
        self._persist(user_address)
        
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
                self._agents[user_address]["last_check"] = datetime.now(timezone.utc).isoformat()
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
                        "time": datetime.now(timezone.utc).isoformat(),
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
        
        1. Load vault policy and check permissions
        2. Fetch real positions from ekubo_lp_service
        3. Analyze portfolio against current market
        4. If thresholds breached, propose rebalance
        5. Run zkML gates
        6. If passed + policy allows, execute
        """
        logger.debug(f"Performing check for {user_address[:10]}...")
        
        try:
            # ── 0. Load and enforce vault policy ──────────────────────────
            from app.services.vault_policy_service import get_vault_policy_service
            policy_svc = get_vault_policy_service()
            policy = policy_svc.get_policy(user_address, create_if_missing=False)

            if policy:
                exec_policy = policy.get("execution_policy", {})
                strat_perms = policy.get("strategy_permissions", {})

                # Respect execution mode
                mode = exec_policy.get("mode", "assist")
                if mode == "monitor":
                    logger.debug("Policy mode=monitor → skip execution")
                    return
                if exec_policy.get("emergency_pause"):
                    logger.info("Emergency pause active → skip execution")
                    return

                # Respect cooldown
                cooldown_sec = exec_policy.get("cooldown_seconds", 300)
                last_action = self._agents.get(user_address, {}).get("last_action")
                if last_action:
                    last_ts = last_action.get("timestamp")
                    if last_ts:
                        try:
                            since = (datetime.now(timezone.utc) - datetime.fromisoformat(last_ts)).total_seconds()
                            if since < cooldown_sec:
                                logger.debug(f"Cooldown: {cooldown_sec - since:.0f}s remaining")
                                return
                        except Exception:
                            pass

                # Check if rebalance is permitted
                if not strat_perms.get("enable_rebalance", True):
                    logger.debug("strategy_permissions.enable_rebalance=False → skip")
                    return

                # Use policy risk threshold if available
                risk_budget = policy.get("risk_budget", {})
                max_drawdown = risk_budget.get("max_drawdown_bps", 1500)
                config.risk_threshold = min(config.risk_threshold, int(max_drawdown / 30))

            # ── DCA strategy branch ────────────────────────────────────────
            if config.strategy_type == "dca":
                from app.services.dca_service import execute_dca_step
                dca_config = config.metadata.get("dca_config", {})
                dca_state = self._agents.get(user_address, {}).get("dca_state", {})
                result = await execute_dca_step(user_address, dca_config, dca_state)
                if not result.get("skipped"):
                    agent_state = self._agents.setdefault(user_address, {})
                    agent_state["dca_state"] = dca_state
                logger.info("DCA for %s: %s", user_address[:10], result)
                return

            # ── 1. Fetch real positions ───────────────────────────────────
            from app.services.ekubo_lp_service import list_positions
            positions_list = list_positions(user_address)

            if not positions_list:
                logger.debug(f"No positions for {user_address[:10]} → skip")
                return

            # Build positions dict: id → allocation estimate
            total_value = sum(
                float(p.get("amount0_wei", 0)) + float(p.get("amount1_wei", 0))
                for p in positions_list
            )
            if total_value <= 0:
                logger.debug("Position total value ≤ 0 → skip")
                return

            positions_map: dict[int, float] = {}
            for i, pos in enumerate(positions_list):
                val = float(pos.get("amount0_wei", 0)) + float(pos.get("amount1_wei", 0))
                pct = (val / total_value) * 100 if total_value > 0 else 0
                positions_map[i + 1] = round(pct, 1)

            # ── 2. Analyze portfolio ──────────────────────────────────────
            analysis = await self._rebalancer.analyze_portfolio(
                user_address=user_address,
                positions=positions_map,
            )
            
            # 3. Check if rebalancing is needed
            if not analysis.get("should_rebalance", False):
                logger.debug(f"No rebalance needed for {user_address[:10]}")
                return
            
            logger.info(f"Rebalance suggested for {user_address[:10]}: {analysis.get('suggestions', [])}")
            
            # 4. Create proposal
            suggestions = analysis.get("suggestions", [])
            if not suggestions:
                return
            
            suggestion = suggestions[0]  # Take first suggestion

            # ── Enforce max position size from policy ─────────────────────
            if policy:
                max_pos_pct = policy.get("risk_budget", {}).get("max_position_pct", 35)
                amount = suggestion.get("amount", config.min_rebalance_amount)
                if total_value > 0:
                    pct_of_total = (amount / total_value) * 100
                    if pct_of_total > max_pos_pct:
                        amount = int(total_value * max_pos_pct / 100)
                        logger.info(f"Clamped amount to {max_pos_pct}% of portfolio")
            else:
                amount = suggestion.get("amount", config.min_rebalance_amount)

            proposal = await self._rebalancer.propose_rebalance(
                user_address=user_address,
                from_protocol=suggestion.get("from_protocol", 1),
                to_protocol=suggestion.get("to_protocol", 2),
                amount=amount,
                reason=f"Autonomous: {suggestion.get('reason', 'threshold breach')}"
            )
            
            proposal_id = proposal.proposal_id
            logger.info(f"Created proposal {proposal_id} for {user_address[:10]}")
            
            # 5. Run zkML gates
            portfolio_features = analysis.get("portfolio_features", [0] * 8)
            zkml_result = await self._rebalancer.check_zkml_gates(
                proposal_id=proposal_id,
                portfolio_features=portfolio_features
            )
            
            if not zkml_result.get("can_proceed", False):
                logger.info(f"zkML gate rejected proposal {proposal_id}")
                return
            
            logger.info(f"zkML gate passed for proposal {proposal_id}")

            # ── Check execution mode before executing ─────────────────────
            if policy:
                mode = policy.get("execution_policy", {}).get("mode", "assist")
                if mode == "assist":
                    logger.info(f"Policy mode=assist → proposal {proposal_id} ready but not auto-executing")
                    if user_address in self._agents:
                        self._agents[user_address]["pending_proposal"] = {
                            "proposal_id": proposal_id,
                            "suggestion": suggestion,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                    return
            
            # 6. Prepare execution (autonomous mode)
            prep_result = await self._rebalancer.prepare_execution(
                proposal_id=proposal_id,
                session_id=session_id
            )
            
            if not prep_result.get("ready_to_execute", False):
                logger.warning(f"Preparation failed for proposal {proposal_id}")
                return
            
            # 7. Execute
            exec_result = await self._rebalancer.execute_rebalance(
                proposal_id=proposal_id,
                session_id=session_id
            )
            
            # 8. Update agent state
            if user_address in self._agents:
                self._agents[user_address]["actions_taken"] += 1
                self._agents[user_address]["last_action"] = {
                    "proposal_id": proposal_id,
                    "tx_hash": exec_result.get("tx_hash"),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "from_protocol": suggestion.get("from_protocol"),
                    "to_protocol": suggestion.get("to_protocol"),
                    "amount": amount,
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
