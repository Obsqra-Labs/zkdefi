"""
Double-Entry Ledger Service

Append-only double-entry bookkeeping for vault fund tracking.
Every entry debits one account and credits another by the same amount,
maintaining the accounting identity: total debits == total credits.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from typing import Any, Dict, List, Optional


class DoubleEntryLedger:
    _BALANCE_CHECK_PREFIXES = ("VAULT_AVAILABLE", "VAULT_PENDING")

    def __init__(self, db_path: str = ":memory:") -> None:
        self._db_path = db_path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        if db_path != ":memory:":
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._create_tables()

    def _create_tables(self) -> None:
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS ledger_entries (
                entry_id         INTEGER PRIMARY KEY AUTOINCREMENT,
                idempotency_key  TEXT UNIQUE NOT NULL,
                tx_type          TEXT NOT NULL,
                amount_wei       TEXT NOT NULL,
                token            TEXT NOT NULL,
                dr_account       TEXT NOT NULL,
                cr_account       TEXT NOT NULL,
                refs             TEXT NOT NULL DEFAULT '{}',
                receipt_hash     TEXT,
                created_at       REAL NOT NULL
            )
        """)
        self._conn.commit()

    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        d = {k: row[k] for k in row.keys()}
        d["amount_wei"] = int(d["amount_wei"])
        return d

    def post_entry(
        self,
        idempotency_key: str,
        tx_type: str,
        amount_wei: int,
        token: str,
        dr_account: str,
        cr_account: str,
        refs: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if refs is None:
            refs = {}

        with self._lock:
            existing = self._conn.execute(
                "SELECT * FROM ledger_entries WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing:
                return self._row_to_dict(existing)

            for prefix in self._BALANCE_CHECK_PREFIXES:
                if dr_account.startswith(prefix):
                    current = self.balance(dr_account)
                    if current < amount_wei:
                        raise ValueError(
                            f"Insufficient balance in {dr_account}"
                        )
                    break

            refs_json = json.dumps(refs, sort_keys=True)
            now = time.time()

            cur = self._conn.execute(
                """INSERT INTO ledger_entries
                   (idempotency_key, tx_type, amount_wei, token,
                    dr_account, cr_account, refs, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (idempotency_key, tx_type, str(amount_wei), token,
                 dr_account, cr_account, refs_json, now),
            )
            entry_id = cur.lastrowid

            hash_input = (
                f"{entry_id}:{dr_account}:{cr_account}:"
                f"{amount_wei}:{token}:{refs_json}"
            )
            receipt_hash = "0x" + hashlib.sha256(hash_input.encode()).hexdigest()

            self._conn.execute(
                "UPDATE ledger_entries SET receipt_hash = ? WHERE entry_id = ?",
                (receipt_hash, entry_id),
            )
            self._conn.commit()

            row = self._conn.execute(
                "SELECT * FROM ledger_entries WHERE entry_id = ?",
                (entry_id,),
            ).fetchone()
            return self._row_to_dict(row)

    def balance(self, account: str) -> int:
        with self._lock:
            credits = self._conn.execute(
                "SELECT amount_wei FROM ledger_entries WHERE cr_account = ?",
                (account,),
            ).fetchall()
            debits = self._conn.execute(
                "SELECT amount_wei FROM ledger_entries WHERE dr_account = ?",
                (account,),
            ).fetchall()
            total_cr = sum(int(r["amount_wei"]) for r in credits)
            total_dr = sum(int(r["amount_wei"]) for r in debits)
            return total_cr - total_dr

    def entries(
        self, account: str, limit: int = 50, offset: int = 0
    ) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                """SELECT * FROM ledger_entries
                   WHERE dr_account = ? OR cr_account = ?
                   ORDER BY created_at DESC
                   LIMIT ? OFFSET ?""",
                (account, account, limit, offset),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]

    def vault_summary(self, vault_id: str, token: str) -> Dict[str, int]:
        available = self.balance(f"VAULT_AVAILABLE:{vault_id}:{token}")
        pending = self.balance(f"VAULT_PENDING:{vault_id}:{token}")

        with self._lock:
            rows = self._conn.execute(
                """SELECT amount_wei FROM ledger_entries
                   WHERE cr_account LIKE 'STRATEGY_ESCROW:%:' || ?
                     AND (dr_account LIKE 'VAULT_PENDING:' || ? || ':%'
                          OR dr_account LIKE 'VAULT_AVAILABLE:' || ? || ':%')""",
                (token, vault_id, vault_id),
            ).fetchall()
            deployed = sum(int(r["amount_wei"]) for r in rows)

        return {
            "available": available,
            "pending": pending,
            "deployed": deployed,
        }

    # ── Pool-scoped helpers ──────────────────────────────────────────────

    def pool_balances(self, pool_id: str) -> Dict[str, int]:
        """Return {sub_account: balance_wei} for all accounts under POOL:{pool_id}:*."""
        prefix = f"POOL:{pool_id}:"
        with self._lock:
            cr_rows = self._conn.execute(
                "SELECT cr_account, amount_wei FROM ledger_entries WHERE cr_account LIKE ?",
                (prefix + "%",),
            ).fetchall()
            dr_rows = self._conn.execute(
                "SELECT dr_account, amount_wei FROM ledger_entries WHERE dr_account LIKE ?",
                (prefix + "%",),
            ).fetchall()

        totals: Dict[str, int] = {}
        for r in cr_rows:
            acct = r["cr_account"][len(prefix):]
            totals[acct] = totals.get(acct, 0) + int(r["amount_wei"])
        for r in dr_rows:
            acct = r["dr_account"][len(prefix):]
            totals[acct] = totals.get(acct, 0) - int(r["amount_wei"])

        return {k: v for k, v in totals.items() if v != 0}

    def pool_entries(
        self, pool_id: str, limit: int = 50, offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Audit trail for a specific pool."""
        prefix = f"POOL:{pool_id}:%"
        with self._lock:
            rows = self._conn.execute(
                """SELECT * FROM ledger_entries
                   WHERE dr_account LIKE ? OR cr_account LIKE ?
                   ORDER BY created_at DESC
                   LIMIT ? OFFSET ?""",
                (prefix, prefix, limit, offset),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]

    def pool_total(self, pool_id: str) -> int:
        """Sum of all balances across all sub-accounts for a pool."""
        return sum(self.pool_balances(pool_id).values())
