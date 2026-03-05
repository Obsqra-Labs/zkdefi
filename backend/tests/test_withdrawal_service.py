import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from app.services.withdrawal_service import WithdrawalService
from app.services.double_entry_ledger import DoubleEntryLedger

def test_withdrawal_lifecycle():
    ledger = DoubleEntryLedger(":memory:")
    svc = WithdrawalService(ledger=ledger)
    vid = "vault-wd-1"

    # Pre-fund
    ledger.post_entry(
        idempotency_key="seed-wd",
        tx_type="DEPOSIT",
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )

    wd = svc.request_withdrawal(
        vault_id=vid,
        amount_wei=3_000_000_000_000_000_000,
        token="STRK",
        destination="0xrecipient",
        route="DIRECT_TRANSFER",
        idempotency_key="wd-1",
    )
    assert wd["status"] == "REQUESTED"
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 7_000_000_000_000_000_000
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 3_000_000_000_000_000_000

    svc.mark_sent(wd["withdrawal_id"], tx_hash="0xwd_tx")
    assert svc.get_withdrawal(wd["withdrawal_id"])["status"] == "SENT"
    
    svc.mark_confirmed(wd["withdrawal_id"])
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 0

def test_withdrawal_insufficient_balance():
    ledger = DoubleEntryLedger(":memory:")
    svc = WithdrawalService(ledger=ledger)

    with pytest.raises(ValueError):
        svc.request_withdrawal(
            vault_id="empty-vault",
            amount_wei=1_000_000_000_000_000_000,
            token="STRK",
            destination="0xrecipient",
            route="DIRECT_TRANSFER",
            idempotency_key="wd-fail",
        )

def test_withdrawal_idempotency():
    ledger = DoubleEntryLedger(":memory:")
    svc = WithdrawalService(ledger=ledger)
    vid = "vault-wd-idem"

    ledger.post_entry(
        idempotency_key="seed-idem",
        tx_type="DEPOSIT",
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )

    wd1 = svc.request_withdrawal(vault_id=vid, amount_wei=1_000_000_000_000_000_000, token="STRK", destination="0xr", route="DIRECT_TRANSFER", idempotency_key="wd-idem-1")
    wd2 = svc.request_withdrawal(vault_id=vid, amount_wei=1_000_000_000_000_000_000, token="STRK", destination="0xr", route="DIRECT_TRANSFER", idempotency_key="wd-idem-1")
    assert wd1["withdrawal_id"] == wd2["withdrawal_id"]

def test_list_pending_withdrawals():
    ledger = DoubleEntryLedger(":memory:")
    svc = WithdrawalService(ledger=ledger)
    vid = "vault-list-wd"

    ledger.post_entry(
        idempotency_key="seed-list",
        tx_type="DEPOSIT",
        amount_wei=20_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )

    svc.request_withdrawal(vault_id=vid, amount_wei=1_000_000_000_000_000_000, token="STRK", destination="0x1", route="DIRECT_TRANSFER", idempotency_key="wd-list-1")
    svc.request_withdrawal(vault_id=vid, amount_wei=2_000_000_000_000_000_000, token="STRK", destination="0x2", route="RELAYER", idempotency_key="wd-list-2")

    pending = svc.list_pending()
    assert len(pending) == 2
