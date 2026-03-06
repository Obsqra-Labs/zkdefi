# Source Generated with Decompyle++
# File: native_staking.cpython-312.pyc (Python 3.12)

__doc__ = '\nStarknet Native Delegated Staking Service (Sepolia).\n\nIntegrates with the official Starknet staking contract on Sepolia:\n  Contract: 0x03745ab04a431fc02871a139be6b93d9260b0ff3e779ad9c8b377183b23109f1\n  Interfaces: IStaking, IStakingPool\n\nFor regular users, delegation works via Pool contracts created by stakers.\nThis service:\n  1. Reads on-chain staking state (total_stake, epoch, staker_info)\n  2. Lists available delegation pools (via event scanning / known pools)\n  3. Builds multicall transactions for enter_delegation_pool / claim / exit \n  4. Returns calldata for frontend wallet signing (no private keys needed)\n'
from __future__ import annotations
import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import httpx
logger = logging.getLogger(__name__)
STAKING_CONTRACT = '0x03745ab04a431fc02871a139be6b93d9260b0ff3e779ad9c8b377183b23109f1'
STRK_TOKEN = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
RPC_URL = 'https://api.cartridge.gg/x/starknet/sepolia'
from Crypto.Hash import keccak as _keccak_mod

def _keccak256(data = None):
    k = _keccak_mod.new(digest_bits = 256)
    k.update(data)
    return k.digest()


def sn_keccak(name = None):
    '''Compute Starknet selector for a function name.'''
    h = int.from_bytes(_keccak256(name.encode()), 'big')
    return hex(h % 2 ** 250)

SEL_GET_TOTAL_STAKE = sn_keccak('get_total_stake')
SEL_GET_CURRENT_EPOCH = sn_keccak('get_current_epoch')
SEL_GET_EPOCH_INFO = sn_keccak('get_epoch_info')
SEL_IS_PAUSED = sn_keccak('is_paused')
SEL_STAKER_INFO_V1 = sn_keccak('staker_info_v1')
SEL_CONTRACT_PARAMS = sn_keccak('contract_parameters_v1')
SEL_GET_STAKER_INFO = sn_keccak('get_staker_info_v1')
SEL_ENTER_DELEGATION_POOL = sn_keccak('enter_delegation_pool')
SEL_EXIT_DELEGATION_POOL_INTENT = sn_keccak('exit_delegation_pool_intent')
SEL_EXIT_DELEGATION_POOL_ACTION = sn_keccak('exit_delegation_pool_action')
SEL_CLAIM_REWARDS = sn_keccak('claim_rewards')
SEL_POOL_MEMBER_INFO = sn_keccak('pool_member_info')
SEL_APPROVE = sn_keccak('approve')
SEL_BALANCE_OF = sn_keccak('balance_of')
StakingOverview = <NODE:12>()
DelegationPool = <NODE:12>()
DelegationPosition = <NODE:12>()
_overview_cache: 'Optional[StakingOverview]' = None
_overview_cache_ts: 'float' = 0
OVERVIEW_CACHE_TTL = 30
_known_pools: 'List[DelegationPool]' = []
_pools_cache_ts: 'float' = 0
POOLS_CACHE_TTL = 120

async def _rpc_call(method = dataclass, params = dataclass):
    '''Make a JSON-RPC call to Starknet Sepolia.'''
    pass
# WARNING: Decompyle incomplete


async def _call_contract(contract = None, selector = None, calldata = None):
    '''Call a Starknet contract view function.'''
    pass
# WARNING: Decompyle incomplete


def _felt_to_int(hex_str = None):
    return int(hex_str, 16)


def _int_to_felt(val = None):
    return hex(val)


def _address_to_felt(addr = None):
    '''Normalize address to felt for calldata.'''
    return addr


async def get_staking_overview():
    '''Get global staking statistics from the on-chain contract.'''
    pass
# WARNING: Decompyle incomplete


async def get_strk_balance(user_address = None):
    '''Get STRK token balance for a user.'''
    pass
# WARNING: Decompyle incomplete


async def get_delegation_pools():
    '''Get list of known delegation pools on Sepolia.
    
    Since event scanning is expensive, we maintain a curated list that can
    be extended via admin endpoints or event indexing.
    '''
    pass
# WARNING: Decompyle incomplete


async def get_user_delegation_positions(user_address = None):
    """Get a user's delegation positions across known pools.
    
    For each known pool contract, we call pool_member_info(user_address).
    If the user hasn't delegated to that pool, it will return zeros/error.
    """
    pass
# WARNING: Decompyle incomplete


def build_delegate_calldata(pool_contract = None, amount_wei = None, reward_address = None):
    '''Build multicall for delegating STRK to a staking pool.
    
    Steps:
    1. Approve STRK token spend by pool contract
    2. Call enter_delegation_pool on the pool contract
    
    Returns list of Call objects for the frontend to execute via wallet.
    '''
    amount_low = hex(amount_wei & (1 << 128) - 1)
    amount_high = hex(amount_wei >> 128)
    calls = [
        {
            'contractAddress': STRK_TOKEN,
            'entrypoint': 'approve',
            'calldata': [
                pool_contract,
                amount_low,
                amount_high] },
        {
            'contractAddress': pool_contract,
            'entrypoint': 'enter_delegation_pool',
            'calldata': [
                reward_address,
                amount_low,
                amount_high] }]
    return calls


def build_claim_rewards_calldata(pool_contract = None, user_address = None):
    '''Build calldata for claiming delegation rewards.'''
    return [
        {
            'contractAddress': pool_contract,
            'entrypoint': 'claim_rewards',
            'calldata': [
                user_address] }]


def build_exit_intent_calldata(pool_contract = None, amount_wei = None):
    '''Build calldata for exit delegation intent (starts cooldown).'''
    amount_low = hex(amount_wei & (1 << 128) - 1)
    amount_high = hex(amount_wei >> 128)
    return [
        {
            'contractAddress': pool_contract,
            'entrypoint': 'exit_delegation_pool_intent',
            'calldata': [
                amount_low,
                amount_high] }]


def build_exit_action_calldata(pool_contract = None):
    '''Build calldata for completing exit (after cooldown).'''
    return [
        {
            'contractAddress': pool_contract,
            'entrypoint': 'exit_delegation_pool_action',
            'calldata': [] }]


async def get_staking_dashboard(user_address = None):
    '''Aggregated staking dashboard data for the frontend.'''
    pass
# WARNING: Decompyle incomplete

return None
# WARNING: Decompyle incomplete
