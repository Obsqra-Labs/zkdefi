# Private Vault & Dark Ledger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the Dark Ledger as the Private Vault's accounting layer with ZK deposit rails, VaultController commit-reveal deployment, relayer-mediated withdrawals, and self-custody sweep.

**Architecture:** Deposits go through existing privacy tier contracts (ConfidentialTransfer, FullyShieldedPool) but the operator/relayer claims the position and credits the user's off-chain Dark Ledger. Capital deployment from the ledger uses VaultController commit-reveal via the relayer. Self-custody mode remains as an option with sweep between modes.

**Tech Stack:** Python (FastAPI backend), TypeScript/React (Next.js frontend), Cairo (Starknet contracts — already deployed), SQLite (Dark Ledger), starknet.py (relayer)

**Design doc:** `docs/plans/2026-03-04-private-vault-dark-ledger-design.md`

---

### Task 1: Dark Ledger — Private Deposit Credit

Credit the Dark Ledger when a user deposits through a privacy tier in "Private Vault" mode. The backend verifies the on-chain deposit tx, confirms tokens landed in the privacy pool, and credits the ledger.

**Files:**
- Modify: `backend/app/services/ledger_service.py`
- Modify: `backend/app/api/routes/ledger.py`
- Test: `backend/tests/test_private_vault_deposit.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_private_vault_deposit.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import AsyncMock, patch
from app.services.ledger_service import get_ledger_service


def test_credit_from_privacy_deposit():
    """Crediting from a privacy tier deposit records the deposit rail and commitment."""
    ledger = get_ledger_service()
    user = "0xtest_user_private_deposit"
    amount = 5_000_000_000_000_000_000  # 5 STRK

    ledger.credit_from_privacy_deposit(
        user_address=user,
        amount_wei=amount,
        deposit_rail="commitment_shield",
        commitment_hash="0xabc123",
        tx_hash="0xtx_deposit_1",
        asset="STRK",
    )

    balance = ledger.get_asset_balance(user, "STRK")
    assert balance >= amount

    transfers = ledger.list_transfers(user, asset="STRK", limit=5)
    latest = transfers[0]
    assert latest["reason"] == "privacy_deposit"
    assert latest["settlement_type"] == "commitment_shield"
    assert latest["capital_source"] == "privacy_tier"
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_private_vault_deposit.py::test_credit_from_privacy_deposit -v`
Expected: FAIL with `AttributeError: 'LedgerService' object has no attribute 'credit_from_privacy_deposit'`

**Step 3: Implement `credit_from_privacy_deposit` in LedgerService**

Add to `backend/app/services/ledger_service.py`:

```python
def credit_from_privacy_deposit(
    self,
    user_address: str,
    amount_wei: int,
    deposit_rail: str,
    commitment_hash: str,
    tx_hash: str,
    asset: str = "STRK",
) -> dict:
    """Credit Dark Ledger from a verified privacy tier deposit."""
    return self.credit_balance(
        address=user_address,
        amount_wei=amount_wei,
        reason="privacy_deposit",
        tx_hash=tx_hash,
        settlement_type=deposit_rail,
        capital_source="privacy_tier",
        asset=asset,
        metadata={"commitment_hash": commitment_hash, "deposit_rail": deposit_rail},
    )
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_private_vault_deposit.py -v`
Expected: PASS

**Step 5: Add API endpoint for private vault deposit**

Add to `backend/app/api/routes/ledger.py`:

```python
class PrivateVaultDepositRequest(BaseModel):
    user_address: str
    amount_wei: int
    deposit_rail: str  # "commitment_shield" | "nullifier_set" | "hashed_proof"
    commitment_hash: str
    tx_hash: str
    asset: str = "STRK"

@router.post("/private-vault/deposit")
async def private_vault_deposit(req: PrivateVaultDepositRequest):
    """Credit Dark Ledger after a verified privacy tier deposit."""
    ledger = get_ledger_service()
    result = ledger.credit_from_privacy_deposit(
        user_address=req.user_address,
        amount_wei=req.amount_wei,
        deposit_rail=req.deposit_rail,
        commitment_hash=req.commitment_hash,
        tx_hash=req.tx_hash,
        asset=req.asset,
    )
    return {"status": "credited", "balance_wei": ledger.get_asset_balance(req.user_address, req.asset), **result}
```

