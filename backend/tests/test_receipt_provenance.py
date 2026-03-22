from __future__ import annotations

import pytest
from types import SimpleNamespace

import app.services.receipt_provenance as provenance


@pytest.mark.asyncio
async def test_collect_public_receipts_for_hashes_merges_and_classifies(monkeypatch):
    class FakeReceiptService:
        async def get_user_receipts(self, address: str):
            return [
                {
                    "tx_hash": "0xrawl2",
                    "proof_hash": "0xproof",
                    "fact_hash": "0xfact",
                    "timestamp": "2026-03-22T02:00:00Z",
                    "metadata": {"tx_source": "l2"},
                },
                {
                    "tx_hash": "0xrawl3",
                    "proof_hash": "0xproof",
                    "fact_hash": "0xfact",
                    "timestamp": "2026-03-22T01:00:00Z",
                    "metadata": {"tx_source": "l3"},
                },
            ]

    class FakeDecisionStore:
        async def get_user_history(self, address: str, limit: int = 1000):
            return [
                {
                    "event_type": "proof_generated",
                    "created_at": "2026-03-22T03:00:00Z",
                    "l2_tx_hash": "0xdecisionl2",
                    "l1_tx_hash": "0xdecisionl1",
                    "metadata": {
                        "proof_hash": "0xproof",
                        "fact_hash": "0xfact",
                    },
                }
            ]

    monkeypatch.setattr(provenance, "get_receipt_service", lambda: FakeReceiptService())
    monkeypatch.setattr(provenance, "get_decision_store", lambda: FakeDecisionStore())

    rows = await provenance.collect_public_receipts_for_hashes(["0xproof", "0xfact"], user_address="0xabc")

    assert {row["tx_hash"] for row in rows} == {"0xdecisionl2", "0xdecisionl1", "0xrawl2"}
    assert all(row["public_receipt"] is True for row in rows)
    by_tx = {row["tx_hash"]: row for row in rows}
    assert by_tx["0xdecisionl2"]["network"] == "starknet_sepolia"
    assert by_tx["0xdecisionl1"]["network"] == "ethereum_sepolia"
    assert by_tx["0xrawl2"]["explorer_url"].endswith("/tx/0xrawl2")

    summary = provenance.summarize_public_receipts(rows)
    assert summary["count"] == 3
    assert summary["starknet_l2"] == 2
    assert summary["ethereum_l1"] == 1


@pytest.mark.asyncio
async def test_collect_public_receipts_matches_trimmed_felt_hashes(monkeypatch):
    class FakeReceiptService:
        async def get_user_receipts(self, address: str):
            return []

    class FakeDecisionStore:
        async def get_user_history(self, address: str, limit: int = 1000):
            return [
                {
                    "event_type": "proof_generated",
                    "created_at": "2026-03-22T03:00:00Z",
                    "l2_tx_hash": "0xtrimmedl2",
                    "metadata": {
                        "proof_hash": "0xabc",
                        "fact_hash": "0xabc",
                    },
                }
            ]

    monkeypatch.setattr(provenance, "get_receipt_service", lambda: FakeReceiptService())
    monkeypatch.setattr(provenance, "get_decision_store", lambda: FakeDecisionStore())

    rows = await provenance.collect_public_receipts_for_hashes(["0x000abc"], user_address="0xabc")

    assert len(rows) == 1
    assert rows[0]["tx_hash"] == "0xtrimmedl2"


@pytest.mark.asyncio
async def test_collect_public_receipts_matches_felt_reduced_hashes(monkeypatch):
    class FakeReceiptService:
        async def get_user_receipts(self, address: str):
            return []

    class FakeDecisionStore:
        async def get_user_history(self, address: str, limit: int = 1000):
            return [
                {
                    "event_type": "proof_generated",
                    "created_at": "2026-03-22T03:00:00Z",
                    "l2_tx_hash": "0xfeltl2",
                    "metadata": {
                        "proof_hash": "0x26460ad2dbad8064219cabf95f31efff195be29399db1e22d16a0612a9b172d",
                        "fact_hash": "0x26460ad2dbad8064219cabf95f31efff195be29399db1e22d16a0612a9b172d",
                    },
                }
            ]

    monkeypatch.setattr(provenance, "get_receipt_service", lambda: FakeReceiptService())
    monkeypatch.setattr(provenance, "get_decision_store", lambda: FakeDecisionStore())

    rows = await provenance.collect_public_receipts_for_hashes(
        ["0xe26460ad2dbad8064219cabf95f31efff195be29399db1e22d16a0612a9b172d"],
        user_address="0xabc",
    )

    assert len(rows) == 1
    assert rows[0]["tx_hash"] == "0xfeltl2"


