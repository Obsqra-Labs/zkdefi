"""
Compute constraint hashes from user vault policy settings.
Maps UI "Vault Constitution" fields to a deterministic hash
that gets registered on the VaultController contract.

For production: replace sha256 with Poseidon hash via starknet-py.
The interface and determinism are what matter now.
"""
import hashlib


def compute_constraint_hash(policy: dict) -> int:
    fields = [
        int(policy.get("max_position_wei", 0)),
        int(policy.get("risk_tolerance", 50)),
        int(policy.get("approved_adapters_mask", 0b111)),
        int(policy.get("max_single_adapter_pct", 60)),
        int(policy.get("cooldown_seconds", 43200)),
        int(policy.get("session_duration_hours", 24)),
    ]
    packed = b"".join(f.to_bytes(32, "big") for f in fields)
    digest = hashlib.sha256(packed).hexdigest()
    return int(digest, 16) % (2**251)
