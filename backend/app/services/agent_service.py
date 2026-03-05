"""
Agent Service for zkde.fi - Manages composed agents and execution.

Architecture:
- All agent logic, models, and orchestration lives here in zkde.fi
- Only calls obsqra.fi for STONE proof generation (heavy computation)
"""

import logging
import hashlib
import time
from typing import Dict, Any, List, Optional
from dataclasses import asdict

from app.services.local_orchestrator import get_local_orchestrator
from app.services.json_store import JsonStore

logger = logging.getLogger(__name__)

_agent_store = JsonStore("agents")
_user_agents_store = JsonStore("user_agents")


class AgentService:
    """
    zkde.fi Agent Service - owns all agent logic locally.
    """
    
    def __init__(self):
        self.orchestrator = get_local_orchestrator()
    
    async def create_agent(
        self, 
        user_address: str, 
        name: str, 
        processors: List[str], 
        decision_logic: Dict
    ) -> Dict:
        """Create a new composed agent."""
        agent_id = hashlib.sha256(f"{user_address}{name}{time.time()}".encode()).hexdigest()[:16]
        
        # Validate processors exist
        available_models = {m["id"] for m in self.orchestrator.list_models()}
        invalid = set(processors) - available_models
        if invalid:
            raise ValueError(f"Unknown processors: {invalid}")
        
        agent = {
            "id": agent_id,
            "owner": user_address,
            "name": name,
            "processors": processors,
            "decision_logic": decision_logic,
            "created_at": int(time.time()),
            "active": True
        }
        
        _agent_store.set(agent_id, agent)
        user_ids = _user_agents_store.get(user_address) or []
        if agent_id not in user_ids:
            user_ids.append(agent_id)
            _user_agents_store.set(user_address, user_ids)
        
        logger.info(f"Created agent {agent_id} for user {user_address[:10]}...")
        return agent
    
    async def get_agent(self, agent_id: str) -> Optional[Dict]:
        """Get agent by ID."""
        return _agent_store.get(agent_id)
    
    async def get_user_agents(self, user_address: str) -> List[Dict]:
        """Get all agents for a user."""
        agent_ids = _user_agents_store.get(user_address) or []
        return [a for aid in agent_ids if (a := _agent_store.get(aid)) is not None]
    
    async def execute_agent(
        self, 
        agent_id: str, 
        user_address: str, 
        portfolio: Dict, 
        constraints: Dict
    ) -> Dict:
        """
        Execute an agent - runs all processors via LOCAL orchestrator.
        Only uses obsqra.fi for STONE proof generation.
        """
        agent = await self.get_agent(agent_id)
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")
        if not agent.get("active"):
            raise ValueError(f"Agent {agent_id} is not active")
        
        # Execute via LOCAL orchestrator (not obsqra)
        result = await self.orchestrator.execute_agent(
            processors=agent["processors"],
            decision_logic=agent["decision_logic"],
            user_address=user_address,
            portfolio=portfolio,
            constraints=constraints
        )
        
        # Format response
        processor_results = []
        for pr in result.processor_results:
            processor_results.append({
                "processor_id": pr.processor_id,
                "passed": pr.passed,
                "score": pr.score,
                "threshold": pr.threshold,
                "has_proof": pr.proof_calldata is not None,
                "error": pr.error,
                "execution_time_ms": pr.execution_time_ms
            })
        
        return {
            "agent_id": agent_id,
            "agent_name": agent["name"],
            "should_execute": result.should_execute,
            "decision_logic": result.decision_logic,
            "processor_results": processor_results,
            "execution_calldata": result.execution_calldata,
            "total_time_ms": result.total_time_ms
        }
    
    async def deactivate_agent(self, agent_id: str, user_address: str) -> bool:
        """Deactivate an agent."""
        agent = await self.get_agent(agent_id)
        if not agent:
            return False
        if agent["owner"] != user_address:
            raise ValueError("Not authorized")
        agent["active"] = False
        _agent_store.set(agent_id, agent)
        logger.info(f"Deactivated agent {agent_id}")
        return True
    
    async def list_available_models(self) -> List[Dict]:
        """List all available models (owned by zkde.fi)."""
        return self.orchestrator.list_models()
    
    def get_model_details(self, model_id: str) -> Optional[Dict]:
        """Get detailed info about a model."""
        return self.orchestrator.get_model(model_id)


_service = None

def get_agent_service():
    global _service
    if _service is None:
        _service = AgentService()
    return _service
