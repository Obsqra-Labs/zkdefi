#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from web3 import Web3


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT = PROJECT_ROOT / "artifacts" / "hackathon_showcase" / "pathc_latest.json"
DEFAULT_PENDING_ARTIFACT = (
    PROJECT_ROOT / "artifacts" / "hackathon_showcase" / "pathc_pending_latest.json"
)
DEFAULT_GENERATED_PAYLOAD = (
    PROJECT_ROOT / "artifacts" / "hackathon_showcase" / "pathc_payload_latest.json"
)
DEFAULT_HISTORY = (
    PROJECT_ROOT / "artifacts" / "hackathon_showcase" / "pathc_history.jsonl"
)
DEFAULT_PARENT_BASE_URL = "http://127.0.0.1:8002"
DEFAULT_BRIDGE_SENDER_ARTIFACT = (
    PROJECT_ROOT / "contracts" / "l1_ezkl" / "out" / "L1EzklBridgeSender.sol" / "L1EzklBridgeSender.json"
)
STARKNET_FELT_MASK = (1 << 251) - 1
STARKNET_CORE_LOG_MESSAGE_TO_L2_TOPIC0 = (
    "0xdb80dd488acf86d17c747445b0eabb5d57c541d3bd7b6b87af987858e5066b2b"
)


def _load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip("'").strip('"')
    return out


def _first_non_empty(*values: str | None) -> str:
    for value in values:
        if value and str(value).strip():
            return str(value).strip()
    return ""


