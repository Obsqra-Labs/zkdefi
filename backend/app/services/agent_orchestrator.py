"""
Agent Orchestrator Service.

Converts policy-gated signals into executable contract calls for the relayer.
Maps signal types to adapter contract methods and generates calldata.

Responsibilities:
1. Signal → ContractCall mapping per opportunity type
2. Parameter generation (amount, slippage, privacy mode)
3. Relayer submission
4. Execution tracking and status updates
"""

import logging
from typing import Any, Optional
from datetime import datetime, timezone
from dataclasses import dataclass

from app.services.json_store import JsonStore
from app.services.relayer_client import get_relayer_client

logger = logging.getLogger(__name__)


@dataclass
class ContractCall:
    """Represents a contract call ready for execution."""
    id: str
    address: str  # User address
    adapter: str  # Adapter name (lending, staking, dex, dca, limits)
    method: str  # Contract method name
    calldata: dict[str, Any]  # Method parameters
    signal_id: str  # Source signal
    estimated_gas: int
    created_at: str


@dataclass
class AgentConfig:
    """Configuration for a registered agent (used by agent_builder)."""
    agent_id: str
    owner_address: str
    name: str
    identity_commitment: str = ""
    bound_skills: list[str] | None = None
    llm_provider_id: str = "deterministic"
    llm_model: str = "deterministic-v1"


