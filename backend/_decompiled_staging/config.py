# Source Generated with Decompyle++
# File: config.cpython-312.pyc (Python 3.12)

'''
Minimal runtime config for services that import `app.config`.

This keeps legacy imports stable while values are sourced directly from env.
'''
from __future__ import annotations
import os

def _first_env(*, default, *names):
    pass
# WARNING: Decompyle incomplete

STARKNET_RPC_URL = _first_env('STARKNET_RPC_URL', 'STARKNET_RPC_URL_V08', default = 'https://starknet-sepolia-rpc.publicnode.com')
STARKNET_CHAIN_ID = _first_env('STARKNET_CHAIN_ID', 'EKUBO_CHAIN_ID', default = 'sepolia')
FULLY_SHIELDED_POOL_ADDRESS = _first_env('FULLY_SHIELDED_POOL_ADDRESS', 'FULL_PRIVACY_POOL_V2_ADDRESS', 'NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS', 'NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS')
CONFIDENTIAL_TRANSFER_ADDRESS = _first_env('CONFIDENTIAL_TRANSFER_ADDRESS', 'NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS')
TIER2H_ESCROW_ADDRESS = _first_env('TIER2H_ESCROW_ADDRESS', 'NEXT_PUBLIC_TIER2H_ESCROW_ADDRESS')
HASHED_WITHDRAW_POOL_ADDRESS = _first_env('HASHED_WITHDRAW_POOL_ADDRESS', 'NEXT_PUBLIC_HASHED_WITHDRAW_POOL_ADDRESS')
LEDGER_PAYOUT_MODE = _first_env('LEDGER_PAYOUT_MODE', default = 'onchain')
