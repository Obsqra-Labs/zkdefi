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

logger = logging.getLogger(__name__)

_agents: Dict[str, Dict] = {}
_user_agents: Dict[str, List[str]] = {}

LLM_PROVIDER_CATALOG: Dict[str, Dict[str, Any]] = {
    "openai": {
        "provider_id": "openai",
        "name": "OpenAI",
        "description": "OpenAI Chat Completions API",
        "default_model": "gpt-4o-mini",
        "models": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o3-mini"],
        "requires_api_key_env": True,
        "api_key_env": "OPENAI_API_KEY",
        "requires_base_url": False,
        "base_url": "",
        "defaults": {"temperature": 0.2, "max_tokens": 1024, "top_p": 1.0},
    },
    "anthropic": {
        "provider_id": "anthropic",
        "name": "Anthropic",
        "description": "Anthropic Messages API",
        "default_model": "claude-3-7-sonnet-latest",
        "models": ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
        "requires_api_key_env": True,
        "api_key_env": "ANTHROPIC_API_KEY",
        "requires_base_url": False,
        "base_url": "",
        "defaults": {"temperature": 0.2, "max_tokens": 1024, "top_p": 1.0},
    },
    "claude": {
        "provider_id": "claude",
        "name": "Claude",
        "description": "Claude model family configuration",
        "default_model": "claude-3-7-sonnet-latest",
        "models": ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
        "requires_api_key_env": True,
        "api_key_env": "ANTHROPIC_API_KEY",
        "requires_base_url": False,
        "base_url": "",
        "defaults": {"temperature": 0.2, "max_tokens": 1024, "top_p": 1.0},
    },
    "local": {
        "provider_id": "local",
        "name": "Local / OpenAI-Compatible",
        "description": "Local endpoint such as Ollama or vLLM",
        "default_model": "llama3.1:8b",
        "models": ["llama3.1:8b", "mistral:7b", "qwen2.5:7b"],
        "requires_api_key_env": False,
        "api_key_env": "",
        "requires_base_url": True,
        "base_url": "http://localhost:11434/v1",
        "defaults": {"temperature": 0.2, "max_tokens": 1024, "top_p": 1.0},
    },
    "deterministic": {
        "provider_id": "deterministic",
        "name": "Deterministic Fallback",
        "description": "No external LLM call; deterministic decision path",
        "default_model": "deterministic-v1",
        "models": ["deterministic-v1"],
        "requires_api_key_env": False,
        "api_key_env": "",
        "requires_base_url": False,
        "base_url": "",
        "defaults": {"temperature": 0.0, "max_tokens": 512, "top_p": 1.0},
    },
}


