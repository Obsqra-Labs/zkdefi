"""
Minimal runtime config for services that import `app.config`.

This keeps legacy imports stable while values are sourced directly from env.
"""
from __future__ import annotations

import os


def _first_env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value is not None and str(value).strip() != "":
            return value
    return default


# Network defaults
STARKNET_RPC_URL = _first_env(
    "STARKNET_RPC_URL",
    "STARKNET_RPC_URL_V08",
    default="https://rpc.starknet.lava.build:443",
)
STARKNET_CHAIN_ID = _first_env("STARKNET_CHAIN_ID", "EKUBO_CHAIN_ID", default="0x534e5f4d41494e")

# Contract addresses used by relayer runner
FULLY_SHIELDED_POOL_ADDRESS = _first_env(
    "FULLY_SHIELDED_POOL_ADDRESS",
    "FULL_PRIVACY_POOL_V2_ADDRESS",
    "NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS",
    "NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS",
)
CONFIDENTIAL_TRANSFER_ADDRESS = _first_env(
    "CONFIDENTIAL_TRANSFER_ADDRESS",
    "NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS",
)
TIER2H_ESCROW_ADDRESS = _first_env(
    "TIER2H_ESCROW_ADDRESS",
    "NEXT_PUBLIC_TIER2H_ESCROW_ADDRESS",
)
HASHED_WITHDRAW_POOL_ADDRESS = _first_env(
    "HASHED_WITHDRAW_POOL_ADDRESS",
    "NEXT_PUBLIC_HASHED_WITHDRAW_POOL_ADDRESS",
)

# Claim settlement mode: "onchain" or "internal"
LEDGER_PAYOUT_MODE = _first_env("LEDGER_PAYOUT_MODE", default="onchain")
