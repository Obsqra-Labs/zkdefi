# Source Generated with Decompyle++
# File: privacy_unified.cpython-312.pyc (Python 3.12)

'''Unified privacy action routes (policy-compiled).'''
from __future__ import annotations
import os
from typing import Any, Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.ekubo_config import EKUBO_ROUTER_SEPOLIA, get_ekubo_chain_id
from app.services.ekubo_execution_service import build_swap_calldata
from app.services.policy_compiler_service import get_policy_compiler_service
from app.services.receipt_service import get_receipt_service
router = APIRouter(prefix = '/privacy', tags = [
    'privacy'])

class PrivacyActionRequest(BaseModel):
    token: 'str' = 'PrivacyActionRequest'
    shared_pool_id: 'str | None' = None
    member_address: 'str | None' = None
    execution_intent: "Literal['manual_wallet', 'orchestrated', 'autonomous', 'session']" = 'manual_wallet'
    wallet_connected: 'bool' = False
    execution_mode: "Literal['wallet', 'orchestrated', 'auto']" = 'auto'
    execute_now: 'bool' = False
    venue: 'str' = 'ekubo'
    withdraw_source: "Literal['vault', 'ai_pool'] | None" = None
    extra_context: 'dict[str, Any]' = Field(default_factory = dict)
    provided_proofs: 'dict[str, str]' = Field(default_factory = dict)


def _enabled():
    return os.getenv('PRIVACY_UNIFIED_ROUTES_ENABLED', 'true').strip().lower() in frozenset({'1', 'on', 'yes', 'true'})


async def _run_action(action_type = None, data = None):
    pass
# WARNING: Decompyle incomplete

privacy_deposit = (lambda data = None: pass# WARNING: Decompyle incomplete
)()
privacy_withdraw = (lambda data = None: pass# WARNING: Decompyle incomplete
)()
