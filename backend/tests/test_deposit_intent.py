import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from app.services.deposit_intent_service import DepositIntentService
from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.vault_account_service import VaultAccountService
from app.services.note_store import NoteStore

def test_create_and_confirm_intent():
    ledger = DoubleEntryLedger(":memory:")
    vaults = VaultAccountService(":memory:")
    notes = NoteStore(":memory:")
    svc = DepositIntentService(ledger=ledger, vaults=vaults, notes=notes)

    vault = vaults.create_vault("0xuser1", mode="OPERATOR_MANAGED")
    intent = svc.create_intent(
        vault_id=vault["vault_id"],
        amount_wei=5_000_000_000_000_000_000,
        token="STRK",
        rail="NULLIFIER_SET",
        idempotency_key="dep-intent-1",
    )
    assert intent["status"] == "PENDING"
    assert intent["intent_id"] is not None

    result = svc.confirm_deposit(
        intent_id=intent["intent_id"],
        tx_hash="0xtx_confirmed",
        commitment_hash="0xcommit_confirmed",
    )
    assert result["status"] == "SETTLED"
    assert ledger.balance(f"VAULT_AVAILABLE:{vault['vault_id']}:STRK") == 5_000_000_000_000_000_000

def test_confirm_creates_note():
    ledger = DoubleEntryLedger(":memory:")
    vaults = VaultAccountService(":memory:")
    notes = NoteStore(":memory:")
    svc = DepositIntentService(ledger=ledger, vaults=vaults, notes=notes)

    vault = vaults.create_vault("0xuser2", mode="OPERATOR_MANAGED")
    intent = svc.create_intent(
        vault_id=vault["vault_id"],
        amount_wei=3_000_000_000_000_000_000,
        token="STRK",
        rail="COMMITMENT_SHIELD",
        idempotency_key="dep-intent-note",
    )
    svc.confirm_deposit(
        intent_id=intent["intent_id"],
        tx_hash="0xtx2",
        commitment_hash="0xcommit2",
    )
    vault_notes = notes.list_notes(vault_id=vault["vault_id"])
    assert len(vault_notes) == 1
    assert vault_notes[0]["custody"] == "OPERATOR_HELD"

def test_intent_idempotency():
    ledger = DoubleEntryLedger(":memory:")
    vaults = VaultAccountService(":memory:")
    notes = NoteStore(":memory:")
    svc = DepositIntentService(ledger=ledger, vaults=vaults, notes=notes)

    vault = vaults.create_vault("0xuser3", mode="OPERATOR_MANAGED")
    intent1 = svc.create_intent(
        vault_id=vault["vault_id"],
        amount_wei=1_000_000_000_000_000_000,
        token="STRK",
        rail="DARK_LEDGER",
        idempotency_key="dep-idem-1",
    )
    intent2 = svc.create_intent(
        vault_id=vault["vault_id"],
        amount_wei=1_000_000_000_000_000_000,
        token="STRK",
        rail="DARK_LEDGER",
        idempotency_key="dep-idem-1",
    )
    assert intent1["intent_id"] == intent2["intent_id"]

def test_double_confirm_fails():
    ledger = DoubleEntryLedger(":memory:")
    vaults = VaultAccountService(":memory:")
    notes = NoteStore(":memory:")
    svc = DepositIntentService(ledger=ledger, vaults=vaults, notes=notes)

    vault = vaults.create_vault("0xuser4", mode="OPERATOR_MANAGED")
    intent = svc.create_intent(
        vault_id=vault["vault_id"],
        amount_wei=1_000_000_000_000_000_000,
        token="STRK",
        rail="DARK_LEDGER",
        idempotency_key="dep-double",
    )
    svc.confirm_deposit(intent_id=intent["intent_id"], tx_hash="0xtx", commitment_hash="0xc")
    with pytest.raises(ValueError, match="not PENDING"):
        svc.confirm_deposit(intent_id=intent["intent_id"], tx_hash="0xtx2", commitment_hash="0xc2")
