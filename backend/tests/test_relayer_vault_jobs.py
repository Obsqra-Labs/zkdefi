import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.vault_deploy_service import VaultDeployService
from app.services.withdrawal_service import WithdrawalService
from app.services.relayer_vault_processor import RelayerVaultProcessor

def test_process_deploy_commits():
    ledger = DoubleEntryLedger(":memory:")
    deploy_svc = VaultDeployService(ledger=ledger)
    processor = RelayerVaultProcessor(deploy_svc=deploy_svc, withdrawal_svc=None)
    vid = "vault-relay-1"

    ledger.post_entry(
        idempotency_key="seed-relay",
        tx_type="DEPOSIT",
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )
    proposal = deploy_svc.create_deploy_intent(
        vault_id=vid,
        adapters=["0xekubo"],
        amounts=[5_000_000_000_000_000_000],
        token="STRK",
        idempotency_key="relay-deploy-1",
    )

    results = processor.process_pending_commits()
    assert len(results) == 1
    assert results[0]["status"] == "COMMITTED"

def test_process_withdrawals():
    ledger = DoubleEntryLedger(":memory:")
    wd_svc = WithdrawalService(ledger=ledger)
    processor = RelayerVaultProcessor(deploy_svc=None, withdrawal_svc=wd_svc)
    vid = "vault-relay-wd"

    ledger.post_entry(
        idempotency_key="seed-relay-wd",
        tx_type="DEPOSIT",
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )
    wd = wd_svc.request_withdrawal(
        vault_id=vid,
        amount_wei=3_000_000_000_000_000_000,
        token="STRK",
        destination="0xrecipient",
        route="DIRECT_TRANSFER",
        idempotency_key="relay-wd-1",
    )

    results = processor.process_pending_withdrawals()
    assert len(results) == 1
    assert results[0]["status"] == "SENT"
