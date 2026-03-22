from __future__ import annotations

from types import SimpleNamespace

import pytest

import app.api.routes.proofs as proofs_routes


async def _empty_public_receipt_index(_addr: str):
    return {}


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
    monkeypatch.setattr(proofs_routes, "build_public_receipt_index_for_user", _empty_public_receipt_index)

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
async def test_list_proofs_indexed_filters_by_canonical_bridge_statement_model_name(monkeypatch):
    class FakeRegistry:
        def list_proofs(self, model_name=None, user_address=None, limit=5000, offset=0):
            return [
                SimpleNamespace(
                    proof_hash="0xalias_record",
                    model_name="yield_predictor",
                    user_address="0xabc",
                    proof_type="noir_honk",
                    action_type="ml_inference",
                    verified_locally=True,
                    created_at=1.0,
                    tx_hash=None,
                    to_dict=lambda: {
                        "model_name": "yield_predictor",
                        "metadata": {
                            "bridge_statement": {
                                "lane": "noir_v2",
                                "model_name": "yield_forecast",
                                "requested_model_name": "yield_predictor",
                            }
                        },
                    },
                )
            ]

    async def fake_attach_public_receipts(payload, requested_hash, **kwargs):
        enriched = dict(payload)
        enriched["public_receipts"] = [{"tx_hash": "0xl2"}]
        enriched["public_receipt_summary"] = {"count": 1, "starknet_l2": 1, "ethereum_l1": 0}
        return enriched

    monkeypatch.setattr("app.services.proof_registry.get_proof_registry", lambda: FakeRegistry())
    monkeypatch.setattr(proofs_routes, "_attach_public_receipts", fake_attach_public_receipts)
    monkeypatch.setattr(proofs_routes, "build_public_receipt_index_for_user", _empty_public_receipt_index)

    payload = await proofs_routes.list_proofs(
        model_name="yield_forecast",
        user_address="0xabc",
        source="indexed",
        public_only=True,
        limit=50,
        offset=0,
    )

    assert payload["total"] == 1
    assert payload["proofs"][0]["proof_hash"] == "0xalias_record"
    assert payload["proofs"][0]["bridge_statement"]["model_name"] == "yield_forecast"


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
    monkeypatch.setattr(proofs_routes, "build_public_receipt_index_for_user", _empty_public_receipt_index)

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


@pytest.mark.asyncio
async def test_list_proofs_indexed_supports_settlement_cursor(monkeypatch):
    class FakeRegistry:
        def list_proofs(self, model_name=None, user_address=None, limit=5000, offset=0):
            return [
                SimpleNamespace(
                    proof_hash="0xccc",
                    model_name="yield_forecast",
                    user_address="0xabc",
                    proof_type="groth16",
                    action_type="ml_inference",
                    verified_locally=True,
                    created_at=3.0,
                    tx_hash=None,
                    to_dict=lambda: {"metadata": {"bridge_statement": {"lane": "modelbridge"}}},
                ),
                SimpleNamespace(
                    proof_hash="0xbbb",
                    model_name="yield_forecast",
                    user_address="0xabc",
                    proof_type="groth16",
                    action_type="ml_inference",
                    verified_locally=True,
                    created_at=2.0,
                    tx_hash=None,
                    to_dict=lambda: {"metadata": {"bridge_statement": {"lane": "modelbridge"}}},
                ),
                SimpleNamespace(
                    proof_hash="0xaaa",
                    model_name="yield_forecast",
                    user_address="0xabc",
                    proof_type="groth16",
                    action_type="ml_inference",
                    verified_locally=True,
                    created_at=1.0,
                    tx_hash=None,
                    to_dict=lambda: {"metadata": {"bridge_statement": {"lane": "modelbridge"}}},
                ),
            ]

    timestamps = {
        "0xccc": "2026-03-22T05:00:00Z",
        "0xbbb": "2026-03-22T04:00:00Z",
        "0xaaa": "2026-03-22T03:00:00Z",
    }

    async def fake_attach_public_receipts(payload, requested_hash, **kwargs):
        enriched = dict(payload)
        ts = timestamps[requested_hash]
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
    monkeypatch.setattr(proofs_routes, "build_public_receipt_index_for_user", _empty_public_receipt_index)

    first_page = await proofs_routes.list_proofs(
        user_address="0xabc",
        source="indexed",
        public_only=True,
        sort_by="latest_public_settlement",
        limit=1,
        offset=0,
    )

    assert [row["proof_hash"] for row in first_page["proofs"]] == ["0xccc"]
    assert first_page["has_more"] is True
    assert first_page["next_cursor"] == {
        "timestamp": "2026-03-22T05:00:00Z",
        "proof_hash": "0xccc",
    }

    second_page = await proofs_routes.list_proofs(
        user_address="0xabc",
        source="indexed",
        public_only=True,
        sort_by="latest_public_settlement",
        limit=1,
        offset=0,
        cursor_timestamp=first_page["next_cursor"]["timestamp"],
        cursor_proof_hash=first_page["next_cursor"]["proof_hash"],
    )

    assert [row["proof_hash"] for row in second_page["proofs"]] == ["0xbbb"]


