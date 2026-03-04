# Private Vault & Dark Ledger — Implementation Plan v2

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the VaultAccount + double-entry Dark Ledger system with deposit intents, VaultController commit-reveal deployment, relayer-mediated withdrawals, self-custody sweep, signed receipts, and ledger commitment roots.

**Architecture:** VaultAccount is the core entity. The double-entry LedgerService tracks every mutation with debit/credit accounts and signed receipts. Deposits go through privacy tier contracts via DepositIntentService. Capital deployment uses VaultController commit-reveal. Provability comes from signed receipts and daily ledger commitment roots published on-chain.

**Tech Stack:** Python (FastAPI), SQLite (double-entry ledger), TypeScript/React (frontend), Cairo (on-chain — already deployed), starknet.py (relayer)

**Design doc:** `docs/plans/2026-03-04-private-vault-dark-ledger-design.md`

---

### Task 1: VaultAccount Model + Double-Entry LedgerService

Create the VaultAccount entity and rewrite the LedgerService as a proper double-entry ledger with account types, idempotent entries, and pending/settled states.

**Files:**
- Create: `backend/app/services/vault_account_service.py`
- Create: `backend/app/services/double_entry_ledger.py`
- Modify: `backend/data/` (new SQLite schema)
- Test: `backend/tests/test_double_entry_ledger.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_double_entry_ledger.py
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
    # Credit available
    ledger.post_entry(
        idempotency_key="credit-1",
        tx_type="DEPOSIT",
        amount_wei=10_000_000_000_000_000_000,
        token="STRK",
        dr_account="OPERATOR_CUSTODY:STRK",
        cr_account=f"VAULT_AVAILABLE:{vid}:STRK",
        refs={},
    )
    # Move to pending (deploy intent)
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

    # Settle (execute confirmed)
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
```

**Step 2: Run test — expect FAIL (module not found)**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_double_entry_ledger.py -v`

**Step 3: Implement DoubleEntryLedger**

Create `backend/app/services/double_entry_ledger.py`:

- SQLite table `ledger_entries`: entry_id, idempotency_key (UNIQUE), tx_type, amount_wei, token, dr_account, cr_account, refs (JSON), receipt_hash, created_at, settled_at
- `post_entry(idempotency_key, tx_type, amount_wei, token, dr_account, cr_account, refs)`:
  - Check idempotency_key uniqueness (return existing if duplicate)
  - If dr_account starts with `VAULT_AVAILABLE` or `VAULT_PENDING`, check balance >= amount
  - Insert entry
  - Compute receipt_hash = sha256(entry_id + dr + cr + amount + token + refs)
  - Return entry dict with receipt_hash
- `balance(account)`: sum credits - sum debits for that account
- `entries(account, limit, offset)`: list entries involving that account
- `vault_summary(vault_id, token)`: returns { available, pending, deployed }

**Step 4: Run test — expect PASS**

**Step 5: Implement VaultAccountService**

Create `backend/app/services/vault_account_service.py`:

- SQLite table `vault_accounts`: vault_id, owner_address, mode, risk_profile (JSON), policy_bounds (JSON), tier, created_at
- `create_vault(owner_address, mode="OPERATOR_MANAGED")` → returns vault_id
- `get_vault(vault_id)` → VaultAccount dict
- `get_vault_by_address(address)` → VaultAccount dict (auto-create if not exists)
- `update_mode(vault_id, mode)`

**Step 6: Commit**

```bash
git add backend/app/services/double_entry_ledger.py backend/app/services/vault_account_service.py backend/tests/test_double_entry_ledger.py
git commit -m "feat: add VaultAccount model and double-entry ledger"
```

---

### Task 2: Notes Tracking

Track all commitments (operator-held and user-held) as Notes with proper lifecycle status.

**Files:**
- Create: `backend/app/services/note_store.py`
- Test: `backend/tests/test_note_store.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_note_store.py
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
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement NoteStore**

SQLite table `notes`: note_id (UUID), vault_id, rail_type, commitment_hash, nullifier_hash, pool_address, token, amount_wei, custody, status, created_at, spent_at

