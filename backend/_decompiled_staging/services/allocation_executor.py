# Source Generated with Decompyle++
# File: allocation_executor.cpython-312.pyc (Python 3.12)

'''
Allocation execution service.

Normalizes strategy allocations and optionally submits live protocol calls via
`ContractExecutor`. When live submission is not configured, it records a
deterministic "recorded" execution status (no fake tx hashes).
'''
from __future__ import annotations
import logging
from dataclasses import dataclass
from typing import Any, Optional
from app.services.contract_executor import ContractExecutor, get_executor
from app.services.real_pool_aggregator import EkuboPoolAggregator
logger = logging.getLogger(__name__)

def _as_float(value = None, default = None):
    pass
# WARNING: Decompyle incomplete

AllocationExecution = <NODE:12>()

class AllocationExecutor:
    
    def __init__(self = None, executor = None, aggregator = None):
        if not executor:
            executor
        self.executor = get_executor()
        if not aggregator:
            aggregator
        self.aggregator = EkuboPoolAggregator()

    
    async def execute_allocations(self = None, user_address = None, allocations = None):
        pass
    # WARNING: Decompyle incomplete


_ALLOCATION_EXECUTOR: 'Optional[AllocationExecutor]' = None

def get_allocation_executor():
    pass
# WARNING: Decompyle incomplete

