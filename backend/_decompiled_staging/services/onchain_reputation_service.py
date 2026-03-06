# Source Generated with Decompyle++
# File: onchain_reputation_service.cpython-312.pyc (Python 3.12)

'''
On-Chain Reputation Reader — reads ReputationRegistry contract state.

Reads from the deployed ReputationRegistry contract at REPUTATION_REGISTRY_ADDRESS.
Provides real tier info, collateral amounts, user stats, and reputation scores
that the backend currently stores only locally.

Contract: ReputationRegistry (0x10d00b33...)
Uses starknet_py FullNodeClient.call_contract for read-only calls.
'''
from __future__ import annotations
import logging
import os
from dataclasses import dataclass
from typing import Optional
from starknet_py.net.client_models import Call
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.hash.selector import get_selector_from_name
logger = logging.getLogger(__name__)

def _parse_int(val = None):
    val = val.strip()
    if val.startswith('0x'):
        return int(val, 16)
    return None(val)

OnChainReputation = <NODE:12>()
TIER_NAMES = {
    0: 'Strict',
    1: 'Standard',
    2: 'Express' }

class OnChainReputationService:
    '''
    Reads live reputation data directly from the Starknet ReputationRegistry contract.
    '''
    
    def __init__(self):
        self._client = None
        self._registry_address = _parse_int(os.getenv('REPUTATION_REGISTRY_ADDRESS', '0x0'))
        self._rpc_url = os.getenv('STARKNET_RPC_URL', 'http://127.0.0.1:6060')

    
    def _get_client(self = None):
        pass
    # WARNING: Decompyle incomplete

    
    async def _call(self = None, method = None, calldata = None):
        '''Make a read-only contract call.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def get_user_tier(self = None, user_address = None):
        """Get user's proof tier from on-chain."""
        pass
    # WARNING: Decompyle incomplete

    
    async def get_reputation_score(self = None, user_address = None):
        """Get user's ERC-8004 reputation score."""
        pass
    # WARNING: Decompyle incomplete

    
    async def get_user_collateral(self = None, user_address = None):
        """Get user's staked collateral (wei)."""
        pass
    # WARNING: Decompyle incomplete

    
    async def get_user_stats(self = None, user_address = None):
        """Get user's on-chain stats (UserStats struct)."""
        pass
    # WARNING: Decompyle incomplete

    
    async def can_use_relayer(self = None, user_address = None):
        '''Check if user is allowed to use the relayer.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def get_relayer_delay(self = None, user_address = None):
        """Get user's relayer delay in seconds."""
        pass
    # WARNING: Decompyle incomplete

    
    async def get_collaborative_score(self = None, user_address = None):
        """Get user's collaborative score (multiplier bps, graph hash)."""
        pass
    # WARNING: Decompyle incomplete

    
    async def get_full_reputation(self = None, user_address = None):
        '''Get comprehensive on-chain reputation data for a user.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def get_total_users(self = None):
        '''Get total number of registered users.'''
        pass
    # WARNING: Decompyle incomplete


_service: 'OnChainReputationService | None' = None

def get_onchain_reputation_service():
    pass
# WARNING: Decompyle incomplete