Methods: create_note, get_note, list_notes(vault_id, status), mark_spent, mark_swept, mark_withdrawn

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add backend/app/services/note_store.py backend/tests/test_note_store.py
git commit -m "feat: add Note tracking with lifecycle status"
```

---

### Task 3: DepositIntentService + Deposit Confirmation

Create the deposit intent flow: create intent → user submits tx → confirm and credit ledger.

**Files:**
- Create: `backend/app/services/deposit_intent_service.py`
- Create: `backend/app/api/routes/vault_v2.py`
- Modify: `backend/app/main.py` (register route)
- Test: `backend/tests/test_deposit_intent.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_deposit_intent.py
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

    result = svc.confirm_deposit(
        intent_id=intent["intent_id"],
        tx_hash="0xtx_confirmed",
        commitment_hash="0xcommit_confirmed",
    )
    assert result["status"] == "SETTLED"
    assert ledger.balance(f"VAULT_AVAILABLE:{vault['vault_id']}:STRK") == 5_000_000_000_000_000_000
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement DepositIntentService**

- `create_intent(vault_id, amount_wei, token, rail, idempotency_key)`:
  - Store intent with status=PENDING
  - Generate calldata for the chosen rail (delegate to existing proof services)
  - Return intent_id + calldata for the frontend
- `confirm_deposit(intent_id, tx_hash, commitment_hash)`:
  - Verify intent exists and is PENDING
  - Post ledger entry: DR OPERATOR_CUSTODY → CR VAULT_AVAILABLE
  - Create Note (custody=OPERATOR_HELD if mode=OPERATOR_MANAGED)
  - Mark intent SETTLED
  - Return receipt

**Step 4: Create API routes**

Create `backend/app/api/routes/vault_v2.py`:

```
POST /vault/deposit/intent    → create_intent
POST /vault/deposit/confirm   → confirm_deposit
GET  /vault/:id/balance       → vault_summary from ledger
GET  /vault/:id/notes         → list_notes
GET  /vault/:id/receipts      → list entries for vault
```

Register in main.py under `/api/v1/zkdefi/vault/v2`

**Step 5: Run test — expect PASS**

**Step 6: Commit**

```bash
git add backend/app/services/deposit_intent_service.py backend/app/api/routes/vault_v2.py backend/app/main.py backend/tests/test_deposit_intent.py
git commit -m "feat: add DepositIntentService with create/confirm flow"
```

---

### Task 4: VaultDeployService (Commit-Reveal Lifecycle)

Orchestrate the full deploy lifecycle: intent → ledger debit (available→pending) → commit on-chain → execute on-chain → settle (pending→escrow).

**Files:**
- Create: `backend/app/services/vault_deploy_service.py`
- Test: `backend/tests/test_vault_deploy_service.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_vault_deploy_service.py
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
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement VaultDeployService**

- `create_deploy_intent(vault_id, adapters, amounts, token, idempotency_key)`:
  - Post ledger entry: DR VAULT_AVAILABLE → CR VAULT_PENDING
  - Create Proposal record (status=CREATED)
  - Return proposal_hash, salt, status
- `mark_committed(proposal_hash, tx_hash)`: update status to COMMITTED
- `settle_execution(proposal_hash, tx_hash)`:
  - Post ledger entry: DR VAULT_PENDING → CR STRATEGY_ESCROW:<adapter>
  - Update status to EXECUTED
- `mark_failed(proposal_hash, reason)`:
  - Post ledger entry: DR VAULT_PENDING → CR VAULT_AVAILABLE (rollback)
  - Update status to FAILED

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add backend/app/services/vault_deploy_service.py backend/tests/test_vault_deploy_service.py
git commit -m "feat: add VaultDeployService with commit-reveal lifecycle and rollback"
```

---

### Task 5: WithdrawalService + Relayer Queue Integration

Handle withdrawal lifecycle: request → approve → send → confirm. Wire to the relayer queue.

**Files:**
- Create: `backend/app/services/withdrawal_service.py`
- Modify: `backend/app/api/routes/vault_v2.py`
- Modify: `backend/app/services/relayer_runner.py`
- Test: `backend/tests/test_withdrawal_service.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_withdrawal_service.py
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
    svc.mark_confirmed(wd["withdrawal_id"])
    assert ledger.balance(f"VAULT_PENDING:{vid}:STRK") == 0
```

**Step 2: Run test — expect FAIL**

**Step 3: Implement WithdrawalService**