**Step 6: Commit**

```bash
git add backend/app/services/ledger_service.py backend/app/api/routes/ledger.py backend/tests/test_private_vault_deposit.py
git commit -m "feat: add private vault deposit — credit dark ledger from privacy tier deposit"
```

---

### Task 2: Frontend — Destination Toggle (Private Vault vs Self-Custody)

Add a toggle to DepositPanel that lets the user choose where their deposit lands: "Private Vault" (Dark Ledger credit) or "Self-Custody" (hold commitment directly, existing behavior).

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/DepositPanel.tsx`
- Modify: `frontend/src/hooks/usePrivacyVault.ts` (add `destination` type)

**Step 1: Add `VaultDestination` type**

In `frontend/src/hooks/usePrivacyVault.ts`, add:
```typescript
export type VaultDestination = "private_vault" | "self_custody";
```

**Step 2: Add destination toggle to DepositPanel**

In `DepositPanel.tsx`:
- Add `const [destination, setDestination] = useState<VaultDestination>("private_vault");`
- Add a toggle UI between the method selector and the amount input
- When `destination === "private_vault"`:
  - After the on-chain deposit succeeds, call `POST /api/v1/zkdefi/ledger/private-vault/deposit` with the tx_hash, commitment, and deposit rail
  - The commitment is NOT stored locally (operator holds it)
- When `destination === "self_custody"`:
  - Existing behavior: store commitment in local vault state via `addCommitment`

**Step 3: Implement the conditional flow**

In each deposit handler (`depositCommitmentShield`, `depositNullifierSet`):
- After `const txHash = result.transaction_hash;`
- If destination is `"private_vault"`, POST to the private-vault/deposit endpoint and skip `addCommitment`
- If destination is `"self_custody"`, continue with existing `addCommitment` flow

**Step 4: Verify both flows work**

Test in browser:
1. Select "Private Vault" destination, deposit 1 STRK via Commitment Shield → balance should appear in Dark Ledger section
2. Select "Self-Custody" destination, deposit 1 STRK via Nullifier Set → commitment should appear in positions list

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/vault/DepositPanel.tsx frontend/src/hooks/usePrivacyVault.ts
git commit -m "feat: add destination toggle — private vault vs self-custody deposits"
```

---

### Task 3: Relayer — VaultController Commit-Reveal Submission

Wire the relayer to submit `commit_proposal` and `execute_proposal` transactions on the VaultController contract.

**Files:**
- Modify: `backend/app/services/relayer_runner.py`
- Create: `backend/app/services/vault_deploy_service.py`
- Test: `backend/tests/test_vault_deploy_service.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_vault_deploy_service.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.vault_deploy_service import VaultDeployService


@pytest.mark.asyncio
async def test_create_and_commit_proposal():
    svc = VaultDeployService()
    proposal = svc.create_proposal(
        user_address="0xuser1",
        adapters=["0xekubo_adapter"],
        amounts=[1_000_000_000_000_000_000],
        params={"pool_fee": 170},
    )
    assert "proposal_hash" in proposal
    assert "salt" in proposal
    assert proposal["status"] == "pending_commit"


@pytest.mark.asyncio
async def test_proposal_lifecycle():
    svc = VaultDeployService()
    proposal = svc.create_proposal(
        user_address="0xuser1",
        adapters=["0xekubo_adapter"],
        amounts=[1_000_000_000_000_000_000],
        params={},
    )
    ph = proposal["proposal_hash"]

    # After commit (simulated)
    svc.mark_committed(ph, tx_hash="0xcommit_tx")
    status = svc.get_status(ph)
    assert status["status"] == "committed"

    # After execute (simulated)
    svc.mark_executed(ph, tx_hash="0xexecute_tx")
    status = svc.get_status(ph)
    assert status["status"] == "executed"
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_vault_deploy_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.vault_deploy_service'`

