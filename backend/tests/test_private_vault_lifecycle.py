import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.vault_account_service import VaultAccountService
from app.services.note_store import NoteStore
from app.services.deposit_intent_service import DepositIntentService
from app.services.vault_deploy_service import VaultDeployService
from app.services.withdrawal_service import WithdrawalService
from app.services.sweep_service import SweepService
from app.services.ledger_receipt_service import LedgerReceiptService


def test_full_lifecycle():
    """End-to-end test: deposit → deploy → yield → withdraw → receipts → inclusion proof."""

    # 1. Create all services with in-memory DBs
    ledger = DoubleEntryLedger(":memory:")
    vaults = VaultAccountService(":memory:")
    notes = NoteStore(":memory:")
    deposit_svc = DepositIntentService(ledger=ledger, vaults=vaults, notes=notes)
    deploy_svc = VaultDeployService(ledger=ledger)
    withdrawal_svc = WithdrawalService(ledger=ledger)
    sweep_svc = SweepService(ledger=ledger, notes=notes)
    receipt_svc = LedgerReceiptService()

    # 2. Create VaultAccount
    vault = vaults.create_vault("0xuser_lifecycle", mode="OPERATOR_MANAGED")
    vid = vault["vault_id"]
    assert vid is not None

    # 3. Create deposit intent (PENDING)
    intent = deposit_svc.create_intent(
        vault_id=vid,
        amount_wei=20_000_000_000_000_000_000,
        token="STRK",
        rail="NULLIFIER_SET",
        idempotency_key="lifecycle-dep-1",
    )
    assert intent["status"] == "PENDING"

    # 4. Confirm deposit (SETTLED) — verify ledger DR/CR
    result = deposit_svc.confirm_deposit(
        intent_id=intent["intent_id"],
        tx_hash="0xtx_lifecycle_dep",
        commitment_hash="0xcommit_lifecycle",
    )
    assert result["status"] == "SETTLED"
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 20_000_000_000_000_000_000

    # 5. Create deploy intent — verify AVAILABLE→PENDING
    proposal = deploy_svc.create_deploy_intent(
        vault_id=vid,
        adapters=["0xekubo_adapter"],
        amounts=[12_000_000_000_000_000_000],
        token="STRK",
        idempotency_key="lifecycle-deploy-1",
    )
    assert proposal["status"] == "CREATED"
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 8_000_000_000_000_000_000
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 12_000_000_000_000_000_000

    # 6. Mark committed — verify proposal status
    deploy_svc.mark_committed(proposal["proposal_hash"], tx_hash="0xcommit_tx")
    status = deploy_svc.get_status(proposal["proposal_hash"])
    assert status["status"] == "COMMITTED"

    # 7. Settle execution — verify PENDING→STRATEGY_ESCROW
    deploy_svc.settle_execution(proposal["proposal_hash"], tx_hash="0xexec_tx")
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 0
    assert ledger.balance("STRATEGY_ESCROW:0xekubo_adapter:STRK") == 12_000_000_000_000_000_000

    # 8. Simulate yield harvest — credit to VAULT_AVAILABLE
    ledger.post_entry(
        idempotency_key="yield-harvest-1",
        tx_type="YIELD",
        amount_wei=500_000_000_000_000_000,
        token="STRK",
        dr_account="STRATEGY_ESCROW:0xekubo_adapter:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={"source": "ekubo_yield"},
    )
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 8_500_000_000_000_000_000

    # 9. Request withdrawal — verify AVAILABLE→PENDING
    wd = withdrawal_svc.request_withdrawal(
        vault_id=vid,
        amount_wei=2_000_000_000_000_000_000,
        token="STRK",
        destination="0xrecipient",
        route="DIRECT_TRANSFER",
        idempotency_key="lifecycle-wd-1",
    )
    assert wd["status"] == "REQUESTED"
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 6_500_000_000_000_000_000

    # 10. Confirm withdrawal — verify PENDING→CLEARING
    withdrawal_svc.mark_sent(wd["withdrawal_id"], tx_hash="0xwd_tx")
    withdrawal_svc.mark_confirmed(wd["withdrawal_id"])
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 0

    # 11. Verify all receipts have valid hashes
    entries = ledger.entries(f"VAULT_AVAILABLE:{vid}:STRK")
    for entry in entries:
        assert entry["receipt_hash"].startswith("0x")
        assert len(entry["receipt_hash"]) > 10

    # 12. Verify vault summary
    summary = ledger.vault_summary(vid, "STRK")
    assert summary["available"] == 6_500_000_000_000_000_000

    # 13. Compute commitment root and verify inclusion proof
    balances = [
        {"vault_id": vid, "token": "STRK", "balance": summary["available"]},
        {"vault_id": "other-vault", "token": "STRK", "balance": 1_000_000_000_000_000_000},
    ]
    root = receipt_svc.compute_commitment_root(balances)
    assert root["root"].startswith("0x")
    assert root["leaf_count"] == 2

    proof = receipt_svc.inclusion_proof(vid, "STRK", balances)
    assert proof["verified"] is True
    assert len(proof["path"]) > 0


