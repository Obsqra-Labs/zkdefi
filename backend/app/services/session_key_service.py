"""
Session Key Service.

Stores short-lived session keys for delegated execution.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

_SESSION_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "session_keys.db"


class SessionKeyService:
    def __init__(self) -> None:
        self._db_lock = threading.RLock()
        self._init_db()

    @staticmethod
    def _db_connect() -> sqlite3.Connection:
        _SESSION_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(_SESSION_DB_PATH), timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._db_lock, self._db_connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_keys (
                    key_id TEXT PRIMARY KEY,
                    owner_address TEXT NOT NULL,
                    session_public_key TEXT NOT NULL,
                    policy_hash TEXT,
                    message_hash TEXT,
                    signature_digest TEXT,
                    max_position INTEGER,
                    allowed_protocols TEXT,
                    grant_tx_hash TEXT,
                    revoke_tx_hash TEXT,
                    expires_at TEXT,
                    revoked_at TEXT,
                    created_at TEXT NOT NULL
                )
            """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_session_keys_owner
                ON session_keys(owner_address)
            """
            )
            existing_columns = {
                str(row["name"]).lower()
                for row in conn.execute("PRAGMA table_info(session_keys)").fetchall()
            }
            column_defs = {
                "max_position": "INTEGER",
                "allowed_protocols": "TEXT",
                "grant_tx_hash": "TEXT",
                "revoke_tx_hash": "TEXT",
            }
            for column_name, column_type in column_defs.items():
                if column_name in existing_columns:
                    continue
                conn.execute(f"ALTER TABLE session_keys ADD COLUMN {column_name} {column_type}")

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        protocols_raw = data.get("allowed_protocols")
        if isinstance(protocols_raw, str) and protocols_raw.strip():
            try:
                parsed_protocols = json.loads(protocols_raw)
            except json.JSONDecodeError:
                parsed_protocols = []
        else:
            parsed_protocols = []
        data["allowed_protocols"] = parsed_protocols if isinstance(parsed_protocols, list) else []
        data["revoked"] = bool(data.get("revoked_at"))
        data["expired"] = self._is_expired(data.get("expires_at"))
        data["status"] = "revoked" if data["revoked"] else "expired" if data["expired"] else "active"
        return data

    @staticmethod
    def _is_expired(expires_at: str | None) -> bool:
        if not expires_at:
            return False
        try:
            expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            return False
        return expiry <= datetime.now(timezone.utc)

    def create_key(
        self,
        *,
        owner_address: str,
        session_public_key: str,
        policy_hash: str | None,
        message_hash: str,
        signature_digest: str,
        expires_at: str | None,
        max_position: int | None = None,
        allowed_protocols: list[str] | None = None,
    ) -> dict[str, Any]:
        created_at = datetime.now(timezone.utc).isoformat()
        key_id = "0x" + hashlib.sha256(
            f"{owner_address}{session_public_key}{policy_hash}{message_hash}{created_at}".encode()
        ).hexdigest()[:64]

        with self._db_lock, self._db_connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO session_keys
                (key_id, owner_address, session_public_key, policy_hash, message_hash,
                 signature_digest, max_position, allowed_protocols, grant_tx_hash,
                 revoke_tx_hash, expires_at, revoked_at, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    key_id,
                    owner_address.lower(),
                    session_public_key,
                    policy_hash,
                    message_hash,
                    signature_digest,
                    max_position,
                    json.dumps(allowed_protocols or []),
                    None,
                    None,
                    expires_at,
                    None,
                    created_at,
                ),
            )

        return {
            "key_id": key_id,
            "owner_address": owner_address.lower(),
            "session_public_key": session_public_key,
            "policy_hash": policy_hash,
            "message_hash": message_hash,
            "signature_digest": signature_digest,
            "max_position": max_position,
            "allowed_protocols": allowed_protocols or [],
            "grant_tx_hash": None,
            "revoke_tx_hash": None,
            "expires_at": expires_at,
            "revoked_at": None,
            "created_at": created_at,
            "status": "active",
        }

    def revoke_key(self, key_id: str, owner_address: str) -> dict[str, Any]:
        revoked_at = datetime.now(timezone.utc).isoformat()
        with self._db_lock, self._db_connect() as conn:
            conn.execute(
                "UPDATE session_keys SET revoked_at=? WHERE key_id=? AND LOWER(owner_address)=?",
                (revoked_at, key_id, owner_address.lower()),
            )
        return {"key_id": key_id, "revoked_at": revoked_at}

    def list_keys(self, owner_address: str) -> list[dict[str, Any]]:
        with self._db_lock, self._db_connect() as conn:
            rows = conn.execute(
                "SELECT * FROM session_keys WHERE LOWER(owner_address)=? ORDER BY created_at DESC",
                (owner_address.lower(),),
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def get_key(self, key_id: str) -> dict[str, Any] | None:
        with self._db_lock, self._db_connect() as conn:
            row = conn.execute(
                "SELECT * FROM session_keys WHERE key_id=?",
                (key_id,),
            ).fetchone()
        return self._row_to_dict(row) if row else None

    def validate_key(self, *, key_id: str, owner_address: str, policy_hash: str | None) -> dict[str, Any]:
        key = self.get_key(key_id)
        if not key:
            return {"ok": False, "reason": "session_key_not_found"}
        if key.get("owner_address") != owner_address.lower():
            return {"ok": False, "reason": "session_key_owner_mismatch"}
        if key.get("revoked"):
            return {"ok": False, "reason": "session_key_revoked"}
        if key.get("expired"):
            return {"ok": False, "reason": "session_key_expired"}
        if policy_hash and key.get("policy_hash") and key.get("policy_hash") != policy_hash:
            return {"ok": False, "reason": "session_key_policy_mismatch"}
        return {"ok": True, "reason": "ok", "key": key}

    async def generate_session_request(
        self,
        *,
        owner_address: str,
        session_key_address: str,
        max_position: int,
        allowed_protocols: list[str],
        duration_hours: int,
    ) -> dict[str, Any]:
        expires_at = (
            datetime.now(timezone.utc) + timedelta(hours=max(1, int(duration_hours)))
        ).isoformat()
        created = self.create_key(
            owner_address=owner_address,
            session_public_key=session_key_address,
            policy_hash=None,
            message_hash=f"session_grant:{owner_address.lower()}:{session_key_address.lower()}:{expires_at}",
            signature_digest="legacy-session-grant",
            expires_at=expires_at,
            max_position=max_position,
            allowed_protocols=allowed_protocols,
        )
        return {
            "session_id": created["key_id"],
            "owner_address": created["owner_address"],
            "session_key_address": session_key_address,
            "max_position": max_position,
            "allowed_protocols": allowed_protocols,
            "expires_at": expires_at,
            "calldata": [],
        }

    async def confirm_session_grant(self, *, session_id: str, tx_hash: str) -> dict[str, Any]:
        with self._db_lock, self._db_connect() as conn:
            conn.execute(
                "UPDATE session_keys SET grant_tx_hash=? WHERE key_id=?",
                (tx_hash, session_id),
            )
        key = self.get_key(session_id)
        return {
            "session_id": session_id,
            "tx_hash": tx_hash,
            "is_active": bool(key and key.get("status") == "active"),
        }

    def get_session_owner(self, session_id: str) -> str | None:
        session = self.get_key(session_id)
        if not session:
            return None
        owner = session.get("owner_address")
        return str(owner) if owner else None

    async def list_user_sessions(self, owner_address: str) -> list[dict[str, Any]]:
        rows = self.list_keys(owner_address)
        return [
            {
                "session_id": row.get("key_id"),
                "session_key_address": row.get("session_public_key"),
                "is_active": row.get("status") == "active",
                "allowed_protocols": row.get("allowed_protocols", []),
                "max_position": row.get("max_position"),
                "expires_at": row.get("expires_at"),
                "revoked_at": row.get("revoked_at"),
                "grant_tx_hash": row.get("grant_tx_hash"),
                "revoke_tx_hash": row.get("revoke_tx_hash"),
            }
            for row in rows
        ]

    async def revoke_session(self, *, session_id: str, owner_address: str) -> dict[str, Any]:
        key = self.get_key(session_id)
        if not key:
            return {"session_id": session_id, "revocation_ready": False, "reason": "session_not_found"}
        if str(key.get("owner_address") or "").lower() != owner_address.lower():
            return {"session_id": session_id, "revocation_ready": False, "reason": "session_owner_mismatch"}
        return {"session_id": session_id, "revocation_ready": True, "calldata": []}

    async def confirm_session_revoke(self, *, session_id: str, tx_hash: str) -> dict[str, Any]:
        owner = self.get_session_owner(session_id)
        if owner:
            self.revoke_key(session_id, owner)
        with self._db_lock, self._db_connect() as conn:
            conn.execute(
                "UPDATE session_keys SET revoke_tx_hash=? WHERE key_id=?",
                (tx_hash, session_id),
            )
        key = self.get_key(session_id)
        return {
            "session_id": session_id,
            "tx_hash": tx_hash,
            "is_active": bool(key and key.get("status") == "active"),
        }

    async def validate_session(self, *, session_id: str, protocol_id: int, amount: int) -> dict[str, Any]:
        session = self.get_key(session_id)
        if not session:
            return {"is_valid": False, "reason": "session_not_found"}
        if session.get("status") != "active":
            return {"is_valid": False, "reason": f"session_{session.get('status', 'invalid')}"}
        max_position = session.get("max_position")
        if isinstance(max_position, int) and max_position > 0 and int(amount) > max_position:
            return {"is_valid": False, "reason": "amount_exceeds_session_limit"}
        return {
            "is_valid": True,
            "reason": "ok",
            "session_id": session_id,
            "protocol_id": protocol_id,
            "amount": amount,
        }


_service: SessionKeyService | None = None


def get_session_key_service() -> SessionKeyService:
    global _service
    if _service is None:
        _service = SessionKeyService()
    return _service


class SessionServiceCompat:
    """Backward-compatible adapter for older callers expecting session service APIs."""

    def __init__(self, key_service: SessionKeyService) -> None:
        self._key_service = key_service

    async def generate_session_request(self, **kwargs: Any) -> dict[str, Any]:
        return await self._key_service.generate_session_request(**kwargs)

    async def confirm_session_grant(self, **kwargs: Any) -> dict[str, Any]:
        return await self._key_service.confirm_session_grant(**kwargs)

    def get_session_owner(self, session_id: str) -> str | None:
        return self._key_service.get_session_owner(session_id)

    async def list_user_sessions(self, owner_address: str) -> list[dict[str, Any]]:
        return await self._key_service.list_user_sessions(owner_address)

    async def revoke_session(self, **kwargs: Any) -> dict[str, Any]:
        return await self._key_service.revoke_session(**kwargs)

    async def confirm_session_revoke(self, **kwargs: Any) -> dict[str, Any]:
        return await self._key_service.confirm_session_revoke(**kwargs)

    async def validate_session(self, **kwargs: Any) -> dict[str, Any]:
        return await self._key_service.validate_session(**kwargs)


_compat_service: SessionServiceCompat | None = None


def get_session_service() -> SessionServiceCompat:
    global _compat_service
    if _compat_service is None:
        _compat_service = SessionServiceCompat(get_session_key_service())
    return _compat_service
