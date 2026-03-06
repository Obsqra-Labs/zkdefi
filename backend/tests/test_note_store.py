import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from app.services.note_store import NoteStore

def test_create_and_query_note():
    store = NoteStore(":memory:")
    note = store.create_note(
        vault_id="v1",
        rail_type="NULLIFIER_SET",
        commitment_hash="0xcommit1",
        pool_address="0xpool1",
        token="STRK",
        amount_wei=5_000_000_000_000_000_000,
        custody="OPERATOR_HELD",
    )
    assert note["status"] == "OPEN"
    assert note["note_id"] is not None

    notes = store.list_notes(vault_id="v1")
    assert len(notes) == 1

def test_note_lifecycle():
    store = NoteStore(":memory:")
    note = store.create_note(
        vault_id="v1",
        rail_type="COMMITMENT_SHIELD",
        commitment_hash="0xc2",
        pool_address="0xpool2",
        token="STRK",
        amount_wei=1_000_000_000_000_000_000,
        custody="USER_HELD",
    )
    store.mark_swept(note["note_id"])
    updated = store.get_note(note["note_id"])
    assert updated["status"] == "SWEPT"

def test_note_status_transitions():
    store = NoteStore(":memory:")
    note = store.create_note(
        vault_id="v2",
        rail_type="DARK_LEDGER",
        commitment_hash="0xc3",
        pool_address="0xpool3",
        token="ETH",
        amount_wei=2_000_000_000_000_000_000,
        custody="OPERATOR_HELD",
    )
    store.mark_spent(note["note_id"])
    updated = store.get_note(note["note_id"])
    assert updated["status"] == "SPENT"

def test_list_notes_with_status_filter():
    store = NoteStore(":memory:")
    store.create_note(vault_id="v3", rail_type="A", commitment_hash="0x1", pool_address="0xp", token="STRK", amount_wei=1, custody="OPERATOR_HELD")
    n2 = store.create_note(vault_id="v3", rail_type="B", commitment_hash="0x2", pool_address="0xp", token="STRK", amount_wei=2, custody="OPERATOR_HELD")
    store.mark_spent(n2["note_id"])

    open_notes = store.list_notes(vault_id="v3", status="OPEN")
    assert len(open_notes) == 1
    all_notes = store.list_notes(vault_id="v3")
    assert len(all_notes) == 2
