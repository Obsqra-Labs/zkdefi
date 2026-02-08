"""
Circomlib-compatible Poseidon hash implementation.

Uses Node.js + circomlibjs to ensure exact compatibility with the circuits.
This is critical for merkle tree operations and commitment generation.

IMPORTANT: BN128 Poseidon can output values > Starknet felt252.
           Use ensure_fits_felt252() to check, and retry with different
           inputs if needed.
"""
import subprocess
import json
from pathlib import Path
from functools import lru_cache
from typing import List

CIRCUITS_DIR = Path("/opt/obsqra.starknet/zkdefi/circuits")

# Field primes
BN128_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617
STARK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001


def poseidon_hash(*inputs: int) -> int:
    """
    Compute Poseidon hash using circomlibjs (BN128 field).
    
    WARNING: Result may exceed STARK_PRIME. Use ensure_fits_felt252() to check.
    """
    if len(inputs) == 0:
        raise ValueError("poseidon_hash requires at least one input")
    
    inputs_json = json.dumps([str(i) for i in inputs])
    
    node_script = f'''
const {{ buildPoseidon }} = require("circomlibjs");

async function main() {{
    const poseidon = await buildPoseidon();
    const inputs = {inputs_json}.map(s => BigInt(s));
    const hash = poseidon.F.toString(poseidon(inputs));
    console.log(hash);
}}

main().catch(e => {{ console.error(e); process.exit(1); }});
'''
    
    result = subprocess.run(
        ['node', '-e', node_script],
        capture_output=True,
        text=True,
        cwd=str(CIRCUITS_DIR),
        timeout=30,
        env={"PATH": "/usr/bin:/usr/local/bin:/bin", "HOME": "/root", "NODE_PATH": str(CIRCUITS_DIR / "node_modules")},
    )
    
    if result.returncode != 0:
        raise RuntimeError(f"Poseidon hash failed (exit={result.returncode}): stdout={result.stdout}, stderr={result.stderr}")
    
    return int(result.stdout.strip())


def poseidon_hash_two(left: int, right: int) -> int:
    """Hash exactly two elements."""
    return poseidon_hash(left, right)


def poseidon_hash_many(inputs: List[int]) -> int:
    """Hash a list of elements."""
    return poseidon_hash(*inputs)


def ensure_fits_felt252(value: int) -> bool:
    """Check if a value fits in Starknet felt252."""
    return 0 <= value < STARK_PRIME


@lru_cache(maxsize=32)
def poseidon_zero_hash(level: int) -> int:
    """Get the zero hash for a given merkle tree level."""
    if level == 0:
        return 0
    prev = poseidon_zero_hash(level - 1)
    return poseidon_hash_two(prev, prev)


if __name__ == "__main__":
    print("Testing circomlib-compatible Poseidon...")
    h2 = poseidon_hash(1, 2)
    h5 = poseidon_hash(1, 2, 3, 4, 5)
    print(f"poseidon(1, 2) = {h2}")
    print(f"poseidon(1, 2, 3, 4, 5) = {h5}")
    print(f"Fits in felt252? {ensure_fits_felt252(h2)}, {ensure_fits_felt252(h5)}")
