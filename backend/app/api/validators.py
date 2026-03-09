"""Shared validation helpers for API request models."""

import re
from pydantic import field_validator

STARKNET_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{1,64}$")
HEX_RE = re.compile(r"^0x[0-9a-fA-F]+$")
ALLOWED_TOKENS = {"ETH", "USDC", "USDT", "DAI", "STRK", "WBTC", "STRKBTC"}
MAX_WEI = 10**30  # ~1 trillion ETH equivalent


def validate_starknet_address(v: str) -> str:
    if not STARKNET_ADDRESS_RE.match(v):
        raise ValueError("Invalid Starknet address format (expected 0x-prefixed hex, 1-64 chars)")
    return v.lower()


def validate_hex_string(v: str) -> str:
    if not HEX_RE.match(v):
        raise ValueError("Invalid hex string (expected 0x-prefixed hex)")
    return v.lower()


def validate_token_symbol(v: str) -> str:
    upper = v.upper()
    if upper not in ALLOWED_TOKENS:
        raise ValueError(f"Unsupported token: {v}. Allowed: {', '.join(sorted(ALLOWED_TOKENS))}")
    return upper


def validate_wei_amount(v: int) -> int:
    if v <= 0:
        raise ValueError("Amount must be positive")
    if v > MAX_WEI:
        raise ValueError(f"Amount exceeds maximum ({MAX_WEI})")
    return v


def validate_usd_amount(v: int) -> int:
    if v <= 0:
        raise ValueError("USD amount must be positive")
    if v > 100_000_000:
        raise ValueError("USD amount exceeds $100M maximum")
    return v
