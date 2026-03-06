# Source Generated with Decompyle++
# File: contract_executor.cpython-312.pyc (Python 3.12)

'''
Contract execution adapter for MVP strategy deployment.

Design goals:
- Deterministic behavior by default (record-only mode; no fake tx hashes)
- Optional live submission via `starkli` when explicitly configured
- Stable response shape for API routes
'''
from __future__ import annotations
import asyncio
import hashlib
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from typing import Optional
logger = logging.getLogger(__name__)
_TX_HASH_RE = re.compile('0x[0-9a-fA-F]{64}')

def _u256_parts(value = None):
    low = value % 2 ** 128
    high = value // 2 ** 128
    return (low, high)


def _pool_id_felt(pool_id = None):
    digest = hashlib.sha256(pool_id.encode('utf-8')).digest()
    return int.from_bytes(digest, 'big') % 2 ** 251


def _extract_tx_hash(output = None):
    if not output:
        output
    match = _TX_HASH_RE.search('')
    if match:
        return match.group(0)

ExecutionResult = <NODE:12>()

class ContractExecutor:
    
    def __init__(self = None):
        if not os.getenv('EXECUTOR_RPC_URL'):
            os.getenv('EXECUTOR_RPC_URL')
        self.rpc_url = os.getenv('STARKNET_RPC_URL', 'http://localhost:5050')
        if not os.getenv('EXECUTOR_ACCOUNT_PATH'):
            os.getenv('EXECUTOR_ACCOUNT_PATH')
        self.account_path = os.getenv('STARKNET_ACCOUNT')
        if not os.getenv('EXECUTOR_PRIVATE_KEY'):
            os.getenv('EXECUTOR_PRIVATE_KEY')
        self.private_key = os.getenv('RELAYER_PRIVATE_KEY')
        if not os.getenv('EXECUTOR_DEPOSIT_CONTRACT'):
            os.getenv('EXECUTOR_DEPOSIT_CONTRACT')
        self.deposit_contract = os.getenv('PROOF_GATED_AGENT_ADDRESS')
        self.deposit_entrypoint = os.getenv('EXECUTOR_DEPOSIT_ENTRYPOINT')
        self.allocation_contract = os.getenv('EXECUTOR_ALLOCATION_CONTRACT')
        self.allocation_entrypoint = os.getenv('EXECUTOR_ALLOCATION_ENTRYPOINT')
        self.live_submit_enabled = os.getenv('EXECUTOR_LIVE_SUBMIT', 'false').lower() == 'true'
        self._starkli = shutil.which('starkli')

    
    def can_submit_live(self = None):
        if self.live_submit_enabled:
            self.live_submit_enabled
            if self._starkli:
                self._starkli
                if self.account_path:
                    self.account_path
        return bool(self.private_key)

    
    async def _invoke(self = None, contract = None, entrypoint = None, calldata = ('contract', 'str', 'entrypoint', 'str', 'calldata', 'list[str]', 'return', 'Optional[str]')):
        pass
    # WARNING: Decompyle incomplete

    
    async def maybe_submit_deposit(self, user_address = None, deposit_amount_wei = None, risk_profile = None, llm_reasoning_hash = ('user_address', 'str', 'deposit_amount_wei', 'int', 'risk_profile', 'str', 'llm_reasoning_hash', 'str', 'return', 'Optional[str]')):
        pass
    # WARNING: Decompyle incomplete

    
    async def maybe_submit_allocation(self = None, pool_id = None, amount_wei = None, protocol = ('pool_id', 'str', 'amount_wei', 'int', 'protocol', 'str', 'return', 'Optional[str]')):
        pass
    # WARNING: Decompyle incomplete

    
    async def execute_deposit_and_allocation(self, user_address, deposit_amount, risk_profile = None, allocation = None, llm_reasoning_hash = None, expected_apy = ('user_address', 'str', 'deposit_amount', 'int', 'risk_profile', 'str', 'allocation', 'dict[str, float]', 'llm_reasoning_hash', 'str', 'expected_apy', 'float', 'return', 'ExecutionResult')):
        pass
    # WARNING: Decompyle incomplete


_EXECUTOR_INSTANCE: 'Optional[ContractExecutor]' = None

def get_executor():
    pass
# WARNING: Decompyle incomplete

