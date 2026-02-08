"""
Fix for Starknet felt252 compatibility.

The issue: BN128 Poseidon can return values > STARK_PRIME.
The fix: Retry with different inputs until we get a valid value.

This is done by incrementing the nonce/blinding until the commitment fits.
"""

STARK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001

def ensure_starknet_compatible(value: int) -> bool:
    """Check if a value fits in Starknet felt252."""
    return value < STARK_PRIME
