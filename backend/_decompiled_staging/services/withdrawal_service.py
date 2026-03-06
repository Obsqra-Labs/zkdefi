"""
Withdrawal Service

Manages the lifecycle of vault withdrawals: request -> send -> confirm.
Integrates with the DoubleEntryLedger for balance tracking and with a
relayer queue for on-chain settlement.
"""

from __future__ import annotations

import sqlite3
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

from app.services.double_entry_ledger import DoubleEntryLedger


class WithdrawalService:
    def __init__(self, ledger: DoubleEntryLedger, db_path: str = ":memory:") -> None:
        self._ledger = ledger
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        if db_path != ":memory:":
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._create_tables()

    def _create_tables(self) -> None:
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS withdrawals (
                withdrawal_id   TEXT PRIMARY KEY,
                vault_id        TEXT NOT NULL,
                amount_wei      TEXT NOT NULL,
                token           TEXT NOT NULL,
                destination     TEXT NOT NULL,
                route           TEXT NOT NULL,
                idempotency_key TEXT UNIQUE NOT NULL,
                status          TEXT NOT NULL DEFAULT 'REQUESTED',
                tx_hash         TEXT,
                created_at      REAL NOT NULL,
                sent_at         REAL,
                confirmed_at    REAL
            )
        """)
        self._conn.commit()

    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {k: row[k] for k in row.keys()}

    def request_withdrawal(
        self,
        vault_id: str,
        amount_wei: int,
        token: str,
        destination: str,
        route: str,
        idempotency_key: str,
    ) -> Dict[str, Any]:
        with self._lock:
            existing = self._conn.execute(
                "SELECT * FROM withdrawals WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing:
                return self._row_to_dict(existing)

            dr_account = f"VAULT_AVAILABLE:{vault_id}:{token}"
            cr_account = f"VAULT_PENDING:{vault_id}:{token}"

            self._ledger.post_entry(
                idempotency_key=f"wd-ledger-{idempotency_key}",
                tx_type="WITHDRAWAL_REQUEST",
                amount_wei=amount_wei,
                token=token,
                dr_account=dr_account,
                cr_account=cr_account,
                refs={"destination": destination, "route": route},
            )

            withdrawal_id = str(uuid.uuid4())
            now = time.time()

            self._conn.execute(
                """INSERT INTO withdrawals
                   (withdrawal_id, vault_id, amount_wei, token, destination,
                    route, idempotency_key, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?)""",
                (withdrawal_id, vault_id, str(amount_wei), token,
                 destination, route, idempotency_key, now),
            )
            self._conn.commit()

            row = self._conn.execute(
                "SELECT * FROM withdrawals WHERE withdrawal_id = ?",
                (withdrawal_id,),
            ).fetchone()
            return self._row_to_dict(row)

    def mark_sent(self, withdrawal_id: str, tx_hash: str) -> Dict[str, Any]:
        with self._lock:
            now = time.time()
            self._conn.execute(
                "UPDATE withdrawals SET status = 'SENT', tx_hash = ?, sent_at = ? WHERE withdrawal_id = ?",
                (tx_hash, now, withdrawal_id),
            )
            self._conn.commit()
            return self.get_withdrawal(withdrawal_id)

    def mark_confirmed(self, withdrawal_id: str) -> Dict[str, Any]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM withdrawals WHERE withdrawal_id = ?",
                (withdrawal_id,),
            ).fetchone()
            if not row:
                raise ValueError(f"Withdrawal {withdrawal_id} not found")

            wd = self._row_to_dict(row)

            dr_account = f"VAULT_PENDING:{wd['vault_id']}:{wd['token']}"
            cr_account = f"WITHDRAWAL_CLEARING:{wd['vault_id']}:{wd['token']}"

            self._ledger.post_entry(
                idempotency_key=f"wd-confirm-{withdrawal_id}",
                tx_type="WITHDRAWAL_CONFIRM",
                amount_wei=int(wd["amount_wei"]),
                token=wd["token"],
                dr_account=dr_account,
                cr_account=cr_account,
                refs={"withdrawal_id": withdrawal_id},
            )

            now = time.time()
            self._conn.execute(
                "UPDATE withdrawals SET status = 'CONFIRMED', confirmed_at = ? WHERE withdrawal_id = ?",
                (now, withdrawal_id),
            )
            self._conn.commit()
            return self.get_withdrawal(withdrawal_id)

    def get_withdrawal(self, withdrawal_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM withdrawals WHERE withdrawal_id = ?",
                (withdrawal_id,),
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def list_pending(self) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM withdrawals WHERE status IN ('REQUESTED', 'SENT') ORDER BY created_at",
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]
