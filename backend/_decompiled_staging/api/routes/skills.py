# Source Generated with Decompyle++
# File: skills.cpython-312.pyc (Python 3.12)

'''
Agent Skills API — Expose zkML circuit skills for direct invocation.

Provides:
  GET  /skills           — List all available skills + circuit status
  GET  /skills/{id}      — Get details for a single skill
  POST /skills/{id}/run  — Execute a skill (generate Groth16 proof)
  POST /skills/batch     — Execute multiple skills in parallel
'''
from __future__ import annotations
import logging
from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.agent_skill_service import get_skill_service
logger = logging.getLogger(__name__)
router = APIRouter()

class SkillRunRequest(BaseModel):
    '''Parameters for executing a single skill.'''
    params: 'dict[str, Any]' = Field(default_factory = dict, description = 'Input parameters for the skill')
    user_address: 'str' = Field(default = '0x0', description = 'User Starknet address (hex or int)')


class BatchSkillRequest(BaseModel):
    '''Execute multiple skills in one call.'''
    skill_ids: 'list[str]' = Field(..., description = 'List of skill IDs to execute')
    params: 'dict[str, dict[str, Any]]' = Field(default_factory = dict, description = 'Per-skill params: { skill_id: { ...params } }')
    user_address: 'str' = Field(default = '0x0', description = 'User Starknet address')


class SkillRunResponse(BaseModel):
    skill_id: 'str' = 'SkillRunResponse'
    success: 'bool' = None
    is_compliant: 'bool | None' = None
    proof_hash: 'str | None' = None
    public_signals: 'list[str] | None' = None
    duration_ms: 'int' = 0
    error: 'str | None' = None


def _parse_address(raw = None):
    '''Parse hex or decimal address string to int.'''
    v = raw.strip()
    if v.startswith('0x'):
        return int(v, 16)
    return None(v)
# WARNING: Decompyle incomplete

list_skills = (lambda category = None, max_tier = None: pass# WARNING: Decompyle incomplete
)()
get_skill = (lambda skill_id = None: pass# WARNING: Decompyle incomplete
)()
run_skill = (lambda skill_id = None, body = None: pass# WARNING: Decompyle incomplete
)()
run_skills_batch = (lambda body = None: pass# WARNING: Decompyle incomplete
)()
