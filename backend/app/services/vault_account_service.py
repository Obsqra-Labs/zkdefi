"""
Vault Account Service

Manages vault accounts — each representing a user's isolated fund container.
Supports operator-managed and self-custody modes with per-vault risk profiles
and policy bounds.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from typing import Any, Dict, List, Optional


class VaultAccountService:
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
            CREATE TABLE IF NOT EXISTS vault_accounts (
                vault_id       TEXT PRIMARY KEY,
                owner_address  TEXT NOT NULL,
                mode           TEXT NOT NULL DEFAULT 'OPERATOR_MANAGED',
                risk_profile   TEXT NOT NULL DEFAULT '{}',
                policy_bounds  TEXT NOT NULL DEFAULT '{}',
                tier           INTEGER NOT NULL DEFAULT 0,
                created_at     REAL NOT NULL
            )
        """)
        self._conn.commit()

    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        d = {k: row[k] for k in row.keys()}
        d["risk_profile"] = json.loads(d["risk_profile"])
        d["policy_bounds"] = json.loads(d["policy_bounds"])
        return d

    def create_vault(
        self,
        owner_address: str,
        mode: str = "OPERATOR_MANAGED",
    ) -> Dict[str, Any]:
        vault_id = str(uuid.uuid4())
        now = time.time()

        with self._lock:
            self._conn.execute(
                """INSERT INTO vault_accounts
                   (vault_id, owner_address, mode, risk_profile, policy_bounds, tier, created_at)
                   VALUES (?, ?, ?, '{}', '{}', 0, ?)""",
                (vault_id, owner_address, mode, now),
            )
            self._conn.commit()

            row = self._conn.execute(
                "SELECT * FROM vault_accounts WHERE vault_id = ?",
                (vault_id,),
            ).fetchone()
            return self._row_to_dict(row)

    def get_vault(self, vault_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM vault_accounts WHERE vault_id = ?",
                (vault_id,),
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def get_vault_by_address(self, address: str) -> Dict[str, Any]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM vault_accounts WHERE owner_address = ?",
                (address,),
            ).fetchone()
            if row:
                return self._row_to_dict(row)
        return self.create_vault(address)

    def update_mode(self, vault_id: str, mode: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._conn.execute(
                "UPDATE vault_accounts SET mode = ? WHERE vault_id = ?",
                (mode, vault_id),
            )
            self._conn.commit()
            return self.get_vault(vault_id)
