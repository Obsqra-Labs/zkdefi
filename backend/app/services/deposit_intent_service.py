"""
Deposit Intent Service

Manages the lifecycle of deposit intents: creation (PENDING) and
confirmation (SETTLED).  On confirmation the service posts a double-entry
ledger record, creates a privacy note, and marks the intent as settled.
"""

from __future__ import annotations

import sqlite3
import time
import uuid
from typing import Any, Dict, Optional

from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.vault_account_service import VaultAccountService
from app.services.note_store import NoteStore


class DepositIntentService:
    def __init__(
        self,
        ledger: DoubleEntryLedger,
        vaults: VaultAccountService,
        notes: NoteStore,
        db_path: str = ":memory:",
    ) -> None:
        self._ledger = ledger
        self._vaults = vaults
        self._notes = notes
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self) -> None:
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS deposit_intents (
                intent_id       TEXT PRIMARY KEY,
                vault_id        TEXT NOT NULL,
                amount_wei      TEXT NOT NULL,
                token           TEXT NOT NULL,
                rail            TEXT NOT NULL,
                idempotency_key TEXT UNIQUE NOT NULL,
                status          TEXT NOT NULL DEFAULT 'PENDING',
                tx_hash         TEXT,
                commitment_hash TEXT,
                created_at      REAL NOT NULL,
                settled_at      REAL
            )
        """)
        self._conn.commit()

    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {k: row[k] for k in row.keys()}

    def create_intent(
        self,
        vault_id: str,
        amount_wei: int,
        token: str,
        rail: str,
        idempotency_key: str,
    ) -> Dict[str, Any]:
        existing = self._conn.execute(
            "SELECT * FROM deposit_intents WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
        if existing:
            return self._row_to_dict(existing)

        intent_id = str(uuid.uuid4())
        now = time.time()
        self._conn.execute(
            """INSERT INTO deposit_intents
               (intent_id, vault_id, amount_wei, token, rail,
                idempotency_key, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)""",
            (intent_id, vault_id, str(amount_wei), token, rail,
             idempotency_key, now),
        )
        self._conn.commit()
        return self._row_to_dict(
            self._conn.execute(
                "SELECT * FROM deposit_intents WHERE intent_id = ?",
                (intent_id,),
            ).fetchone()
        )

    def confirm_deposit(
        self,
        intent_id: str,
        tx_hash: str,
        commitment_hash: str,
    ) -> Dict[str, Any]:
        row = self._conn.execute(
            "SELECT * FROM deposit_intents WHERE intent_id = ?",
            (intent_id,),
        ).fetchone()
        if row is None:
            raise ValueError(f"Intent {intent_id} not found")

        intent = self._row_to_dict(row)
        if intent["status"] != "PENDING":
            raise ValueError(
                f"Intent {intent_id} is {intent['status']}, not PENDING"
            )

        vault_id = intent["vault_id"]
        token = intent["token"]
        amount_wei = int(intent["amount_wei"])
        rail = intent["rail"]

        self._ledger.post_entry(
            idempotency_key=f"deposit:{intent_id}",
            tx_type="DEPOSIT",
            amount_wei=amount_wei,
            token=token,
            dr_account=f"OPERATOR_CUSTODY:{token}",
            cr_account=f"VAULT_AVAILABLE:{vault_id}:{token}",
        )

        vault = self._vaults.get_vault(vault_id)
        custody = (
            "OPERATOR_HELD"
            if vault and vault["mode"] == "OPERATOR_MANAGED"
            else "SELF_CUSTODY"
        )

        self._notes.create_note(
            vault_id=vault_id,
            rail_type=rail,
            commitment_hash=commitment_hash,
            pool_address="deposit",
            token=token,
            amount_wei=amount_wei,
            custody=custody,
        )

        now = time.time()
        self._conn.execute(
            """UPDATE deposit_intents
               SET status = 'SETTLED', tx_hash = ?, commitment_hash = ?,
                   settled_at = ?
               WHERE intent_id = ?""",
            (tx_hash, commitment_hash, now, intent_id),
        )
        self._conn.commit()

        return self._row_to_dict(
            self._conn.execute(
                "SELECT * FROM deposit_intents WHERE intent_id = ?",
                (intent_id,),
            ).fetchone()
        )

    def get_intent(self, intent_id: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute(
            "SELECT * FROM deposit_intents WHERE intent_id = ?",
            (intent_id,),
        ).fetchone()
        return self._row_to_dict(row) if row else None