- `request_withdrawal(vault_id, amount_wei, token, destination, route, idempotency_key)`:
  - Post ledger: DR VAULT_AVAILABLE → CR VAULT_PENDING
  - Create withdrawal record (status=REQUESTED)
  - Queue relayer job
- `mark_sent(withdrawal_id, tx_hash)`: update status, post ledger: DR VAULT_PENDING → CR OPERATOR_CUSTODY
- `mark_confirmed(withdrawal_id)`: final status

**Step 4: Add withdraw endpoint to vault_v2.py**

```
POST /vault/withdraw/request → request_withdrawal
GET  /vault/withdraw/:id     → get withdrawal status
```

**Step 5: Run test — expect PASS**

**Step 6: Commit**

```bash
git add backend/app/services/withdrawal_service.py backend/app/api/routes/vault_v2.py backend/tests/test_withdrawal_service.py
git commit -m "feat: add WithdrawalService with ledger lifecycle"
```

---

### Task 6: SweepService (Self-Custody ↔ Dark Ledger)

**Files:**
- Create: `backend/app/services/sweep_service.py`
- Modify: `backend/app/api/routes/vault_v2.py`
- Test: `backend/tests/test_sweep_service.py`

**Step 1: Write the failing test**

Test sweep-to-ledger: accepts proof bundle, credits VAULT_AVAILABLE, creates SWEPT note.
Test sweep-to-vault: debits VAULT_AVAILABLE, returns commitment to user, creates USER_HELD note.

**Step 2: Implement SweepService**

- `sweep_to_ledger(vault_id, commitment_hash, amount_wei, token, rail, proof_bundle)`:
  - Queue relayer to execute withdrawal from pool
  - Post ledger: DR OPERATOR_CUSTODY → CR VAULT_AVAILABLE
  - Create Note (custody=OPERATOR_HELD, status=SWEPT-source indicator)
  - Mark original user-held note as SWEPT
- `sweep_to_vault(vault_id, amount_wei, token, target_rail)`:
  - Post ledger: DR VAULT_AVAILABLE → CR OPERATOR_CUSTODY
  - Queue relayer to deposit into privacy pool
  - Create Note (custody=USER_HELD)
  - Return commitment + secrets to user

**Step 3: Add sweep endpoints to vault_v2.py**

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add backend/app/services/sweep_service.py backend/tests/test_sweep_service.py backend/app/api/routes/vault_v2.py
git commit -m "feat: add SweepService for self-custody <-> dark ledger transitions"
```

---

### Task 7: Receipt Service + Ledger Commitment Roots

Make the Dark Ledger provable with signed receipts and periodic Merkle commitment roots.

**Files:**
- Create: `backend/app/services/ledger_receipt_service.py`
- Modify: `backend/app/api/routes/vault_v2.py`
- Test: `backend/tests/test_ledger_receipts.py`

**Step 1: Write the failing test**

```python
def test_receipt_is_signed():
    svc = LedgerReceiptService(operator_key="0xoperator_private_key")
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
    assert svc.verify_receipt(receipt) is True

def test_commitment_root():
    svc = LedgerReceiptService(operator_key="0xkey")
    balances = [
        {"vault_id": "v1", "token": "STRK", "balance": 5_000_000_000_000_000_000},
        {"vault_id": "v2", "token": "STRK", "balance": 3_000_000_000_000_000_000},
    ]
    root = svc.compute_commitment_root(balances)
    assert root["root"].startswith("0x")
    assert root["leaf_count"] == 2

    proof = svc.inclusion_proof("v1", "STRK", balances)
    assert proof["verified"] is True
```

**Step 2: Implement LedgerReceiptService**

- `create_receipt(...)`: hash all fields, sign with operator key, return receipt
- `verify_receipt(receipt)`: verify signature against receipt_hash
- `compute_commitment_root(balances)`: build Merkle tree from vault balance leaves, return root
- `inclusion_proof(vault_id, token, balances)`: return Merkle path for user's leaf

**Step 3: Add provability endpoints**

```
GET /vault/:id/receipts              → list receipts for vault
GET /vault/:id/inclusion-proof       → inclusion proof against latest root
GET /ledger/commitment-root/latest   → latest root + block
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add backend/app/services/ledger_receipt_service.py backend/tests/test_ledger_receipts.py backend/app/api/routes/vault_v2.py
git commit -m "feat: add signed receipts and ledger commitment roots"
```

---

### Task 8: Frontend — Vault Screen v2

Rebuild the vault UI to show the two-track architecture: Dark Ledger balance + self-custody notes, with privacy grades, receipts, and sweep actions.

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/DepositPanel.tsx`
- Modify: `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx`
- Modify: `frontend/src/components/zkdefi/vault/PositionsOverview.tsx`
- Modify: `frontend/src/hooks/usePrivacyVault.ts`
- Modify: `frontend/src/lib/api/vault.ts`

