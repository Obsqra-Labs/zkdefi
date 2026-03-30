from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.receipt_bundle import build_receipt_bundle, compute_receipt_hash


def test_build_receipt_bundle_computes_stable_receipt_hash():
    bundle = build_receipt_bundle(
        receipt_id="42",
        action_type="rebalance",
        timestamp="2026-03-30T12:00:00+00:00",
        subject="0xabc",
        policy_hash="0x123",
        proof_hash="0x456",
        allowed=True,
        constraints_checked=["slippage", "allocation"],
        tier="verified",
        registry_tx_hash="0x789",
        registry_contract_address="0xaaa",
        event_key="0xbbb",
        human_readable="Rebalance executed within policy bounds. Verified on Starknet Sepolia.",
    )

    assert bundle["version"] == "1.0"
    assert bundle["proof_hashes"]["receipt_hash"].startswith("0x")
    assert bundle["proof_hashes"]["receipt_hash"] == compute_receipt_hash(bundle)


def test_compute_receipt_hash_ignores_existing_receipt_hash_field():
    bundle = build_receipt_bundle(
        receipt_id="99",
        action_type="verification",
        timestamp="2026-03-30T12:00:00+00:00",
        subject="0xdef",
        policy_hash="0x111",
        proof_hash="0x222",
        allowed=True,
        constraints_checked=["passport_vector"],
        tier="trusted",
        registry_tx_hash="0x333",
        registry_contract_address="0x444",
        event_key="0x555",
        human_readable="Passport verification issued within policy bounds. Verified on Starknet Sepolia.",
    )

    original = bundle["proof_hashes"]["receipt_hash"]
    bundle["proof_hashes"]["receipt_hash"] = "0xdeadbeef"

    assert compute_receipt_hash(bundle) == original