class AgentService:
    """
    zkde.fi Agent Service - owns all agent logic locally.
    """
    
    def __init__(self):
        self.orchestrator = get_local_orchestrator()

    @staticmethod
    def _clamp_float(value: Any, minimum: float, maximum: float, fallback: float) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return fallback
        return max(minimum, min(maximum, parsed))

    @staticmethod
    def _clamp_int(value: Any, minimum: int, maximum: int, fallback: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return fallback
        return max(minimum, min(maximum, parsed))

    def _normalize_llm_config(self, llm_config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        payload = llm_config or {}
        provider_id = str(payload.get("provider") or "deterministic").strip().lower()
        provider = LLM_PROVIDER_CATALOG.get(provider_id)
        if not provider:
            available = sorted(LLM_PROVIDER_CATALOG.keys())
            raise ValueError(f"Unknown LLM provider: {provider_id}. Available: {available}")

        defaults = provider["defaults"]
        model = str(payload.get("model") or provider["default_model"]).strip()
        if not model:
            model = provider["default_model"]

        normalized: Dict[str, Any] = {
            "provider": provider_id,
            "model": model,
            "temperature": self._clamp_float(payload.get("temperature"), 0.0, 2.0, float(defaults["temperature"])),
            "max_tokens": self._clamp_int(payload.get("max_tokens"), 64, 8192, int(defaults["max_tokens"])),
            "top_p": self._clamp_float(payload.get("top_p"), 0.0, 1.0, float(defaults["top_p"])),
        }

        api_key_env = str(payload.get("api_key_env") or provider.get("api_key_env") or "").strip().upper()
        if provider["requires_api_key_env"]:
            if not api_key_env:
                raise ValueError(f"Provider {provider_id} requires api_key_env")
            normalized["api_key_env"] = api_key_env
        elif api_key_env:
            normalized["api_key_env"] = api_key_env

        base_url = str(payload.get("base_url") or provider.get("base_url") or "").strip()
        if provider["requires_base_url"]:
            if not base_url:
                raise ValueError(f"Provider {provider_id} requires base_url")
            normalized["base_url"] = base_url
        elif base_url:
            normalized["base_url"] = base_url

        return normalized
    
    async def create_agent(
        self, 
        user_address: str, 
        name: str, 
        processors: List[str], 
        decision_logic: Dict,
        llm_config: Optional[Dict[str, Any]] = None,
    ) -> Dict:
        """Create a new composed agent."""
        agent_id = hashlib.sha256(f"{user_address}{name}{time.time()}".encode()).hexdigest()[:16]
        
        # Validate processors exist
        available_models = {m["id"] for m in self.orchestrator.list_models()}
        invalid = set(processors) - available_models
        if invalid:
            raise ValueError(f"Unknown processors: {invalid}")

        normalized_llm = self._normalize_llm_config(llm_config)
        
        agent = {
            "id": agent_id,
            "owner": user_address,
            "name": name,
            "processors": processors,
            "decision_logic": decision_logic,
            "llm": normalized_llm,
            "created_at": int(time.time()),
            "active": True
        }
        
        _agents[agent_id] = agent
        if user_address not in _user_agents:
            _user_agents[user_address] = []
        _user_agents[user_address].append(agent_id)
        
        logger.info(f"Created agent {agent_id} for user {user_address[:10]}...")
        return agent
    
    async def get_agent(self, agent_id: str) -> Optional[Dict]:
        """Get agent by ID."""
        return _agents.get(agent_id)
    
    async def get_user_agents(self, user_address: str) -> List[Dict]:
        """Get all agents for a user."""
        agent_ids = _user_agents.get(user_address, [])
        return [_agents[aid] for aid in agent_ids if aid in _agents]
    
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

        response = {
            "agent_id": agent_id,
            "agent_name": agent["name"],
            "should_execute": result.should_execute,
            "decision_logic": result.decision_logic,
            "processor_results": processor_results,
            "execution_calldata": result.execution_calldata,
            "total_time_ms": result.total_time_ms
        }

        # Run LLM decision if agent has a non-deterministic LLM provider
        llm_config = agent.get("llm", {})
        if llm_config.get("provider", "deterministic") != "deterministic":
            try:
                llm_result = await self.orchestrator.run_llm_decision(
                    llm_config=llm_config,
                    processor_results=result.processor_results,
                    portfolio=portfolio,
                    agent_skills=agent.get("processors"),
                )
                response["llm_decision"] = llm_result
            except Exception as e:
                logger.warning(f"LLM decision step failed for agent {agent_id}: {e}")

        return response
    
    async def deactivate_agent(self, agent_id: str, user_address: str) -> bool:
        """Deactivate an agent."""
        agent = await self.get_agent(agent_id)
        if not agent:
            return False
        if agent["owner"] != user_address:
            raise ValueError("Not authorized")
        agent["active"] = False
        logger.info(f"Deactivated agent {agent_id}")
        return True
    
    async def list_available_models(self) -> List[Dict]:
        """List all available models (owned by zkde.fi)."""
        return self.orchestrator.list_models()

    async def list_llm_providers(self) -> List[Dict]:
        """List available LLM providers and defaults for builder UIs."""
        providers: List[Dict[str, Any]] = []
        for provider in LLM_PROVIDER_CATALOG.values():
            providers.append(
                {
                    "provider_id": provider["provider_id"],
                    "name": provider["name"],
                    "description": provider["description"],
                    "default_model": provider["default_model"],
                    "models": provider["models"],
                    "requires_api_key_env": provider["requires_api_key_env"],
                    "requires_base_url": provider["requires_base_url"],
                    "api_key_env": provider["api_key_env"],
                    "base_url": provider["base_url"],
                    "defaults": provider["defaults"],
                }
            )
        return providers
    
    def get_model_details(self, model_id: str) -> Optional[Dict]:
        """Get detailed info about a model."""
        return self.orchestrator.get_model(model_id)


_service = None

def get_agent_service():
    global _service
    if _service is None:
        _service = AgentService()
    return _service
