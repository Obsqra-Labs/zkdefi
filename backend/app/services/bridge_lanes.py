from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any


class BridgeCircuitName(str, Enum):
    MODEL_BRIDGE = "ModelBridge"
    MODEL_BRIDGE_HEAVY = "ModelBridgeHeavy"
    NOIR_EZKL_BRIDGE = "NoirEzklBridge"
    NOIR_EZKL_BRIDGE_V2 = "NoirEzklBridgeV2"
    EZKL_NATIVE_KZG = "EzklNativeKzg"


@dataclass(frozen=True)
class BridgeLaneSpec:
    name: BridgeCircuitName
    short_id: str
    proof_type: str
    output_count: int
    description: str
    aliases: tuple[str, ...]
    attempts_real_ezkl: bool = True
    statement_version: str = "obsqra_bridge_statement_v1"
    binds_model_hash: bool = True
    binds_output_bounds: bool = True
    binds_output_vector: bool = True
    binds_output_commitment: bool = True
    binds_timestamp: bool = True
    binds_ezkl_proof_hash: bool = True

    @property
    def circuit_name_for_l3(self) -> str:
        return self.name.value

    @property
    def is_noir_honk(self) -> bool:
        return self.proof_type == "noir_honk"

    @property
    def is_native_kzg(self) -> bool:
        return self.proof_type == "native_kzg"

    @property
    def is_groth16(self) -> bool:
        return self.proof_type == "groth16"

    @property
    def is_modelbridge_family(self) -> bool:
        return self.name in {
            BridgeCircuitName.MODEL_BRIDGE,
            BridgeCircuitName.MODEL_BRIDGE_HEAVY,
            BridgeCircuitName.NOIR_EZKL_BRIDGE,
            BridgeCircuitName.NOIR_EZKL_BRIDGE_V2,
        }

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["name"] = self.name.value
        data["circuit_name_for_l3"] = self.circuit_name_for_l3
        data["is_noir_honk"] = self.is_noir_honk
        data["is_native_kzg"] = self.is_native_kzg
        data["is_groth16"] = self.is_groth16
        data["is_modelbridge_family"] = self.is_modelbridge_family
        data["binding_profile"] = {
            "statement_version": self.statement_version,
            "binds_model_hash": self.binds_model_hash,
            "binds_output_bounds": self.binds_output_bounds,
            "binds_output_vector": self.binds_output_vector,
            "binds_output_commitment": self.binds_output_commitment,
            "binds_timestamp": self.binds_timestamp,
            "binds_ezkl_proof_hash": self.binds_ezkl_proof_hash,
        }
        return data


_BRIDGE_LANES: tuple[BridgeLaneSpec, ...] = (
    BridgeLaneSpec(
        name=BridgeCircuitName.MODEL_BRIDGE,
        short_id="modelbridge",
        proof_type="groth16",
        output_count=8,
        description="Standard EZKL -> Groth16 ModelBridge lane.",
        aliases=("model_bridge", "groth16_modelbridge", "groth16"),
    ),
    BridgeLaneSpec(
        name=BridgeCircuitName.MODEL_BRIDGE_HEAVY,
        short_id="modelbridge_heavy",
        proof_type="groth16",
        output_count=16,
        description="Heavier 16-output EZKL -> Groth16 ModelBridge lane.",
        aliases=("model_bridge_heavy", "heavy", "groth16_heavy"),
    ),
    BridgeLaneSpec(
        name=BridgeCircuitName.NOIR_EZKL_BRIDGE,
        short_id="noir",
        proof_type="noir_honk",
        output_count=8,
        description="Noir HONK bridge lane over the ModelBridge policy scaffold.",
        aliases=("noir", "noir_honk", "noir_ezkl", "noir_ezkl_bridge", "honk"),
        binds_output_vector=False,
        binds_output_commitment=False,
        binds_timestamp=False,
        binds_ezkl_proof_hash=False,
    ),
    BridgeLaneSpec(
        name=BridgeCircuitName.NOIR_EZKL_BRIDGE_V2,
        short_id="noir_v2",
        proof_type="noir_honk",
        output_count=8,
        description="Versioned Noir HONK bridge lane binding EZKL proof hash + bounded outputs.",
        aliases=("noir_v2", "noir-v2", "honk_v2", "noir_ezkl_bridge_v2", "noir2"),
    ),
    BridgeLaneSpec(
        name=BridgeCircuitName.EZKL_NATIVE_KZG,
        short_id="native_kzg",
        proof_type="native_kzg",
        output_count=8,
        description="Direct EZKL native KZG lane for Cairo verifier routing.",
        aliases=("native", "kzg", "native-kzg", "ezkl_native_kzg"),
    ),
)


def list_bridge_lanes() -> list[BridgeLaneSpec]:
    return list(_BRIDGE_LANES)


def bridge_lane_choices() -> list[str]:
    return [lane.name.value for lane in _BRIDGE_LANES]


def normalize_bridge_circuit(value: str | BridgeCircuitName | None) -> BridgeCircuitName:
    if value is None:
        return BridgeCircuitName.MODEL_BRIDGE
    if isinstance(value, BridgeCircuitName):
        return value

    raw = str(value or "").strip()
    if not raw:
        return BridgeCircuitName.MODEL_BRIDGE

    for lane in _BRIDGE_LANES:
        if raw == lane.name.value:
            return lane.name

    canon = raw.lower().replace("-", "_").replace(" ", "_")
    for lane in _BRIDGE_LANES:
        if canon == lane.short_id:
            return lane.name
        if canon in lane.aliases:
            return lane.name

    allowed = ", ".join(bridge_lane_choices())
    raise ValueError(f"Unsupported bridge_circuit '{raw}'. Allowed: {allowed}")


def get_bridge_lane(value: str | BridgeCircuitName | None) -> BridgeLaneSpec:
    lane_name = normalize_bridge_circuit(value)
    for lane in _BRIDGE_LANES:
        if lane.name == lane_name:
            return lane
    raise KeyError(f"Unknown bridge lane: {lane_name}")


def bridge_lane_payload() -> list[dict[str, Any]]:
    return [lane.to_dict() for lane in _BRIDGE_LANES]
