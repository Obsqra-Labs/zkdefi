"""
Constraint Receipt Service

Generates and manages on-chain receipts for agent actions.
Receipts provide transparency without revealing strategy details.

Persisted to SQLite so receipts survive server restarts.
"""
import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services.zkdefi_agent_service import ZkdefiAgentService

_RECEIPT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "receipts.db"


class ReceiptService:
    """
    Service for managing constraint receipts.
    All data persisted to SQLite.
    """

    def __init__(self):
        self.agent_service = ZkdefiAgentService()
        self._db_lock = threading.RLock()
        self._init_db()

    # ── DB helpers ────────────────────────────────────────────────────

    @staticmethod
    def _db_connect() -> sqlite3.Connection:
        _RECEIPT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(_RECEIPT_DB_PATH), timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._db_lock, self._db_connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS receipts (
                    receipt_id   TEXT PRIMARY KEY,
                    user_address TEXT NOT NULL,
                    action_type  TEXT,
                    proof_type   TEXT,
                    constraints_hash TEXT,
                    proof_hash   TEXT,
                    protocol_id  INTEGER,
                    amount       INTEGER DEFAULT 0,
                    threshold_or_model TEXT,
                    result       TEXT,
                    snapshot_hash TEXT,
                    tx_hash      TEXT,
                    fact_hash    TEXT,
                    model_hash   TEXT,
                    pool_id      TEXT,
                    metadata     TEXT,
                    on_chain     INTEGER DEFAULT 0,
                    timestamp    TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_receipts_user
                ON receipts(user_address)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_receipts_pool
                ON receipts(pool_id)
            """)

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        """Convert a sqlite3.Row to the receipt dict format callers expect."""
        d = dict(row)
        d["on_chain"] = bool(d.get("on_chain", 0))
        d["user"] = d.pop("user_address", "")
        if d.get("metadata"):
            try:
                d["metadata"] = json.loads(d["metadata"])
            except (json.JSONDecodeError, TypeError):
                pass
        return d

    # ── public API ────────────────────────────────────────────────────

    async def create_receipt(
        self,
        user_address: str,
        constraints_hash: str = "",
        proof_hash: str = "",
        action_type: str = "",  # 'deposit', 'withdraw', 'rebalance'
        protocol_id: int = 0,
        amount: int = 0,
        *,
        metadata: dict | None = None,
    ) -> dict[str, Any]:
        """
        Create a new constraint receipt.

        Returns receipt with ID for on-chain submission.
        Now accepts an optional metadata kwarg so privacy-vault callers
        no longer error out.
        """
        timestamp = datetime.now(timezone.utc).isoformat()

        receipt_id = "0x" + hashlib.sha256(
            f"{user_address}{constraints_hash}{proof_hash}{timestamp}".encode()
        ).hexdigest()[:64]

        meta_json = json.dumps(metadata) if metadata else None

        with self._db_lock, self._db_connect() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO receipts
                   (receipt_id, user_address, constraints_hash, proof_hash,
                    action_type, protocol_id, amount, metadata, on_chain, timestamp)
                   VALUES (?,?,?,?,?,?,?,?,0,?)""",
                (receipt_id, user_address, constraints_hash, proof_hash,
                 action_type, protocol_id, amount, meta_json, timestamp),
            )

        return {
            "receipt_id": receipt_id,
            "user": user_address,
            "constraints_hash": constraints_hash,
            "proof_hash": proof_hash,
            "action_type": action_type,
            "protocol_id": protocol_id,
            "amount": amount,
            "metadata": metadata,
            "timestamp": timestamp,
            "on_chain": False,
        }

    async def confirm_receipt(
        self,
        receipt_id: str,
        tx_hash: str,
    ) -> dict[str, Any]:
        """Confirm receipt was submitted on-chain."""
        with self._db_lock, self._db_connect() as conn:
            conn.execute(
                "UPDATE receipts SET on_chain=1, tx_hash=? WHERE receipt_id=?",
                (tx_hash, receipt_id),
            )
        return {
            "receipt_id": receipt_id,
            "tx_hash": tx_hash,
            "status": "confirmed",
        }

    async def get_receipt(self, receipt_id: str) -> dict[str, Any] | None:
        """Get receipt by ID."""
        with self._db_lock, self._db_connect() as conn:
            row = conn.execute(
                "SELECT * FROM receipts WHERE receipt_id=?", (receipt_id,)
            ).fetchone()
        return self._row_to_dict(row) if row else None

    async def get_user_receipts(self, user_address: str) -> list[dict[str, Any]]:
        """Get all receipts for a user (runs in thread to avoid blocking)."""
        import asyncio
        key = (user_address or "").strip().lower()

        def _fetch() -> list[dict[str, Any]]:
            with self._db_lock, self._db_connect() as conn:
                rows = conn.execute(
                    "SELECT * FROM receipts WHERE LOWER(user_address)=? ORDER BY timestamp DESC",
                    (key,),
                ).fetchall()
            return [self._row_to_dict(r) for r in rows]

        return await asyncio.to_thread(_fetch)

    async def get_receipts(self, limit: int | None = None) -> list[dict[str, Any]]:
        """Get all receipts across users, newest first."""
        import asyncio

        def _fetch() -> list[dict[str, Any]]:
            sql = "SELECT * FROM receipts ORDER BY timestamp DESC"
            params: tuple[Any, ...] = ()
            if isinstance(limit, int) and limit > 0:
                sql += " LIMIT ?"
                params = (limit,)
            with self._db_lock, self._db_connect() as conn:
                rows = conn.execute(sql, params).fetchall()
            return [self._row_to_dict(r) for r in rows]

        return await asyncio.to_thread(_fetch)

    def append_proof_receipt(
        self,
        user_address: str,
        proof_type: str,
        threshold_or_model: str,
        result: str,
        snapshot_hash: str | None = None,
        tx_hash: str | None = None,
        fact_hash: str | None = None,
        model_hash: str | None = None,
        pool_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Append a proof-oriented receipt (risk_score, pool_safety, rebalance, etc.).
        Used by zkML and rebalancer; readable by risk passport and proof timeline.
        """
        timestamp = datetime.now(timezone.utc).isoformat()
        receipt_id = "0x" + hashlib.sha256(
            f"{user_address}{proof_type}{threshold_or_model}{result}{timestamp}".encode()
        ).hexdigest()[:64]

        with self._db_lock, self._db_connect() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO receipts
                   (receipt_id, user_address, proof_type, threshold_or_model,
                    result, snapshot_hash, tx_hash, fact_hash, model_hash,
                    pool_id, on_chain, timestamp)
                   VALUES (?,?,?,?,?,?,?,?,?,?,0,?)""",
                (receipt_id, user_address, proof_type, threshold_or_model,
                 result, snapshot_hash, tx_hash, fact_hash, model_hash,
                 pool_id, timestamp),
            )

        return {
            "receipt_id": receipt_id,
            "user": user_address,
            "proof_type": proof_type,
            "threshold_or_model": threshold_or_model,
            "result": result,
            "timestamp": timestamp,
            "snapshot_hash": snapshot_hash,
            "tx_hash": tx_hash,
            "fact_hash": fact_hash,
            "model_hash": model_hash,
            "pool_id": pool_id,
            "on_chain": False,
        }

    def get_receipts_by_pool(self, pool_id: str) -> list[dict[str, Any]]:
        """Get all receipts that have this pool_id (e.g. pool_safety runs)."""
        with self._db_lock, self._db_connect() as conn:
            rows = conn.execute(
                "SELECT * FROM receipts WHERE pool_id=? ORDER BY timestamp DESC",
                (pool_id,),
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    async def generate_constraints_hash(
        self,
        max_position: int,
        max_daily_yield_bps: int,
        min_withdraw_delay: int,
    ) -> str:
        """Generate hash of user constraints."""
        return "0x" + hashlib.sha256(
            f"{max_position}{max_daily_yield_bps}{min_withdraw_delay}".encode()
        ).hexdigest()[:64]


# Singleton instance
_receipt_service: ReceiptService | None = None


def get_receipt_service() -> ReceiptService:
    """Get or create the receipt service singleton."""
    global _receipt_service
    if _receipt_service is None:
        _receipt_service = ReceiptService()
    return _receipt_service
