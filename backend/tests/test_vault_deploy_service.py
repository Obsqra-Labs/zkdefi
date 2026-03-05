import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from app.services.vault_deploy_service import VaultDeployService
from app.services.double_entry_ledger import DoubleEntryLedger

def test_deploy_lifecycle_happy_path():
    ledger = DoubleEntryLedger(":memory:")
    svc = VaultDeployService(ledger=ledger)
    vid = "vault-deploy-1"

    # Pre-fund
    ledger.post_entry(
        idempotency_key="seed-1",
        tx_type="DEPOSIT",
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )

    # Create deploy intent
    proposal = svc.create_deploy_intent(
        vault_id=vid,
        adapters=["0xekubo_adapter"],
        amounts=[5_000_000_000_000_000_000],
        token="STRK",
        idempotency_key="deploy-1",
    )
    assert proposal["status"] == "CREATED"
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 5_000_000_000_000_000_000
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 5_000_000_000_000_000_000

    # Commit
    svc.mark_committed(proposal["proposal_hash"], tx_hash="0xcommit")
    assert svc.get_status(proposal["proposal_hash"])["status"] == "COMMITTED"

    # Execute + settle
    svc.settle_execution(proposal["proposal_hash"], tx_hash="0xexec")
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 0
    assert ledger.balance("STRATEGY_ESCROW:0xekubo_adapter:STRK") == 5_000_000_000_000_000_000

def test_deploy_failure_rollback():
    ledger = DoubleEntryLedger(":memory:")
    svc = VaultDeployService(ledger=ledger)
    vid = "vault-fail-1"

    ledger.post_entry(
        idempotency_key="seed-2",
        tx_type="DEPOSIT",
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )

    proposal = svc.create_deploy_intent(
        vault_id=vid,
        adapters=["0xadapter"],
        amounts=[5_000_000_000_000_000_000],
        token="STRK",
        idempotency_key="deploy-fail-1",
    )

    # Fail the proposal
    svc.mark_failed(proposal["proposal_hash"], reason="execution reverted")
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 10_000_000_000_000_000_000
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 0

def test_multi_adapter_deploy():
    ledger = DoubleEntryLedger(":memory:")
    svc = VaultDeployService(ledger=ledger)
    vid = "vault-multi-1"

    ledger.post_entry(
        idempotency_key="seed-multi",
        tx_type="DEPOSIT",
        amount_wei=20_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )

    proposal = svc.create_deploy_intent(
        vault_id=vid,
        adapters=["0xekubo", "0xvesu"],
        amounts=[8_000_000_000_000_000_000, 7_000_000_000_000_000_000],
        token="STRK",
        idempotency_key="deploy-multi-1",
    )
    total = 8_000_000_000_000_000_000 + 7_000_000_000_000_000_000
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 20_000_000_000_000_000_000 - total
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == total

    svc.settle_execution(proposal["proposal_hash"], tx_hash="0xexec_multi")
    assert ledger.balance("STRATEGY_ESCROW:0xekubo:STRK") == 8_000_000_000_000_000_000
    assert ledger.balance("STRATEGY_ESCROW:0xvesu:STRK") == 7_000_000_000_000_000_000
