"""
SweepService – bridges self-custody notes and the dark ledger.

sweep_to_ledger: user-held note → ledger credit (VAULT_AVAILABLE)
sweep_to_vault:  ledger debit   → new user-held note for on-chain deposit
"""

from __future__ import annotations

import uuid
from typing import Any, Dict

from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.note_store import NoteStore


class SweepService:
    def __init__(self, ledger: DoubleEntryLedger, notes: NoteStore) -> None:
        self._ledger = ledger
        self._notes = notes

    def sweep_to_ledger(
        self,
        vault_id: str,
        note_id: str,
        amount_wei: int,
        token: str,
        idempotency_key: str,
    ) -> Dict[str, Any]:
        note = self._notes.get_note(note_id)
        if note is None:
            raise ValueError(f"Note {note_id} not found")
        if note["status"] != "OPEN":
            raise ValueError(
                f"Note {note_id} is {note['status']}, expected OPEN"
            )

        self._ledger.post_entry(
            idempotency_key=idempotency_key,
            tx_type="SWEEP_IN",
            amount_wei=amount_wei,
            token=token,
            dr_account=f"OPERATOR_CUSTODY:{token}",
            cr_account=f"VAULT_AVAILABLE:{vault_id}:{token}",
            refs={"note_id": note_id},
        )

        self._notes.mark_swept(note_id)

        return {"status": "SWEPT", "note_id": note_id}

    def sweep_to_vault(
        self,
        vault_id: str,
        amount_wei: int,
        token: str,
        target_rail: str,
        idempotency_key: str,
    ) -> Dict[str, Any]:
        self._ledger.post_entry(
            idempotency_key=idempotency_key,
            tx_type="SWEEP_OUT",
            amount_wei=amount_wei,
            token=token,
            dr_account=f"VAULT_AVAILABLE:{vault_id}:{token}",
            cr_account=f"OPERATOR_CUSTODY:{token}",
            refs={"target_rail": target_rail},
        )

        note = self._notes.create_note(
            vault_id=vault_id,
            rail_type=target_rail,
            commitment_hash="0x" + uuid.uuid4().hex,
            pool_address="pending",
            token=token,
            amount_wei=amount_wei,
            custody="USER_HELD",
        )

        return {"status": "PENDING_DEPOSIT", "note_id": note["note_id"]}
