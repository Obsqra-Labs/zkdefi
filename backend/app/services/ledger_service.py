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
                    CREATE TABLE IF NOT EXISTS ledger_asset_accounts (
                        address TEXT NOT NULL,
                        asset TEXT NOT NULL,
                        balance_wei TEXT NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY(address, asset)
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ledger_transfers (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        address TEXT NOT NULL,
                        asset TEXT NOT NULL DEFAULT 'STRK',
                        amount_wei TEXT NOT NULL,
                        direction TEXT NOT NULL,
                        request_id INTEGER,
                        reason TEXT,
                        tx_hash TEXT,
                        created_at INTEGER NOT NULL,
                        settlement_type TEXT NOT NULL DEFAULT 'onchain',
                        capital_source TEXT,
                        UNIQUE(request_id, direction)
                    )
                    """
                )
                self._migrate_ledger_transfers_settlement_type(conn)
                self._migrate_ledger_transfers_asset(conn)
                self._migrate_ledger_transfers_capital_source(conn)
                self._migrate_ledger_transfers_tx_hash(conn)
                self._migrate_ledger_asset_accounts_seed(conn)
                # ── Vault tables ─────────────────────────────────────
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS vault_deposits (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_address TEXT NOT NULL,
                        amount_wei TEXT NOT NULL,
                        tx_hash TEXT UNIQUE,
                        status TEXT NOT NULL DEFAULT 'confirmed',
                        created_at INTEGER NOT NULL,
                        is_demo INTEGER NOT NULL DEFAULT 0
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS vault_allocations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_address TEXT NOT NULL,
                        venue TEXT NOT NULL,
                        position_id TEXT,
                        amount_wei TEXT NOT NULL,
                        pair TEXT,
                        lower_tick TEXT,
                        upper_tick TEXT,
                        status TEXT NOT NULL DEFAULT 'active',
                        allocated_at INTEGER NOT NULL,
                        recalled_at INTEGER,
                        recall_tx_hash TEXT,
                        is_demo INTEGER NOT NULL DEFAULT 0
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS vault_yield_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_address TEXT NOT NULL,
                        allocation_id INTEGER,
                        amount_wei TEXT NOT NULL,
                        harvest_tx_hash TEXT,
                        harvested_at INTEGER NOT NULL
                    )
                    """
                )
                self._migrate_vault_deposits_is_demo(conn)
                self._migrate_vault_allocations_is_demo(conn)
                conn.commit()
            finally:
                conn.close()

    def _migrate_ledger_transfers_settlement_type(self, conn: sqlite3.Connection) -> None:
        """Add settlement_type to ledger_transfers if missing (existing DBs)."""
        try:
            row = conn.execute("PRAGMA table_info(ledger_transfers)").fetchall()
            columns = [r[1] for r in row]
            if "settlement_type" not in columns:
                conn.execute(
                    "ALTER TABLE ledger_transfers ADD COLUMN settlement_type TEXT NOT NULL DEFAULT 'onchain'"
                )
        except Exception as e:
            self._log.warning("Migration ledger_transfers.settlement_type: %s", e)

    def _migrate_ledger_transfers_asset(self, conn: sqlite3.Connection) -> None:
        """Add asset column to ledger_transfers if missing (existing DBs)."""
        try:
            row = conn.execute("PRAGMA table_info(ledger_transfers)").fetchall()
            columns = [r[1] for r in row]
            if "asset" not in columns:
                conn.execute(
                    "ALTER TABLE ledger_transfers ADD COLUMN asset TEXT NOT NULL DEFAULT 'STRK'"
                )
        except Exception as e:
            self._log.warning("Migration ledger_transfers.asset: %s", e)

    def _migrate_ledger_transfers_capital_source(self, conn: sqlite3.Connection) -> None:
        """Add capital_source column to ledger_transfers if missing."""
        try:
            row = conn.execute("PRAGMA table_info(ledger_transfers)").fetchall()
            columns = [r[1] for r in row]
            if "capital_source" not in columns:
                conn.execute(
                    "ALTER TABLE ledger_transfers ADD COLUMN capital_source TEXT"
                )
        except Exception as e:
            self._log.warning("Migration ledger_transfers.capital_source: %s", e)

    def _migrate_ledger_transfers_tx_hash(self, conn: sqlite3.Connection) -> None:
        """Add tx_hash column to ledger_transfers if missing."""
        try:
            row = conn.execute("PRAGMA table_info(ledger_transfers)").fetchall()
            columns = [r[1] for r in row]
            if "tx_hash" not in columns:
                conn.execute("ALTER TABLE ledger_transfers ADD COLUMN tx_hash TEXT")
        except Exception as e:
            self._log.warning("Migration ledger_transfers.tx_hash: %s", e)

    def _migrate_ledger_asset_accounts_seed(self, conn: sqlite3.Connection) -> None:
        """Backfill STRK balances from legacy ledger_accounts into ledger_asset_accounts."""
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO ledger_asset_accounts (address, asset, balance_wei, updated_at)
                SELECT address, 'STRK', balance_wei, updated_at
                FROM ledger_accounts
                """
            )
        except Exception as e:
            self._log.warning("Migration ledger_asset_accounts seed: %s", e)

    def _migrate_vault_deposits_is_demo(self, conn: sqlite3.Connection) -> None:
        """Add is_demo to vault_deposits if missing."""
        try:
            row = conn.execute("PRAGMA table_info(vault_deposits)").fetchall()
            columns = [r[1] for r in row]
            if "is_demo" not in columns:
                conn.execute("ALTER TABLE vault_deposits ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0")
        except Exception as e:
            self._log.warning("Migration vault_deposits.is_demo: %s", e)

    def _migrate_vault_allocations_is_demo(self, conn: sqlite3.Connection) -> None:
        """Add is_demo to vault_allocations if missing."""
        try:
            row = conn.execute("PRAGMA table_info(vault_allocations)").fetchall()
            columns = [r[1] for r in row]
            if "is_demo" not in columns:
                conn.execute("ALTER TABLE vault_allocations ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0")
        except Exception as e:
            self._log.warning("Migration vault_allocations.is_demo: %s", e)

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

    def mark_claim_cancelled(self, request_id: int, reason: Optional[str] = None) -> None:
        if not self.enabled:
            return
        now = int(time.time())
        with self._lock:
            conn = self._db_connect()
            try:
                cur = conn.execute(
                    """
                    UPDATE claim_requests
                    SET status = ?, executed_at = ?
                    WHERE request_id = ?
                    """,
                    ("cancelled", now, int(request_id)),
                )
                if cur.rowcount == 0:
                    conn.execute(
                        """
                        INSERT INTO claim_requests (request_id, status, created_at, executed_at)
                        VALUES (?, ?, ?, ?)
                        """,
                        (int(request_id), "cancelled", now, now),
                    )
                self._log_event(
                    conn,
                    "claim_request_cancelled",
                    int(request_id),
                    {"request_id": int(request_id), "reason": reason},
                )
                conn.commit()
            finally:
                conn.close()

    # ── Address normalisation ────────────────────────────────────────────
    @staticmethod
    def _norm_addr(addr: str) -> str:
        """Canonical 0x-prefixed lower-hex with no excess leading zeros."""
        try:
            v = addr.strip()
            return hex(int(v, 16) if v.startswith(("0x", "0X")) else int(v)).lower()
        except (ValueError, TypeError):
            return addr.lower()

    @staticmethod
    def _norm_asset(asset: Optional[str]) -> str:
        raw = str(asset or "STRK").strip().upper()
        aliases = {
            "STRK": "STRK",
            "ZKDETH": "zkdETH",
            "ZKDAI": "zkdAI",
        }
        return aliases.get(raw, raw)

    def get_asset_balance(self, address: str, asset: str = "STRK") -> int:
        address = self._norm_addr(address)
        asset_norm = self._norm_asset(asset)
        if not self.enabled:
            return 0
        with self._lock:
            conn = self._db_connect()
            try:
                row = conn.execute(
                    "SELECT balance_wei FROM ledger_asset_accounts WHERE address = ? AND asset = ?",
                    (address, asset_norm),
                ).fetchone()
                if row:
                    return int(row[0])
                if asset_norm == "STRK":
                    legacy = conn.execute(
                        "SELECT balance_wei FROM ledger_accounts WHERE address = ?",
                        (address,),
                    ).fetchone()
                    if legacy:
                        return int(legacy[0])
                return 0
            finally:
                conn.close()

    def get_balance(self, address: str) -> int:
        return self.get_asset_balance(address, asset="STRK")

    def list_asset_balances(self, address: str) -> dict[str, str]:
        address = self._norm_addr(address)
        if not self.enabled:
            return {}
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(
                    """
                    SELECT asset, balance_wei
                    FROM ledger_asset_accounts
                    WHERE address = ?
                    ORDER BY asset ASC
                    """,
                    (address,),
                ).fetchall()
                balances = {str(r[0]): str(r[1]) for r in rows}
                if "STRK" not in balances:
                    legacy = conn.execute(
                        "SELECT balance_wei FROM ledger_accounts WHERE address = ?",
                        (address,),
                    ).fetchone()
                    if legacy:
                        balances["STRK"] = str(legacy[0])
                return balances
            finally:
                conn.close()

    def credit_balance(self, address: str, amount_wei: int | str, request_id: Optional[int] = None, reason: str = "credit", settlement_type: str = "onchain", asset: str = "STRK", capital_source: Optional[str] = None, tx_hash: Optional[str] = None) -> int:
        address = self._norm_addr(address)
        asset_norm = self._norm_asset(asset)
        if not self.enabled:
            return 0
        amount = int(amount_wei)
        if amount <= 0:
            raise ValueError("Amount must be positive")
        st = "demo" if settlement_type == "demo" else "onchain"
        now = int(time.time())
        with self._lock:
            conn = self._db_connect()
            try:
                existing = None
                if request_id is not None:
                    existing = conn.execute(
                        "SELECT 1 FROM ledger_transfers WHERE request_id = ? AND direction = ? AND asset = ?",
                        (int(request_id), "credit", asset_norm),
                    ).fetchone()
                if existing:
                    return self.get_asset_balance(address, asset=asset_norm)
                row = conn.execute(
                    "SELECT balance_wei FROM ledger_asset_accounts WHERE address = ? AND asset = ?",
                    (address, asset_norm),
                ).fetchone()
                current = int(row[0]) if row else 0
                new_balance = current + amount
                conn.execute(
                    "INSERT OR REPLACE INTO ledger_asset_accounts (address, asset, balance_wei, updated_at) VALUES (?, ?, ?, ?)",
                    (address, asset_norm, str(new_balance), now),
                )
                if asset_norm == "STRK":
                    conn.execute(
                        "INSERT OR REPLACE INTO ledger_accounts (address, balance_wei, updated_at) VALUES (?, ?, ?)",
                        (address, str(new_balance), now),
                    )
                conn.execute(
                    "INSERT OR IGNORE INTO ledger_transfers (address, asset, amount_wei, direction, request_id, reason, tx_hash, created_at, settlement_type, capital_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        address,
                        asset_norm,
                        str(amount),
                        "credit",
                        request_id,
                        reason,
                        tx_hash,
                        now,
                        st,
                        capital_source,
                    ),
                )
                payload: dict[str, Any] = {
                    "address": address,
                    "asset": asset_norm,
                    "amount_wei": str(amount),
                    "balance_wei": str(new_balance),
                    "reason": reason,
                }
                if capital_source:
                    payload["capital_source"] = capital_source
                if tx_hash:
                    payload["tx_hash"] = tx_hash
                if st == "demo":
                    payload["settlement_type"] = "demo"
                self._log_event(
                    conn,
                    "ledger_credit",
                    request_id,
                    payload,
                )
                conn.commit()
                return new_balance
            finally:
                conn.close()

    def debit_balance(self, address: str, amount_wei: int | str, request_id: Optional[int] = None, reason: str = "debit", settlement_type: str = "onchain", asset: str = "STRK", capital_source: Optional[str] = None, tx_hash: Optional[str] = None) -> int:
        address = self._norm_addr(address)
        asset_norm = self._norm_asset(asset)
        if not self.enabled:
            return 0
        amount = int(amount_wei)
        if amount <= 0:
            raise ValueError("Amount must be positive")
        st = "demo" if settlement_type == "demo" else "onchain"
        now = int(time.time())
        with self._lock:
            conn = self._db_connect()
            try:
                existing = None
                if request_id is not None:
                    existing = conn.execute(
                        "SELECT 1 FROM ledger_transfers WHERE request_id = ? AND direction = ? AND asset = ?",
                        (int(request_id), "debit", asset_norm),
                    ).fetchone()
                if existing:
                    return self.get_asset_balance(address, asset=asset_norm)
                row = conn.execute(
                    "SELECT balance_wei FROM ledger_asset_accounts WHERE address = ? AND asset = ?",
                    (address, asset_norm),
                ).fetchone()
                current = int(row[0]) if row else 0
                if current < amount:
                    raise ValueError("Insufficient ledger balance")
                new_balance = current - amount
                conn.execute(
                    "INSERT OR REPLACE INTO ledger_asset_accounts (address, asset, balance_wei, updated_at) VALUES (?, ?, ?, ?)",
                    (address, asset_norm, str(new_balance), now),
                )
                if asset_norm == "STRK":
                    conn.execute(
                        "INSERT OR REPLACE INTO ledger_accounts (address, balance_wei, updated_at) VALUES (?, ?, ?)",
                        (address, str(new_balance), now),
                    )
                conn.execute(
                    "INSERT OR IGNORE INTO ledger_transfers (address, asset, amount_wei, direction, request_id, reason, tx_hash, created_at, settlement_type, capital_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        address,
                        asset_norm,
                        str(amount),
                        "debit",
                        request_id,
                        reason,
                        tx_hash,
                        now,
                        st,
                        capital_source,
                    ),
                )
                payload: dict[str, Any] = {
                    "address": address,
                    "asset": asset_norm,
                    "amount_wei": str(amount),
                    "balance_wei": str(new_balance),
                    "reason": reason,
                }
                if capital_source:
                    payload["capital_source"] = capital_source
                if tx_hash:
                    payload["tx_hash"] = tx_hash
                if st == "demo":
                    payload["settlement_type"] = "demo"
                self._log_event(
                    conn,
                    "ledger_debit",
                    request_id,
                    payload,
                )
                conn.commit()
                return new_balance
            finally:
                conn.close()

    def list_transfers(
        self,
        address: Optional[str] = None,
        asset: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        params: list[Any] = []
        query = (
            "SELECT id, address, asset, amount_wei, direction, request_id, reason, "
            "tx_hash, created_at, settlement_type, capital_source FROM ledger_transfers"
        )
        clauses: list[str] = []
        if address:
            address = self._norm_addr(address)
            clauses.append("address = ?")
            params.append(address)
        if asset:
            clauses.append("asset = ?")
            params.append(self._norm_asset(asset))
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
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
                        "asset": row[2] if len(row) > 2 and row[2] else "STRK",
                        "amount_wei": row[3],
                        "direction": row[4],
                        "request_id": row[5],
                        "reason": row[6],
                        "tx_hash": row[7] if len(row) > 7 else None,
                        "created_at": row[8],
                        "settlement_type": row[9] if len(row) > 9 else "onchain",
                        "capital_source": row[10] if len(row) > 10 else None,
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

    # ── Vault deposit helpers ────────────────────────────────────────────

    def record_vault_deposit(
        self,
        user_address: str,
        amount_wei: int | str,
        tx_hash: str,
        is_demo: bool = False,
    ) -> dict[str, Any]:
        """Record a vault deposit and credit the user's ledger balance.

        Returns dict with deposit record and new balance.
        Idempotent: duplicate tx_hash is silently ignored.
        """
        user_address = self._norm_addr(user_address)
        if not self.enabled:
            return {"deposit_id": None, "balance_wei": 0}
        amount = int(amount_wei)
        if amount <= 0:
            raise ValueError("Deposit amount must be positive")
        now = int(time.time())
        with self._lock:
            conn = self._db_connect()
            try:
                # Idempotency guard on tx_hash
                existing = conn.execute(
                    "SELECT id FROM vault_deposits WHERE tx_hash = ?",
                    (tx_hash,),
                ).fetchone()
                if existing:
                    balance = self.get_balance(user_address)
                    return {"deposit_id": existing[0], "balance_wei": balance, "duplicate": True}

                conn.execute(
                    "INSERT INTO vault_deposits (user_address, amount_wei, tx_hash, status, created_at, is_demo) VALUES (?, ?, ?, ?, ?, ?)",
                    (user_address, str(amount), tx_hash, "confirmed", now, 1 if is_demo else 0),
                )
                deposit_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

                # Credit the ledger balance
                row = conn.execute(
                    "SELECT balance_wei FROM ledger_asset_accounts WHERE address = ? AND asset = 'STRK'",
                    (user_address,),
                ).fetchone()
                current = int(row[0]) if row else 0
                new_balance = current + amount
                conn.execute(
                    "INSERT OR REPLACE INTO ledger_asset_accounts (address, asset, balance_wei, updated_at) VALUES (?, 'STRK', ?, ?)",
                    (user_address, str(new_balance), now),
                )
                conn.execute(
                    "INSERT OR REPLACE INTO ledger_accounts (address, balance_wei, updated_at) VALUES (?, ?, ?)",
                    (user_address, str(new_balance), now),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO ledger_transfers (address, asset, amount_wei, direction, request_id, reason, tx_hash, created_at, settlement_type, capital_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        user_address,
                        "STRK",
                        str(amount),
                        "credit",
                        deposit_id,
                        "vault_deposit",
                        tx_hash,
                        now,
                        "demo" if is_demo else "onchain",
                        "wallet_mode",
                    ),
                )
                self._log_event(
                    conn,
                    "vault_deposit",
                    deposit_id,
                    {
                        "user_address": user_address,
                        "amount_wei": str(amount),
                        "tx_hash": tx_hash,
                        "balance_wei": str(new_balance),
                    },
                )
                conn.commit()
                return {"deposit_id": deposit_id, "balance_wei": new_balance, "duplicate": False}
            finally:
                conn.close()

    def list_vault_deposits(self, user_address: str, limit: int = 50) -> list[dict[str, Any]]:
        user_address = self._norm_addr(user_address)
        if not self.enabled:
            return []
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(
                    "SELECT id, user_address, amount_wei, tx_hash, status, created_at, is_demo FROM vault_deposits WHERE user_address = ? ORDER BY id DESC LIMIT ?",
                    (user_address, limit),
                ).fetchall()
                return [
                    {"id": r[0], "user_address": r[1], "amount_wei": r[2], "tx_hash": r[3], "status": r[4], "created_at": r[5], "is_demo": bool(r[6]) if len(r) > 6 else False}
                    for r in rows
                ]
            finally:
                conn.close()

    def get_total_deposited(self, user_address: str) -> int:
        """Sum of all confirmed vault deposits for a user."""
        user_address = self._norm_addr(user_address)
        if not self.enabled:
            return 0
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(
                    "SELECT amount_wei FROM vault_deposits WHERE user_address = ? AND status = 'confirmed'",
                    (user_address,),
                ).fetchall()
                return sum(int(r[0]) for r in rows)
            finally:
                conn.close()

    def get_deployed_amount(self, user_address: str) -> int:
        """Sum of active allocations for a user."""
        user_address = self._norm_addr(user_address)
        if not self.enabled:
            return 0
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(
                    "SELECT amount_wei FROM vault_allocations WHERE user_address = ? AND status = 'active'",
                    (user_address,),
                ).fetchall()
                return sum(int(r[0]) for r in rows)
            finally:
                conn.close()

    def get_total_yield(self, user_address: str) -> int:
        """Sum of all yield harvested for a user."""
        user_address = self._norm_addr(user_address)
        if not self.enabled:
            return 0
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(
                    "SELECT amount_wei FROM vault_yield_events WHERE user_address = ?",
                    (user_address,),
                ).fetchall()
                return sum(int(r[0]) for r in rows)
            finally:
                conn.close()

    def list_active_allocations(self, user_address: str) -> list[dict[str, Any]]:
        user_address = self._norm_addr(user_address)
        if not self.enabled:
            return []
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(
                    "SELECT id, user_address, venue, position_id, amount_wei, pair, lower_tick, upper_tick, status, allocated_at, is_demo FROM vault_allocations WHERE user_address = ? AND status = 'active' ORDER BY allocated_at DESC",
                    (user_address,),
                ).fetchall()
                return [
                    {
                        "id": r[0], "user_address": r[1], "venue": r[2], "position_id": r[3],
                        "amount_wei": r[4], "pair": r[5], "lower_tick": r[6], "upper_tick": r[7],
                        "status": r[8], "allocated_at": r[9], "is_demo": bool(r[10]) if len(r) > 10 else False,
                    }
                    for r in rows
                ]
            finally:
                conn.close()

    def get_total_withdrawn(self, user_address: str) -> int:
        """Sum of all debit transfers with vault_withdraw or claim_payout reason."""
        user_address = self._norm_addr(user_address)
        if not self.enabled:
            return 0
        with self._lock:
            conn = self._db_connect()
            try:
                rows = conn.execute(
                    "SELECT amount_wei FROM ledger_transfers WHERE address = ? AND asset = 'STRK' AND direction = 'debit' AND reason IN ('vault_withdraw', 'claim_payout', 'transfer_out_shielded', 'transfer_out_wallet')",
                    (user_address,),
                ).fetchall()
                return sum(int(r[0]) for r in rows)
            finally:
                conn.close()

    def record_vault_allocation(
        self,
        user_address: str,
        strategy_id: str,
        pool_id: str,
        amount: float,
        metadata: str = "",
        pair: str = "",
        status: str = "active",
        is_demo: bool = False,
    ) -> int | None:
        """Record an AI allocation decision in vault_allocations.

        Returns the allocation row id.
        """
        user_address = self._norm_addr(user_address)
        if not self.enabled:
            return None
        now = int(time.time())
        # Use pair if provided, else fall back to metadata for backwards compat
        pair_val = pair or metadata
        with self._lock:
            conn = self._db_connect()
            try:
                conn.execute(
                    "INSERT INTO vault_allocations "
                    "(user_address, venue, position_id, amount_wei, pair, status, allocated_at, is_demo) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (user_address, strategy_id, pool_id, str(int(amount * 1e18)),
                     pair_val, status, now, 1 if is_demo else 0),
                )
                row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                conn.commit()
                return row_id
            except Exception as e:
                logger.warning("record_vault_allocation failed: %s", e)
                return None
            finally:
                conn.close()

    def get_vault_allocations(self, user_address: str, status: str | None = None) -> list[dict[str, Any]]:
        """Return vault allocations for a user.  Optional status filter."""
        user_address = self._norm_addr(user_address)
        if not self.enabled:
            return []
        with self._lock:
            conn = self._db_connect()
            try:
                if status:
                    rows = conn.execute(
                        "SELECT id, user_address, venue, position_id, amount_wei, pair, "
                        "lower_tick, upper_tick, status, allocated_at, is_demo "
                        "FROM vault_allocations WHERE user_address = ? AND status = ? "
                        "ORDER BY allocated_at DESC",
                        (user_address, status),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id, user_address, venue, position_id, amount_wei, pair, "
                        "lower_tick, upper_tick, status, allocated_at, is_demo "
                        "FROM vault_allocations WHERE user_address = ? "
                        "ORDER BY allocated_at DESC",
                        (user_address,),
                    ).fetchall()
                return [
                    {
                        "id": r[0], "user_address": r[1], "venue": r[2],
                        "position_id": r[3], "amount": r[4], "pool_id": r[3],
                        "metadata": r[5], "status": r[8], "allocated_at": r[9],
                        "is_demo": bool(r[10]) if len(r) > 10 else False,
                    }
                    for r in rows
                ]
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