def test_sweep_round_trip():
    """Test: deposit via self-custody → sweep to ledger → deploy → sweep back to vault."""

    ledger = DoubleEntryLedger(":memory:")
    vaults = VaultAccountService(":memory:")
    notes_store = NoteStore(":memory:")
    sweep_svc = SweepService(ledger=ledger, notes=notes_store)

    vault = vaults.create_vault("0xuser_sweep_round", mode="OPERATOR_MANAGED")
    vid = vault["vault_id"]

    # User deposits into self-custody (creates a USER_HELD note)
    user_note = notes_store.create_note(
        vault_id=vid,
        rail_type="COMMITMENT_SHIELD",
        commitment_hash="0xuser_commitment",
        pool_address="0xshielded_pool",
        token="STRK",
        amount_wei=10_000_000_000_000_000_000,
        custody="USER_HELD",
    )
    assert user_note["status"] == "OPEN"

    # Sweep to ledger (user-held → operator-managed)
    sweep_result = sweep_svc.sweep_to_ledger(
        vault_id=vid,
        note_id=user_note["note_id"],
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        idempotency_key="sweep-round-in",
    )
    assert sweep_result["status"] == "SWEPT"
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 10_000_000_000_000_000_000

    # Sweep back to vault (operator-managed → user-held)
    sweep_back = sweep_svc.sweep_to_vault(
        vault_id=vid,
        amount_wei=4_000_000_000_000_000_000,
        token="STRK",
        target_rail="NULLIFIER_SET",
        idempotency_key="sweep-round-out",
    )
    assert sweep_back["status"] == "PENDING_DEPOSIT"
    assert ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK") == 6_000_000_000_000_000_000

    # Verify notes
    all_notes = notes_store.list_notes(vault_id=vid)
    assert len(all_notes) == 2  # original (SWEPT) + new (OPEN, USER_HELD)
    open_notes = notes_store.list_notes(vault_id=vid, status="OPEN")
    assert len(open_notes) == 1
    assert open_notes[0]["custody"] == "USER_HELD"


def test_double_entry_invariant():
    """Verify the accounting invariant: sum of all account balances = 0."""

    ledger = DoubleEntryLedger(":memory:")
    vaults = VaultAccountService(":memory:")
    notes_store = NoteStore(":memory:")
    deposit_svc = DepositIntentService(ledger=ledger, vaults=vaults, notes=notes_store)
    deploy_svc = VaultDeployService(ledger=ledger)
    withdrawal_svc = WithdrawalService(ledger=ledger)

    vault = vaults.create_vault("0xuser_invariant", mode="OPERATOR_MANAGED")
    vid = vault["vault_id"]

    # Deposit
    intent = deposit_svc.create_intent(vid, 15_000_000_000_000_000_000, "STRK", "DARK_LEDGER", "inv-dep")
    deposit_svc.confirm_deposit(intent["intent_id"], "0xtx", "0xcommit")

    # Deploy
    proposal = deploy_svc.create_deploy_intent(vid, ["0xadapter"], [6_000_000_000_000_000_000], "STRK", "inv-deploy")
    deploy_svc.settle_execution(proposal["proposal_hash"], "0xexec")

    # Withdraw
    wd = withdrawal_svc.request_withdrawal(vid, 3_000_000_000_000_000_000, "STRK", "0xrecip", "DIRECT_TRANSFER", "inv-wd")
    withdrawal_svc.mark_sent(wd["withdrawal_id"], "0xwd_tx")
    withdrawal_svc.mark_confirmed(wd["withdrawal_id"])

    # Verify invariant: sum of all debits should equal sum of all credits
    available = ledger.balance(f"VAULT_AVAILABLE:{vid}:STRK")
    pending = ledger.balance(f"VAULT_PENDING:{vid}:STRK")
    escrow = ledger.balance("STRATEGY_ESCROW:0xadapter:STRK")
    custody = ledger.balance("OPERATOR_CUSTODY:STRK")
    clearing = ledger.balance(f"WITHDRAWAL_CLEARING:{vid}:STRK")

    # available(6) + pending(0) + escrow(6) + clearing(3) = 15 (total deposited)
    # custody is the contra account = -15
    total_assets = available + pending + escrow + clearing
    assert total_assets == 15_000_000_000_000_000_000
    assert custody == -15_000_000_000_000_000_000
    assert total_assets + custody == 0  # Double-entry invariant
