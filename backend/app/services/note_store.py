import sqlite3
import time
import uuid
from typing import Optional


class NoteStore:
    def __init__(self, db_path: str = "data/notes.db"):
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                note_id        TEXT PRIMARY KEY,
                vault_id       TEXT NOT NULL,
                rail_type      TEXT NOT NULL,
                commitment_hash TEXT NOT NULL,
                nullifier_hash TEXT,
                pool_address   TEXT NOT NULL,
                token          TEXT NOT NULL,
                amount_wei     TEXT NOT NULL,
                custody        TEXT NOT NULL,
                status         TEXT NOT NULL DEFAULT 'OPEN',
                created_at     REAL NOT NULL,
                spent_at       REAL
            )
        """)
        self._conn.commit()

    def create_note(
        self,
        vault_id: str,
        rail_type: str,
        commitment_hash: str,
        pool_address: str,
        token: str,
        amount_wei: int,
        custody: str,
    ) -> dict:
        note_id = uuid.uuid4().hex
        now = time.time()
        self._conn.execute(
            """INSERT INTO notes
               (note_id, vault_id, rail_type, commitment_hash, pool_address,
                token, amount_wei, custody, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)""",
            (note_id, vault_id, rail_type, commitment_hash, pool_address,
             token, str(amount_wei), custody, now),
        )
        self._conn.commit()
        return self.get_note(note_id)

    @staticmethod
    def _row_to_dict(row) -> dict:
        d = dict(row)
        d["amount_wei"] = int(d["amount_wei"])
        return d

    def get_note(self, note_id: str) -> Optional[dict]:
        row = self._conn.execute(
            "SELECT * FROM notes WHERE note_id = ?", (note_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def find_by_commitment(
        self,
        vault_id: str,
        commitment_hash: str,
        status: Optional[str] = None,
    ) -> Optional[dict]:
        if status:
            row = self._conn.execute(
                """
                SELECT * FROM notes
                WHERE vault_id = ? AND commitment_hash = ? AND status = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (vault_id, commitment_hash, status),
            ).fetchone()
        else:
            row = self._conn.execute(
                """
                SELECT * FROM notes
                WHERE vault_id = ? AND commitment_hash = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (vault_id, commitment_hash),
            ).fetchone()
        return self._row_to_dict(row) if row else None

    def find_latest_open(self, vault_id: str, token: Optional[str] = None) -> Optional[dict]:
        if token:
            row = self._conn.execute(
                """
                SELECT * FROM notes
                WHERE vault_id = ? AND token = ? AND status = 'OPEN'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (vault_id, token),
            ).fetchone()
        else:
            row = self._conn.execute(
                """
                SELECT * FROM notes
                WHERE vault_id = ? AND status = 'OPEN'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (vault_id,),
            ).fetchone()
        return self._row_to_dict(row) if row else None

    def list_notes(self, vault_id: str, status: Optional[str] = None) -> list[dict]:
        if status:
            rows = self._conn.execute(
                "SELECT * FROM notes WHERE vault_id = ? AND status = ? ORDER BY created_at DESC",
                (vault_id, status),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM notes WHERE vault_id = ? ORDER BY created_at DESC",
                (vault_id,),
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def _set_status(self, note_id: str, status: str):
        self._conn.execute(
            "UPDATE notes SET status = ?, spent_at = ? WHERE note_id = ?",
            (status, time.time(), note_id),
        )
        self._conn.commit()

    def mark_spent(self, note_id: str):
        self._set_status(note_id, "SPENT")

    def mark_swept(self, note_id: str):
        self._set_status(note_id, "SWEPT")

    def mark_withdrawn(self, note_id: str):
        self._set_status(note_id, "WITHDRAWN")