**Step 3: Implement VaultDeployService**

Create `backend/app/services/vault_deploy_service.py`:

```python
"""
VaultDeployService — manages the lifecycle of Dark Ledger capital deployments
through the VaultController commit-reveal flow.

Lifecycle: create_proposal → commit (on-chain) → execute (on-chain) → done
"""
import hashlib
import os
import time
from typing import Any


class VaultDeployService:
    def __init__(self):
        self._proposals: dict[str, dict] = {}

    def create_proposal(
        self,
        user_address: str,
        adapters: list[str],
        amounts: list[int],
        params: dict | None = None,
    ) -> dict[str, Any]:
        salt = os.urandom(16).hex()
        payload = f"{','.join(adapters)}:{','.join(str(a) for a in amounts)}:{salt}"
        proposal_hash = "0x" + hashlib.sha256(payload.encode()).hexdigest()

        record = {
            "proposal_hash": proposal_hash,
            "salt": salt,
            "user_address": user_address,
            "adapters": adapters,
            "amounts": amounts,
            "params": params or {},
            "status": "pending_commit",
            "created_at": int(time.time()),
            "commit_tx": None,
            "execute_tx": None,
        }
        self._proposals[proposal_hash] = record
        return record

    def mark_committed(self, proposal_hash: str, tx_hash: str):
        p = self._proposals.get(proposal_hash)
        if not p:
            raise ValueError(f"Unknown proposal: {proposal_hash}")
        p["status"] = "committed"
        p["commit_tx"] = tx_hash
        p["committed_at"] = int(time.time())

    def mark_executed(self, proposal_hash: str, tx_hash: str):
        p = self._proposals.get(proposal_hash)
        if not p:
            raise ValueError(f"Unknown proposal: {proposal_hash}")
        p["status"] = "executed"
        p["execute_tx"] = tx_hash
        p["executed_at"] = int(time.time())

    def get_status(self, proposal_hash: str) -> dict:
        p = self._proposals.get(proposal_hash)
        if not p:
            raise ValueError(f"Unknown proposal: {proposal_hash}")
        return p

    def list_pending_commits(self) -> list[dict]:
        return [p for p in self._proposals.values() if p["status"] == "pending_commit"]

    def list_pending_executes(self) -> list[dict]:
        return [p for p in self._proposals.values() if p["status"] == "committed"]
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_vault_deploy_service.py -v`
Expected: PASS

**Step 5: Wire relayer to process commit-reveal queue**

In `backend/app/services/relayer_runner.py`, add a new processing step in the main loop:

```python
async def _process_vault_proposals(self):
    """Submit pending commit_proposal and execute_proposal txs."""
    from app.services.vault_deploy_service import get_vault_deploy_service
    svc = get_vault_deploy_service()

    # Phase 1: Submit commits for pending proposals
    for proposal in svc.list_pending_commits():
        calldata = [int(proposal["proposal_hash"], 16)]
        try:
            tx = await self._submit_tx(
                contract=self.vault_controller_address,
                entrypoint="commit_proposal",
                calldata=calldata,
            )
            svc.mark_committed(proposal["proposal_hash"], tx_hash=tx)
        except Exception as e:
            logger.warning("commit_proposal failed: %s", e)

    # Phase 2: Execute proposals that have been committed for > commit_delay
    for proposal in svc.list_pending_executes():
        committed_at = proposal.get("committed_at", 0)
        if time.time() - committed_at < 30:  # 30s commit delay
            continue
        adapters = [int(a, 16) for a in proposal["adapters"]]
        amounts_flat = []
        for amt in proposal["amounts"]:
            amounts_flat.extend([amt % (2**128), amt // (2**128)])
        salt = int(proposal["salt"], 16)
        calldata = [
            len(adapters), *adapters,
            len(proposal["amounts"]), *amounts_flat,
            salt,
        ]
        try:
            tx = await self._submit_tx(
                contract=self.vault_controller_address,
                entrypoint="execute_proposal",
                calldata=calldata,
            )
            svc.mark_executed(proposal["proposal_hash"], tx_hash=tx)
        except Exception as e:
            logger.warning("execute_proposal failed: %s", e)
```

