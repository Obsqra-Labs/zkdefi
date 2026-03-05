"""
VaultDeployService — Commit-Reveal Lifecycle

Manages the lifecycle of vault deploy proposals through states:
  CREATED → COMMITTED → EXECUTED
                ↘ FAILED (with rollback)
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import uuid
from typing import Any, Dict, List, Optional

from app.services.double_entry_ledger import DoubleEntryLedger


class VaultDeployService:
    def __init__(self, ledger: DoubleEntryLedger, db_path: str = ":memory:") -> None:
        self._ledger = ledger
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self) -> None:
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS deploy_proposals (
                proposal_hash   TEXT PRIMARY KEY,
                vault_id        TEXT NOT NULL,
                adapters        TEXT NOT NULL,
                amounts         TEXT NOT NULL,
                token           TEXT NOT NULL,
                salt            TEXT NOT NULL,
                idempotency_key TEXT UNIQUE NOT NULL,
                status          TEXT NOT NULL DEFAULT 'CREATED',
                commit_tx_hash  TEXT,
                execute_tx_hash TEXT,
                fail_reason     TEXT,
                created_at      REAL NOT NULL,
                updated_at      REAL NOT NULL
            )
        """)
        self._conn.commit()

    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {k: row[k] for k in row.keys()}

    def create_deploy_intent(
        self,
        vault_id: str,
        adapters: List[str],
        amounts: List[int],
        token: str,
        idempotency_key: str,
    ) -> Dict[str, Any]:
        if len(adapters) != len(amounts):
            raise ValueError("adapters and amounts must have the same length")

        salt = uuid.uuid4().hex

        hash_payload = json.dumps(
            {
                "vault_id": vault_id,
                "adapters": adapters,
                "amounts": [str(a) for a in amounts],
                "token": token,
                "salt": salt,
            },
            sort_keys=True,
        )
        proposal_hash = hashlib.sha256(hash_payload.encode()).hexdigest()

        for i, (adapter, amount) in enumerate(zip(adapters, amounts)):
            self._ledger.post_entry(
                idempotency_key=f"deploy:{proposal_hash}:lock:{i}",
                tx_type="DEPLOY_LOCK",
                amount_wei=amount,
                token=token,
                dr_account=f"VAULT_AVAILABLE:{vault_id}:{token}",
                cr_account=f"VAULT_PENDING:{vault_id}:{token}",
                refs={"proposal_hash": proposal_hash, "adapter": adapter},
            )

        now = time.time()
        self._conn.execute(
            """INSERT INTO deploy_proposals
               (proposal_hash, vault_id, adapters, amounts, token, salt,
                idempotency_key, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?)""",
            (
                proposal_hash,
                vault_id,
                json.dumps(adapters),
                json.dumps([str(a) for a in amounts]),
                token,
                salt,
                idempotency_key,
                now,
                now,
            ),
        )
        self._conn.commit()

        return {"proposal_hash": proposal_hash, "salt": salt, "status": "CREATED"}

    def mark_committed(self, proposal_hash: str, tx_hash: str) -> None:
        now = time.time()
        self._conn.execute(
            """UPDATE deploy_proposals
               SET status = 'COMMITTED', commit_tx_hash = ?, updated_at = ?
               WHERE proposal_hash = ?""",
            (tx_hash, now, proposal_hash),
        )
        self._conn.commit()

    def settle_execution(self, proposal_hash: str, tx_hash: str) -> None:
        row = self._conn.execute(
            "SELECT * FROM deploy_proposals WHERE proposal_hash = ?",
            (proposal_hash,),
        ).fetchone()
        if not row:
            raise ValueError(f"Proposal {proposal_hash} not found")

        proposal = self._row_to_dict(row)
        vault_id = proposal["vault_id"]
        token = proposal["token"]
        adapters = json.loads(proposal["adapters"])
        amounts = [int(a) for a in json.loads(proposal["amounts"])]

        for i, (adapter, amount) in enumerate(zip(adapters, amounts)):
            self._ledger.post_entry(
                idempotency_key=f"deploy:{proposal_hash}:settle:{i}",
                tx_type="DEPLOY_SETTLE",
                amount_wei=amount,
                token=token,
                dr_account=f"VAULT_PENDING:{vault_id}:{token}",
                cr_account=f"STRATEGY_ESCROW:{adapter}:{token}",
                refs={"proposal_hash": proposal_hash, "adapter": adapter, "tx_hash": tx_hash},
            )

        now = time.time()
        self._conn.execute(
            """UPDATE deploy_proposals
               SET status = 'EXECUTED', execute_tx_hash = ?, updated_at = ?
               WHERE proposal_hash = ?""",
            (tx_hash, now, proposal_hash),
        )
        self._conn.commit()

    def mark_failed(self, proposal_hash: str, reason: str) -> None:
        row = self._conn.execute(
            "SELECT * FROM deploy_proposals WHERE proposal_hash = ?",
            (proposal_hash,),
        ).fetchone()
        if not row:
            raise ValueError(f"Proposal {proposal_hash} not found")

        proposal = self._row_to_dict(row)
        vault_id = proposal["vault_id"]
        token = proposal["token"]
        adapters = json.loads(proposal["adapters"])
        amounts = [int(a) for a in json.loads(proposal["amounts"])]

        for i, (adapter, amount) in enumerate(zip(adapters, amounts)):
            self._ledger.post_entry(
                idempotency_key=f"deploy:{proposal_hash}:rollback:{i}",
                tx_type="DEPLOY_ROLLBACK",
                amount_wei=amount,
                token=token,
                dr_account=f"VAULT_PENDING:{vault_id}:{token}",
                cr_account=f"VAULT_AVAILABLE:{vault_id}:{token}",
                refs={"proposal_hash": proposal_hash, "adapter": adapter, "reason": reason},
            )

        now = time.time()
        self._conn.execute(
            """UPDATE deploy_proposals
               SET status = 'FAILED', fail_reason = ?, updated_at = ?
               WHERE proposal_hash = ?""",
            (reason, now, proposal_hash),
        )
        self._conn.commit()

    def get_status(self, proposal_hash: str) -> Dict[str, Any]:
        row = self._conn.execute(
            "SELECT * FROM deploy_proposals WHERE proposal_hash = ?",
            (proposal_hash,),
        ).fetchone()
        if not row:
            raise ValueError(f"Proposal {proposal_hash} not found")
        return self._row_to_dict(row)
