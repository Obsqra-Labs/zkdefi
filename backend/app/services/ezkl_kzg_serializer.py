"""
EZKL -> native KZG calldata serializer (Path B scaffolding).

This module prepares deterministic felt calldata for the `native_kzg` proving path.
It does not implement Cairo-side KZG verification; it serializes proof payloads so
the backend can route real EZKL artifacts once a KZG verifier contract is deployed.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

FELT252_PRIME = 3618502788666131213697322783095070105623107215331596699973092056135872020481
FIXED_POINT_SCALE = 1_000_000
U96_MASK = (1 << 96) - 1

EZKL_KZG_V1_MARKER = int.from_bytes(b"ezkl_kzg_v1", "big") % FELT252_PRIME
NATIVE_KZG_PLACEHOLDER_MARKER = int.from_bytes(b"native_kzg_placeholder_v1", "big") % FELT252_PRIME
KZG_MPCHECK_V1_MARKER = int.from_bytes(b"kzg_mpcheck_v1", "big") % FELT252_PRIME


def _felt_from_hex_or_text(value: str) -> int:
    raw = (value or "").strip()
    if not raw:
        return 0
    if raw.startswith("0x"):
        try:
            return int(raw, 16) % FELT252_PRIME
        except ValueError:
            return 0
    try:
        return int(raw, 16) % FELT252_PRIME
    except ValueError:
        return int.from_bytes(raw.encode("utf-8"), "big") % FELT252_PRIME


def _int_from_any(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return int(raw, 16) if raw.startswith("0x") else int(raw)
        except ValueError:
            return None
    return None


def _float_to_felt(value: float, *, scale: int = FIXED_POINT_SCALE) -> int:
    scaled = int(round(float(value) * scale))
    if scaled < 0:
        scaled = FELT252_PRIME + scaled
    return scaled % FELT252_PRIME


def _bytes_to_felts(blob: bytes, *, chunk_size: int = 31) -> list[int]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be > 0")
    out: list[int] = []
    for i in range(0, len(blob), chunk_size):
        chunk = blob[i : i + chunk_size]
        out.append(int.from_bytes(chunk, "big") % FELT252_PRIME)
    return out


def _u384_to_limbs(value: int) -> list[int] | None:
    if value is None or value < 0:
        return None
    return [
        value & U96_MASK,
        (value >> 96) & U96_MASK,
        (value >> 192) & U96_MASK,
        (value >> 288) & U96_MASK,
    ]


def _parse_g1_point(value: Any) -> tuple[int, int] | None:
    if isinstance(value, dict):
        x = _int_from_any(value.get("x"))
        y = _int_from_any(value.get("y"))
        if x is None or y is None:
            return None
        return (x, y)
    if isinstance(value, (list, tuple)) and len(value) == 2:
        x = _int_from_any(value[0])
        y = _int_from_any(value[1])
        if x is None or y is None:
            return None
        return (x, y)
    return None


def _parse_felt_list(values: Any) -> list[int]:
    if not isinstance(values, (list, tuple)):
        return []
    out: list[int] = []
    for item in values:
        v = _int_from_any(item)
        if v is None:
            return []
        out.append(v % FELT252_PRIME)
    return out


def _garaga_module_path() -> Path | None:
    root = Path(__file__).resolve().parents[3]
    module = root / "circuits" / "node_modules" / "garaga" / "dist" / "index.cjs"
    return module if module.exists() else None


def _build_bn254_mpcheck_hint_felts(pair0: tuple[int, int], pair1: tuple[int, int]) -> list[int]:
    """
    Build MPCheck hint felts for MPCHECK_BN254_2P_2F with fixed KZG G2 points.

    Requires local Node + Garaga npm package at `circuits/node_modules/garaga`.
    """
    garaga_module = _garaga_module_path()
    if garaga_module is None:
        return []

    payload = json.dumps(
        {
            "pair0": [str(pair0[0]), str(pair0[1])],
            "pair1": [str(pair1[0]), str(pair1[1])],
        }
    )
    js = r"""
const garaga = require(process.argv[1]);
const payload = JSON.parse(process.argv[2]);
const makeU384 = (l0, l1, l2, l3) =>
  BigInt(l0) + (BigInt(l1) << 96n) + (BigInt(l2) << 192n) + (BigInt(l3) << 288n);

