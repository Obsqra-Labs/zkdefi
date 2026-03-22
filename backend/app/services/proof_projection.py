"""
Helpers for normalizing indexed proof rows into a stable explorer-facing shape.
"""

from __future__ import annotations

from typing import Any

from app.services.bridge_lanes import get_bridge_lane


LEGACY_GROTH16_LANE = "legacy_groth16"
LEGACY_GROTH16_STATEMENT_VERSION = "obsqra_legacy_proof_index_v1"


def lane_model_alias(lane: object, model_name: object) -> str | None:
    lane_text = str(lane or "").strip().lower()
    model_text = str(model_name or "").strip().lower()
    if not lane_text or not model_text:
        return None
    return f"lane_model:{lane_text}:{model_text}"


def legacy_groth16_binding_profile() -> dict[str, bool | str]:
    return {
        "statement_version": LEGACY_GROTH16_STATEMENT_VERSION,
        "binds_model_hash": False,
        "binds_output_bounds": False,
        "binds_output_vector": False,
        "binds_output_commitment": False,
        "binds_timestamp": False,
        "binds_ezkl_proof_hash": False,
    }


def infer_bridge_lane(payload: dict[str, Any]) -> str | None:
    bridge_statement = payload.get("bridge_statement") if isinstance(payload.get("bridge_statement"), dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    row_proof_type = str(payload.get("proof_type") or "").strip().lower()

    explicit = (
        bridge_statement.get("lane")
        or payload.get("lane")
        or metadata.get("bridge_lane")
    )
    if explicit:
        return str(explicit).strip().lower()

    circuit_value = metadata.get("bridge_circuit")
    if circuit_value:
        try:
            return get_bridge_lane(str(circuit_value)).short_id
        except Exception:
            pass

    backend_value = str(metadata.get("bridge_backend") or "").strip().lower()
    if backend_value:
        if "native_kzg" in backend_value:
            return "native_kzg"
        if "noir" in backend_value and "v2" in backend_value:
            return "noir_v2"
        if "noir" in backend_value:
            return "noir"
        if "heavy" in backend_value:
            return "modelbridge_heavy"
        if "modelbridge" in backend_value:
            return "modelbridge"

    l3_mode = str(metadata.get("l3_mode") or "").strip().lower()
    if l3_mode == "native_kzg":
        return "native_kzg"
    if l3_mode == "noir_honk":
        return "noir"
    if l3_mode == "groth16_garaga":
        return "modelbridge"

    if row_proof_type in {"native_kzg", "ezkl_kzg"}:
        return "native_kzg"
    if row_proof_type == "noir_honk":
        return "noir"
    if row_proof_type == "groth16":
        return LEGACY_GROTH16_LANE
    return None


def normalize_indexed_proof_payload(payload: dict[str, Any]) -> dict[str, Any]:
    out = dict(payload)
    metadata = out.get("metadata") if isinstance(out.get("metadata"), dict) else {}
    bridge_statement = out.get("bridge_statement") if isinstance(out.get("bridge_statement"), dict) else {}
    registry_record = out.get("registry_record") if isinstance(out.get("registry_record"), dict) else {}

    metadata = dict(metadata)
    bridge_statement = dict(bridge_statement or metadata.get("bridge_statement") or {})

    lane = infer_bridge_lane(
        {
            **out,
            "metadata": metadata,
            "bridge_statement": bridge_statement,
        }
    )

    model_name = (
        bridge_statement.get("model_name")
        or out.get("model_name")
        or registry_record.get("model_name")
        or metadata.get("model_name")
    )
    requested_model_name = bridge_statement.get("requested_model_name") or out.get("model_name") or metadata.get("model_name")

    if lane and not bridge_statement.get("lane"):
        bridge_statement["lane"] = lane
    if out.get("proof_type") and not bridge_statement.get("proof_type"):
        bridge_statement["proof_type"] = out.get("proof_type")
    if model_name and not bridge_statement.get("model_name"):
        bridge_statement["model_name"] = model_name
    if (
        requested_model_name
        and not bridge_statement.get("requested_model_name")
        and str(requested_model_name).strip().lower() != str(model_name or "").strip().lower()
    ):
        bridge_statement["requested_model_name"] = requested_model_name

    if lane == LEGACY_GROTH16_LANE and not isinstance(bridge_statement.get("binding_profile"), dict):
        bridge_statement["binding_profile"] = legacy_groth16_binding_profile()

    if bridge_statement:
        metadata["bridge_statement"] = bridge_statement
        out["bridge_statement"] = bridge_statement
    if lane:
        metadata.setdefault("bridge_lane", lane)
        out["lane"] = lane
    out["metadata"] = metadata
    return out
