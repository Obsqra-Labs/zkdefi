from __future__ import annotations

from pathlib import Path


def test_ml_bridge_commitment_guard_wired():
    contract_path = Path(__file__).resolve().parents[2] / "contracts" / "src" / "proof_gated_yield_agent.cairo"
    source = contract_path.read_text()

    assert "ezkl_proof_hash: felt252" in source
    assert "bridge_timestamp: felt252" in source
    assert "assert(expected_bridge == bridge_commitment, 'Bridge commitment mismatch');" in source
    assert "output_commitment,\n                ezkl_proof_hash,\n                bridge_timestamp" in source