@pytest.mark.asyncio
async def test_list_proofs_indexed_normalizes_legacy_groth16_lane(monkeypatch):
    class FakeRegistry:
        def list_proofs(self, model_name=None, user_address=None, limit=5000, offset=0):
            return [
                SimpleNamespace(
                    proof_hash="0xlegacy",
                    model_name="StrategyIntegrity",
                    user_address="0xabc",
                    proof_type="groth16",
                    action_type="strategy_integrity",
                    verified_locally=True,
                    created_at=1.0,
                    tx_hash=None,
                    to_dict=lambda: {"metadata": {}},
                )
            ]

    monkeypatch.setattr("app.services.proof_registry.get_proof_registry", lambda: FakeRegistry())
    monkeypatch.setattr(proofs_routes, "build_public_receipt_index_for_user", _empty_public_receipt_index)

    payload = await proofs_routes.list_proofs(
        user_address="0xabc",
        source="indexed",
        public_only=False,
        limit=50,
        offset=0,
    )

    assert payload["total"] == 1
    row = payload["proofs"][0]
    assert row["lane"] == "legacy_groth16"
    assert row["metadata"]["bridge_lane"] == "legacy_groth16"
    assert row["bridge_statement"]["lane"] == "legacy_groth16"
    assert row["bridge_statement"]["binding_profile"]["statement_version"] == "obsqra_legacy_proof_index_v1"


@pytest.mark.asyncio
async def test_list_proofs_indexed_native_kzg_can_match_model_lane_public_receipts(monkeypatch):
    class FakeRegistry:
        def list_proofs(self, model_name=None, user_address=None, limit=5000, offset=0):
            return [
                SimpleNamespace(
                    proof_hash="0xnativeproof",
                    model_name="yield_predictor",
                    user_address="0xabc",
                    proof_type="native_kzg",
                    action_type="yield_estimate",
                    verified_locally=True,
                    created_at=1.0,
                    tx_hash=None,
                    to_dict=lambda: {
                        "metadata": {
                            "bridge_statement": {
                                "lane": "native_kzg",
                                "model_name": "yield_forecast",
                                "requested_model_name": "yield_predictor",
                            }
                        }
                    },
                )
            ]

    async def fake_build_public_receipt_index(_addr: str):
        return {
            "lane_model:native_kzg:yield_forecast": [
                {
                    "tx_hash": "0xmirroredl2",
                    "proof_hash": "0xartifactproof",
                    "fact_hash": "0xartifactproof",
                    "timestamp": "2026-03-22T06:00:00Z",
                    "source": "pathb_artifact",
                    "tx_source": "l2",
                    "public_receipt": True,
                    "public_chain": "starknet_l2",
                    "network": "starknet_sepolia",
                    "explorer_url": "https://sepolia.voyager.online/tx/0xmirroredl2",
                    "proof_match_scope": "lane_model",
                }
            ]
        }

    monkeypatch.setattr("app.services.proof_registry.get_proof_registry", lambda: FakeRegistry())
    monkeypatch.setattr(proofs_routes, "build_public_receipt_index_for_user", fake_build_public_receipt_index)

    payload = await proofs_routes.list_proofs(
        user_address="0xabc",
        source="indexed",
        public_only=True,
        model_name="yield_forecast",
        limit=50,
        offset=0,
    )

    assert payload["total"] == 1
    row = payload["proofs"][0]
    assert row["public_receipt_summary"]["count"] == 1
    assert row["public_receipts"][0]["tx_hash"] == "0xmirroredl2"
    assert row["public_receipts"][0]["proof_match_scope"] == "lane_model"


@pytest.mark.asyncio
async def test_list_proofs_indexed_normalizes_legacy_ezkl_kzg_lane(monkeypatch):
    class FakeRegistry:
        def list_proofs(self, model_name=None, user_address=None, limit=5000, offset=0):
            return [
                SimpleNamespace(
                    proof_hash="0xlegacykzg",
                    model_name="yield_forecast",
                    user_address="0xabc",
                    proof_type="ezkl_kzg",
                    action_type="yield_estimate",
                    verified_locally=True,
                    created_at=1.0,
                    tx_hash=None,
                    to_dict=lambda: {
                        "metadata": {
                            "bridge_statement": {
                                "proof_type": "ezkl_kzg",
                                "model_name": "yield_forecast",
                            }
                        }
                    },
                )
            ]

    monkeypatch.setattr("app.services.proof_registry.get_proof_registry", lambda: FakeRegistry())
    monkeypatch.setattr(proofs_routes, "build_public_receipt_index_for_user", _empty_public_receipt_index)

    payload = await proofs_routes.list_proofs(
        user_address="0xabc",
        source="indexed",
        public_only=False,
        limit=50,
        offset=0,
    )

    assert payload["total"] == 1
    row = payload["proofs"][0]
    assert row["lane"] == "native_kzg"
    assert row["bridge_statement"]["lane"] == "native_kzg"
