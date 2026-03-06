# Source Generated with Decompyle++
# File: shared_pools.cpython-312.pyc (Python 3.12)

'''Shared pool API routes (manager envelope + member overrides).'''
from __future__ import annotations
import os
from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.shared_pool_executor import get_shared_pool_executor
from app.services.shared_pool_service import get_shared_pool_service
router = APIRouter(prefix = '/shared_pools', tags = [
    'shared_pools'])

class CreateSharedPoolRequest(BaseModel):
    manager_address: 'str' = 'CreateSharedPoolRequest'
    shared_pool_id: 'str | None' = None
    envelope: 'dict[str, Any]' = Field(default_factory = dict)
    metadata: 'dict[str, Any]' = Field(default_factory = dict)


class UpdateEnvelopeRequest(BaseModel):
    envelope: 'dict[str, Any]' = Field(default_factory = dict)


class JoinSharedPoolRequest(BaseModel):
    member_address: 'str' = 'JoinSharedPoolRequest'
    member_override: 'dict[str, Any]' = Field(default_factory = dict)
    autopilot_opt_in: 'bool' = False
    session_scope: 'dict[str, Any]' = Field(default_factory = dict)


class UpdateMemberRequest(BaseModel):
    member_override: 'dict[str, Any] | None' = None
    autopilot_opt_in: 'bool | None' = None
    session_scope: 'dict[str, Any] | None' = None


class CreateProposalRequest(BaseModel):
    manager_address: 'str' = 'CreateProposalRequest'
    payload: 'dict[str, Any]' = Field(default_factory = dict)


class ExecuteProposalRequest(BaseModel):
    member_address: 'str' = 'ExecuteProposalRequest'
    execution_intent: 'str' = 'autonomous'
    wallet_connected: 'bool' = False


def _enabled():
    return os.getenv('SHARED_POOLS_V1_ENABLED', 'true').strip().lower() in frozenset({'1', 'on', 'yes', 'true'})

create_shared_pool = (lambda data = None: pass# WARNING: Decompyle incomplete
)()
get_shared_pool = (lambda shared_pool_id = None: pass# WARNING: Decompyle incomplete
)()
put_shared_pool_envelope = (lambda shared_pool_id = None, data = None: pass# WARNING: Decompyle incomplete
)()
join_shared_pool = (lambda shared_pool_id = None, data = None: pass# WARNING: Decompyle incomplete
)()
put_shared_pool_member = (lambda shared_pool_id = None, member_address = None, data = router.put('/{shared_pool_id}/member/{member_address}'): pass# WARNING: Decompyle incomplete
)()
create_shared_pool_proposal = (lambda shared_pool_id = None, data = None: pass# WARNING: Decompyle incomplete
)()
execute_shared_pool_proposal = (lambda shared_pool_id = None, data = None: pass# WARNING: Decompyle incomplete
)()