// garaga::apps::noir::{G2_POINT_KZG_1, G2_POINT_KZG_2}
const G2_1 = [
  [makeU384("0xf75edadd46debd5cd992f6ed", "0x426a00665e5c4479674322d4", "0x1800deef121f1e76", "0x0"),
   makeU384("0x35a9e71297e485b7aef312c2", "0x7260bfb731fb5d25f1aa4933", "0x198e9393920d483a", "0x0")],
  [makeU384("0x0c43d37b4ce6cc0166fa7daa", "0x4aab71808dcb408fe3d1e769", "0x12c85ea5db8c6deb", "0x0"),
   makeU384("0x70b38ef355acdadcd122975b", "0xec9e99ad690c3395bc4b3133", "0x090689d0585ff075", "0x0")],
];
const G2_2 = [
  [makeU384("0x3b32078b7e231fec938883b0", "0xbc89b5b398b5974e9f594407", "0x0118c4d5b837bcc2", "0x0"),
   makeU384("0x358e038b4efe30fac09383c1", "0xe7ff4e580791dee8ea51d87a", "0x260e01b251f6f1c7", "0x0")],
  [makeU384("0x96e6cea2854a87d4dacc5e55", "0x56475b4214e5615e11e6dd3f", "0x22febda3c0c0632a", "0x0"),
   makeU384("0x41f99ba4ee413c80da6a5fe4", "0xd25156c1bb9a72859cf2a046", "0x04fc6369f7110fe3", "0x0")],
];

