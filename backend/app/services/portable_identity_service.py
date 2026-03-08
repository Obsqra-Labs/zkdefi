"""Portable reputation/identity V3 storage and helpers."""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.cross_chain_fetcher import fetch_combined_history
from app.services.json_store import JsonStore
from app.services.linked_address_verification_service import (
    get_linked_address_verification_service,
)
from app.services.linked_addresses_store import get_linked
from app.services.session_key_service import get_session_service
from app.services.trust_version_matrix import get_trust_version_matrix


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _env_bool_any(names: list[str], default: bool) -> bool:
    for name in names:
        raw = os.getenv(name)
        if raw is None:
            continue
        return str(raw).strip().lower() in {"1", "true", "yes", "on"}
    return default


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _sha256_hex(value: str) -> str:
    return "0x" + hashlib.sha256(value.encode("utf-8")).hexdigest()


class PortableIdentityService:
    """Persistence + aggregation for identity graph, claims, and credentials."""

    def __init__(self) -> None:
        self._node_store = JsonStore("identity_graph_nodes")
        self._link_store = JsonStore("identity_graph_links")
        self._attribution_store = JsonStore("attribution_events")
        self._claims_store = JsonStore("derived_claims")
        self._credential_store = JsonStore("issued_credentials")
        self._revocation_store = JsonStore("credential_revocations")
        self._signing_salt = os.getenv("PORTABLE_CREDENTIAL_SIGNING_SALT", "zkdefi-portable-v3")

    @staticmethod
    def normalize_subject(subject: str) -> str:
        return str(subject or "").strip().lower()

    def enabled(self) -> bool:
        return _env_bool_any(
            ["PORTABLE_IDENTITY_V3", "PORTABLE_IDENTITY_V3_ENABLED"],
            True,
        )

    def get_version_matrix(self) -> dict[str, str]:
        return get_trust_version_matrix()

    async def get_identity_graph(self, subject: str) -> dict[str, Any]:
        subject_key = self.normalize_subject(subject)
        node = self._node_store.get(subject_key)
        if not isinstance(node, dict):
            node = {
                "subject": subject_key,
                "identity_commitment": None,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            self._node_store.set(subject_key, node)

        links = self._link_store.get(subject_key)
        if not isinstance(links, list):
            links = []

        sessions = await get_session_service().list_user_sessions(owner_address=subject_key)
        session_rows: list[dict[str, Any]] = []
        for row in sessions:
            if not isinstance(row, dict):
                continue
            session_rows.append(
                {
                    "session_id": row.get("session_id"),
                    "active": bool(row.get("is_active", False)),
                    "scope": {
                        "protocols": row.get("allowed_protocols", []),
                        "max_position_wei": row.get("max_position"),
                    },
                    "expires_at": row.get("expires_at"),
                    "revoked_at": row.get("revoked_at"),
                }
            )

        return {
            "subject": subject_key,
            "identity_commitment": node.get("identity_commitment"),
            "links": links,
            "sessions": session_rows,
            "updated_at": node.get("updated_at"),
            "version_matrix": get_trust_version_matrix(),
        }

    def set_identity_commitment(self, subject: str, identity_commitment: str | None) -> None:
        subject_key = self.normalize_subject(subject)
        node = self._node_store.get(subject_key)
        if not isinstance(node, dict):
            node = {
                "subject": subject_key,
                "created_at": _now_iso(),
            }
        node["identity_commitment"] = identity_commitment
        node["updated_at"] = _now_iso()
        self._node_store.set(subject_key, node)

    def upsert_identity_link(
        self,
        *,
        subject: str,
        chain: str,
        address: str,
        verification_method: str,
        verified: bool,
        confidence: float,
        verification_ref: str | None = None,
    ) -> dict[str, Any]:
        subject_key = self.normalize_subject(subject)
        chain_name = str(chain or "").strip().lower()
        addr = str(address or "").strip().lower()
        links = self._link_store.get(subject_key)
        if not isinstance(links, list):
            links = []

        now = _now_iso()
        next_links: list[dict[str, Any]] = []
        replaced = False
        for row in links:
            if not isinstance(row, dict):
                continue
            if str(row.get("chain") or "").lower() == chain_name and str(row.get("address") or "").lower() == addr:
                replaced = True
                continue
            next_links.append(row)

        link_row = {
            "link_id": f"link_{uuid.uuid4().hex}",
            "subject": subject_key,
            "chain": chain_name,
            "address": addr,
            "verified": bool(verified),
            "verified_at": now if verified else None,
            "verification_method": verification_method,
            "verification_ref": verification_ref,
            "confidence": max(0.0, min(float(confidence), 1.0)),
            "created_at": now,
            "updated_at": now,
        }
        next_links.append(link_row)
        self._link_store.set(subject_key, next_links)

        node = self._node_store.get(subject_key)
        if not isinstance(node, dict):
            node = {"subject": subject_key, "created_at": now}
        node["updated_at"] = now
        self._node_store.set(subject_key, node)

        return {
            "link": link_row,
            "replaced": replaced,
            "link_count": len(next_links),
        }

    async def query_attributions(
        self,
        *,
        subject: str,
        window_days: int,
        filters: dict[str, Any] | None,
        include_evidence: bool,
    ) -> dict[str, Any]:
        subject_key = self.normalize_subject(subject)
        filters = filters if isinstance(filters, dict) else {}
        allowed_chains = {str(c).strip().lower() for c in (filters.get("chains") or []) if str(c).strip()}
        allowed_protocols = {
            str(p).strip().lower() for p in (filters.get("protocols") or []) if str(p).strip()
        }
        allowed_actions = {
            str(a).strip().lower() for a in (filters.get("actions") or []) if str(a).strip()
        }
        now_ts = int(time.time())
        window_sec = max(1, int(window_days)) * 86400

        verifier = get_linked_address_verification_service()
        linked = get_linked(subject_key)
        verified = verifier.filter_verified(subject_key, linked)
        combined = await fetch_combined_history(
            subject_key,
            verified.get("eth"),
            verified.get("arb"),
            verified.get("base"),
        )

        stored = self._attribution_store.get(subject_key)
        stored_rows = stored if isinstance(stored, list) else []
        rows: list[dict[str, Any]] = []
        for row in stored_rows:
            if not isinstance(row, dict):
                continue
            ts = int(row.get("ts", now_ts))
            if now_ts - ts > window_sec:
                continue
            chain = str(row.get("chain") or "").lower()
            protocol = str(row.get("protocol_id") or "").lower()
            action = str(row.get("action_type") or "").lower()
            if allowed_chains and chain not in allowed_chains:
                continue
            if allowed_protocols and protocol not in allowed_protocols:
                continue
            if allowed_actions and action not in allowed_actions:
                continue
            rows.append(row)

        # If no detailed rows are available, derive deterministic attribution entries from verified chains.
        if not rows:
            for chain, meta in (combined.get("per_chain") or {}).items():
                chain_name = str(chain or "").lower()
                if allowed_chains and chain_name not in allowed_chains:
                    continue
                action_type = "swap"
                if allowed_actions and action_type not in allowed_actions:
                    continue
                protocol = "aggregated"
                if allowed_protocols and protocol not in allowed_protocols:
                    continue
                row = {
                    "id": f"attr_{uuid.uuid4().hex[:12]}",
                    "subject": subject_key,
                    "chain": chain_name,
                    "protocol_id": protocol,
                    "action_type": action_type,
                    "timestamp": _now_iso(),
                    "ts": now_ts,
                    "confidence": 0.9 if chain_name == "starknet" else 1.0,
                    "evidence": {
                        "source": "cross_chain_summary",
                        "tx_count": int((meta or {}).get("tx_count", 0)),
                    },
                }
                rows.append(row)

        attributions: list[dict[str, Any]] = []
        for row in rows:
            formatted = {
                "id": row.get("id") or f"attr_{uuid.uuid4().hex[:12]}",
                "chain": row.get("chain"),
                "protocol_id": row.get("protocol_id"),
                "action_type": row.get("action_type"),
                "timestamp": row.get("timestamp") or _now_iso(),
                "confidence": float(row.get("confidence", 0.5)),
            }
            if include_evidence:
                formatted["evidence"] = row.get("evidence") or {}
            attributions.append(formatted)

        coverage_score = min(
            1.0,
            max(
                0.0,
                0.35
                + (0.2 * int(combined.get("chains_active", 0)))
                + (0.05 * min(5, len(attributions))),
            ),
        )

        return {
            "subject": subject_key,
            "summary": {
                "total_events": len(attributions),
                "coverage_score": round(coverage_score, 3),
                "verified_chain_count": len([k for k in ("eth", "arb", "base") if verified.get(k)]),
            },
            "attributions": attributions,
        }

    def persist_attributions(self, subject: str, attributions: list[dict[str, Any]]) -> None:
        subject_key = self.normalize_subject(subject)
        safe_rows: list[dict[str, Any]] = []
        now_ts = int(time.time())
        for row in attributions:
            if not isinstance(row, dict):
                continue
            copy = dict(row)
            copy["subject"] = subject_key
            copy["ts"] = int(copy.get("ts", now_ts))
            safe_rows.append(copy)
        self._attribution_store.set(subject_key, safe_rows)

    def set_derived_claims(self, subject: str, payload: dict[str, Any]) -> None:
        subject_key = self.normalize_subject(subject)
        self._claims_store.set(subject_key, payload)

    def get_derived_claims(self, subject: str) -> dict[str, Any] | None:
        subject_key = self.normalize_subject(subject)
        data = self._claims_store.get(subject_key)
        return data if isinstance(data, dict) else None

    def issue_credential(
        self,
        *,
        subject: str,
        template: str,
        audience: str,
        claims: dict[str, Any],
        ttl_hours: int,
    ) -> dict[str, Any]:
        subject_key = self.normalize_subject(subject)
        now = int(time.time())
        expires_at = now + max(1, int(ttl_hours)) * 3600
        credential_id = f"cred_{uuid.uuid4().hex}"
        revocation_id = f"rev_{uuid.uuid4().hex}"
        issued_at_iso = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()
        expires_at_iso = datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat()

        signature_payload = {
            "credential_id": credential_id,
            "subject": subject_key,
            "template": template,
            "audience": audience,
            "claims": claims,
            "issued_at": issued_at_iso,
            "expires_at": expires_at_iso,
        }
        signature = _sha256_hex(f"{_stable_json(signature_payload)}|{self._signing_salt}")

        row = {
            "credential_id": credential_id,
            "subject": subject_key,
            "template": template,
            "audience": audience,
            "claims": claims,
            "issued_at": issued_at_iso,
            "expires_at": expires_at_iso,
            "signature": signature,
            "revocation_id": revocation_id,
            "revoked": False,
            "revoked_at": None,
            "revocation_reason": None,
            "version_matrix": get_trust_version_matrix(),
        }
        self._credential_store.set(credential_id, row)
        self._revocation_store.set(
            revocation_id,
            {
                "revocation_id": revocation_id,
                "credential_id": credential_id,
                "subject": subject_key,
                "revoked": False,
                "revoked_at": None,
                "reason": None,
            },
        )
        return row

    def verify_credential(self, credential_id: str, signature: str | None = None) -> dict[str, Any]:
        row = self._credential_store.get(str(credential_id or "").strip())
        if not isinstance(row, dict):
            return {"verified": False, "reason": "credential_not_found"}

        if bool(row.get("revoked", False)):
            return {"verified": False, "reason": "credential_revoked", "credential": row}

        expires_at = str(row.get("expires_at") or "")
        try:
            expiry_ts = int(datetime.fromisoformat(expires_at).timestamp())
        except Exception:
            expiry_ts = 0
        if expiry_ts > 0 and int(time.time()) > expiry_ts:
            return {"verified": False, "reason": "credential_expired", "credential": row}

        if signature is not None and str(signature).strip() != str(row.get("signature") or ""):
            return {"verified": False, "reason": "invalid_signature", "credential": row}

        return {"verified": True, "reason": "ok", "credential": row}

    def revoke_credential(
        self,
        *,
        credential_id: str | None = None,
        revocation_id: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        row: dict[str, Any] | None = None
        if credential_id:
            candidate = self._credential_store.get(str(credential_id).strip())
            if isinstance(candidate, dict):
                row = candidate
        elif revocation_id:
            rev = self._revocation_store.get(str(revocation_id).strip())
            if isinstance(rev, dict):
                candidate = self._credential_store.get(str(rev.get("credential_id") or "").strip())
                if isinstance(candidate, dict):
                    row = candidate

        if row is None:
            return {"revoked": False, "reason": "credential_not_found"}

        now_iso = _now_iso()
        row["revoked"] = True
        row["revoked_at"] = now_iso
        row["revocation_reason"] = reason or "revoked"
        self._credential_store.set(str(row.get("credential_id")), row)

        rid = str(row.get("revocation_id") or "")
        if rid:
            self._revocation_store.set(
                rid,
                {
                    "revocation_id": rid,
                    "credential_id": row.get("credential_id"),
                    "subject": row.get("subject"),
                    "revoked": True,
                    "revoked_at": now_iso,
                    "reason": reason or "revoked",
                },
            )

        return {
            "revoked": True,
            "credential_id": row.get("credential_id"),
            "revocation_id": row.get("revocation_id"),
            "revoked_at": row.get("revoked_at"),
            "reason": row.get("revocation_reason"),
        }

    def get_revocation_status(self, revocation_id: str) -> dict[str, Any] | None:
        row = self._revocation_store.get(str(revocation_id or "").strip())
        return row if isinstance(row, dict) else None

    def get_credential_summary(self, subject: str) -> dict[str, Any]:
        subject_key = self.normalize_subject(subject)
        rows = [r for r in self._credential_store.values() if isinstance(r, dict) and r.get("subject") == subject_key]
        issued = len(rows)
        active = len([r for r in rows if not bool(r.get("revoked", False))])
        revoked = issued - active
        return {
            "issued_count": issued,
            "active_count": active,
            "revoked_count": revoked,
            "latest_issued_at": max((str(r.get("issued_at") or "") for r in rows), default=None),
        }

    def get_attribution_summary(self, subject: str) -> dict[str, Any]:
        subject_key = self.normalize_subject(subject)
        rows = self._attribution_store.get(subject_key)
        if not isinstance(rows, list):
            rows = []
        chains = {str(r.get("chain") or "").lower() for r in rows if isinstance(r, dict)}
        return {
            "event_count": len(rows),
            "chains": sorted([c for c in chains if c]),
        }


_portable_identity_service: PortableIdentityService | None = None


def get_portable_identity_service() -> PortableIdentityService:
    global _portable_identity_service
    if _portable_identity_service is None:
        _portable_identity_service = PortableIdentityService()
    return _portable_identity_service
