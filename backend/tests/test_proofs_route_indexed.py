from __future__ import annotations

from types import SimpleNamespace

import pytest

import app.api.routes.proofs as proofs_routes


@pytest.mark.asyncio
async def test_list_proofs_indexed_public_only_filters(monkeypatch):
    class FakeRegistry:
        def list_proofs(self, model_name=None, user_address=None, limit=5000, offset=0):
            return [
                SimpleNamespace(
                    proof_hash="0xproof_public",
                    model_name="yield_forecast",
                    user_address="0xabc",
                    proof_type="groth16",
                    action_type="ml_inference",
                    verified_locally=True,
                    created_at=1.0,
                    tx_hash=None,
                    to_dict=lambda: {"metadata": {"bridge_statement": {"lane": "modelbridge"}}},
                ),
                SimpleNamespace(
                    proof_hash="0xproof_private",
                    model_name="yield_forecast",
                    user_address="0xabc",
                    proof_type="groth16",
                    action_type="ml_inference",
                    verified_locally=True,
                    created_at=2.0,
                    tx_hash=None,
                    to_dict=lambda: {"metadata": {"bridge_statement": {"lane": "modelbridge"}}},
                ),
            ]

    async def fake_attach_public_receipts(payload, requested_hash, **kwargs):
        enriched = dict(payload)
        count = 1 if requested_hash == "0xproof_public" else 0
        enriched["public_receipts"] = [{"tx_hash": "0xl2"}] if count else []
        enriched["public_receipt_summary"] = {"count": count, "starknet_l2": count, "ethereum_l1": 0}
        return enriched

    monkeypatch.setattr("app.services.proof_registry.get_proof_registry", lambda: FakeRegistry())
    monkeypatch.setattr(proofs_routes, "_attach_public_receipts", fake_attach_public_receipts)

    payload = await proofs_routes.list_proofs(
        model_name="yield_forecast",
        user_address="0xabc",
        source="indexed",
        public_only=True,
        limit=50,
        offset=0,
    )

    assert payload["source_mode"] == "indexed"
    assert payload["total"] == 1
    assert len(payload["proofs"]) == 1
    assert payload["proofs"][0]["proof_hash"] == "0xproof_public"


@pytest.mark.asyncio
async def test_list_proofs_indexed_can_sort_by_latest_public_settlement(monkeypatch):
    class FakeRegistry:
        def list_proofs(self, model_name=None, user_address=None, limit=5000, offset=0):
            return [
                SimpleNamespace(
                    proof_hash="0xolder",
                    model_name="yield_forecast",
                    user_address="0xabc",
                    proof_type="groth16",
                    action_type="ml_inference",
                    verified_locally=True,
                    created_at=1.0,
                    tx_hash=None,
                    to_dict=lambda: {"metadata": {"bridge_statement": {"lane": "modelbridge"}}},
                ),
                SimpleNamespace(
                    proof_hash="0xnewer",
                    model_name="yield_forecast",
                    user_address="0xabc",
                    proof_type="groth16",
                    action_type="ml_inference",
                    verified_locally=True,
                    created_at=2.0,
                    tx_hash=None,
                    to_dict=lambda: {"metadata": {"bridge_statement": {"lane": "modelbridge"}}},
                ),
            ]

    async def fake_attach_public_receipts(payload, requested_hash, **kwargs):
        enriched = dict(payload)
        ts = "2026-03-22T04:00:00Z" if requested_hash == "0xnewer" else "2026-03-22T03:00:00Z"
        enriched["public_receipts"] = [{"tx_hash": requested_hash, "timestamp": ts}]
        enriched["public_receipt_summary"] = {
            "count": 1,
            "starknet_l2": 1,
            "ethereum_l1": 0,
            "latest_tx_hash": requested_hash,
            "latest_timestamp": ts,
        }
        return enriched

    monkeypatch.setattr("app.services.proof_registry.get_proof_registry", lambda: FakeRegistry())
    monkeypatch.setattr(proofs_routes, "_attach_public_receipts", fake_attach_public_receipts)

    payload = await proofs_routes.list_proofs(
        user_address="0xabc",
        source="indexed",
        public_only=True,
        sort_by="latest_public_settlement",
        limit=50,
        offset=0,
    )

    assert payload["sort_by"] == "latest_public_settlement"
    assert [row["proof_hash"] for row in payload["proofs"]] == ["0xnewer", "0xolder"]
