"""
Canonical zkde.fi Receipt Vault bundle helpers.

The bundle format is intentionally plain JSON so a receipt can be exported,
shared, and verified without relying on zkde.fi-specific code.
"""

from __future__ import annotations

import copy
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[3]
RECEIPT_VAULT_HELPER = REPO_ROOT / "receiptos" / "attester" / "receipt_vault.mjs"
RECEIPT_BUNDLE_SCHEMA_PATH = (
    REPO_ROOT / "receiptos" / "docs" / "receipt-vault" / "receipt_bundle_schema.json"
)

def _detect_chain() -> str:
    rpc = os.getenv("RECEIPTOS_STARKNET_RPC", "").strip().lower()
    if "sepolia" in rpc:
        return "starknet_sepolia"
    if rpc:
        return "starknet"
    return "starknet_sepolia"


DEFAULT_CHAIN = _detect_chain()
DEFAULT_DISCLOSURE = {
    "public_fields": [
        "action_type",
        "timestamp",
        "policy_result.allowed",
        "policy_result.tier",
    ],
    "private_fields": [
        "subject",
        "proof_hashes.proof_hash",
    ],
    "disclosure_mode": "full",
}


def _sort_keys(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _sort_keys(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_sort_keys(item) for item in value]
    return value


def canonicalize_bundle_json(value: dict[str, Any]) -> str:
    return json.dumps(_sort_keys(value), separators=(",", ":"), ensure_ascii=True)


def _normalize_hex(value: Any, *, default: str = "0x0") -> str:
    text = str(value or "").strip()
    if not text:
        return default
    return text if text.startswith("0x") else f"0x{text}"


def _normalize_string(value: Any, *, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _run_receipt_vault_helper(command: str, **kwargs: Any) -> dict[str, Any]:
    args = ["node", str(RECEIPT_VAULT_HELPER), command]
    for key, value in kwargs.items():
        if value is None:
            continue
        args.extend([f"--{key.replace('_', '-')}", str(value)])
    env = os.environ.copy()
    for key in ("NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE", "NODE_APP_INSTANCE"):
        env.pop(key, None)
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
        env=env,
    )
    output = (result.stdout or "").strip() or (result.stderr or "").strip()
    if result.returncode != 0:
        raise RuntimeError(output or f"Receipt Vault helper failed for {command}")
    if not output:
        return {}
    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid helper JSON for {command}: {output}") from exc


def poseidon_hash_text(text: str) -> str:
    return str(_run_receipt_vault_helper("hash-string", text=text)["hash"])


def poseidon_hash_json(value: dict[str, Any]) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
        tmp.write(canonicalize_bundle_json(value))
        tmp.flush()
        path = tmp.name
    try:
        return str(_run_receipt_vault_helper("hash-json-file", path=path)["hash"])
    finally:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass


def compute_receipt_hash(bundle: dict[str, Any]) -> str:
    payload = copy.deepcopy(bundle)
    proof_hashes = dict(payload.get("proof_hashes") or {})
    proof_hashes["receipt_hash"] = "0x0"
    payload["proof_hashes"] = proof_hashes
    return poseidon_hash_json(payload)


def build_receipt_bundle(
    *,
    receipt_id: str | int,
    action_type: str,
    timestamp: str,
    subject: str,
    policy_hash: str,
    proof_hash: str,
    allowed: bool,
    constraints_checked: list[str],
    tier: str,
    registry_tx_hash: str,
    registry_contract_address: str,
    human_readable: str,
    block_number: int | None = None,
    chain: str = DEFAULT_CHAIN,
    event_key: str = "0x0",
    archive_tx_hash: str | None = None,
    archive_contract_address: str | None = None,
    metadata: dict[str, Any] | None = None,
    policy_result: dict[str, Any] | None = None,
    disclosure: dict[str, Any] | None = None,
) -> dict[str, Any]:
    bundle = {
        "version": "1.0",
        "receipt_id": str(receipt_id),
        "action_type": _normalize_string(action_type),
        "timestamp": _normalize_string(timestamp),
        "block_number": block_number,
        "chain": _normalize_string(chain, default=DEFAULT_CHAIN),
        "subject": _normalize_string(subject),
        "proof_hashes": {
            "policy_hash": _normalize_hex(policy_hash),
            "proof_hash": _normalize_hex(proof_hash),
            "receipt_hash": "0x0",
        },
        "policy_result": {
            "allowed": bool(allowed),
            "constraints_checked": list(constraints_checked or []),
            "tier": _normalize_string(tier, default="basic"),
            **(policy_result or {}),
        },
        "starknet_evidence": {
            "tx_hash": _normalize_hex(registry_tx_hash),
            "contract_address": _normalize_hex(registry_contract_address),
            "event_key": _normalize_hex(event_key),
            "archive_tx_hash": _normalize_hex(archive_tx_hash, default="0x0")
            if archive_tx_hash
            else None,
            "archive_contract_address": _normalize_hex(archive_contract_address, default="0x0")
            if archive_contract_address
            else None,
        },
        "selective_disclosure": {
            **DEFAULT_DISCLOSURE,
            **(disclosure or {}),
        },
        "metadata": {
            "issuer": "obsqra_attester_v1",
            "schema_version": "1.0",
            "human_readable": _normalize_string(human_readable),
            **(metadata or {}),
        },
    }
    bundle["proof_hashes"]["receipt_hash"] = compute_receipt_hash(bundle)
    return bundle


def bundle_summary(bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        "receipt_id": str(bundle.get("receipt_id") or ""),
        "action_type": str(bundle.get("action_type") or ""),
        "timestamp": str(bundle.get("timestamp") or ""),
        "subject": str(bundle.get("subject") or ""),
        "policy_hash": str(((bundle.get("proof_hashes") or {}).get("policy_hash")) or ""),
        "proof_hash": str(((bundle.get("proof_hashes") or {}).get("proof_hash")) or ""),
        "receipt_hash": str(((bundle.get("proof_hashes") or {}).get("receipt_hash")) or ""),
        "allowed": bool(((bundle.get("policy_result") or {}).get("allowed"))),
        "tier": str(((bundle.get("policy_result") or {}).get("tier")) or ""),
        "registry_tx_hash": str(((bundle.get("starknet_evidence") or {}).get("tx_hash")) or ""),
        "archive_tx_hash": str(((bundle.get("starknet_evidence") or {}).get("archive_tx_hash")) or ""),
    }