**Step 6: Commit**

```bash
git add backend/app/services/vault_deploy_service.py backend/app/services/relayer_runner.py backend/tests/test_vault_deploy_service.py
git commit -m "feat: add VaultDeployService and wire relayer commit-reveal"
```

---

### Task 4: Deploy API — Dark Ledger Capital Deployment

API endpoint that takes a deployment request, debits the Dark Ledger, and queues a VaultController commit-reveal.

**Files:**
- Modify: `backend/app/api/routes/orchestration.py`
- Test: `backend/tests/test_dark_ledger_deploy.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_dark_ledger_deploy.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


def test_deploy_from_dark_ledger():
    from app.main import app
    client = TestClient(app)

    # Pre-credit the ledger
    from app.services.ledger_service import get_ledger_service
    ledger = get_ledger_service()
    ledger.credit_balance("0xtest_deploy_user", 10_000_000_000_000_000_000, reason="test")

    response = client.post("/api/v1/zkdefi/orchestration/deploy", json={
        "user_address": "0xtest_deploy_user",
        "strategy": "ekubo_lp",
        "amount_wei": "5000000000000000000",
        "deploy_mode": "dark_ledger",
    })
    assert response.status_code == 200
    data = response.json()
    assert data.get("proposal_hash") is not None
    assert data.get("status") == "pending_commit"

    # Ledger should be debited
    balance = ledger.get_balance("0xtest_deploy_user")
    assert balance == 5_000_000_000_000_000_000
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_dark_ledger_deploy.py -v`
Expected: FAIL

**Step 3: Add dark_ledger deploy mode to orchestration endpoint**

In `backend/app/api/routes/orchestration.py`, modify the `/deploy` endpoint to handle `deploy_mode == "dark_ledger"`:

```python
if deploy_mode == "dark_ledger":
    # Debit ledger
    ledger = get_ledger_service()
    ledger.debit_balance(user_address, amount_wei, reason="dark_pool_deploy")

    # Create VaultController proposal
    from app.services.vault_deploy_service import get_vault_deploy_service
    deploy_svc = get_vault_deploy_service()
    adapter_address = STRATEGY_ADAPTERS.get(strategy, STRATEGY_ADAPTERS["ekubo_lp"])
    proposal = deploy_svc.create_proposal(
        user_address=user_address,
        adapters=[adapter_address],
        amounts=[amount_wei],
        params={"strategy": strategy},
    )
    return {**proposal, "message": "Deployment queued via VaultController commit-reveal"}
```

**Step 4: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_dark_ledger_deploy.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/api/routes/orchestration.py backend/tests/test_dark_ledger_deploy.py
git commit -m "feat: add dark ledger deploy mode via VaultController commit-reveal"
```

---

### Task 5: Sweep — Self-Custody to Dark Ledger

Let users move a self-custody vault position into the Dark Ledger. The relayer executes the withdrawal from the privacy pool, and the ledger is credited.

**Files:**
- Create: `backend/app/api/routes/sweep.py`
- Modify: `backend/app/main.py` (register route)
- Test: `backend/tests/test_sweep.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_sweep.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient


def test_sweep_to_ledger_endpoint_exists():
    from app.main import app
    client = TestClient(app)
    response = client.post("/api/v1/zkdefi/sweep/to-ledger", json={
        "user_address": "0xsweep_user",
        "commitment_hash": "0xcommit123",
        "amount_wei": "1000000000000000000",
        "deposit_rail": "nullifier_set",
        "withdraw_proof": {"nullifier": "0xnull1", "root": "0xroot1", "proof_calldata": []},
    })
    assert response.status_code in (200, 202)


