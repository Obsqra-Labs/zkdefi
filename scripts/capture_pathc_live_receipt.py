#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT = PROJECT_ROOT / "artifacts" / "hackathon_showcase" / "pathc_latest.json"
DEFAULT_PARENT_BASE_URL = "http://127.0.0.1:8002"
DEFAULT_BRIDGE_SENDER_ARTIFACT = (
    PROJECT_ROOT / "contracts" / "l1_ezkl" / "out" / "L1EzklBridgeSender.sol" / "L1EzklBridgeSender.json"
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


def _normalize_public_inputs(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    out: list[str] = []
    for value in values:
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

    payload = {
        "proof_hex": proof_hex,
        "public_inputs": _normalize_public_inputs(public_inputs),
        "model_hash": _normalize_hex(model_hash) if model_hash else "",
        "output_commitment": _normalize_hex(output_commitment) if output_commitment else "",
    }
    return payload


def _load_existing_artifact(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return data


def _artifact_timestamp(path: Path, value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


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
    try:
        from web3 import Web3
        from web3._utils.events import get_event_data
    except Exception:
        return {}

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
        return {}
    return {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture a live Path C L1->L2 bridge receipt into pathc_latest.json.")
    parser.add_argument("--payload-json", help="JSON file with proof_hex/public_inputs/model_hash/output_commitment.")
    parser.add_argument(
        "--refresh-artifact",
        help="Existing pathc_latest.json to refresh in place without submitting a new verifyAndBridge call.",
    )
    parser.add_argument("--parent-base-url", default=os.getenv("PARENT_BASE_URL", DEFAULT_PARENT_BASE_URL))
    parser.add_argument("--artifact", default=str(DEFAULT_ARTIFACT))
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--wait-for-l2", action="store_true", default=True)
    parser.add_argument("--no-wait-for-l2", dest="wait_for_l2", action="store_false")
    parser.add_argument("--l2-max-polls", type=int, default=12)
    parser.add_argument("--l2-poll-interval-seconds", type=float, default=5.0)
    parser.add_argument("--l1-rpc", default="")
    parser.add_argument("--bridge-sender-artifact", default=str(DEFAULT_BRIDGE_SENDER_ARTIFACT))
    args = parser.parse_args()

    if not args.payload_json and not args.refresh_artifact:
        raise SystemExit("provide --payload-json or --refresh-artifact")

    parent_base = str(args.parent_base_url).rstrip("/")
    verify_url = f"{parent_base}/api/v1/aggregation/l1/verify"
    status_url = f"{parent_base}/api/v1/aggregation/l1/verification-status"

    payload_path: Path | None = None
    existing_artifact: dict[str, Any] = {}
    payload: dict[str, Any]
    verify_status: int | None = None
    verify_result: dict[str, Any] = {}
    tx_hash = ""
    query = None
    used_nonce = None
    message_hash = ""

    if args.payload_json:
        payload_path = Path(args.payload_json).expanduser().resolve()
        payload = _load_payload(payload_path)
        if not payload.get("proof_hex"):
            raise SystemExit("payload missing proof_hex")
        if not payload.get("model_hash"):
            raise SystemExit("payload missing model_hash")
        if not payload.get("output_commitment"):
            raise SystemExit("payload missing output_commitment")

        verify_body = {
            "proof_hex": payload["proof_hex"],
            "public_inputs": payload["public_inputs"],
            "model_hash": payload["model_hash"],
            "output_commitment": payload["output_commitment"],
            "wait_for_l2": bool(args.wait_for_l2),
            "l2_max_polls": int(args.l2_max_polls),
            "l2_poll_interval_seconds": float(args.l2_poll_interval_seconds),
        }
        verify_status, verify_result = _post_json(verify_url, verify_body, args.timeout)
        if verify_status != 200 or not verify_result.get("success"):
            print(json.dumps({"verify_status": verify_status, "verify_result": verify_result}, indent=2))
            raise SystemExit(1)

        tx_hash = _first_non_empty(verify_result.get("tx_hash"))
        query = verify_result.get("verification_status_query")
        used_nonce = verify_result.get("used_nonce")
        message_hash = _first_non_empty(verify_result.get("message_hash"))
    else:
        refresh_path = Path(args.refresh_artifact).expanduser().resolve()
        existing_artifact = _load_existing_artifact(refresh_path)
        payload = {
            "proof_hex": "",
            "public_inputs": _normalize_public_inputs(existing_artifact.get("public_inputs")),
            "model_hash": _normalize_hex(existing_artifact.get("model_hash")),
            "output_commitment": _normalize_hex(existing_artifact.get("output_commitment")),
        }
        tx_hash = _first_non_empty(existing_artifact.get("tx_hash"))
        if not tx_hash:
            raise SystemExit("refresh artifact missing tx_hash")
        query = existing_artifact.get("verification_status_query")
        used_nonce = existing_artifact.get("used_nonce")
        message_hash = _first_non_empty(existing_artifact.get("message_hash"))
        if not payload.get("model_hash"):
            raise SystemExit("refresh artifact missing model_hash")
        if not payload.get("output_commitment"):
            raise SystemExit("refresh artifact missing output_commitment")
        if not isinstance(query, dict) and used_nonce is not None:
            query = {"model_hash": payload["model_hash"], "nonce": str(used_nonce)}

    l2_status = {}
    l2_status_code = None
    if isinstance(query, dict) and query.get("model_hash") and query.get("nonce"):
        l2_status_code, l2_status = _get_json(
            status_url,
            {"model_hash": str(query["model_hash"]), "nonce": str(query["nonce"])},
            args.timeout,
        )

    parent_env = _load_env_file(PROJECT_ROOT.parent / "backend" / ".env")
    l1_rpc = _first_non_empty(args.l1_rpc, os.getenv("L1_SEPOLIA_RPC"), parent_env.get("L1_SEPOLIA_RPC"))
    l1_receipt = _fetch_l1_receipt(l1_rpc, tx_hash, args.timeout)
    sender_address = _first_non_empty(
        os.getenv("L1_EZKL_BRIDGE_SENDER_ADDRESS"),
        parent_env.get("L1_EZKL_BRIDGE_SENDER_ADDRESS"),
        existing_artifact.get("sender_address") if isinstance(existing_artifact, dict) else None,
    )
    bridge_event = _decode_bridge_event(
        receipt=l1_receipt,
        sender_address=sender_address,
        artifact_path=Path(args.bridge_sender_artifact).expanduser().resolve(),
    )
    if used_nonce is None:
        used_nonce = bridge_event.get("used_nonce")
    message_hash = _first_non_empty(message_hash, bridge_event.get("message_hash"))
    if not isinstance(query, dict) and used_nonce is not None:
        query = {"model_hash": payload["model_hash"], "nonce": str(used_nonce)}
    elif isinstance(query, dict) and used_nonce is not None and not query.get("nonce"):
        query["nonce"] = str(used_nonce)
        query.setdefault("model_hash", payload["model_hash"])

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

    artifact = {
        "generated_at": (
            now_iso
            if args.payload_json
            else _artifact_timestamp(refresh_path, existing_artifact.get("generated_at"))
        ),
        "last_checked_at": now_iso,
        "source_payload": str(payload_path) if payload_path else existing_artifact.get("source_payload"),
        "mode": verify_result.get("mode") or existing_artifact.get("mode"),
        "tx_hash": tx_hash,
        "model_hash": payload["model_hash"],
        "output_commitment": payload["output_commitment"],
        "used_nonce": used_nonce,
        "message_hash": message_hash,
        "l1_receipt": {
            "status": int(l1_receipt.get("status", "0x0"), 16) if l1_receipt.get("status") else None,
            "blockNumber": int(l1_receipt.get("blockNumber", "0x0"), 16) if l1_receipt.get("blockNumber") else None,
            "gasUsed": int(l1_receipt.get("gasUsed", "0x0"), 16) if l1_receipt.get("gasUsed") else None,
        },
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
    }

    artifact_path = Path(args.artifact).expanduser().resolve()
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"artifact": str(artifact_path), "tx_hash": tx_hash, "used_nonce": artifact["used_nonce"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