class AgentOrchestrator:
    """Orchestrates signal execution through adapters."""
    
    def __init__(self):
        self._execution_store = JsonStore("execution_queue")
        self._execution_history = JsonStore("execution_history")
        self._agent_store = JsonStore("builder_agents")
        self._relayer = get_relayer_client()  # ← NEW: Real relayer
    
    def prepare_execution(
        self,
        signal: dict[str, Any],
        user_address: str,
        execution_params: dict[str, Any],
    ) -> ContractCall:
        """
        Prepare a contract call from a signal.
        
        Args:
            signal: Signal from gating engine
            user_address: Address executing the signal
            execution_params: {amount, slippage, privacyLevel, adapterId}
            
        Returns:
            ContractCall ready for submission
        """
        signal_type = signal.get("type", "unknown")
        signal_id = signal.get("id", "unknown")
        
        try:
            # Map signal type to adapter and method
            adapter_config = self._get_adapter_config(signal_type, signal)
            if not adapter_config:
                raise ValueError(f"No adapter for signal type: {signal_type}")
            
            # Generate calldata
            calldata = self._generate_calldata(
                signal=signal,
                adapter_config=adapter_config,
                execution_params=execution_params,
            )
            
            # Create contract call
            call_id = self._generate_call_id(user_address, signal_id)
            call = ContractCall(
                id=call_id,
                address=user_address,
                adapter=adapter_config["adapter"],
                method=adapter_config["method"],
                calldata=calldata,
                signal_id=signal_id,
                estimated_gas=adapter_config.get("estimated_gas", 200000),
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            
            # Store for execution queue
            self._execution_store.set(call_id, self._call_to_dict(call))
            logger.info(f"Prepared execution: {call_id} for {signal_id}")
            
            return call
            
        except Exception as e:
            logger.error(f"Failed to prepare execution for signal {signal_id}: {e}")
            raise
    
    async def submit_execution(
        self,
        call: ContractCall,
        relayer_url: str = "http://localhost:8004",
    ) -> dict[str, Any]:
        """
        Submit contract call to REAL relayer (Phase 2).
        
        Args:
            call: ContractCall from prepare_execution
            relayer_url: Relayer service URL
            
        Returns:
            {tx_hash, submitted_at, status}
        """
        try:
            # Submit to REAL relayer
            submission = await self._relayer.submit_call(
                address=call.address,
                adapter=call.adapter,
                method=call.method,
                calldata=call.calldata,
            )
            
            # Store with REAL tx_hash (no longer mocked)
            execution_record = self._call_to_dict(call)
            execution_record.update(submission)
            self._execution_history.set(call.id, execution_record)
            
            logger.info(f"Submitted execution: {call.id} → {submission['tx_hash']}")
            return submission
            
        except Exception as e:
            logger.error(f"Failed to submit execution {call.id}: {e}")
            raise
    
    def get_execution_status(self, call_id: str) -> dict[str, Any]:
        """Get status of a submitted execution."""
        record = self._execution_history.get(call_id)
        if not record:
            return {"status": "not_found", "call_id": call_id}
        
        return {
            "call_id": call_id,
            "status": record.get("status", "unknown"),
            "tx_hash": record.get("tx_hash"),
            "signal_id": record.get("signal_id"),
            "address": record.get("address"),
            "submitted_at": record.get("submitted_at"),
            "completed_at": record.get("completed_at"),
        }
    
    def _get_adapter_config(
        self,
        signal_type: str,
        signal: dict[str, Any],
    ) -> Optional[dict[str, Any]]:
        """Map signal type to adapter configuration."""
        
        configs = {
            "lending": {
                "adapter": "lending",
                "method": "supply" if "supply" in signal.get("name", "").lower() else "borrow",
                "estimated_gas": 180000,  # TODO: live via gas_oracle when async context available
            },
            "staking": {
                "adapter": "staking",
                "method": "stake",
                "estimated_gas": 150000,
            },
            "dex": {
                "adapter": "ekubo",
                "method": "swap",
                "estimated_gas": 250000,
            },
            "swap": {
                "adapter": "ekubo",
                "method": "swap",
                "estimated_gas": 250000,
            },
            "dca": {
                "adapter": "dca",
                "method": "execute_dca",
                "estimated_gas": 200000,
            },
            "limits": {
                "adapter": "limit_orders",
                "method": "create_limit",
                "estimated_gas": 160000,
            },
        }
        
        return configs.get(signal_type)
    
    def _generate_calldata(
        self,
        signal: dict[str, Any],
        adapter_config: dict[str, Any],
        execution_params: dict[str, Any],
    ) -> dict[str, Any]:
        """Generate contract calldata from signal and parameters."""
        
        adapter = adapter_config["adapter"]
        method = adapter_config["method"]
        
        # Extract execution parameters
        amount = execution_params.get("amount", 0)
        slippage = execution_params.get("slippage", 50)  # bps
        privacy_level = execution_params.get("privacyLevel", "public")
        
        # Base calldata
        calldata = {
            "to": signal.get("constitution", {}).get("contract"),
            "method": method,
            "amount": int(amount),
            "slippage_bps": int(slippage),
            "privacy_mode": privacy_level,
        }
        
        # Adapter-specific parameters
        if adapter == "lending":
            calldata.update({
                "asset": signal.get("constitution", {}).get("asset"),
                "pool_id": signal.get("constitution", {}).get("pool"),
            })
        elif adapter == "staking":
            calldata.update({
                "staking_token": signal.get("constitution", {}).get("asset"),
            })
        elif adapter == "ekubo":
            calldata.update({
                "token_in": signal.get("tokenA"),
                "token_out": signal.get("tokenB"),
                "fee_tier": 3000,  # Standard fee tier
            })
        elif adapter == "dca":
            calldata.update({
                "interval": execution_params.get("interval", 86400),  # 1 day default
                "iterations": execution_params.get("iterations", 12),
            })
        elif adapter == "limit_orders":
            calldata.update({
                "trigger_price": execution_params.get("triggerPrice", 0),
                "order_type": execution_params.get("orderType", "stop_loss"),
            })
        
        return calldata
    
    @staticmethod
    def _generate_call_id(address: str, signal_id: str) -> str:
        """Generate unique call ID."""
        import hashlib
        payload = f"{address}:{signal_id}:{datetime.now(timezone.utc).isoformat()}".encode()
        return "0x" + hashlib.sha256(payload).hexdigest()[:62]
    
    @staticmethod
    def _call_to_dict(call: ContractCall) -> dict[str, Any]:
        """Convert ContractCall to dict for storage."""
        return {
            "id": call.id,
            "address": call.address,
            "adapter": call.adapter,
            "method": call.method,
            "calldata": call.calldata,
            "signal_id": call.signal_id,
            "estimated_gas": call.estimated_gas,
            "created_at": call.created_at,
        }

    # ── Agent CRUD (used by agent_builder.py) ────────────────────────────

    def register_agent(self, config: AgentConfig) -> dict[str, Any]:
        """Register a new agent in the builder store."""
        import hashlib, json
        data = {
            "agent_id": config.agent_id,
            "owner_address": config.owner_address,
            "name": config.name,
            "identity_commitment": config.identity_commitment,
            "bound_skills": config.bound_skills or [],
            "llm_provider_id": config.llm_provider_id,
            "llm_model": config.llm_model,
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self._agent_store.set(config.agent_id, data)
        config_hash = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:16]
        return {"config_hash": config_hash}

    def list_agents(self, owner: str | None = None) -> list[dict]:
        """List all registered agents, optionally filtered by owner."""
        all_agents = self._agent_store.values()
        if owner:
            return [a for a in all_agents if a.get("owner_address") == owner]
        return all_agents

    def get_agent(self, agent_id: str) -> Optional[Any]:
        """Get agent by ID. Returns a namespace-like object or None."""
        data = self._agent_store.get(agent_id)
        if not data:
            return None
        # Return a simple namespace so attribute access works
        from types import SimpleNamespace
        return SimpleNamespace(**data)

    def update_agent(self, agent_id: str, updates: dict) -> bool:
        """Update agent fields."""
        data = self._agent_store.get(agent_id)
        if not data:
            return False
        data.update(updates)
        self._agent_store.set(agent_id, data)
        return True

    def delete_agent(self, agent_id: str) -> bool:
        """Delete an agent. Returns True if it existed."""
        data = self._agent_store.get(agent_id)
        if not data:
            return False
        self._agent_store.delete(agent_id)
        return True

    async def execute_goal(self, agent_id: str, goal: str, context: dict | None = None):
        """Execute a goal using the agent's LLM + ZK skills pipeline."""
        from app.services.local_orchestrator import get_orchestrator as get_local
        from app.services.agent_service import get_agent_service
        from types import SimpleNamespace

        agent_data = self._agent_store.get(agent_id)
        if not agent_data:
            raise ValueError(f"Agent not found: {agent_id}")

        local = get_local()
        svc = get_agent_service()
        result = await svc.execute_agent(agent_id, context or {})

        return SimpleNamespace(
            agent_id=agent_id,
            goal=goal,
            steps=[],
            final_decision=result.get("should_execute", False),
            all_proofs_pass=all(
                p.get("has_proof") for p in result.get("processor_results", [])
            ),
            total_duration_ms=result.get("total_time_ms", 0),
            llm_tokens_used=0,
            llm_provider_used=agent_data.get("llm_provider_id", "deterministic"),
            llm_fallback_reason=None,
            error=None,
        )


def get_agent_orchestrator() -> AgentOrchestrator:
    """Singleton getter for orchestrator."""
    global _orchestrator
    if not hasattr(get_agent_orchestrator, "_orchestrator"):
        get_agent_orchestrator._orchestrator = AgentOrchestrator()
    return get_agent_orchestrator._orchestrator


# Alias used by agent_builder.py
get_orchestrator = get_agent_orchestrator