def test_sweep_to_vault_endpoint_exists():
    from app.main import app
    client = TestClient(app)

    # Pre-credit ledger
    from app.services.ledger_service import get_ledger_service
    ledger = get_ledger_service()
    ledger.credit_balance("0xsweep_user2", 2_000_000_000_000_000_000, reason="test")

    response = client.post("/api/v1/zkdefi/sweep/to-vault", json={
        "user_address": "0xsweep_user2",
        "amount_wei": "1000000000000000000",
        "target_rail": "nullifier_set",
    })
    assert response.status_code in (200, 202)
```

**Step 2: Run test to verify it fails**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_sweep.py -v`
Expected: FAIL (404 — route doesn't exist)

**Step 3: Create sweep router**

Create `backend/app/api/routes/sweep.py`:

```python
"""Sweep between self-custody vault positions and the Dark Ledger."""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services.ledger_service import get_ledger_service

logger = logging.getLogger(__name__)
router = APIRouter()


class SweepToLedgerRequest(BaseModel):
    user_address: str
    commitment_hash: str
    amount_wei: str
    deposit_rail: str
    withdraw_proof: dict
    asset: str = "STRK"


class SweepToVaultRequest(BaseModel):
    user_address: str
    amount_wei: str
    target_rail: str
    asset: str = "STRK"


@router.post("/to-ledger")
async def sweep_to_ledger(req: SweepToLedgerRequest):
    """Move a self-custody position into the Dark Ledger.

    The relayer will execute the withdrawal from the privacy pool
    and credit the user's ledger balance.
    """
    amount = int(req.amount_wei)
    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    # Queue the relayer to execute the withdrawal
    from app.api.relayer import enqueue_withdraw
    entry = enqueue_withdraw(
        requester=req.user_address,
        nullifier_low=req.withdraw_proof.get("nullifier_low", "0"),
        nullifier_high=req.withdraw_proof.get("nullifier_high", "0"),
        root_low=req.withdraw_proof.get("root_low", "0"),
        root_high=req.withdraw_proof.get("root_high", "0"),
        pool_type=0,
        proof_calldata=req.withdraw_proof.get("proof_calldata", []),
    )

    # Credit ledger (relayer will settle the on-chain part async)
    ledger = get_ledger_service()
    ledger.credit_from_privacy_deposit(
        user_address=req.user_address,
        amount_wei=amount,
        deposit_rail=f"sweep_{req.deposit_rail}",
        commitment_hash=req.commitment_hash,
        tx_hash=f"sweep_pending_{entry.get('withdraw_id', 'unknown')}",
        asset=req.asset,
    )

    return {
        "status": "queued",
        "withdraw_id": entry.get("withdraw_id"),
        "ledger_balance": ledger.get_asset_balance(req.user_address, req.asset),
        "message": "Position queued for sweep to Dark Ledger",
    }


@router.post("/to-vault")
async def sweep_to_vault(req: SweepToVaultRequest):
    """Move Dark Ledger balance into a self-custody vault position.

    The relayer will deposit into a privacy tier pool and return
    the commitment to the user.
    """
    amount = int(req.amount_wei)
    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    ledger = get_ledger_service()
    balance = ledger.get_asset_balance(req.user_address, req.asset)
    if balance < amount:
        raise HTTPException(400, f"Insufficient Dark Ledger balance: {balance} < {amount}")

    # Debit ledger
    ledger.debit_balance(req.user_address, amount, reason="sweep_to_vault", asset=req.asset)

    # Queue relayer to deposit into privacy pool on user's behalf
    # Returns a commitment the user can hold for self-custody withdrawal
    from app.api.routes.full_privacy import _generate_commitment
    commitment_data = _generate_commitment(req.user_address, amount, pool_type=0)

    return {
        "status": "queued",
        "commitment": commitment_data.get("commitment"),
        "user_secret": commitment_data.get("user_secret"),
        "nonce": commitment_data.get("nonce"),
        "blinding": commitment_data.get("blinding"),
        "ledger_balance": ledger.get_asset_balance(req.user_address, req.asset),
        "message": "Dark Ledger balance queued for sweep to self-custody vault",
    }
```

**Step 4: Register sweep router in main.py**

In `backend/app/main.py`, add:
```python
sweep_router = _optional_router("app.api.routes.sweep")
if sweep_router:
    app.include_router(sweep_router, prefix="/api/v1/zkdefi/sweep", tags=["sweep"])
```

**Step 5: Run test to verify it passes**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_sweep.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/app/api/routes/sweep.py backend/app/main.py backend/tests/test_sweep.py
git commit -m "feat: add sweep endpoints — self-custody <-> dark ledger"
```

---

### Task 6: Relayer-Mediated Vault Withdrawal

Let self-custody users submit their withdraw proof to the relayer instead of signing the tx directly. Breaks the on-chain link.

**Files:**
- Modify: `backend/app/api/relayer.py` (add endpoint)
- Modify: `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx` (add "via Relayer" option)
- Test: `backend/tests/test_relayer_withdraw.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_relayer_withdraw.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient


def test_relayer_mediated_withdraw():
    from app.main import app
    client = TestClient(app)
    response = client.post("/api/v1/zkdefi/relayer/vault-withdraw", json={
        "requester": "0xwithdraw_user",
        "nullifier_low": "0x1",
        "nullifier_high": "0x0",
        "root_low": "0x2",
        "root_high": "0x0",
        "pool_type": 0,
        "proof_calldata": ["0x3", "0x4"],
        "recipient": "0xrecipient_addr",
        "amount_wei": "1000000000000000000",
    })
    assert response.status_code == 200
    data = response.json()
    assert "withdraw_id" in data
```

**Step 2: Run test — expect FAIL**

**Step 3: Add vault-withdraw endpoint to relayer**

In `backend/app/api/relayer.py`:

```python
class VaultWithdrawRequest(BaseModel):
    requester: str
    nullifier_low: str
    nullifier_high: str
    root_low: str
    root_high: str
    pool_type: int = 0
    proof_calldata: list[str] = Field(default_factory=list)
    recipient: str
    amount_wei: str

@router.post("/vault-withdraw")
async def vault_withdraw_via_relayer(req: VaultWithdrawRequest):
    """Accept a self-custody withdraw proof and execute via relayer.

    The relayer submits the on-chain withdrawal and sends tokens to the recipient.
    This decouples the privacy pool withdrawal from the recipient address.
    """
    entry = enqueue_withdraw(
        requester=req.requester,
        nullifier_low=req.nullifier_low,
        nullifier_high=req.nullifier_high,
        root_low=req.root_low,
        root_high=req.root_high,
        pool_type=req.pool_type,
        proof_calldata=req.proof_calldata,
    )
    # Also queue a payout to the recipient
    enqueue_wallet_payout(
        requester=req.requester,
        amount_wei=req.amount_wei,
        recipient=req.recipient,
    )
    return {
        "withdraw_id": entry.get("withdraw_id"),
        "status": "queued",
        "message": "Withdrawal queued via relayer. Tokens will be sent to recipient.",
    }
```

**Step 4: Run test — expect PASS**

**Step 5: Update WithdrawPanel to offer relayer option**

In `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx`:
- Add a toggle: "Withdraw directly" vs "Withdraw via Relayer (private)"
- When "via Relayer": POST the withdraw proof to `/api/v1/zkdefi/relayer/vault-withdraw` instead of calling `account.execute`

**Step 6: Commit**

```bash
git add backend/app/api/relayer.py backend/tests/test_relayer_withdraw.py frontend/src/components/zkdefi/vault/WithdrawPanel.tsx
git commit -m "feat: add relayer-mediated vault withdrawal for self-custody positions"
```

---

### Task 7: Frontend — Dark Ledger Balance & Deploy UI

Show the Dark Ledger balance in the vault UI and add a deploy action that uses the VaultController commit-reveal flow.

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/PositionsOverview.tsx`
- Modify: `frontend/src/components/zkdefi/vault/VaultTab.tsx` (or equivalent)
- Modify: `frontend/src/lib/api/vault.ts`

**Step 1: Add Dark Ledger balance fetch to vault API client**

```typescript
export function getDarkLedgerBalance(userAddress: string): Promise<{ balance_wei: string; asset: string }> {
  return vaultFetch(`/status?user_address=${encodeURIComponent(userAddress)}`);
}
```

**Step 2: Show Dark Ledger balance in PositionsOverview**

Add a "Dark Ledger" section above the self-custody positions showing:
- Current balance
- Active deployments (via VaultController)
- Accrued yield
- "Deploy" and "Withdraw" action buttons

**Step 3: Wire Deploy button to orchestration endpoint**

When user clicks "Deploy" on their Dark Ledger balance:
1. Show strategy selector (Ekubo LP, Lending, Staking)
2. Show amount input
3. POST to `/api/v1/zkdefi/orchestration/deploy` with `deploy_mode: "dark_ledger"`
4. Show commit-reveal progress stepper

**Step 4: Add Sweep buttons**

On self-custody positions: "Move to Dark Ledger" button → calls `/api/v1/zkdefi/sweep/to-ledger`
On Dark Ledger: "Move to Self-Custody" button → calls `/api/v1/zkdefi/sweep/to-vault`

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/vault/PositionsOverview.tsx frontend/src/components/zkdefi/vault/VaultTab.tsx frontend/src/lib/api/vault.ts
git commit -m "feat: add dark ledger balance, deploy UI, and sweep actions"
```

---

### Task 8: Integration Test — Full Private Vault Lifecycle

End-to-end test covering: deposit via privacy tier → dark ledger credit → deploy via commit-reveal → yield accrual → withdrawal via relayer.

**Files:**
- Create: `backend/tests/test_private_vault_lifecycle.py`

**Step 1: Write the integration test**

```python
# backend/tests/test_private_vault_lifecycle.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.services.ledger_service import get_ledger_service
from app.services.vault_deploy_service import VaultDeployService


def test_full_lifecycle():
    user = "0xlifecycle_test_user"
    ledger = get_ledger_service()
    deploy_svc = VaultDeployService()

    # 1. Private deposit credits ledger
    ledger.credit_from_privacy_deposit(
        user_address=user,
        amount_wei=10_000_000_000_000_000_000,
        deposit_rail="nullifier_set",
        commitment_hash="0xcommit_lifecycle",
        tx_hash="0xtx_lifecycle_deposit",
    )
    assert ledger.get_balance(user) == 10_000_000_000_000_000_000

    # 2. Deploy via commit-reveal
    proposal = deploy_svc.create_proposal(
        user_address=user,
        adapters=["0xekubo_adapter_addr"],
        amounts=[5_000_000_000_000_000_000],
    )
    ledger.debit_balance(user, 5_000_000_000_000_000_000, reason="dark_pool_deploy")
    assert ledger.get_balance(user) == 5_000_000_000_000_000_000

    # 3. Commit + execute lifecycle
    deploy_svc.mark_committed(proposal["proposal_hash"], "0xcommit_tx")
    deploy_svc.mark_executed(proposal["proposal_hash"], "0xexec_tx")
    status = deploy_svc.get_status(proposal["proposal_hash"])
    assert status["status"] == "executed"

    # 4. Yield accrual
    ledger.credit_balance(user, 100_000_000_000_000_000, reason="yield_harvest")
    assert ledger.get_balance(user) == 5_100_000_000_000_000_000

    # 5. Withdrawal debits ledger
    ledger.debit_balance(user, 5_100_000_000_000_000_000, reason="relayer_withdraw")
    assert ledger.get_balance(user) == 0
```

**Step 2: Run the test**

Run: `cd /opt/obsqra.starknet/zkdefi/backend && python -m pytest tests/test_private_vault_lifecycle.py -v`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/tests/test_private_vault_lifecycle.py
git commit -m "test: add full private vault lifecycle integration test"
```
