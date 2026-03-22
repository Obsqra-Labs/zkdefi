from __future__ import annotations

from pathlib import Path

from app.services import proof_registry as proof_registry_mod


def test_proof_registry_resolves_felt_safe_alias(tmp_path, monkeypatch):
    db_path = tmp_path / "proof_registry.db"
    monkeypatch.setattr(proof_registry_mod, "DB_PATH", db_path)

    svc = proof_registry_mod.ProofRegistryService()
    svc.store_proof(
        proof_hash="0xe26460ad2dbad8064219cabf95f31efff195be29399db1e22d16a0612a9b172d",
        model_name="yield_forecast",
        user_address="0xabc",
        proof_type="groth16",
        action_type="ml_inference",
        verified_locally=True,
        metadata={
            "bridge_statement": {
                "fact_hash": "0xe26460ad2dbad8064219cabf95f31efff195be29399db1e22d16a0612a9b172d",
                "bridge_fact_hash": "0xe26460ad2dbad8064219cabf95f31efff195be29399db1e22d16a0612a9b172d",
            }
        },
    )

    record = svc.get_proof_by_alias("0x26460ad2dbad8064219cabf95f31efff195be29399db1e22d16a0612a9b172d")

    assert record is not None
    assert record.proof_hash == "0xe26460ad2dbad8064219cabf95f31efff195be29399db1e22d16a0612a9b172d"
