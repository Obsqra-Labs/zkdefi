import pytest

from app.api.routes.proofs import MLBridgeProofRequest, list_bridge_lane_metadata
from app.services.bridge_lanes import BridgeCircuitName, get_bridge_lane, normalize_bridge_circuit


def test_bridge_lane_aliases_normalize():
    assert normalize_bridge_circuit(None) == BridgeCircuitName.MODEL_BRIDGE
    assert normalize_bridge_circuit("heavy") == BridgeCircuitName.MODEL_BRIDGE_HEAVY
    assert normalize_bridge_circuit("noir") == BridgeCircuitName.NOIR_EZKL_BRIDGE
    assert normalize_bridge_circuit("native-kzg") == BridgeCircuitName.EZKL_NATIVE_KZG


def test_ml_bridge_request_accepts_alias_bridge_names():
    req = MLBridgeProofRequest(
        user_address="0x1",
        model_name="yield_forecast",
        input_data=[[1.0]],
        bridge_circuit="noir",
    )

    assert req.bridge_circuit == BridgeCircuitName.NOIR_EZKL_BRIDGE
    assert get_bridge_lane(req.bridge_circuit).proof_type == "noir_honk"


@pytest.mark.asyncio
async def test_bridge_lane_metadata_route_exposes_registry(monkeypatch):
    monkeypatch.setattr("app.services.noir_prover.noir_honk_available", lambda: True)

    payload = await list_bridge_lane_metadata()

    assert payload["count"] == 4
    lanes = {row["name"]: row for row in payload["bridge_lanes"]}
    assert lanes["ModelBridge"]["proof_type"] == "groth16"
    assert lanes["ModelBridgeHeavy"]["output_count"] == 16
    assert lanes["NoirEzklBridge"]["proof_type"] == "noir_honk"
    assert lanes["EzklNativeKzg"]["proof_type"] == "native_kzg"
