import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from app.services.sweep_service import SweepService
from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.note_store import NoteStore

def test_sweep_to_ledger():
    ledger = DoubleEntryLedger(":memory:")
    notes = NoteStore(":memory:")
    svc = SweepService(ledger=ledger, notes=notes)
    vid = "vault-sweep-1"

    # Create a user-held note (simulating a self-custody deposit)
    note = notes.create_note(
        vault_id=vid,
        rail_type="NULLIFIER_SET",
        commitment_hash="0xcommit_user",
        pool_address="0xpool",
        token="STRK",
        amount_wei=5_000_000_000_000_000_000,
        custody="USER_HELD",
    )

    result = svc.sweep_to_ledger(
        vault_id=vid,
        note_id=note["note_id"],
        amount_wei=5_000_000_000_000_000_000,
        token="STRK",
        idempotency_key="sweep-in-1",
    )
    assert result["status"] == "SWEPT"
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 5_000_000_000_000_000_000

    updated_note = notes.get_note(note["note_id"])
    assert updated_note["status"] == "SWEPT"

def test_sweep_to_vault():
    ledger = DoubleEntryLedger(":memory:")
    notes = NoteStore(":memory:")
    svc = SweepService(ledger=ledger, notes=notes)
    vid = "vault-sweep-out-1"

    # Pre-fund the dark ledger
    ledger.post_entry(
        idempotency_key="seed-sweep-out",
        tx_type="DEPOSIT",
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )

    result = svc.sweep_to_vault(
        vault_id=vid,
        amount_wei=3_000_000_000_000_000_000,
        token="STRK",
        target_rail="COMMITMENT_SHIELD",
        idempotency_key="sweep-out-1",
    )
    assert result["status"] == "PENDING_DEPOSIT"
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 7_000_000_000_000_000_000

    # A new USER_HELD note should be created
    vault_notes = notes.list_notes(vault_id=vid)
    assert len(vault_notes) == 1
    assert vault_notes[0]["custody"] == "USER_HELD"

def test_sweep_to_ledger_wrong_note():
    ledger = DoubleEntryLedger(":memory:")
    notes = NoteStore(":memory:")
    svc = SweepService(ledger=ledger, notes=notes)

    with pytest.raises(ValueError, match="not found"):
        svc.sweep_to_ledger(
            vault_id="v1",
            note_id="nonexistent",
            amount_wei=1_000_000_000_000_000_000,
            token="STRK",
            idempotency_key="sweep-bad",
        )

def test_sweep_insufficient_balance():
    ledger = DoubleEntryLedger(":memory:")
    notes = NoteStore(":memory:")
    svc = SweepService(ledger=ledger, notes=notes)
    vid = "vault-sweep-empty"

    with pytest.raises(ValueError):
        svc.sweep_to_vault(
            vault_id=vid,
            amount_wei=1_000_000_000_000_000_000,
            token="STRK",
            target_rail="NULLIFIER_SET",
            idempotency_key="sweep-empty",
        )