async function main() {
  await garaga.init();
  const p0 = [BigInt(payload.pair0[0]), BigInt(payload.pair0[1])];
  const p1 = [BigInt(payload.pair1[0]), BigInt(payload.pair1[1])];
  const pairs = [[p0, G2_1], [p1, G2_2]];
  const out = garaga.mpcCalldataBuilder(garaga.CurveId.BN254, pairs, 2);
  console.log(JSON.stringify(out.map((x) => x.toString())));
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
"""
    try:
        proc = subprocess.run(
            ["node", "-e", js, str(garaga_module), payload],
            check=True,
            capture_output=True,
            text=True,
            timeout=45,
        )
        raw = json.loads(proc.stdout.strip() or "[]")
        return [int(x) % FELT252_PRIME for x in raw if str(x).strip()]
    except Exception:
        return []


def _build_kzg_mpcheck_trailer(raw_json: dict[str, Any]) -> tuple[list[int], dict[str, Any]]:
    """
    Optional cryptographic trailer for ezkl_kzg_v1:
      [kzg_mpcheck_v1][pair0_g1(8 felts)][pair1_g1(8 felts)][hint_len][hint_felts...]
    """
    bundle = (
        raw_json.get("kzg_mpcheck_bundle")
        or raw_json.get("kzg_pairing_bundle")
        or {}
    )
    if not isinstance(bundle, dict):
        bundle = {}

    pair0 = _parse_g1_point(bundle.get("pair0") or bundle.get("p1"))
    pair1 = _parse_g1_point(bundle.get("pair1") or bundle.get("p2"))
    hint_felts = _parse_felt_list(
        bundle.get("mpcheck_hint_felts")
        or bundle.get("hint_felts")
        or bundle.get("mpcheck_hint")
    )
    hint_source = "provided"

    if pair0 and pair1 and not hint_felts and bool(bundle.get("auto_build_hint", True)):
        hint_felts = _build_bn254_mpcheck_hint_felts(pair0, pair1)
        hint_source = "garaga_mpc_builder"

    if not pair0 or not pair1 or not hint_felts:
        return [], {
            "kzg_mpcheck_bundle_present": False,
            "kzg_mpcheck_hint_felts": 0,
            "kzg_mpcheck_hint_source": "none",
        }

    pair0_x_limbs = _u384_to_limbs(pair0[0])
    pair0_y_limbs = _u384_to_limbs(pair0[1])
    pair1_x_limbs = _u384_to_limbs(pair1[0])
    pair1_y_limbs = _u384_to_limbs(pair1[1])
    if not pair0_x_limbs or not pair0_y_limbs or not pair1_x_limbs or not pair1_y_limbs:
        return [], {
            "kzg_mpcheck_bundle_present": False,
            "kzg_mpcheck_hint_felts": 0,
            "kzg_mpcheck_hint_source": "none",
        }

    trailer = [KZG_MPCHECK_V1_MARKER]
    trailer.extend(pair0_x_limbs)
    trailer.extend(pair0_y_limbs)
    trailer.extend(pair1_x_limbs)
    trailer.extend(pair1_y_limbs)
    trailer.append(len(hint_felts))
    trailer.extend(hint_felts)
    return trailer, {
        "kzg_mpcheck_bundle_present": True,
        "kzg_mpcheck_hint_felts": len(hint_felts),
        "kzg_mpcheck_hint_source": hint_source,
        "kzg_mpcheck_pair0_x": hex(pair0[0]),
        "kzg_mpcheck_pair0_y": hex(pair0[1]),
        "kzg_mpcheck_pair1_x": hex(pair1[0]),
        "kzg_mpcheck_pair1_y": hex(pair1[1]),
    }


def serialize_ezkl_proof_to_kzg_calldata(proof: Any) -> tuple[list[str], dict[str, Any]]:
    """
    Serialize an EZKL proof object to deterministic felt calldata.

    Expected fields on `proof`:
      - proof_hash (0x...)
      - model_hash (hex string)
      - verify_key_hash (0x...)
      - public_inputs (list[float])
      - inference_output (list[float])
      - proof_hex (0x...) or proof_bytes (bytes)
      - raw_proof_json (dict)
    """
    marker = EZKL_KZG_V1_MARKER
    model_hash_felt = _felt_from_hex_or_text(str(getattr(proof, "model_hash", "")))
    vk_hash_felt = _felt_from_hex_or_text(str(getattr(proof, "verify_key_hash", "")))
    proof_hash_felt = _felt_from_hex_or_text(str(getattr(proof, "proof_hash", "")))

    public_inputs = [_float_to_felt(v) for v in list(getattr(proof, "public_inputs", []) or [])]
    outputs = [_float_to_felt(v) for v in list(getattr(proof, "inference_output", []) or [])]

    proof_hex = str(getattr(proof, "proof_hex", "") or "")
    proof_bytes = bytes(getattr(proof, "proof_bytes", b"") or b"")
    if proof_hex:
        try:
            proof_bytes = bytes.fromhex(proof_hex.replace("0x", ""))
        except ValueError:
            pass
    proof_blob_felts = _bytes_to_felts(proof_bytes)

    raw_json = dict(getattr(proof, "raw_proof_json", {}) or {})
    raw_hash_bytes = hashlib.sha256(
        json.dumps(raw_json, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).digest()
    raw_hash_felt = int.from_bytes(raw_hash_bytes, "big") % FELT252_PRIME
    kzg_trailer, trailer_meta = _build_kzg_mpcheck_trailer(raw_json)

    calldata_ints: list[int] = [
        marker,
        model_hash_felt,
        vk_hash_felt,
        proof_hash_felt,
        len(public_inputs),
        len(outputs),
        len(proof_blob_felts),
        raw_hash_felt,
    ]
    calldata_ints.extend(public_inputs)
    calldata_ints.extend(outputs)
    calldata_ints.extend(proof_blob_felts)
    calldata_ints.extend(kzg_trailer)

    meta = {
        "format": "ezkl_kzg_v1",
        "fact_hash_felt": hex(proof_hash_felt),
        "public_inputs_count": len(public_inputs),
        "output_count": len(outputs),
        "proof_blob_felts": len(proof_blob_felts),
        "raw_proof_hash": hex(raw_hash_felt),
        "fixed_point_scale": FIXED_POINT_SCALE,
        "verification_semantics": (
            "cryptographic_pairing"
            if trailer_meta.get("kzg_mpcheck_bundle_present")
            else "payload_and_fact_binding_only"
        ),
    }
    meta.update(trailer_meta)
    return [hex(v) for v in calldata_ints], meta


def build_placeholder_kzg_calldata(
    *,
    proof_hash: str,
    model_hash: str,
    inference_output: list[float],
    timestamp: int,
) -> tuple[list[str], dict[str, Any]]:
    """
    Deterministic placeholder calldata for native KZG path when EZKL artifacts
    are unavailable. This keeps routing/test paths active without claiming proof
    verification semantics.
    """
    marker = NATIVE_KZG_PLACEHOLDER_MARKER
    outputs = [_float_to_felt(v) for v in (inference_output or [])[:16]]
    payload = [
        marker,
        _felt_from_hex_or_text(model_hash),
        _felt_from_hex_or_text(proof_hash),
        int(timestamp) % FELT252_PRIME,
        len(outputs),
    ]
    payload.extend(outputs)
    meta = {
        "format": "native_kzg_placeholder_v1",
        "output_count": len(outputs),
        "fixed_point_scale": FIXED_POINT_SCALE,
    }
    return [hex(v) for v in payload], meta
