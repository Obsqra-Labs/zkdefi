"""
Ledger Service

Persists Tier-2H claim records and an append-only audit log to SQLite.
Intended for custody records and payout tracking.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional


DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "ledger.db"


class LedgerService:
    def __init__(self, db_path: Optional[str], enabled: bool = True) -> None:
        self._log = logging.getLogger(__name__)
        self.enabled = enabled
        self._db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self._lock = threading.RLock()

        if not self.enabled:
            return

        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _db_connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self) -> None:
        with self._lock:
            conn = self._db_connect()
            try:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS claim_requests (
                        request_id INTEGER PRIMARY KEY,
                        requester TEXT,
                        claim_hash TEXT,
                        claim_salt TEXT,
                        recipient TEXT,
                        amount_wei TEXT,
                        payout_nonce TEXT,
                        commitment_low TEXT,
                        commitment_high TEXT,
                        claim_tx_hash TEXT,
                        payout_tx_hash TEXT,
                        status TEXT,
                        created_at INTEGER,
                        executed_at INTEGER
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ledger_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        event_type TEXT NOT NULL,
                        request_id INTEGER,
                        payload TEXT NOT NULL,
                        created_at INTEGER NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ledger_accounts (
                        address TEXT PRIMARY KEY,
                        balance_wei TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ledger_transfers (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        address TEXT NOT NULL,
                        amount_wei TEXT NOT NULL,
                        direction TEXT NOT NULL,
                        request_id INTEGER,
                        reason TEXT,
                        created_at INTEGER NOT NULL,
                        UNIQUE(request_id, direction)
                    )
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def _log_event(self, conn: sqlite3.Connection, event_type: str, request_id: Optional[int], payload: dict[str, Any]) -> None:
        created_at = int(time.time())
        conn.execute(
            "INSERT INTO ledger_events (event_type, request_id, payload, created_at) VALUES (?, ?, ?, ?)",
            (event_type, request_id, json.dumps(payload, separators=(",", ":"), sort_keys=True), created_at),
        )

    def record_claim_request(self, entry: dict[str, Any], log_event: bool = True) -> None:
        if not self.enabled:
            return
        now = int(time.time())
        status = "executed" if entry.get("executed") else entry.get("status", "pending")
        request_id = int(entry["request_id"])
        with self._lock:
            conn = self._db_connect()
            try:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO claim_requests (
                        request_id, requester, claim_hash, claim_salt, recipient,
                        amount_wei, payout_nonce, commitment_low, commitment_high,
                        claim_tx_hash, payout_tx_hash, status, created_at, executed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        request_id,
                        entry.get("requester"),
                        entry.get("claim_hash"),
                        entry.get("claim_salt"),
                        entry.get("recipient"),
                        str(entry.get("amount_wei")) if entry.get("amount_wei") is not None else None,
                        entry.get("payout_nonce"),
                        entry.get("commitment_low"),
                        entry.get("commitment_high"),
                        entry.get("claim_tx_hash"),
                        entry.get("tx_hash") or entry.get("payout_tx_hash"),
                        status,
                        entry.get("request_time") or now,
                        entry.get("execution_time"),
                    ),
                )
                if log_event:
                    self._log_event(
                        conn,
                        "claim_request_created",
                        request_id,
                        {
                            "request_id": request_id,
                            "claim_hash": entry.get("claim_hash"),
                            "amount_wei": str(entry.get("amount_wei")),
                            "recipient": entry.get("recipient"),
                            "status": status,
                        },
                    )
                conn.commit()
            finally:
                conn.close()

    def mark_claim_executed(self, request_id: int, tx_hash: Optional[str] = None, entry: Optional[dict[str, Any]] = None) -> None:
        if not self.enabled:
            return
        now = int(time.time())
        with self._lock:
            conn = self._db_connect()
            try:
                if entry:
                    self.record_claim_request(entry, log_event=False)
                cur = conn.execute(
                    """
                    UPDATE claim_requests
                    SET status = ?, executed_at = ?, payout_tx_hash = ?
                    WHERE request_id = ?
                    """,
                    ("executed", now, tx_hash, int(request_id)),
                )
                if cur.rowcount == 0:
                    conn.execute(
                        """
                        INSERT INTO claim_requests (request_id, status, created_at, executed_at, payout_tx_hash)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (int(request_id), "executed", now, now, tx_hash),
                    )
                self._log_event(
                    conn,
                    "claim_request_executed",
                    int(request_id),
                    {"request_id": int(request_id), "payout_tx_hash": tx_hash},
                )
                conn.commit()
            finally:
                conn.close()

    def get_balance(self, address: str) -> int:
        if not self.enabled:
            return 0
        with self._lock:
            conn = self._db_connect()
            try:
                row = conn.execute(
                    "SELECT balance_wei FROM ledger_accounts WHERE address = ?",
                    (address,),
                ).fetchone()
                if not row:
                    return 0
                return int(row[0])
            finally:
                conn.close()

    def credit_balance(self, address: str, amount_wei: int | str, request_id: Optional[int] = None, reason: str = "credit") -> int:
        if not self.enabled:
            return 0
        amount = int(amount_wei)
        if amount <= 0:
            raise ValueError("Amount must be positive")
        now = int(time.time())
        with self._lock:
            conn = self._db_connect()
            try:
                existing = None
                if request_id is not None:
                    existing = conn.execute(
                        "SELECT 1 FROM ledger_transfers WHERE request_id = ? AND direction = ?",
                        (int(request_id), "credit"),
                    ).fetchone()
                if existing:
                    return self.get_balance(address)
                row = conn.execute(
                    "SELECT balance_wei FROM ledger_accounts WHERE address = ?",
                    (address,),
                ).fetchone()
                current = int(row[0]) if row else 0
                new_balance = current + amount
                conn.execute(
                    "INSERT OR REPLACE INTO ledger_accounts (address, balance_wei, updated_at) VALUES (?, ?, ?)",
                    (address, str(new_balance), now),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO ledger_transfers (address, amount_wei, direction, request_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (address, str(amount), "credit", request_id, reason, now),
                )
                self._log_event(
                    conn,
                    "ledger_credit",
                    request_id,
                    {
                        "address": address,
                        "amount_wei": str(amount),
                        "balance_wei": str(new_balance),
                        "reason": reason,
                    },
                )
                conn.commit()
                return new_balance
            finally:
                conn.close()

    def debit_balance(self, address: str, amount_wei: int | str, request_id: Optional[int] = None, reason: str = "debit") -> int:
        if not self.enabled:
            return 0
        amount = int(amount_wei)
        if amount <= 0:
            raise ValueError("Amount must be positive")
        now = int(time.time())
        with self._lock:
            conn = self._db_connect()
            try:
                existing = None
                if request_id is not None:
                    existing = conn.execute(
                        "SELECT 1 FROM ledger_transfers WHERE request_id = ? AND direction = ?",
                        (int(request_id), "debit"),
                    ).fetchone()
                if existing:
                    return self.get_balance(address)
                row = conn.execute(
                    "SELECT balance_wei FROM ledger_accounts WHERE address = ?",
                    (address,),
                ).fetchone()
                current = int(row[0]) if row else 0
                if current < amount:
                    raise ValueError("Insufficient ledger balance")
                new_balance = current - amount
                conn.execute(
                    "INSERT OR REPLACE INTO ledger_accounts (address, balance_wei, updated_at) VALUES (?, ?, ?)",
                    (address, str(new_balance), now),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO ledger_transfers (address, amount_wei, direction, request_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (address, str(amount), "debit", request_id, reason, now),
                )
                self._log_event(
                    conn,
                    "ledger_debit",
                    request_id,
                    {
                        "address": address,
                        "amount_wei": str(amount),
                        "balance_wei": str(new_balance),
                        "reason": reason,
                    },
                )
                conn.commit()
                return new_balance
            finally:
                conn.close()

    def list_transfers(
        self,
        address: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        params: list[Any] = []
        query = "SELECT id, address, amount_wei, direction, request_id, reason, created_at FROM ledger_transfers"
        if address:
            query += " WHERE address = ?"
            params.append(address)
        query += " ORDER BY id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(query, params).fetchall()
                return [
                    {
                        "id": row[0],
                        "address": row[1],
                        "amount_wei": row[2],
                        "direction": row[3],
                        "request_id": row[4],
                        "reason": row[5],
                        "created_at": row[6],
                    }
                    for row in rows
                ]
            finally:
                conn.close()

    def get_claim(self, request_id: int) -> Optional[dict[str, Any]]:
        if not self.enabled:
            return None
        with self._lock:
            conn = self._db_connect()
            try:
                row = conn.execute(
                    """
                    SELECT request_id, requester, claim_hash, claim_salt, recipient,
                           amount_wei, payout_nonce, commitment_low, commitment_high,
                           claim_tx_hash, payout_tx_hash, status, created_at, executed_at
                    FROM claim_requests WHERE request_id = ?
                    """,
                    (int(request_id),),
                ).fetchone()
                if not row:
                    return None
                return {
                    "request_id": row[0],
                    "requester": row[1],
                    "claim_hash": row[2],
                    "claim_salt": row[3],
                    "recipient": row[4],
                    "amount_wei": row[5],
                    "payout_nonce": row[6],
                    "commitment_low": row[7],
                    "commitment_high": row[8],
                    "claim_tx_hash": row[9],
                    "payout_tx_hash": row[10],
                    "status": row[11],
                    "created_at": row[12],
                    "executed_at": row[13],
                }
            finally:
                conn.close()

    def list_claims(self, status: Optional[str] = None, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        params: list[Any] = []
        query = (
            "SELECT request_id, requester, claim_hash, recipient, amount_wei, status, "
            "claim_tx_hash, payout_tx_hash, created_at, executed_at "
            "FROM claim_requests"
        )
        if status:
            query += " WHERE status = ?"
            params.append(status)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(query, params).fetchall()
                return [
                    {
                        "request_id": row[0],
                        "requester": row[1],
                        "claim_hash": row[2],
                        "recipient": row[3],
                        "amount_wei": row[4],
                        "status": row[5],
                        "claim_tx_hash": row[6],
                        "payout_tx_hash": row[7],
                        "created_at": row[8],
                        "executed_at": row[9],
                    }
                    for row in rows
                ]
            finally:
                conn.close()

    def list_events(self, limit: int = 100, offset: int = 0, request_id: Optional[int] = None) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        params: list[Any] = []
        query = "SELECT id, event_type, request_id, payload, created_at FROM ledger_events"
        if request_id is not None:
            query += " WHERE request_id = ?"
            params.append(int(request_id))
        query += " ORDER BY id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(query, params).fetchall()
                events = []
                for row in rows:
                    payload = json.loads(row[3]) if row[3] else {}
                    events.append(
                        {
                            "id": row[0],
                            "event_type": row[1],
                            "request_id": row[2],
                            "payload": payload,
                            "created_at": row[4],
                        }
                    )
                return events
            finally:
                conn.close()


_LEDGER_INSTANCE: Optional[LedgerService] = None


def get_ledger_service() -> LedgerService:
    global _LEDGER_INSTANCE
    if _LEDGER_INSTANCE is None:
        enabled = os.getenv("LEDGER_ENABLED", "true").lower() == "true"
        db_path = os.getenv("LEDGER_DB_PATH")
        _LEDGER_INSTANCE = LedgerService(db_path=db_path, enabled=enabled)
    return _LEDGER_INSTANCE
