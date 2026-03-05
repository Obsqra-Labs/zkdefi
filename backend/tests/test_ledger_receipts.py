import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from app.services.ledger_receipt_service import LedgerReceiptService

def test_receipt_is_signed():
    svc = LedgerReceiptService()
    receipt = svc.create_receipt(
        entry_id="e1",
        vault_id="v1",
        tx_type="DEPOSIT",
        amount_wei=5_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account="VAULT_AVAILABLE:v1:STRK",
        refs={"tx_hash": "0xabc"},
    )
    assert receipt["receipt_hash"].startswith("0x")
    assert receipt["signature"] is not None
    assert len(receipt["signature"]) > 0
    assert svc.verify_receipt(receipt) is True

def test_tampered_receipt_fails_verification():
    svc = LedgerReceiptService()
    receipt = svc.create_receipt(
        entry_id="e2",
        vault_id="v2",
        tx_type="DEPOSIT",
        amount_wei=1_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account="VAULT_AVAILABLE:v2:STRK",
        refs={},
    )
    receipt["amount_wei"] = 999_999
    assert svc.verify_receipt(receipt) is False

def test_commitment_root():
    svc = LedgerReceiptService()
    balances = [
        {"vault_id": "v1", "token": "STRK", "balance": 5_000_000_000_000_000_000},
        {"vault_id": "v2", "token": "STRK", "balance": 3_000_000_000_000_000_000},
    ]
    root = svc.compute_commitment_root(balances)
    assert root["root"].startswith("0x")
    assert root["leaf_count"] == 2

def test_inclusion_proof():
    svc = LedgerReceiptService()
    balances = [
        {"vault_id": "v1", "token": "STRK", "balance": 5_000_000_000_000_000_000},
        {"vault_id": "v2", "token": "STRK", "balance": 3_000_000_000_000_000_000},
        {"vault_id": "v3", "token": "ETH", "balance": 1_000_000_000_000_000_000},
        {"vault_id": "v4", "token": "STRK", "balance": 7_000_000_000_000_000_000},
    ]
    proof = svc.inclusion_proof("v1", "STRK", balances)
    assert proof["verified"] is True
    assert len(proof["path"]) > 0

def test_different_keys_produce_different_signatures():
    svc1 = LedgerReceiptService()
    svc2 = LedgerReceiptService()
    r1 = svc1.create_receipt(entry_id="e1", vault_id="v1", tx_type="DEPOSIT", amount_wei=100, token="STRK", dr_account="A", cr_account="B", refs={})
    r2 = svc2.create_receipt(entry_id="e1", vault_id="v1", tx_type="DEPOSIT", amount_wei=100, token="STRK", dr_account="A", cr_account="B", refs={})
    assert r1["signature"] != r2["signature"]
    assert svc1.verify_receipt(r1) is True
    assert svc2.verify_receipt(r2) is True
