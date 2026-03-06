# Source Generated with Decompyle++
# File: agent_builder.cpython-312.pyc (Python 3.12)

'''
Agent Builder API — Create, manage, and execute identity-bound agents.

Endpoints:
  POST   /agents/build          — Create a new agent with skills + LLM binding
  GET    /agents/list            — List agents for an owner
  GET    /agents/{id}            — Get agent details
  POST   /agents/{id}/execute    — Execute a goal via the orchestrator
  GET    /agents/{id}/performance — Get performance history
  GET    /skills                 — List available skills
  GET    /skills/{id}/schema     — Get skill parameter schema
  GET    /providers              — List LLM providers
  POST   /providers/bind         — Bind an agent to an LLM provider
  GET    /leaderboard            — Get agent leaderboard
'''
from __future__ import annotations
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.agent_orchestrator import get_orchestrator, AgentConfig
from app.services.agent_skill_service import get_skill_service, SKILL_DEFINITIONS
from app.services.llm_provider_registry import get_llm_registry
from app.services.agent_performance_service import get_performance_service, PeriodPerformance
logger = logging.getLogger(__name__)
router = APIRouter()

class BuildAgentRequest(BaseModel):
    owner_address: 'str' = 'BuildAgentRequest'
    identity_commitment: 'str' = '0'
    skills: 'list[str]' = []
    llm_provider: 'str' = 'onyx'
    llm_model: 'str | None' = None


class BuildAgentResponse(BaseModel):
    llm_config_hash: 'str' = 'BuildAgentResponse'
    onchain_tx: 'str | None' = None


class ExecuteGoalRequest(BaseModel):
    goal: 'str' = 'ExecuteGoalRequest'
    context: 'dict | None' = None


class BindProviderRequest(BaseModel):
    provider_id: 'str' = 'BindProviderRequest'


class UpdateAgentRequest(BaseModel):
    name: 'str | None' = None
    skills: 'list[str] | None' = None
    llm_provider: 'str | None' = None
    llm_model: 'str | None' = None
    active: 'bool | None' = None


class RecordPerformanceRequest(BaseModel):
    period_id: 'str' = 'RecordPerformanceRequest'
    return_bps: 'int' = 0
    volume: 'int' = 0
    proof_count: 'int' = 0
    successful_actions: 'int' = 0
    failed_actions: 'int' = 0
    max_drawdown_bps: 'int' = 0

build_agent = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
list_agents = (lambda owner = None: pass# WARNING: Decompyle incomplete
)()
get_agent = (lambda agent_id = None: pass# WARNING: Decompyle incomplete
)()
update_agent = (lambda agent_id = None, req = None: pass# WARNING: Decompyle incomplete
)()
delete_agent = (lambda agent_id = None: pass# WARNING: Decompyle incomplete
)()
execute_goal = (lambda agent_id = None, req = None: pass# WARNING: Decompyle incomplete
)()
list_skills = (lambda category = None: pass# WARNING: Decompyle incomplete
)()
get_skill = (lambda skill_id = None: pass# WARNING: Decompyle incomplete
)()
execute_skill = (lambda skill_id = None, body = None: pass# WARNING: Decompyle incomplete
)()
list_providers = (lambda : pass# WARNING: Decompyle incomplete
)()
bind_provider = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
get_performance = (lambda agent_id = None, periods = None: pass# WARNING: Decompyle incomplete
)()
record_performance = (lambda agent_id = None, req = None: pass# WARNING: Decompyle incomplete
)()
get_leaderboard = (lambda sort_by = None, limit = None: pass# WARNING: Decompyle incomplete
)()
get_reputation_witness = (lambda agent_id = None: pass# WARNING: Decompyle incomplete
)()
get_performance_witness = (lambda agent_id = None, num_periods = None: pass# WARNING: Decompyle incomplete
)()
provider_health = (lambda : pass# WARNING: Decompyle incomplete
)()
