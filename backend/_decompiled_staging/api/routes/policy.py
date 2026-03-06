# Source Generated with Decompyle++
# File: policy.cpython-312.pyc (Python 3.12)

'''Vault policy + compile API routes.'''
from __future__ import annotations
import os
from typing import Any, Literal
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from middleware.auth import require_wallet_owner, require_admin
from app.services.policy_compiler_service import get_policy_compiler_service
from app.services.receipt_service import get_receipt_service
from app.services.session_key_service import get_session_service
from app.services.shared_pool_service import get_shared_pool_service
from app.services.vault_policy_service import get_vault_policy_service
from app.api.routes.onboarding import clear_onboarding_state
router = APIRouter(prefix = '/policy', tags = [
    'policy'])

class VaultPolicyPutRequest(BaseModel):
    patch: 'dict[str, Any]' = Field(default_factory = dict)


class PolicyCompileRequest(BaseModel):
    user_address: 'str' = 'PolicyCompileRequest'
    action_type: "Literal['deposit', 'withdraw', 'swap', 'lp_add', 'lp_remove', 'deploy', 'rebalance']" = 'deposit'
    execution_intent: "Literal['manual_wallet', 'orchestrated', 'autonomous', 'session']" = 'manual_wallet'
    wallet_connected: 'bool' = False
    shared_pool_id: 'str | None' = None
    member_address: 'str | None' = None
    context: 'dict[str, Any]' = Field(default_factory = dict)


class PolicyPreviewRequest(PolicyCompileRequest):
    pass


def _enabled():
    return os.getenv('VAULT_POLICY_V1_ENABLED', 'true').strip().lower() in frozenset({'1', 'on', 'yes', 'true'})


def _reset_enabled():
    explicit = os.getenv('DEV_STATE_RESET_ENABLED', '').strip().lower()
    if explicit in frozenset({'1', 'on', 'yes', 'true'}):
        return True
    app_env = os.getenv('APP_ENV', 'development').strip().lower()
    return app_env != 'production'


async def _decision_context(user_address = None, request = None):
    pass
# WARNING: Decompyle incomplete

get_vault_policy = (lambda user_address = None: pass# WARNING: Decompyle incomplete
)()
put_vault_policy = (lambda user_address = None, data = None, _caller = router.put('/vault/{user_address}'): pass# WARNING: Decompyle incomplete
)()
compile_policy = (lambda data = None, request = None: pass# WARNING: Decompyle incomplete
)()
preview_policy = (lambda data = None, request = None: pass# WARNING: Decompyle incomplete
)()
reset_user_policy_state = (lambda user_address = None, _admin = None: pass# WARNING: Decompyle incomplete
)()