@pytest.mark.asyncio
async def test_collect_public_receipts_includes_pathb_native_kzg_model_alias(monkeypatch):
    class FakeReceiptService:
        async def get_user_receipts(self, address: str):
            return []

    class FakeDecisionStore:
        async def get_user_history(self, address: str, limit: int = 1000):
            return []

    monkeypatch.setattr(provenance, "get_receipt_service", lambda: FakeReceiptService())
    monkeypatch.setattr(provenance, "get_decision_store", lambda: FakeDecisionStore())
    monkeypatch.setattr(
        provenance,
        "load_pathb_bundle_warm_report",
        lambda: {
            "generated_at": "2026-03-22T06:00:00Z",
            "rows": [
                {
                    "model": "yield_forecast",
                    "proof_hash": "0xartifactproof",
                    "native_kzg_mirror_status": "mirrored",
                    "native_kzg_l2_tx_hash": "0xartifactl2",
                }
            ],
        },
    )

    rows = await provenance.collect_public_receipts_for_hashes(
        ["lane_model:native_kzg:yield_forecast"],
        user_address="0xabc",
    )

    assert len(rows) == 1
    assert rows[0]["tx_hash"] == "0xartifactl2"
    assert rows[0]["source"] == "pathb_artifact"
    assert rows[0]["public_chain"] == "starknet_l2"
    assert rows[0]["proof_match_scope"] == "lane_model"


@pytest.mark.asyncio
async def test_collect_public_receipts_includes_proof_registry_metadata_fallback(monkeypatch):
    class FakeReceiptService:
        async def get_user_receipts(self, address: str):
            return []

    class FakeDecisionStore:
        async def get_user_history(self, address: str, limit: int = 1000):
            return []

    class FakeRecord(SimpleNamespace):
        def to_dict(self):
            return {
                "proof_hash": self.proof_hash,
                "model_name": self.model_name,
                "action_type": self.action_type,
                "created_at_iso": "2026-03-22T08:00:00Z",
                "submitted_at_iso": None,
                "metadata": self.metadata,
                "tx_hash": self.tx_hash,
            }

    class FakeProofRegistry:
        def list_proofs(self, **kwargs):
            return [
                FakeRecord(
                    proof_hash="0xproof-registry",
                    model_name="yield_forecast",
                    action_type="ml_bridge",
                    tx_hash="0xpublicl2",
                    metadata={
                        "bridge_statement": {
                            "lane": "modelbridge_heavy",
                            "model_name": "yield_forecast",
                            "fact_hash": "0xfact-registry",
                        },
                        "verification": {
                            "l2": {
                                "verified_on_chain": True,
                                "tx_hash": "0xpublicl2",
                            }
                        },
                        "l2_tx_hash": "0xpublicl2",
                    },
                )
            ]

    monkeypatch.setattr(provenance, "get_receipt_service", lambda: FakeReceiptService())
    monkeypatch.setattr(provenance, "get_decision_store", lambda: FakeDecisionStore())
    monkeypatch.setattr(provenance, "get_proof_registry", lambda: FakeProofRegistry())

    rows = await provenance.collect_public_receipts_for_hashes(
        ["0xproof-registry", "0xfact-registry"],
        user_address="0xabc",
    )

    assert len(rows) == 1
    assert rows[0]["tx_hash"] == "0xpublicl2"
    assert rows[0]["source"] == "proof_registry_metadata"
    assert rows[0]["proof_match_scope"] == "exact_hash"
    summary = provenance.summarize_public_receipts(rows)
    assert summary["latest_match_scope"] == "exact_hash"