**Step 1: Update vault API client**

Add v2 endpoints to `frontend/src/lib/api/vault.ts`:
- `createDepositIntent`, `confirmDeposit`
- `getVaultBalance` (available, pending, deployed, by_token)
- `getVaultNotes`, `getVaultReceipts`
- `requestWithdrawal`, `sweepToLedger`, `sweepToVault`
- `getInclusionProof`

**Step 2: Update DepositPanel**

- Add mode toggle: **Operator-Managed** | **Self-Custody**
- Collapse rail selector under "Advanced"
- Operator-Managed flow: createDepositIntent → user signs → confirmDeposit → show receipt
- Self-Custody flow: existing behavior
- Show privacy grade tooltip

**Step 3: Update PositionsOverview**

Match the UI layout from the design doc:
- Dark Ledger section: Available balance, deployed positions with receipts
- Self-Custody section: open notes with sweep/withdraw actions
- Privacy grade indicators on each item

**Step 4: Update WithdrawPanel**

- Source selector: Dark Ledger balance or specific note
- Route selector: Fast (direct) | Private (via pool)
- Wire to `/vault/withdraw/request`

**Step 5: Build and verify**

```bash
cd /opt/obsqra.starknet/zkdefi/frontend && npm run build
```

**Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat: vault screen v2 with dark ledger balance, notes, receipts, sweep"
```

---

### Task 9: Relayer Queue — Commit/Execute/Withdraw Jobs

Wire the relayer to process VaultController commit-reveal jobs and vault withdrawal payouts.

**Files:**
- Modify: `backend/app/services/relayer_runner.py`
- Test: `backend/tests/test_relayer_vault_jobs.py`

**Step 1: Add vault job processing to relayer loop**

In RelayerRunner's main processing loop, add:
- `_process_vault_commits()`: submit pending commit_proposal txs
- `_process_vault_executes()`: submit pending execute_proposal txs (after delay)
- `_process_vault_withdrawals()`: execute pending withdrawal payouts

Each job:
1. Reads from the service's pending queue
2. Builds and submits the Starknet tx
3. Updates the service status on success/failure

**Step 2: Write test for commit-execute flow**

Test that creating a deploy intent → relayer processes commit → relayer processes execute → ledger state is correct.

**Step 3: Commit**

```bash
git add backend/app/services/relayer_runner.py backend/tests/test_relayer_vault_jobs.py
git commit -m "feat: wire relayer for VaultController commit-reveal and withdrawal jobs"
```

---

### Task 10: Integration Test — Full Lifecycle

End-to-end test covering: create vault → deposit via privacy tier → ledger credit → deploy via commit-reveal → yield harvest → withdrawal → receipts valid → inclusion proof valid.

**Files:**
- Create: `backend/tests/test_private_vault_lifecycle.py`

**Step 1: Write comprehensive lifecycle test**

Cover all state transitions:
1. Create VaultAccount
2. Create deposit intent (PENDING)
3. Confirm deposit (SETTLED) — verify ledger DR/CR
4. Create deploy intent — verify AVAILABLE→PENDING
5. Mark committed — verify proposal status
6. Settle execution — verify PENDING→STRATEGY_ESCROW
7. Harvest yield — verify credit to VAULT_AVAILABLE
8. Request withdrawal — verify AVAILABLE→PENDING
9. Confirm withdrawal — verify PENDING→0
10. Verify all receipts have valid hashes
11. Compute commitment root and verify inclusion proof

**Step 2: Run test — expect PASS**

**Step 3: Commit**

```bash
git add backend/tests/test_private_vault_lifecycle.py
git commit -m "test: full private vault lifecycle with double-entry ledger verification"
```
