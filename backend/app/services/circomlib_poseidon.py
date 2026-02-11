"""
Circomlib-compatible Poseidon hash implementation.

Uses a long-lived Node.js child process that stays warm to avoid
per-hash startup overhead (~1s per hash → <1ms per hash).

IMPORTANT: BN128 Poseidon can output values > Starknet felt252.
           Use ensure_fits_felt252() to check, and retry with different
           inputs if needed.
"""
import subprocess
import json
import os
import threading
from pathlib import Path
from functools import lru_cache
from typing import List, Optional

CIRCUITS_DIR = Path("/opt/obsqra.starknet/zkdefi/circuits")

# Field primes
BN128_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617
STARK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001


# ---------------------------------------------------------------------------
# Persistent Node.js Poseidon worker
# ---------------------------------------------------------------------------

_NODE_SCRIPT = r'''
const { buildPoseidon } = require("circomlibjs");
const readline = require("readline");

(async () => {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
        try {
            const inputs = JSON.parse(line).map(s => BigInt(s));
            const hash = F.toString(poseidon(inputs));
            process.stdout.write(hash + "\n");
        } catch (e) {
            process.stdout.write("ERROR:" + e.message + "\n");
        }
    });
    // Signal ready
    process.stdout.write("READY\n");
})();
'''

_lock = threading.Lock()
_proc: Optional[subprocess.Popen] = None


def _get_worker() -> subprocess.Popen:
    """Get or start the persistent Poseidon Node.js worker."""
    global _proc
    if _proc is not None and _proc.poll() is None:
        return _proc

    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/usr/local/bin:/bin"),
        "HOME": os.environ.get("HOME", "/root"),
        "NODE_PATH": str(CIRCUITS_DIR / "node_modules"),
    }
    _proc = subprocess.Popen(
        ['node', '-e', _NODE_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(CIRCUITS_DIR),
        env=env,
    )
    # Wait for READY signal
    ready = _proc.stdout.readline().strip()
    if ready != "READY":
        _proc.kill()
        raise RuntimeError(f"Poseidon worker failed to start: {ready}")
    return _proc


def _poseidon_via_worker(inputs: list[str]) -> int:
    """Send inputs to the worker and read result."""
    with _lock:
        proc = _get_worker()
        line = json.dumps(inputs) + "\n"
        proc.stdin.write(line)
        proc.stdin.flush()
        result = proc.stdout.readline().strip()
        if result.startswith("ERROR:"):
            raise RuntimeError(f"Poseidon hash failed: {result}")
        return int(result)


def poseidon_hash(*inputs: int) -> int:
    """
    Compute Poseidon hash using circomlibjs (BN128 field).
    
    WARNING: Result may exceed STARK_PRIME. Use ensure_fits_felt252() to check.
    """
    if len(inputs) == 0:
        raise ValueError("poseidon_hash requires at least one input")
    return _poseidon_via_worker([str(i) for i in inputs])


def poseidon_hash_two(left: int, right: int) -> int:
    """Hash exactly two elements."""
    return _poseidon_via_worker([str(left), str(right)])


def poseidon_hash_many(inputs: List[int]) -> int:
    """Hash a list of elements."""
    return _poseidon_via_worker([str(i) for i in inputs])


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
    import time
    print("Testing circomlib-compatible Poseidon (persistent worker)...")
    start = time.time()
    h2 = poseidon_hash(1, 2)
    first = time.time() - start
    print(f"poseidon(1, 2) = {h2}  [{first:.3f}s including worker startup]")

    start = time.time()
    h5 = poseidon_hash(1, 2, 3, 4, 5)
    warm = time.time() - start
    print(f"poseidon(1, 2, 3, 4, 5) = {h5}  [{warm*1000:.1f}ms warm]")
    print(f"Fits in felt252? {ensure_fits_felt252(h2)}, {ensure_fits_felt252(h5)}")

    # Benchmark
    start = time.time()
    count = 0
    while time.time() - start < 2.0:
        poseidon_hash_two(count, count + 1)
        count += 1
    elapsed = time.time() - start
    print(f"{count} hashes in {elapsed:.1f}s = {count/elapsed:.0f} hashes/sec")
