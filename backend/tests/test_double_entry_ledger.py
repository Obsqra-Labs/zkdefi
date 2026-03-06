import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from app.services.double_entry_ledger import DoubleEntryLedger

def test_post_entry_and_balance():
    ledger = DoubleEntryLedger(":memory:")
    vault_id = "vault-test-001"
    ledger.post_entry(
        idempotency_key="dep-001",
        tx_type="DEPOSIT",
        amount_wei=5_000_000_000_000_000_000,
        token="STRK",
        dr_account=f"OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vault_id}:STRK",
        refs={"tx_hash": "0xabc"},
    )
    assert ledger.balance(f"VAULT_AVAILABLE:{vault_id}:STRK") == 5_000_000_000_000_000_000
    assert ledger.balance(f"OPERATOR_CUSTODY:STRK") == -5_000_000_000_000_000_000

def test_idempotency():
    ledger = DoubleEntryLedger(":memory:")
    for _ in range(3):
        ledger.post_entry(
            idempotency_key="same-key",
            tx_type="DEPOSIT",
            amount_wei=1_000_000_000_000_000_000,
            token="STRK",
            dr_account="OPERATOR_CUSTODY:STRK",
            cr_account="VAULT_AVAILABLE:v1:STRK",
            refs={},
        )
    assert ledger.balance("VAULT_AVAILABLE:v1:STRK") == 1_000_000_000_000_000_000

def test_pending_to_settled():
    ledger = DoubleEntryLedger(":memory:")
    vid = "vault-pending-test"
    ledger.post_entry(
        idempotency_key="credit-1",
        tx_type="DEPOSIT",
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )
    ledger.post_entry(
        idempotency_key="deploy-1",
        tx_type="DEPLOY",
        amount_wei=5_000_000_000_000_000_000,
        token="STRK",
        dr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        cr_account=f"VAULT_PENDING:{vid}:STRK",
        refs={"proposal_hash": "0xprop1"},
    )
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 5_000_000_000_000_000_000
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 5_000_000_000_000_000_000

    ledger.post_entry(
        idempotency_key="settle-1",
        tx_type="DEPLOY",
        amount_wei=5_000_000_000_000_000_000,
        token="STRK",
        dr_account=f"VAULT_PENDING:{vid}:STRK",
        cr_account="STRATEGY_ESCROW:ekubo:STRK",
        refs={"proposal_hash": "0xprop1", "tx_hash": "0xexec_tx"},
    )
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 0
    assert ledger.balance("STRATEGY_ESCROW:ekubo:STRK") == 5_000_000_000_000_000_000

def test_receipt_generation():
    ledger = DoubleEntryLedger(":memory:")
    entry = ledger.post_entry(
        idempotency_key="receipt-test",
        tx_type="DEPOSIT",
        amount_wei=1_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account="VAULT_AVAILABLE:v1:STRK",
        refs={"tx_hash": "0xdef"},
    )
    assert "receipt_hash" in entry
    assert entry["receipt_hash"].startswith("0x")

def test_vault_available_never_negative():
    ledger = DoubleEntryLedger(":memory:")
    with pytest.raises(ValueError, match="Insufficient"):
        ledger.post_entry(
            idempotency_key="overdraw-1",
            tx_type="WITHDRAW",
            amount_wei=1_000_000_000_000_000_000,
            token="STRK",
            dr_account="VAULT_AVAILABLE:v1:STRK",
            cr_account="VAULT_PENDING:v1:STRK",
            refs={},
        )
