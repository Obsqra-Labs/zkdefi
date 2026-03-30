"""
Receipt Vault service.

Stores portable receipt bundles for both portfolio execution and passport claims,
uploads them to Storacha/IPFS, and ties them back to Starknet via a CID anchor.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from app.services.receipt_bundle import (
    build_receipt_bundle,
    bundle_summary,
    canonicalize_bundle_json,
    compute_receipt_hash,
    poseidon_hash_json,
    poseidon_hash_text,
)


DATA_DIR = Path(__file__).resolve().parents[2] / "data"
REPO_ROOT = Path(__file__).resolve().parents[3]
RECEIPT_VAULT_DB_PATH = DATA_DIR / "receipt_vault.db"
RECEIPT_VAULT_HELPER = REPO_ROOT / "receiptos" / "attester" / "receipt_vault.mjs"
STORACHA_UPLOAD_HELPER = REPO_ROOT / "receiptos" / "attester" / "storacha_upload.mjs"

DEFAULT_GATEWAY_HOST = os.getenv("STORACHA_GATEWAY_HOST", "storacha.link")
DEFAULT_REGISTRY_ADDRESS = "0x0544ef8cbf8bf1ac7987bc0d2bb211434d515fbe10bab65f36e0f761c79bbdff"
DEFAULT_REGISTRY_EVENT = "ReceiptIssued"
DEFAULT_ARCHIVE_EVENT = "CidAnchored"
DEFAULT_TIER_BY_MODE = {
    "manual": "basic",
    "assisted": "verified",
    "automated": "trusted",
}
CID_PATTERN = re.compile(r"(bafy[a-z0-9]+|Qm[1-9A-HJ-NP-Za-km-z]{44})")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _utc_now().isoformat()


def _normalize_address(value: str) -> str:
    text = str(value or "").strip().lower()
    return text if text.startswith("0x") else value


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _map_tier(raw: Any, *, fallback: str = "basic") -> str:
    text = str(raw or "").strip().lower()
    if text in {"basic", "verified", "trusted"}:
        return text
    if text in {"tier_1", "tier 1", "bronze"}:
        return "basic"
    if text in {"tier_2", "tier 2", "silver"}:
        return "verified"
    if text in {"tier_3", "tier 3", "gold"}:
        return "trusted"
    return fallback


def _normalize_felt(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return "0x0"
    if text in {"true", "false"}:
        return "0x1" if text == "true" else "0x0"
    try:
        if text.startswith("0x"):
            return hex(int(text, 16))
        return hex(int(text))
    except ValueError:
        return text


def _registry_contract_address() -> str:
    return (
        os.getenv("RECEIPTOS_REGISTRY_ADDRESS", "").strip()
        or os.getenv("RECEIPT_REGISTRY_ADDRESS", "").strip()
        or DEFAULT_REGISTRY_ADDRESS
    )


class ReceiptVaultService:
    def __init__(self) -> None:
        self._db_lock = threading.RLock()
        self._init_db()

    @staticmethod
    def _db_connect() -> sqlite3.Connection:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(RECEIPT_VAULT_DB_PATH), timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._db_lock, self._db_connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS receipt_vault (
                    registry_receipt_id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    source_receipt_id TEXT,
                    owner_address TEXT NOT NULL,
                    action_type TEXT NOT NULL,
                    policy_hash TEXT,
                    proof_hash TEXT,
                    receipt_hash TEXT,
                    registry_tx_hash TEXT,
                    registry_contract_address TEXT,
                    cid TEXT,
                    cid_hash TEXT,
                    archive_tx_hash TEXT,
                    archive_contract_address TEXT,
                    bundle_json TEXT NOT NULL,
                    verification_status TEXT,
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_receipt_vault_owner
                ON receipt_vault(owner_address)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_receipt_vault_source_receipt
                ON receipt_vault(source, source_receipt_id)
                """
            )

    def _row_to_dict(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        data = dict(row)
        try:
            data["bundle"] = json.loads(data.get("bundle_json") or "{}")
        except json.JSONDecodeError:
            data["bundle"] = {}
        return data

    def _upsert_row(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = _iso_now()
        with self._db_lock, self._db_connect() as conn:
            existing = conn.execute(
                "SELECT created_at FROM receipt_vault WHERE registry_receipt_id = ?",
                (payload["registry_receipt_id"],),
            ).fetchone()
            created_at = existing["created_at"] if existing else now
            conn.execute(
                """
                INSERT OR REPLACE INTO receipt_vault (
                    registry_receipt_id,
                    source,
                    source_receipt_id,
                    owner_address,
                    action_type,
                    policy_hash,
                    proof_hash,
                    receipt_hash,
                    registry_tx_hash,
                    registry_contract_address,
                    cid,
                    cid_hash,
                    archive_tx_hash,
                    archive_contract_address,
                    bundle_json,
                    verification_status,
                    last_error,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["registry_receipt_id"],
                    payload["source"],
                    payload.get("source_receipt_id"),
                    payload["owner_address"],
                    payload["action_type"],
                    payload.get("policy_hash"),
                    payload.get("proof_hash"),
                    payload.get("receipt_hash"),
                    payload.get("registry_tx_hash"),
                    payload.get("registry_contract_address"),
                    payload.get("cid"),
                    payload.get("cid_hash"),
                    payload.get("archive_tx_hash"),
                    payload.get("archive_contract_address"),
                    payload["bundle_json"],
                    payload.get("verification_status"),
                    payload.get("last_error"),
                    created_at,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM receipt_vault WHERE registry_receipt_id = ?",
                (payload["registry_receipt_id"],),
            ).fetchone()
        return self._row_to_dict(row) or {}

    def _run_json_command(self, args: list[str], *, env: dict[str, str] | None = None) -> dict[str, Any]:
        run_env = dict(env or os.environ)
        for key in ("NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE", "NODE_APP_INSTANCE"):
            run_env.pop(key, None)
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=240,
            env=run_env,
            check=False,
        )
        output = (result.stdout or "").strip() or (result.stderr or "").strip()
        if result.returncode != 0:
            raise RuntimeError(output or f"Command failed: {' '.join(args)}")
        if not output:
            return {}
        try:
            return json.loads(output)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid command JSON: {output}") from exc

    def _run_json_command_with_nonce_retry(
        self,
        args: list[str],
        *,
        env: dict[str, str] | None = None,
        attempts: int = 3,
    ) -> dict[str, Any]:
        last_error: RuntimeError | None = None
        for attempt in range(1, max(1, attempts) + 1):
            try:
                return self._run_json_command(args, env=env)
            except RuntimeError as exc:
                last_error = exc
                message = str(exc)
                if "InvalidTransactionNonce" not in message or attempt >= attempts:
                    raise
                time.sleep(1.25 * attempt)
        if last_error is not None:
            raise last_error
        return {}

    def _starkli_call(self, contract: str, entrypoint: str, *calldata: str) -> str:
        rpc = (
            os.getenv("RECEIPTOS_STARKNET_RPC", "").strip()
            or os.getenv("STARKNET_RPC_URL", "").strip()
        )
        if not rpc:
            raise RuntimeError("RECEIPTOS_STARKNET_RPC is not configured")
        cmd = ["starkli", "call", contract, entrypoint, *calldata, "--rpc", rpc]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        output = f"{result.stdout or ''}\n{result.stderr or ''}".strip()
        if result.returncode != 0:
            raise RuntimeError(output or f"starkli call failed for {entrypoint}")
        return output

    def _starkli_selector(self, name: str) -> str:
        result = subprocess.run(
            ["starkli", "selector", name],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        output = (result.stdout or "").strip() or (result.stderr or "").strip()
        if result.returncode != 0:
            return "0x0"
        match = re.search(r"0x[0-9a-fA-F]+", output)
        return match.group(0) if match else "0x0"

    def _parse_call_value(self, output: str) -> str:
        match = re.search(r"(0x[0-9a-fA-F]+|\d+|true|false)", output.strip(), re.IGNORECASE)
        if not match:
            raise RuntimeError(f"Unable to parse starkli output: {output}")
        return match.group(1)

    def _bool_from_output(self, output: str) -> bool:
        value = self._parse_call_value(output).lower()
        if value in {"true", "false"}:
            return value == "true"
        try:
            if value.startswith("0x"):
                return int(value, 16) != 0
            return int(value) != 0
        except ValueError:
            return False

    def _gateway_url(self, cid: str, filename: str = "receipt-bundle.json") -> str:
        host = os.getenv("STORACHA_GATEWAY_HOST", DEFAULT_GATEWAY_HOST).strip() or DEFAULT_GATEWAY_HOST
        return f"https://{cid}.ipfs.{host}/{filename}"

    def _normalize_cid_input(self, cid_or_url: str) -> tuple[str, str | None]:
        raw = str(cid_or_url or "").strip()
        if not raw:
            raise ValueError("CID is required")
        if raw.startswith("ipfs://"):
            body = raw[len("ipfs://") :]
            cid = body.split("/", 1)[0]
            return cid, raw
        parsed = urlparse(raw)
        if parsed.scheme in {"http", "https"}:
            host = parsed.netloc
            if ".ipfs." in host:
                cid = host.split(".ipfs.", 1)[0]
                return cid, raw
            path = parsed.path or ""
            match = CID_PATTERN.search(path)
            if match:
                return match.group(1), raw
        match = CID_PATTERN.search(raw)
        if match:
            return match.group(1), None
        raise ValueError("Unable to parse CID")

    async def _fetch_bundle_by_cid(self, cid_or_url: str) -> tuple[str, str, dict[str, Any]]:
        cid, preferred_url = self._normalize_cid_input(cid_or_url)
        candidates = []
        if preferred_url:
            candidates.append(preferred_url)
        candidates.append(self._gateway_url(cid))
        candidates.append(f"https://storacha.link/ipfs/{cid}/receipt-bundle.json")
        last_error: Exception | None = None
        for url in dict.fromkeys(candidates):
            try:
                async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    return cid, url, response.json()
            except Exception as exc:  # pragma: no cover - external network
                last_error = exc
                continue
        raise RuntimeError(f"Unable to fetch receipt bundle for CID {cid}: {last_error}")

    async def _issue_registry_receipt(self, *, policy_hash: str, weight: int) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._run_json_command_with_nonce_retry,
            [
                "node",
                str(RECEIPT_VAULT_HELPER),
                "issue-registry",
                "--policy-hash",
                policy_hash,
                "--weight",
                str(max(1, weight)),
            ],
        )

    async def _upload_bundle(self, bundle: dict[str, Any]) -> dict[str, Any]:
        import tempfile

        serialized = canonicalize_bundle_json(bundle)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            tmp.write(serialized)
            tmp.flush()
            path = tmp.name
        try:
            return await asyncio.to_thread(
                self._run_json_command,
                [
                    "node",
                    str(STORACHA_UPLOAD_HELPER),
                    "upload-json-file",
                    "--path",
                    path,
                    "--name",
                    "receipt-bundle.json",
                ],
            )
        finally:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass

    async def _anchor_cid(self, receipt_id: str, cid_hash: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._run_json_command_with_nonce_retry,
            [
                "node",
                str(RECEIPT_VAULT_HELPER),
                "anchor-cid",
                "--receipt-id",
                str(receipt_id),
                "--cid-hash",
                cid_hash,
            ],
        )

    async def _hash_cid(self, cid: str) -> str:
        return await asyncio.to_thread(poseidon_hash_text, cid)

    def _portfolio_constraints_checked(self, gate_meta: dict[str, Any]) -> list[str]:
        constraints: list[str] = []
        for item in gate_meta.get("constraint_results") or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("constraint") or "").strip()
            if name:
                constraints.append(name)
        if constraints:
            return constraints
        for code in gate_meta.get("reason_codes") or []:
            text = str(code).strip()
            if text:
                constraints.append(text)
        return constraints

    def _portfolio_human_readable(self, metadata: dict[str, Any]) -> str:
        gate = metadata.get("gate") if isinstance(metadata.get("gate"), dict) else {}
        execution = metadata.get("execution") if isinstance(metadata.get("execution"), dict) else {}
        action = "Rebalance" if metadata.get("action_type") == "rebalance" else "Swap"
        adapter = str(execution.get("execution_adapter") or "wallet route").upper()
        if gate.get("override_mode") == "manual":
            return f"{action} submitted in manual mode. Gate result recorded, route prepared for direct wallet review via {adapter}."
        if gate.get("override_mode") == "advisory":
            return f"{action} submitted after a fee warning. Route reviewed and sent through {adapter}."
        return f"{action} executed within policy bounds. Verified on Starknet Sepolia."

    async def register_portfolio_execution(
        self,
        *,
        owner_address: str,
        source_receipt: dict[str, Any],
        execution_tx_hash: str,
    ) -> dict[str, Any]:
        metadata = source_receipt.get("metadata") if isinstance(source_receipt.get("metadata"), dict) else {}
        existing_portable = metadata.get("portable_receipt") if isinstance(metadata.get("portable_receipt"), dict) else {}
        existing_registry_id = str(existing_portable.get("registry_receipt_id") or "").strip()
        if existing_registry_id:
            existing = await self.get_receipt(existing_registry_id, verify=False)
            if existing:
                return existing

        gate_meta = metadata.get("gate") if isinstance(metadata.get("gate"), dict) else {}
        workflow_mode = str(gate_meta.get("workflow_mode") or "manual")
        action_type = str(source_receipt.get("action_type") or "swap")
        policy_hash = str(gate_meta.get("policy_hash") or source_receipt.get("constraints_hash") or "0x0")
        proof_hash = str(gate_meta.get("intent_hash") or source_receipt.get("proof_hash") or "0x0")
        if proof_hash in {"", "0x0", "0x00"}:
            proof_hash = poseidon_hash_json({"execution_tx_hash": execution_tx_hash})
        weight = max(1, _safe_int(source_receipt.get("amount"), 1))
        registry_issue = await self._issue_registry_receipt(policy_hash=policy_hash, weight=weight)
        registry_receipt_id = str(registry_issue["receipt_id"])
        event_key = self._starkli_selector(DEFAULT_REGISTRY_EVENT)
        constraints_checked = self._portfolio_constraints_checked(gate_meta)
        tier = _map_tier(DEFAULT_TIER_BY_MODE.get(workflow_mode), fallback="basic")
        bundle = build_receipt_bundle(
            receipt_id=registry_receipt_id,
            action_type=action_type,
            timestamp=str(source_receipt.get("timestamp") or _iso_now()),
            subject=owner_address,
            policy_hash=policy_hash,
            proof_hash=proof_hash,
            allowed=bool(gate_meta.get("allowed", True)),
            constraints_checked=constraints_checked,
            tier=tier,
            registry_tx_hash=str(registry_issue["tx_hash"]),
            registry_contract_address=_registry_contract_address(),
            event_key=event_key,
            human_readable=self._portfolio_human_readable(
                {
                    **metadata,
                    "action_type": action_type,
                }
            ),
            metadata={
                "source": "portfolio_execute",
                "workflow_mode": workflow_mode,
                "execution_tx_hash": execution_tx_hash,
                "source_receipt_id": str(source_receipt.get("receipt_id") or ""),
                "gate_status": str(metadata.get("status") or ""),
                "route_summary": gate_meta.get("swap_steps") or [],
                "override_mode": gate_meta.get("override_mode"),
            },
            policy_result={
                "reason_codes": gate_meta.get("reason_codes") or [],
                "gate_allowed_before_submission": bool(gate_meta.get("allowed", True)),
                "override_mode": gate_meta.get("override_mode"),
            },
        )
        upload = await self._upload_bundle(bundle)
        cid = str(upload.get("cid") or "")
        cid_hash = await self._hash_cid(cid)
        anchor = await self._anchor_cid(registry_receipt_id, cid_hash)
        self._upsert_row(
            {
                "registry_receipt_id": registry_receipt_id,
                "source": "portfolio_execute",
                "source_receipt_id": str(source_receipt.get("receipt_id") or ""),
                "owner_address": _normalize_address(owner_address),
                "action_type": action_type,
                "policy_hash": policy_hash,
                "proof_hash": proof_hash,
                "receipt_hash": str((bundle.get("proof_hashes") or {}).get("receipt_hash") or ""),
                "registry_tx_hash": str(registry_issue["tx_hash"]),
                "registry_contract_address": _registry_contract_address(),
                "cid": cid,
                "cid_hash": cid_hash,
                "archive_tx_hash": str(anchor.get("tx_hash") or ""),
                "archive_contract_address": os.getenv("RECEIPTOS_ARCHIVE_ADDRESS", ""),
                "bundle_json": canonicalize_bundle_json(bundle),
                "verification_status": "anchored",
                "last_error": None,
            }
        )
        return await self.get_receipt(registry_receipt_id, verify=False) or {}

    async def register_passport_claim(
        self,
        *,
        wallet_address: str,
        registry_receipt_id: str | int,
        tx_hash: str,
        policy_hash: str,
        tier: str | None = None,
        proof_hash: str | None = None,
        claim_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        registry_receipt_id = str(registry_receipt_id)
        existing = await self.get_receipt(registry_receipt_id, verify=False)
        if existing:
            return existing

        metadata = dict(claim_metadata or {})
        proof_input = {
            "wallet_address": wallet_address,
            "policy_hash": policy_hash,
            "tier": metadata.get("tier_name") or tier or "basic",
            "gates": metadata.get("gates") or {},
            "reputation_score": metadata.get("reputation_score"),
            "scanned_at": metadata.get("scanned_at"),
        }
        derived_proof_hash = proof_hash or poseidon_hash_json(proof_input)
        event_key = self._starkli_selector(DEFAULT_REGISTRY_EVENT)
        bundle = build_receipt_bundle(
            receipt_id=registry_receipt_id,
            action_type="verification",
            timestamp=str(metadata.get("claimed_at") or _iso_now()),
            subject=wallet_address,
            policy_hash=policy_hash,
            proof_hash=derived_proof_hash,
            allowed=True,
            constraints_checked=["passport_vector", "attester_signature", "receipt_registry"],
            tier=_map_tier(tier or metadata.get("tier_name"), fallback="verified"),
            registry_tx_hash=tx_hash,
            registry_contract_address=_registry_contract_address(),
            event_key=event_key,
            human_readable="Passport verification issued within policy bounds. Verified on Starknet Sepolia.",
            metadata={
                "source": "passport_claim",
                "claim_kind": metadata.get("claim_kind") or "passport",
                "reputation_score": metadata.get("reputation_score"),
                "gates": metadata.get("gates") or {},
                "tier_name": metadata.get("tier_name"),
            },
            policy_result={
                "reputation_score": metadata.get("reputation_score"),
                "gates": metadata.get("gates") or {},
            },
        )
        upload = await self._upload_bundle(bundle)
        cid = str(upload.get("cid") or "")
        cid_hash = await self._hash_cid(cid)
        anchor = await self._anchor_cid(registry_receipt_id, cid_hash)
        self._upsert_row(
            {
                "registry_receipt_id": registry_receipt_id,
                "source": "passport_claim",
                "source_receipt_id": registry_receipt_id,
                "owner_address": _normalize_address(wallet_address),
                "action_type": "verification",
                "policy_hash": policy_hash,
                "proof_hash": derived_proof_hash,
                "receipt_hash": str((bundle.get("proof_hashes") or {}).get("receipt_hash") or ""),
                "registry_tx_hash": tx_hash,
                "registry_contract_address": _registry_contract_address(),
                "cid": cid,
                "cid_hash": cid_hash,
                "archive_tx_hash": str(anchor.get("tx_hash") or ""),
                "archive_contract_address": os.getenv("RECEIPTOS_ARCHIVE_ADDRESS", ""),
                "bundle_json": canonicalize_bundle_json(bundle),
                "verification_status": "anchored",
                "last_error": None,
            }
        )
        return await self.get_receipt(registry_receipt_id, verify=False) or {}

    async def list_receipts(self, owner_address: str) -> list[dict[str, Any]]:
        key = _normalize_address(owner_address)
        with self._db_lock, self._db_connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM receipt_vault
                WHERE LOWER(owner_address) = ?
                ORDER BY created_at DESC
                """,
                (key,),
            ).fetchall()
        rows = [self._row_to_dict(row) or {} for row in rows]
        return [
            {
                **row,
                "bundle_summary": bundle_summary(row.get("bundle") or {}),
                "gateway_url": self._gateway_url(row["cid"]) if row.get("cid") else None,
                "ipfs_uri": f"ipfs://{row['cid']}" if row.get("cid") else None,
            }
            for row in rows
        ]

    async def get_receipt(self, registry_receipt_id: str | int, *, verify: bool = True) -> dict[str, Any] | None:
        registry_receipt_id = str(registry_receipt_id)
        with self._db_lock, self._db_connect() as conn:
            row = conn.execute(
                "SELECT * FROM receipt_vault WHERE registry_receipt_id = ?",
                (registry_receipt_id,),
            ).fetchone()
        row = self._row_to_dict(row)
        if row is None:
            return None
        payload = {
            **row,
            "bundle_summary": bundle_summary(row.get("bundle") or {}),
            "gateway_url": self._gateway_url(row["cid"]) if row.get("cid") else None,
            "ipfs_uri": f"ipfs://{row['cid']}" if row.get("cid") else None,
        }
        if verify and row.get("cid"):
            try:
                payload["verification"] = await self.verify_cid(row["cid"])
            except Exception as exc:
                payload["verification"] = {
                    "status": "FAILED",
                    "verified": False,
                    "error": str(exc),
                    "checks": {},
                }
        return payload

    async def verify_cid(self, cid_or_url: str) -> dict[str, Any]:
        cid, fetched_url, bundle = await self._fetch_bundle_by_cid(cid_or_url)
        receipt_id = str(bundle.get("receipt_id") or "")
        bundle_receipt_hash = str(((bundle.get("proof_hashes") or {}).get("receipt_hash")) or "")
        recomputed_receipt_hash = compute_receipt_hash(bundle)
        cid_hash = await self._hash_cid(cid)

        archive_contract = os.getenv("RECEIPTOS_ARCHIVE_ADDRESS", "").strip()
        registry_contract = _registry_contract_address()
        anchored_cid_hash = None
        anchored_matches = False
        if archive_contract and receipt_id:
            anchored_cid_hash = self._parse_call_value(
                self._starkli_call(archive_contract, "get_cid_anchor", receipt_id)
            )
            anchored_matches = _normalize_felt(anchored_cid_hash) == _normalize_felt(cid_hash)

        registry_valid = False
        onchain_policy_hash = None
        policy_hash_matches = False
        if registry_contract and receipt_id:
            registry_valid = self._bool_from_output(
                self._starkli_call(registry_contract, "verify_receipt", receipt_id)
            )
            onchain_policy_hash = self._parse_call_value(
                self._starkli_call(registry_contract, "get_receipt_policy_hash", receipt_id)
            )
            bundle_policy_hash = str(((bundle.get("proof_hashes") or {}).get("policy_hash")) or "")
            policy_hash_matches = _normalize_felt(onchain_policy_hash) == _normalize_felt(bundle_policy_hash)

        receipt_hash_matches = bundle_receipt_hash.lower() == recomputed_receipt_hash.lower()
        verified = all(
            [
                bool(receipt_id),
                receipt_hash_matches,
                anchored_matches,
                registry_valid,
                policy_hash_matches,
            ]
        )
        return {
            "status": "VERIFIED" if verified else "FAILED",
            "verified": verified,
            "cid": cid,
            "fetched_url": fetched_url,
            "receipt_id": receipt_id,
            "checks": {
                "receipt_hash_matches": receipt_hash_matches,
                "anchored_cid_matches": anchored_matches,
                "registry_receipt_valid": registry_valid,
                "policy_hash_matches": policy_hash_matches,
            },
            "bundle_receipt_hash": bundle_receipt_hash,
            "recomputed_receipt_hash": recomputed_receipt_hash,
            "cid_hash": cid_hash,
            "anchored_cid_hash": anchored_cid_hash,
            "bundle_policy_hash": str(((bundle.get("proof_hashes") or {}).get("policy_hash")) or ""),
            "onchain_policy_hash": onchain_policy_hash,
            "bundle": bundle,
        }


_receipt_vault_service: ReceiptVaultService | None = None


def get_receipt_vault_service() -> ReceiptVaultService:
    global _receipt_vault_service
    if _receipt_vault_service is None:
        _receipt_vault_service = ReceiptVaultService()
    return _receipt_vault_service