def _normalize_hex(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return ""
        return raw if raw.startswith("0x") else f"0x{raw}"
    try:
        return hex(int(value))
    except Exception:
        return str(value)


def _normalize_bridge_felt(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return ""
        value = int(raw, 16) if raw.startswith(("0x", "0X")) else int(raw)
    else:
        value = int(value)
    if value < 0:
        raise ValueError("bridge felt values must be non-negative")
    return hex(value & STARKNET_FELT_MASK)


def _normalize_public_inputs(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    out: list[str] = []
    for value in values:
        if isinstance(value, str):
            raw = value.strip()
            if raw and not raw.startswith("0x") and len(raw) == 64:
                lowered = raw.lower()
                if all(ch in "0123456789abcdef" for ch in lowered):
                    out.append(hex(int.from_bytes(bytes.fromhex(lowered), "little")))
                    continue
        out.append(_normalize_hex(value))
    return out


def _load_payload(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")

    proof_obj = data.get("proof") if isinstance(data.get("proof"), dict) else data
    proof_hex = _first_non_empty(
        data.get("proof_hex"),
        proof_obj.get("proof_hex") if isinstance(proof_obj, dict) else None,
        proof_obj.get("hex_proof") if isinstance(proof_obj, dict) else None,
    )
    public_inputs = (
        data.get("public_inputs")
        if isinstance(data.get("public_inputs"), list)
        else (proof_obj.get("public_inputs") if isinstance(proof_obj, dict) and isinstance(proof_obj.get("public_inputs"), list) else [])
    )
    if not public_inputs and isinstance(proof_obj, dict):
        instances = proof_obj.get("instances")
        if isinstance(instances, list) and instances and isinstance(instances[0], list):
            public_inputs = instances[0]

    model_hash = _first_non_empty(
        data.get("model_hash"),
        proof_obj.get("model_hash") if isinstance(proof_obj, dict) else None,
    )
    output_commitment = _first_non_empty(data.get("output_commitment"))
    raw_model_hash = _first_non_empty(
        data.get("raw_model_hash"),
        proof_obj.get("raw_model_hash") if isinstance(proof_obj, dict) else None,
        model_hash,
    )
    raw_output_commitment = _first_non_empty(
        data.get("raw_output_commitment"),
        proof_obj.get("raw_output_commitment") if isinstance(proof_obj, dict) else None,
        output_commitment,
    )
    bridge_model_hash = _first_non_empty(
        data.get("bridge_model_hash"),
        proof_obj.get("bridge_model_hash") if isinstance(proof_obj, dict) else None,
    )
    bridge_output_commitment = _first_non_empty(
        data.get("bridge_output_commitment"),
        proof_obj.get("bridge_output_commitment") if isinstance(proof_obj, dict) else None,
    )

    payload = {
        "proof_hex": proof_hex,
        "public_inputs": _normalize_public_inputs(public_inputs),
        "raw_model_hash": _normalize_hex(raw_model_hash) if raw_model_hash else "",
        "raw_output_commitment": _normalize_hex(raw_output_commitment) if raw_output_commitment else "",
        "bridge_model_hash": (
            _normalize_hex(bridge_model_hash)
            if bridge_model_hash
            else (_normalize_bridge_felt(raw_model_hash) if raw_model_hash else "")
        ),
        "bridge_output_commitment": (
            _normalize_hex(bridge_output_commitment)
            if bridge_output_commitment
            else (_normalize_bridge_felt(raw_output_commitment) if raw_output_commitment else "")
        ),
    }
    payload["model_hash"] = payload["bridge_model_hash"]
    payload["output_commitment"] = payload["bridge_output_commitment"]
    return payload


def _backend_root() -> Path:
    return PROJECT_ROOT / "backend"


def _parent_backend_root() -> Path:
    return PROJECT_ROOT.parent / "backend"


def _ensure_backend_import_path() -> None:
    backend_root = _backend_root()
    backend_root_str = str(backend_root)
    if backend_root_str not in sys.path:
        sys.path.insert(0, backend_root_str)


def _coerce_input_rows(raw: Any) -> list[list[float]]:
    candidate = raw
    if isinstance(candidate, dict) and isinstance(candidate.get("input_data"), list):
        candidate = candidate.get("input_data")
    if isinstance(candidate, list) and candidate and not isinstance(candidate[0], list):
        candidate = [candidate]
    if not isinstance(candidate, list) or not candidate:
        raise ValueError("Expected input_data as a list of rows")
    rows: list[list[float]] = []
    for row in candidate:
        if not isinstance(row, list):
            raise ValueError("Each input row must be a list")
        rows.append([float(value) for value in row])
    return rows


def _canonical_output_commitment(outputs: list[Any]) -> str:
    rounded = [str(int(round(float(value)))) for value in (outputs or [])]
    raw = ",".join(rounded).encode()
    return "0x" + hashlib.sha256(raw).hexdigest()


def _load_generated_input_rows(
    *,
    model_dir: Path,
    input_json_path: Path | None,
    sample_index: int,
) -> tuple[list[list[float]], str]:
    if input_json_path is not None:
        data = json.loads(input_json_path.read_text(encoding="utf-8"))
        return _coerce_input_rows(data), "input_json"

    calibration_path = model_dir / "calibration.json"
    if not calibration_path.exists():
        raise FileNotFoundError(
            f"No calibration.json found for model '{model_dir.name}' and no --input-json provided"
        )
    calibration = json.loads(calibration_path.read_text(encoding="utf-8"))
    rows = _coerce_input_rows(calibration)
    if sample_index < 0 or sample_index >= len(rows):
        raise ValueError(
            f"sample_index {sample_index} out of range for {model_dir.name} calibration set ({len(rows)} rows)"
        )
    return [rows[sample_index]], "calibration"


async def _generate_payload_from_local_model(
    *,
    model_name: str,
    input_json_path: Path | None,
    sample_index: int,
    generated_payload_path: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    _ensure_backend_import_path()

    from app.services.ezkl_prover_service import get_ezkl_prover
    from app.services.proof_pipeline import get_proof_pipeline

    pipeline = get_proof_pipeline()
    requested_model_name = str(model_name or "").strip()
    if not requested_model_name:
        raise ValueError("model_name is required")
    resolved_model_name = pipeline._resolve_local_ezkl_model_name(requested_model_name)
    model_dir = pipeline._local_ezkl_models_root() / resolved_model_name
    if not model_dir.exists():
        raise FileNotFoundError(f"Local EZKL model directory not found: {model_dir}")

    raw_rows, input_source = _load_generated_input_rows(
        model_dir=model_dir,
        input_json_path=input_json_path,
        sample_index=sample_index,
    )
    normalized_rows = pipeline._normalize_ezkl_input_data(
        resolved_model_name=resolved_model_name,
        input_data=raw_rows,
    )

    ezkl = get_ezkl_prover()
    artifacts = None
    try:
        artifacts = ezkl.get_artifacts(resolved_model_name)
    except Exception:
        artifacts = None
    if not artifacts or not artifacts.is_ready():
        onnx_path = pipeline._discover_local_onnx_path(resolved_model_name)
        if onnx_path is None:
            raise FileNotFoundError(f"Could not discover ONNX artifact for model '{resolved_model_name}'")
        artifacts = await ezkl.setup_model(resolved_model_name, onnx_path, force=False)
    if not artifacts or not artifacts.is_ready():
        raise RuntimeError(f"EZKL artifacts not ready for model '{resolved_model_name}'")

    proof = await ezkl.prove_inference(
        model_name=resolved_model_name,
        input_data=normalized_rows,
    )
    verified = await ezkl.verify_proof(proof)
    if not verified:
        raise RuntimeError(f"Local EZKL verify failed for model '{resolved_model_name}'")

    raw_proof_json = getattr(proof, "raw_proof_json", {}) or {}
    public_inputs_raw: list[Any] = []
    if isinstance(raw_proof_json.get("instances"), list):
        instances = raw_proof_json.get("instances") or []
        if instances and isinstance(instances[0], list):
            public_inputs_raw = instances[0]
    if not public_inputs_raw:
        public_inputs_raw = list(getattr(proof, "public_inputs", []) or [])

    payload = {
        "proof_hex": _first_non_empty(getattr(proof, "proof_hex", "")),
        "public_inputs": _normalize_public_inputs(public_inputs_raw),
        "raw_model_hash": _normalize_hex(getattr(proof, "model_hash", "")),
        "raw_output_commitment": _canonical_output_commitment(
            list(getattr(proof, "inference_output", []) or [])
        ),
    }
    payload["bridge_model_hash"] = _normalize_bridge_felt(payload["raw_model_hash"])
    payload["bridge_output_commitment"] = _normalize_bridge_felt(payload["raw_output_commitment"])
    payload["model_hash"] = payload["bridge_model_hash"]
    payload["output_commitment"] = payload["bridge_output_commitment"]
    if not payload["proof_hex"]:
        raise RuntimeError(f"Generated proof for '{resolved_model_name}' did not include proof_hex")
    if not payload["public_inputs"]:
        raise RuntimeError(f"Generated proof for '{resolved_model_name}' did not include public_inputs")
    if not payload["raw_model_hash"]:
        raise RuntimeError(f"Generated proof for '{resolved_model_name}' did not include model_hash")

    generated_payload = {
        **payload,
        "source_model_name": requested_model_name,
        "resolved_model_name": resolved_model_name,
        "input_source": input_source,
        "sample_index": sample_index,
        "input_data": raw_rows,
        "normalized_input_data": normalized_rows,
        "inference_output": list(getattr(proof, "inference_output", []) or []),
        "proof_hash": _normalize_hex(getattr(proof, "proof_hash", "")),
        "verify_key_hash": _normalize_hex(getattr(proof, "verify_key_hash", "")),
        "verified_local": True,
        "output_commitment_scheme": "sha256_csv_round_int_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    generated_payload_path.parent.mkdir(parents=True, exist_ok=True)
    generated_payload_path.write_text(json.dumps(generated_payload, indent=2) + "\n", encoding="utf-8")

    meta = {
        "source_model_name": requested_model_name,
        "resolved_model_name": resolved_model_name,
        "input_source": input_source,
        "sample_index": sample_index,
        "generated_payload": str(generated_payload_path),
        "raw_model_hash": payload["raw_model_hash"],
        "raw_output_commitment": payload["raw_output_commitment"],
        "bridge_model_hash": payload["bridge_model_hash"],
        "bridge_output_commitment": payload["bridge_output_commitment"],
        "output_commitment_scheme": "sha256_csv_round_int_v1",
        "verified_local": True,
    }
    return payload, meta


def _load_existing_artifact(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return data


def _artifact_timestamp(path: Path, value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def _parse_iso_datetime(raw: Any) -> datetime | None:
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _pathc_confirmation_latency_ms(artifact: dict[str, Any]) -> int | None:
    generated_at = _parse_iso_datetime(artifact.get("generated_at"))
    if generated_at is None:
        return None
    l2_last = artifact.get("l2_last") if isinstance(artifact.get("l2_last"), dict) else {}
    block_timestamp = l2_last.get("block_timestamp")
    try:
        block_timestamp_int = int(block_timestamp) if block_timestamp is not None else 0
    except Exception:
        block_timestamp_int = 0
    if block_timestamp_int > 0:
        latency_ms = int(round((float(block_timestamp_int) - generated_at.timestamp()) * 1000.0))
        return latency_ms if latency_ms > 0 else None
    last_checked_at = _parse_iso_datetime(artifact.get("last_checked_at"))
    if last_checked_at is None:
        return None
    latency_ms = int(round((last_checked_at - generated_at).total_seconds() * 1000.0))
    return latency_ms if latency_ms > 0 else None


def _pathc_history_row(artifact: dict[str, Any]) -> dict[str, Any]:
    generated_meta = (
        artifact.get("generated_payload_meta")
        if isinstance(artifact.get("generated_payload_meta"), dict)
        else {}
    )
    return {
        "generated_at": artifact.get("generated_at"),
        "last_checked_at": artifact.get("last_checked_at"),
        "mode": artifact.get("mode"),
        "tx_hash": artifact.get("tx_hash"),
        "message_hash": artifact.get("message_hash"),
        "used_nonce": artifact.get("used_nonce"),
        "route_key": artifact.get("route_key"),
        "route_source": artifact.get("route_source"),
        "verifier_address": artifact.get("verifier_address"),
        "bridge_sender_address": artifact.get("bridge_sender_address"),
        "source_model_name": (
            artifact.get("source_model_name")
            or generated_meta.get("source_model_name")
        ),
        "resolved_model_name": (
            artifact.get("resolved_model_name")
            or generated_meta.get("resolved_model_name")
        ),
        "input_source": (
            artifact.get("input_source")
            or generated_meta.get("input_source")
        ),
        "sample_index": (
            artifact.get("sample_index")
            if artifact.get("sample_index") is not None
            else generated_meta.get("sample_index")
        ),
        "raw_model_hash": artifact.get("raw_model_hash"),
        "bridge_model_hash": artifact.get("bridge_model_hash") or artifact.get("model_hash"),
        "raw_output_commitment": artifact.get("raw_output_commitment"),
        "bridge_output_commitment": artifact.get("bridge_output_commitment") or artifact.get("output_commitment"),
        "l1_status": (artifact.get("l1_receipt") or {}).get("status"),
        "l1_block_number": (artifact.get("l1_receipt") or {}).get("blockNumber"),
        "l1_gas_used": (artifact.get("l1_receipt") or {}).get("gasUsed"),
        "l2_verified": bool(artifact.get("l2_verified")),
        "l2_verified_on_l2": bool(((artifact.get("l2_last") or {}).get("verified_on_l2"))),
        "l2_block_timestamp": (artifact.get("l2_last") or {}).get("block_timestamp"),
        "confirmation_latency_ms": _pathc_confirmation_latency_ms(artifact),
    }


def _append_pathc_history(path: Path, row: dict[str, Any]) -> bool:
    tx_hash = str(row.get("tx_hash") or "").strip().lower()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            for raw in path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line:
                    continue
                parsed = json.loads(line)
                if not isinstance(parsed, dict):
                    continue
                existing_tx = str(parsed.get("tx_hash") or "").strip().lower()
                if tx_hash and existing_tx == tx_hash:
                    return False
        except Exception:
            pass
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, sort_keys=True) + "\n")
    return True


def _post_json(url: str, payload: dict[str, Any], timeout: float) -> tuple[int, dict[str, Any]]:
    response = httpx.post(url, json=payload, timeout=timeout)
    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text}
    return response.status_code, body if isinstance(body, dict) else {"raw": body}


def _get_json(url: str, params: dict[str, Any], timeout: float) -> tuple[int, dict[str, Any]]:
    response = httpx.get(url, params=params, timeout=timeout)
    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text}
    return response.status_code, body if isinstance(body, dict) else {"raw": body}


def _parent_backend_python() -> str:
    backend_root = _parent_backend_root()
    venv_python = backend_root / "venv" / "bin" / "python"
    if venv_python.exists():
        return str(venv_python)
    return sys.executable


def _run_parent_backend_subprocess(*, code: str, payload: dict[str, Any], timeout: float) -> tuple[int, dict[str, Any]]:
    proc = subprocess.run(
        [_parent_backend_python(), "-c", code],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=max(30, int(timeout)),
        cwd=str(_parent_backend_root()),
    )
    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()
    if proc.returncode != 0:
        return 502, {
            "success": False,
            "error": stderr or stdout or f"parent subprocess exited {proc.returncode}",
            "returncode": proc.returncode,
        }
    try:
        body = json.loads(stdout or "{}")
    except Exception:
        body = {"raw": stdout, "stderr": stderr}
    return 200, body if isinstance(body, dict) else {"raw": body}


def _post_json_with_parent_fallback(
    *,
    url: str,
    payload: dict[str, Any],
    timeout: float,
    enable_local_fallback: bool,
) -> tuple[int, dict[str, Any]]:
    try:
        return _post_json(url, payload, timeout)
    except Exception as exc:
        if not enable_local_fallback:
            raise
        code = r"""
import json, sys
from pathlib import Path
from dotenv import load_dotenv

repo_root = Path.cwd()
load_dotenv(repo_root / ".env")
sys.path.insert(0, str(repo_root))

from app.services.l1_ezkl_bridge_service import get_l1_ezkl_bridge_service

body = json.loads(sys.stdin.read())
svc = get_l1_ezkl_bridge_service()
proof_payload = body.get("proof_hex") or body.get("proof_calldata") or []
result = svc.submit_ezkl_proof_to_l1(
    proof_payload,
    body.get("public_inputs") or [],
    model_hash=body.get("model_hash"),
    raw_model_hash=body.get("raw_model_hash"),
    model_name=body.get("model_name"),
    output_commitment=body.get("output_commitment"),
    wait_for_l2=bool(body.get("wait_for_l2")),
    l2_max_polls=int(body.get("l2_max_polls") or 8),
    l2_poll_interval_seconds=float(body.get("l2_poll_interval_seconds") or 3.0),
)
verification_status_query = None
if result.used_nonce is not None and body.get("model_hash") not in (None, ""):
    verification_status_query = {
        "model_hash": str(body.get("model_hash")),
        "nonce": str(result.used_nonce),
    }
print(json.dumps({
    "success": result.success,
    "tx_hash": result.tx_hash,
    "mode": result.mode,
    "route_key": result.route_key or None,
    "route_source": result.route_source or None,
    "verifier_address": result.verifier_address or None,
    "bridge_sender_address": result.bridge_sender_address or None,
    "used_nonce": result.used_nonce,
    "message_hash": result.message_hash or None,
    "verified_on_l2": result.l2_verified_on_l2,
    "l2_output_commitment": result.l2_output_commitment,
    "l2_block_timestamp": result.l2_block_timestamp,
    "l2_poll_attempts": result.l2_poll_attempts,
    "verification_status_query": verification_status_query,
    "not_configured": result.not_configured,
    "error": result.error,
    "fallback": "local_parent_service",
}))
"""
        body = dict(payload)
        body["_fallback_error"] = str(exc)
        return _run_parent_backend_subprocess(code=code, payload=body, timeout=timeout)


def _get_json_with_parent_fallback(
    *,
    url: str,
    params: dict[str, Any],
    timeout: float,
    enable_local_fallback: bool,
) -> tuple[int, dict[str, Any]]:
    try:
        return _get_json(url, params, timeout)
    except Exception as exc:
        if not enable_local_fallback:
            raise
        code = r"""
import json, sys
from pathlib import Path
from dotenv import load_dotenv

repo_root = Path.cwd()
load_dotenv(repo_root / ".env")
sys.path.insert(0, str(repo_root))

from app.services.l1_ezkl_bridge_service import get_l1_ezkl_bridge_service

params = json.loads(sys.stdin.read())
svc = get_l1_ezkl_bridge_service()
status = svc.poll_l2_for_verification(params.get("model_hash") or "0", params.get("nonce") or "0")
print(json.dumps({
    "verified_on_l2": status.verified_on_l2,
    "output_commitment": status.output_commitment,
    "block_timestamp": status.block_timestamp,
    "verified": status.verified,
    "not_configured": status.not_configured,
    "error": status.error,
    "fallback": "local_parent_service",
}))
"""
        body = dict(params)
        body["_fallback_error"] = str(exc)
        return _run_parent_backend_subprocess(code=code, payload=body, timeout=timeout)


def _fetch_l1_receipt(rpc_url: str, tx_hash: str, timeout: float) -> dict[str, Any]:
    if not rpc_url or not tx_hash:
        return {}
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_getTransactionReceipt",
        "params": [tx_hash],
    }
    response = httpx.post(rpc_url, json=payload, timeout=timeout)
    data = response.json()
    result = data.get("result") if isinstance(data, dict) else None
    return result if isinstance(result, dict) else {}


def _decode_bridge_event(
    *,
    receipt: dict[str, Any],
    sender_address: str,
    artifact_path: Path,
) -> dict[str, Any]:
    if not receipt or not sender_address or not artifact_path.exists():
        return {}
    def _manual_decode() -> dict[str, Any]:
        sender_norm = sender_address.lower()
        logs = receipt.get("logs")
        if not isinstance(logs, list):
            return {}
        topic0_expected = (
            "0x75c90c773d78e379aaaee2b3cc5be5d0cd3b70f8e2b773a402f709c7f07f7e99"
        )
        for raw_log in logs:
            if not isinstance(raw_log, dict):
                continue
            if str(raw_log.get("address") or "").lower() != sender_norm:
                continue
            topics = raw_log.get("topics")
            if not isinstance(topics, list) or len(topics) < 4:
                continue
            if str(topics[0] or "").lower() != topic0_expected:
                continue
            try:
                caller = "0x" + str(topics[1])[-40:]
                used_nonce = int(str(topics[2]), 16)
                model_hash = _normalize_hex(str(topics[3]))
                data_hex = str(raw_log.get("data") or "")
                if data_hex.startswith("0x"):
                    data_hex = data_hex[2:]
                if len(data_hex) < 128:
                    continue
                output_commitment = "0x" + data_hex[:64]
                message_hash = "0x" + data_hex[64:128]
                return {
                    "caller": caller,
                    "used_nonce": used_nonce,
                    "model_hash": model_hash,
                    "output_commitment": output_commitment,
                    "message_hash": message_hash,
                }
            except Exception:
                continue
        return {}
    try:
        from web3 import Web3
        from web3._utils.events import get_event_data
    except Exception:
        return _manual_decode()

    try:
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        abi = artifact.get("abi") if isinstance(artifact, dict) else None
        if not isinstance(abi, list):
            return {}
        event_abi = next(
            (
                item
                for item in abi
                if isinstance(item, dict)
                and item.get("type") == "event"
                and item.get("name") == "EzklVerifiedAndBridged"
            ),
            None,
        )
        if not isinstance(event_abi, dict):
            return {}

        w3 = Web3()
        topic0_expected = Web3.keccak(
            text="EzklVerifiedAndBridged(address,uint256,uint256,uint256,bytes32)"
        ).hex().lower()
        sender_norm = sender_address.lower()
        logs = receipt.get("logs")
        if not isinstance(logs, list):
            return {}

        for raw_log in logs:
            if not isinstance(raw_log, dict):
                continue
            if str(raw_log.get("address") or "").lower() != sender_norm:
                continue
            topics = raw_log.get("topics")
            if not isinstance(topics, list) or not topics:
                continue
            if str(topics[0] or "").lower() != topic0_expected:
                continue
            decoded = get_event_data(w3.codec, event_abi, raw_log)
            args = decoded.get("args") if isinstance(decoded, dict) else None
            if not isinstance(args, dict):
                continue
            return {
                "caller": _normalize_hex(args.get("caller")),
                "used_nonce": int(args.get("nonce")) if args.get("nonce") is not None else None,
                "model_hash": _normalize_hex(args.get("modelHash")),
                "output_commitment": _normalize_hex(args.get("outputCommitment")),
                "message_hash": _normalize_hex(args.get("messageHash")),
            }
    except Exception:
        return _manual_decode()
    return _manual_decode()


def _extract_core_message_log(receipt: dict[str, Any]) -> dict[str, Any]:
    if not receipt:
        return {}
    logs = receipt.get("logs")
    if not isinstance(logs, list):
        return {}
    for raw_log in logs:
        if not isinstance(raw_log, dict):
            continue
        topics = raw_log.get("topics")
        if not isinstance(topics, list) or len(topics) < 4:
            continue
        if str(topics[0] or "").lower() != STARKNET_CORE_LOG_MESSAGE_TO_L2_TOPIC0:
            continue
        return {
            "core_address": _normalize_hex(raw_log.get("address")),
            "from_address": _normalize_hex(str(topics[1])[-40:]),
            "to_address": _normalize_hex(topics[2]),
            "selector": _normalize_hex(topics[3]),
        }
    return {}


def _fetch_core_message_state(
    *,
    rpc_url: str,
    core_address: str,
    message_hash: str,
) -> dict[str, Any]:
    if not rpc_url or not core_address or not message_hash:
        return {}
    abi = [
        {
            "inputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
            "name": "l1ToL2Messages",
            "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
            "stateMutability": "view",
            "type": "function",
        }
    ]
    try:
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        contract = w3.eth.contract(address=Web3.to_checksum_address(core_address), abi=abi)
        raw_value = contract.functions.l1ToL2Messages(message_hash).call()
        slot_value = (
            int.from_bytes(raw_value, "big")
            if isinstance(raw_value, (bytes, bytearray))
            else int(raw_value)
        )
        return {
            "core_address": Web3.to_checksum_address(core_address),
            "message_hash": _normalize_hex(message_hash),
            "slot_value": hex(slot_value),
            "pending": slot_value != 0,
        }
    except Exception as exc:
        return {
            "core_address": _normalize_hex(core_address),
            "message_hash": _normalize_hex(message_hash),
            "pending": False,
            "error": str(exc),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture a live Path C L1->L2 bridge receipt into pathc_latest.json.")
    parser.add_argument("--payload-json", help="JSON file with proof_hex/public_inputs/model_hash/output_commitment.")
    parser.add_argument(
        "--model-name",
        help="Generate a fresh Path C payload from a local first-party EZKL model before submitting.",
    )
    parser.add_argument(
        "--input-json",
        help="Optional JSON file with input_data rows for --model-name. Defaults to calibration.json sample.",
    )
    parser.add_argument(
        "--sample-index",
        type=int,
        default=0,
        help="Calibration sample index to use when --model-name is set and --input-json is omitted.",
    )
    parser.add_argument(
        "--generated-payload",
        default=str(DEFAULT_GENERATED_PAYLOAD),
        help="Where to write the generated payload JSON when --model-name is used.",
    )
    parser.add_argument(
        "--no-local-parent-fallback",
        dest="local_parent_fallback",
        action="store_false",
        help="Disable same-host fallback to the parent backend service when the parent HTTP API is blocked or times out.",
    )
    parser.set_defaults(local_parent_fallback=True)
    parser.add_argument(
        "--refresh-artifact",
        help="Existing pathc_latest.json to refresh in place without submitting a new verifyAndBridge call.",
    )
    parser.add_argument("--parent-base-url", default=os.getenv("PARENT_BASE_URL", DEFAULT_PARENT_BASE_URL))
    parser.add_argument("--artifact", default=str(DEFAULT_ARTIFACT))
    parser.add_argument("--pending-artifact", default=str(DEFAULT_PENDING_ARTIFACT))
    parser.add_argument("--history-file", default=str(DEFAULT_HISTORY))
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--wait-for-l2", action="store_true", default=True)
    parser.add_argument("--no-wait-for-l2", dest="wait_for_l2", action="store_false")
    parser.add_argument("--l2-max-polls", type=int, default=12)
    parser.add_argument("--l2-poll-interval-seconds", type=float, default=5.0)
    parser.add_argument("--l1-rpc", default="")
    parser.add_argument("--bridge-sender-artifact", default=str(DEFAULT_BRIDGE_SENDER_ARTIFACT))
    args = parser.parse_args()

    selected_sources = sum(
        1
        for flag in (
            bool(args.payload_json),
            bool(args.model_name),
            bool(args.refresh_artifact),
        )
        if flag
    )
    if selected_sources != 1:
        raise SystemExit("provide exactly one of --payload-json, --model-name, or --refresh-artifact")

    parent_base = str(args.parent_base_url).rstrip("/")
    verify_url = f"{parent_base}/api/v1/aggregation/l1/verify"
    status_url = f"{parent_base}/api/v1/aggregation/l1/verification-status"

    payload_path: Path | None = None
    existing_artifact: dict[str, Any] = {}
    payload: dict[str, Any]
    generated_payload_meta: dict[str, Any] | None = None
    verify_status: int | None = None
    verify_result: dict[str, Any] = {}
    tx_hash = ""
    query = None
    used_nonce = None
    message_hash = ""
    route_model_name = ""

    if args.model_name:
        payload_path = Path(args.generated_payload).expanduser().resolve()
        input_json_path = (
            Path(args.input_json).expanduser().resolve() if args.input_json else None
        )
        payload, generated_payload_meta = asyncio.run(
            _generate_payload_from_local_model(
                model_name=args.model_name,
                input_json_path=input_json_path,
                sample_index=int(args.sample_index),
                generated_payload_path=payload_path,
            )
        )
        verify_body = {
            "proof_hex": payload["proof_hex"],
            "public_inputs": payload["public_inputs"],
            "raw_model_hash": payload["raw_model_hash"],
            "model_hash": payload["bridge_model_hash"],
            "model_name": (generated_payload_meta or {}).get("resolved_model_name"),
            "output_commitment": payload["bridge_output_commitment"],
            "wait_for_l2": bool(args.wait_for_l2),
            "l2_max_polls": int(args.l2_max_polls),
            "l2_poll_interval_seconds": float(args.l2_poll_interval_seconds),
        }
        route_model_name = str(verify_body.get("model_name") or "")
        verify_status, verify_result = _post_json_with_parent_fallback(
            url=verify_url,
            payload=verify_body,
            timeout=args.timeout,
            enable_local_fallback=bool(args.local_parent_fallback),
        )
        if verify_status != 200 or not verify_result.get("success"):
            print(json.dumps({"verify_status": verify_status, "verify_result": verify_result}, indent=2))
            raise SystemExit(1)

        tx_hash = _normalize_hex(_first_non_empty(verify_result.get("tx_hash")))
        query = verify_result.get("verification_status_query")
        used_nonce = verify_result.get("used_nonce")
        message_hash = _first_non_empty(verify_result.get("message_hash"))
    elif args.payload_json:
        payload_path = Path(args.payload_json).expanduser().resolve()
        payload = _load_payload(payload_path)
        payload_source_data = _load_existing_artifact(payload_path)
        if not payload.get("proof_hex"):
            raise SystemExit("payload missing proof_hex")
        if not payload.get("model_hash"):
            raise SystemExit("payload missing model_hash")
        if not payload.get("output_commitment"):
            raise SystemExit("payload missing output_commitment")

        verify_body = {
            "proof_hex": payload["proof_hex"],
            "public_inputs": payload["public_inputs"],
            "raw_model_hash": payload["raw_model_hash"],
            "model_hash": payload["bridge_model_hash"],
            "model_name": _first_non_empty(
                payload_source_data.get("resolved_model_name"),
                payload_source_data.get("source_model_name"),
            ) or None,
            "output_commitment": payload["bridge_output_commitment"],
            "wait_for_l2": bool(args.wait_for_l2),
            "l2_max_polls": int(args.l2_max_polls),
            "l2_poll_interval_seconds": float(args.l2_poll_interval_seconds),
        }
        route_model_name = str(verify_body.get("model_name") or "")
        verify_status, verify_result = _post_json_with_parent_fallback(
            url=verify_url,
            payload=verify_body,
            timeout=args.timeout,
            enable_local_fallback=bool(args.local_parent_fallback),
        )
        if verify_status != 200 or not verify_result.get("success"):
            print(json.dumps({"verify_status": verify_status, "verify_result": verify_result}, indent=2))
            raise SystemExit(1)

        tx_hash = _normalize_hex(_first_non_empty(verify_result.get("tx_hash")))
        query = verify_result.get("verification_status_query")
        used_nonce = verify_result.get("used_nonce")
        message_hash = _first_non_empty(verify_result.get("message_hash"))
    else:
        refresh_path = Path(args.refresh_artifact).expanduser().resolve()
        existing_artifact = _load_existing_artifact(refresh_path)
        payload = {
            "proof_hex": "",
            "public_inputs": _normalize_public_inputs(existing_artifact.get("public_inputs")),
            "raw_model_hash": _normalize_hex(
                existing_artifact.get("raw_model_hash") or existing_artifact.get("model_hash")
            ),
            "raw_output_commitment": _normalize_hex(
                existing_artifact.get("raw_output_commitment") or existing_artifact.get("output_commitment")
            ),
            "bridge_model_hash": _normalize_hex(
                existing_artifact.get("bridge_model_hash") or existing_artifact.get("model_hash")
            ),
            "bridge_output_commitment": _normalize_hex(
                existing_artifact.get("bridge_output_commitment") or existing_artifact.get("output_commitment")
            ),
        }
        payload["model_hash"] = payload["bridge_model_hash"]
        payload["output_commitment"] = payload["bridge_output_commitment"]
        tx_hash = _normalize_hex(_first_non_empty(existing_artifact.get("tx_hash")))
        if not tx_hash:
            raise SystemExit("refresh artifact missing tx_hash")
        query = existing_artifact.get("verification_status_query")
        used_nonce = existing_artifact.get("used_nonce")
        message_hash = _first_non_empty(existing_artifact.get("message_hash"))
        if not payload.get("bridge_model_hash"):
            raise SystemExit("refresh artifact missing model_hash")
        if not payload.get("bridge_output_commitment"):
            raise SystemExit("refresh artifact missing output_commitment")
        if not isinstance(query, dict) and used_nonce is not None:
            query = {"model_hash": payload["bridge_model_hash"], "nonce": str(used_nonce)}
        route_model_name = _first_non_empty(
            existing_artifact.get("resolved_model_name"),
            existing_artifact.get("source_model_name"),
            (
                existing_artifact.get("generated_payload_meta") or {}
            ).get("resolved_model_name")
            if isinstance(existing_artifact.get("generated_payload_meta"), dict)
            else None,
        )

    l2_status = {}
    l2_status_code = None
    if isinstance(query, dict) and query.get("model_hash") and query.get("nonce"):
        l2_status_code, l2_status = _get_json_with_parent_fallback(
            url=status_url,
            params={"model_hash": str(query["model_hash"]), "nonce": str(query["nonce"])},
            timeout=args.timeout,
            enable_local_fallback=bool(args.local_parent_fallback),
        )

    parent_env = _load_env_file(PROJECT_ROOT.parent / "backend" / ".env")
    l1_rpc = _first_non_empty(args.l1_rpc, os.getenv("L1_SEPOLIA_RPC"), parent_env.get("L1_SEPOLIA_RPC"))
    l1_receipt = _fetch_l1_receipt(l1_rpc, tx_hash, args.timeout)
    sender_address = _first_non_empty(
        verify_result.get("bridge_sender_address"),
        os.getenv("L1_EZKL_BRIDGE_SENDER_ADDRESS"),
        parent_env.get("L1_EZKL_BRIDGE_SENDER_ADDRESS"),
        existing_artifact.get("bridge_sender_address") if isinstance(existing_artifact, dict) else None,
        existing_artifact.get("sender_address") if isinstance(existing_artifact, dict) else None,
    )
    bridge_event = _decode_bridge_event(
        receipt=l1_receipt,
        sender_address=sender_address,
        artifact_path=Path(args.bridge_sender_artifact).expanduser().resolve(),
    )
    core_message_log = _extract_core_message_log(l1_receipt)
    if bridge_event.get("used_nonce") is not None:
        used_nonce = bridge_event.get("used_nonce")
    message_hash = _first_non_empty(bridge_event.get("message_hash"), message_hash)
    if not isinstance(query, dict) and used_nonce is not None:
        query = {"model_hash": payload["bridge_model_hash"], "nonce": str(used_nonce)}
    elif isinstance(query, dict) and used_nonce is not None and not query.get("nonce"):
        query["nonce"] = str(used_nonce)
        query.setdefault("model_hash", payload["bridge_model_hash"])

    now_iso = datetime.now(timezone.utc).isoformat()
    refresh_poll_entry = (
        {
            "attempt": 1,
            "status_code": l2_status_code,
            "verified": bool(l2_status.get("verified")),
            "verified_on_l2": bool(l2_status.get("verified_on_l2")),
            "output_commitment": l2_status.get("output_commitment"),
            "block_timestamp": l2_status.get("block_timestamp"),
            "error": l2_status.get("error"),
            "checked_at": now_iso,
        }
        if l2_status_code is not None
        else None
    )
    existing_polls = existing_artifact.get("l2_polls") if isinstance(existing_artifact.get("l2_polls"), list) else []
    l2_polls = list(existing_polls)
    if refresh_poll_entry is not None:
        l2_polls.append(refresh_poll_entry)
    core_message_state = _fetch_core_message_state(
        rpc_url=l1_rpc,
        core_address=str(core_message_log.get("core_address") or ""),
        message_hash=message_hash,
    )

    artifact = {
        "generated_at": (
            now_iso
            if args.payload_json
            else (
                now_iso
                if args.model_name
                else _artifact_timestamp(refresh_path, existing_artifact.get("generated_at"))
            )
        ),
        "last_checked_at": now_iso,
        "source_payload": str(payload_path) if payload_path else existing_artifact.get("source_payload"),
        "mode": verify_result.get("mode") or existing_artifact.get("mode"),
        "tx_hash": tx_hash,
        "raw_model_hash": payload["raw_model_hash"],
        "raw_output_commitment": payload["raw_output_commitment"],
        "bridge_model_hash": payload["bridge_model_hash"],
        "bridge_output_commitment": payload["bridge_output_commitment"],
        "model_hash": payload["bridge_model_hash"],
        "output_commitment": payload["bridge_output_commitment"],
        "used_nonce": used_nonce,
        "message_hash": message_hash,
        "l1_receipt": {
            "status": int(l1_receipt.get("status", "0x0"), 16) if l1_receipt.get("status") else None,
            "blockNumber": int(l1_receipt.get("blockNumber", "0x0"), 16) if l1_receipt.get("blockNumber") else None,
            "gasUsed": int(l1_receipt.get("gasUsed", "0x0"), 16) if l1_receipt.get("gasUsed") else None,
        },
        "l1_core_message_log": core_message_log or existing_artifact.get("l1_core_message_log") or None,
        "l1_core_message_state": core_message_state or existing_artifact.get("l1_core_message_state") or None,
        "l1_bridge_event": bridge_event or existing_artifact.get("l1_bridge_event") or None,
        "l2_verified": bool(
            verify_result.get("verified_on_l2")
            or l2_status.get("verified_on_l2")
            or existing_artifact.get("l2_verified")
        ),
        "l2_last": {
            "verified": bool(l2_status.get("verified") or (existing_artifact.get("l2_last") or {}).get("verified")),
            "verified_on_l2": bool(
                l2_status.get("verified_on_l2")
                or verify_result.get("verified_on_l2")
                or (existing_artifact.get("l2_last") or {}).get("verified_on_l2")
            ),
            "output_commitment": (
                l2_status.get("output_commitment")
                or verify_result.get("l2_output_commitment")
                or (existing_artifact.get("l2_last") or {}).get("output_commitment")
            ),
            "block_timestamp": (
                l2_status.get("block_timestamp")
                or verify_result.get("l2_block_timestamp")
                or (existing_artifact.get("l2_last") or {}).get("block_timestamp")
            ),
        },
        "l2_polls": l2_polls,
        "verification_status_query": query,
        "verify_result": verify_result or existing_artifact.get("verify_result"),
        "verify_status_code": verify_status if verify_status is not None else existing_artifact.get("verify_status_code"),
        "route_key": verify_result.get("route_key") or existing_artifact.get("route_key"),
        "route_source": verify_result.get("route_source") or existing_artifact.get("route_source"),
        "verifier_address": verify_result.get("verifier_address") or existing_artifact.get("verifier_address"),
        "bridge_sender_address": verify_result.get("bridge_sender_address") or existing_artifact.get("bridge_sender_address") or sender_address,
        "sender_address": verify_result.get("bridge_sender_address") or existing_artifact.get("sender_address") or sender_address,
        "generated_payload_meta": generated_payload_meta or existing_artifact.get("generated_payload_meta"),
        "source_model_name": (
            (generated_payload_meta or {}).get("source_model_name")
            or ((existing_artifact.get("generated_payload_meta") or {}).get("source_model_name") if isinstance(existing_artifact.get("generated_payload_meta"), dict) else None)
            or existing_artifact.get("source_model_name")
        ),
        "resolved_model_name": (
            (generated_payload_meta or {}).get("resolved_model_name")
            or ((existing_artifact.get("generated_payload_meta") or {}).get("resolved_model_name") if isinstance(existing_artifact.get("generated_payload_meta"), dict) else None)
            or route_model_name
            or existing_artifact.get("resolved_model_name")
        ),
        "input_source": (
            (generated_payload_meta or {}).get("input_source")
            or ((existing_artifact.get("generated_payload_meta") or {}).get("input_source") if isinstance(existing_artifact.get("generated_payload_meta"), dict) else None)
            or existing_artifact.get("input_source")
        ),
        "sample_index": (
            (generated_payload_meta or {}).get("sample_index")
            if (generated_payload_meta or {}).get("sample_index") is not None
            else (
                (existing_artifact.get("generated_payload_meta") or {}).get("sample_index")
                if isinstance(existing_artifact.get("generated_payload_meta"), dict)
                and (existing_artifact.get("generated_payload_meta") or {}).get("sample_index") is not None
                else existing_artifact.get("sample_index")
            )
        ),
        "output_commitment_scheme": (
            (generated_payload_meta or {}).get("output_commitment_scheme")
            or ((existing_artifact.get("generated_payload_meta") or {}).get("output_commitment_scheme") if isinstance(existing_artifact.get("generated_payload_meta"), dict) else None)
            or existing_artifact.get("output_commitment_scheme")
        ),
    }

    artifact_path = Path(args.artifact).expanduser().resolve()
    pending_artifact_path = Path(args.pending_artifact).expanduser().resolve()
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    pending_artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_live = bool(
        artifact.get("l2_verified")
        or ((artifact.get("l2_last") or {}).get("verified_on_l2") if isinstance(artifact.get("l2_last"), dict) else False)
    )
    current_primary: dict[str, Any] = {}
    if artifact_path.exists():
        try:
            current_primary = _load_existing_artifact(artifact_path)
        except Exception:
            current_primary = {}
    current_primary_live = bool(
        current_primary.get("l2_verified")
        or ((current_primary.get("l2_last") or {}).get("verified_on_l2") if isinstance(current_primary.get("l2_last"), dict) else False)
    )
    promote_to_primary = artifact_live or not current_primary_live
    write_path = artifact_path if promote_to_primary else pending_artifact_path
    write_path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    if promote_to_primary and pending_artifact_path.exists():
        remove_pending = False
        try:
            pending_existing = _load_existing_artifact(pending_artifact_path)
            pending_tx = str(pending_existing.get("tx_hash") or "").strip().lower()
            current_tx = str(tx_hash or "").strip().lower()
            if current_tx and pending_tx == current_tx:
                remove_pending = True
        except Exception:
            if Path(args.refresh_artifact or "").expanduser().resolve() == pending_artifact_path:
                remove_pending = True
        if remove_pending:
            try:
                pending_artifact_path.unlink()
            except FileNotFoundError:
                pass
    history_path = Path(args.history_file).expanduser().resolve()
    history_row = _pathc_history_row(artifact)
    history_appended = _append_pathc_history(history_path, history_row)
    print(
        json.dumps(
            {
                "artifact": str(write_path),
                "primary_artifact": str(artifact_path),
                "pending_artifact": str(pending_artifact_path),
                "promoted_to_primary": promote_to_primary,
                "history_file": str(history_path),
                "history_appended": history_appended,
                "tx_hash": tx_hash,
                "used_nonce": artifact["used_nonce"],
                "route_key": artifact.get("route_key"),
                "route_source": artifact.get("route_source"),
                "resolved_model_name": artifact.get("resolved_model_name"),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
