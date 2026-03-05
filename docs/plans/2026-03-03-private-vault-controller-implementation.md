# Private Vault Controller Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the VaultController contract, three first-party StrategyAdapters, backend proposal service, and UX surfaces that make privacy-preserving yield feel controlled, legible, and calm.

**Architecture:** Three-layer system -- privacy pools (existing, no changes) feed into a VaultController (new Cairo contract) that routes capital to pluggable StrategyAdapters (new Cairo contracts). Backend orchestrates proposals with constraint verification and zkML proofs. Frontend surfaces use metaphors (Shield/Vault/Strategies) with zero jargon.

**Tech Stack:** Cairo (Starknet contracts), Python/FastAPI (backend services), React/Next.js/TypeScript/Tailwind (frontend), Poseidon hash (commitments), snforge (Cairo tests), pytest (backend tests).

**Design Doc:** `docs/plans/2026-03-03-private-vault-controller-design.md`

---

## Phase 1: Cairo Contracts

### Task 1: IStrategyAdapter Trait

Define the composability interface that all adapters implement.

**Files:**
- Create: `contracts/src/strategy_adapter.cairo`
- Modify: `contracts/src/lib.cairo`

**Step 1: Create the trait file**

```cairo
// contracts/src/strategy_adapter.cairo
use starknet::ContractAddress;

#[starknet::interface]
pub trait IStrategyAdapter<TContractState> {
    fn deploy(ref self: TContractState, amount: u256, params: Span<felt252>) -> felt252;
    fn withdraw(ref self: TContractState, position_id: felt252, amount: u256) -> u256;
    fn harvest(ref self: TContractState) -> u256;
    fn value_of(self: @TContractState) -> u256;
    fn current_apy_bps(self: @TContractState) -> u32;
    fn is_healthy(self: @TContractState) -> bool;
}
```

**Step 2: Register in lib.cairo**

Add `pub mod strategy_adapter;` to `contracts/src/lib.cairo`.

**Step 3: Build**

Run: `cd contracts && scarb build`
Expected: Compiles without errors.

**Step 4: Commit**

```bash
git add contracts/src/strategy_adapter.cairo contracts/src/lib.cairo
git commit -m "feat: add IStrategyAdapter trait -- composability interface for vault strategies"
```

---

### Task 2: VaultController Contract (Core)

The routing contract between privacy pools and strategy adapters.

**Files:**
- Create: `contracts/src/vault_controller.cairo`
- Modify: `contracts/src/lib.cairo`

**Step 1: Create vault_controller.cairo**

Core state and functions:

```cairo
// contracts/src/vault_controller.cairo
use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct AdapterConfig {
    pub max_allocation_bps: u16,     // basis points (10000 = 100%)
    pub enabled: bool,
    pub circuit_breaker: bool,
}

#[starknet::interface]
pub trait IVaultController<TContractState> {
    // Adapter management (admin only)
    fn register_adapter(ref self: TContractState, adapter: ContractAddress, max_bps: u16);
    fn set_adapter_enabled(ref self: TContractState, adapter: ContractAddress, enabled: bool);
    fn trigger_circuit_breaker(ref self: TContractState, adapter: ContractAddress);

    // Constraint registration
    fn register_constraint(ref self: TContractState, constraint_hash: felt252, commitment: felt252);
    fn update_policy_root(ref self: TContractState, new_root: felt252);

    // Dark pool commit-reveal
    fn commit_proposal(ref self: TContractState, proposal_hash: felt252);
    fn execute_proposal(
        ref self: TContractState,
        adapters: Span<ContractAddress>,
        amounts: Span<u256>,
        params: Span<Span<felt252>>,
        salt: felt252,
        risk_proof: Span<felt252>,
    );

    // Emergency
    fn emergency_withdraw(ref self: TContractState, adapter: ContractAddress);

    // Views
    fn total_value(self: @TContractState) -> u256;
    fn get_adapter_config(self: @TContractState, adapter: ContractAddress) -> AdapterConfig;
    fn get_policy_root(self: @TContractState) -> felt252;
    fn get_pending_proposal(self: @TContractState) -> felt252;
    fn get_last_rebalance_ts(self: @TContractState) -> u64;
    fn get_admin(self: @TContractState) -> ContractAddress;
}
```

Implementation should include:
- Storage: admin, zkml_verifier, policy_root, pending_proposal, proposal_block, last_rebalance_ts, min_cooldown_seconds, adapter configs map, constraint hashes map
- Constructor: takes admin address, zkml_verifier address, min_cooldown_seconds, ETH token address
- register_adapter: admin-only, stores AdapterConfig
- register_constraint: stores constraint_hash keyed by commitment
- commit_proposal: stores hash + current block number. Asserts no pending proposal.
- execute_proposal: (a) verify hash matches pending, (b) verify risk proof via zkml_verifier dispatcher, (c) verify per-adapter bounds, (d) verify cooldown, (e) call each adapter's deploy(), (f) clear pending proposal, (g) update last_rebalance_ts
- emergency_withdraw: admin-only, calls adapter withdraw, sets circuit_breaker
- total_value: sum of value_of() across all enabled adapters

**Step 2: Register in lib.cairo**

Add `pub mod vault_controller;` to `contracts/src/lib.cairo`.

**Step 3: Build**

Run: `cd contracts && scarb build`
Expected: Compiles. If there are import issues with IStrategyAdapter dispatch, use the dispatcher pattern from starknet::interface.

**Step 4: Commit**

```bash
git add contracts/src/vault_controller.cairo contracts/src/lib.cairo
git commit -m "feat: add VaultController contract -- dark pool commit-reveal with constraint enforcement"
```

---

### Task 3: EkuboLpAdapter

Thin wrapper around Ekubo Positions for LP deployment.

**Files:**
- Create: `contracts/src/ekubo_lp_adapter.cairo`
- Modify: `contracts/src/lib.cairo`

**Step 1: Create adapter**

The adapter:
- Stores vault_controller address (only caller)
- deploy() calls Ekubo Positions to mint_and_deposit LP. params encode pool_key and tick_range.
- withdraw() calls Ekubo to withdraw liquidity
- harvest() calls collect_fees
- value_of() reads position value from Ekubo
- current_apy_bps() returns estimated APY (can be set by admin or read from oracle)
- is_healthy() returns true unless circuit breaker set

For Sepolia without live Ekubo integration, implement with a mock that stores balances and simulated APY. The interface is what matters for composability.

**Step 2: Register in lib.cairo, build, commit**

```bash
git commit -m "feat: add EkuboLpAdapter -- IStrategyAdapter wrapper for Ekubo LP"
```

---

### Task 4: LendingAdapter

Thin wrapper around the deployed LendingPool contract.

**Files:**
- Create: `contracts/src/lending_adapter.cairo`
- Modify: `contracts/src/lib.cairo`

**Step 1: Create adapter**

- deploy() calls LendingPool.supply()
- withdraw() calls LendingPool.withdraw()
- harvest() reads accrued interest
- value_of() reads supplied balance
- current_apy_bps() reads from LendingPool or admin-set
- is_healthy() checks LendingPool utilization rate

Reference existing: `contracts/src/lending_pool.cairo` for the interface.

**Step 2: Register, build, commit**

```bash
git commit -m "feat: add LendingAdapter -- IStrategyAdapter wrapper for LendingPool"
```

---

### Task 5: StakingAdapter

Thin wrapper around Starknet native staking.

**Files:**
- Create: `contracts/src/staking_adapter.cairo`
- Modify: `contracts/src/lib.cairo`

**Step 1: Create adapter**

- deploy() delegates STRK to staking pool
- withdraw() un-delegates and reclaims
- harvest() claims staking rewards
- value_of() reads delegated amount + pending rewards
- current_apy_bps() reads from staking contract or oracle
- is_healthy() returns true unless staking pool is offline

Reference existing: `backend/app/services/staking/native_staking.py` for the staking contract interface.

**Step 2: Register, build, commit**

```bash
git commit -m "feat: add StakingAdapter -- IStrategyAdapter wrapper for STRK staking"
```

---

## Phase 2: Backend Services

### Task 6: Constraint Hash Computation Service

Compute Poseidon constraint hashes from user policy settings.

**Files:**
- Create: `backend/app/services/constraint_hash_service.py`
- Create: `backend/tests/test_constraint_hash_service.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_constraint_hash_service.py
from backend.app.services.constraint_hash_service import compute_constraint_hash

def test_deterministic_hash():
    policy = {
        "max_position_wei": 1_000_000_000_000_000_000,
        "risk_tolerance": 50,
        "approved_adapters_mask": 0b111,
        "max_single_adapter_pct": 60,
        "cooldown_seconds": 43200,
        "session_duration_hours": 24,
    }
    h1 = compute_constraint_hash(policy)
    h2 = compute_constraint_hash(policy)
    assert h1 == h2
    assert isinstance(h1, int)
    assert h1 > 0

def test_different_policies_differ():
    p1 = {"max_position_wei": 1e18, "risk_tolerance": 30, "approved_adapters_mask": 0b111,
          "max_single_adapter_pct": 60, "cooldown_seconds": 43200, "session_duration_hours": 24}
    p2 = {**p1, "risk_tolerance": 70}
    assert compute_constraint_hash(p1) != compute_constraint_hash(p2)
```

**Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_constraint_hash_service.py -v`
Expected: ImportError

**Step 3: Write implementation**

```python
# backend/app/services/constraint_hash_service.py
"""
Compute Poseidon-style constraint hashes from user vault policy settings.
Maps UI "Vault Constitution" fields to a deterministic hash that gets
registered on the VaultController contract.
"""
import hashlib

def compute_constraint_hash(policy: dict) -> int:
    fields = [
        int(policy.get("max_position_wei", 0)),
        int(policy.get("risk_tolerance", 50)),
        int(policy.get("approved_adapters_mask", 0b111)),
        int(policy.get("max_single_adapter_pct", 60)),
        int(policy.get("cooldown_seconds", 43200)),
        int(policy.get("session_duration_hours", 24)),
    ]
    packed = b"".join(f.to_bytes(32, "big") for f in fields)
    digest = hashlib.sha256(packed).hexdigest()
    return int(digest, 16) % (2**251)  # felt252-safe
```

Note: For production, replace sha256 with actual Poseidon hash via starknet-py or poseidon-py. The interface and determinism are what matter now.

**Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_constraint_hash_service.py -v`
Expected: 2 passed

**Step 5: Commit**

```bash
git add backend/app/services/constraint_hash_service.py backend/tests/test_constraint_hash_service.py
git commit -m "feat: add constraint hash computation service for vault constitution"
```

---

### Task 7: Proposal Commit-Reveal Backend Service

Orchestrates the dark pool commit-reveal flow.

**Files:**
- Create: `backend/app/services/vault_proposal_service.py`
- Create: `backend/tests/test_vault_proposal_service.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_vault_proposal_service.py
import pytest
from backend.app.services.vault_proposal_service import VaultProposalService

@pytest.fixture
def svc():
    return VaultProposalService()

def test_create_proposal(svc):
    proposal = svc.create_proposal(
        adapters=["0xEKUBO", "0xLEND"],
        amounts=[500, 300],
        params=[[], []],
    )
    assert "proposal_hash" in proposal
    assert "salt" in proposal
    assert proposal["status"] == "committed"

def test_reveal_matches_commit(svc):
    p = svc.create_proposal(["0xA"], [100], [[]])
    verified = svc.verify_reveal(
        proposal_hash=p["proposal_hash"],
        adapters=["0xA"],
        amounts=[100],
        params=[[]],
        salt=p["salt"],
    )
    assert verified is True

def test_reveal_wrong_salt_fails(svc):
    p = svc.create_proposal(["0xA"], [100], [[]])
    verified = svc.verify_reveal(
        proposal_hash=p["proposal_hash"],
        adapters=["0xA"],
        amounts=[100],
        params=[[]],
        salt="wrong_salt",
    )
    assert verified is False
```

**Step 2: Run test, verify fail**

Run: `cd backend && python -m pytest tests/test_vault_proposal_service.py -v`

**Step 3: Implement**

```python
# backend/app/services/vault_proposal_service.py
"""
Dark pool proposal service -- commit-reveal for vault allocations.
Phase 1: AI generates proposal, service hashes it (commit).
Phase 2: Service reveals data on-chain, contract verifies hash match.
"""
import hashlib
import json
import secrets
from datetime import datetime

class VaultProposalService:
    def __init__(self):
        self._proposals = {}

    def create_proposal(self, adapters: list, amounts: list, params: list) -> dict:
        salt = secrets.token_hex(32)
        raw = json.dumps({"adapters": adapters, "amounts": amounts, "params": params, "salt": salt}, sort_keys=True)
        proposal_hash = hashlib.sha256(raw.encode()).hexdigest()
        record = {
            "proposal_hash": proposal_hash,
            "salt": salt,
            "adapters": adapters,
            "amounts": amounts,
            "params": params,
            "status": "committed",
            "created_at": datetime.utcnow().isoformat(),
        }
        self._proposals[proposal_hash] = record
        return record

    def verify_reveal(self, proposal_hash: str, adapters: list, amounts: list, params: list, salt: str) -> bool:
        raw = json.dumps({"adapters": adapters, "amounts": amounts, "params": params, "salt": salt}, sort_keys=True)
        computed = hashlib.sha256(raw.encode()).hexdigest()
        return computed == proposal_hash
```

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add backend/app/services/vault_proposal_service.py backend/tests/test_vault_proposal_service.py
git commit -m "feat: add vault proposal service -- dark pool commit-reveal orchestration"
```

---

### Task 8: Vault Proposal API Routes

Expose proposal service via REST.

**Files:**
- Create: `backend/app/api/routes/vault_proposals.py`
- Modify: `backend/app/main.py` (register router)

**Step 1: Create route file**

```python
# backend/app/api/routes/vault_proposals.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Any

router = APIRouter(prefix="/api/v1/zkdefi/vault/proposals", tags=["vault-proposals"])

from backend.app.services.vault_proposal_service import VaultProposalService
_svc = VaultProposalService()

class ProposalRequest(BaseModel):
    adapters: List[str]
    amounts: List[int]
    params: List[List[Any]] = []

class RevealRequest(BaseModel):
    proposal_hash: str
    adapters: List[str]
    amounts: List[int]
    params: List[List[Any]]
    salt: str

@router.post("/commit")
async def commit_proposal(req: ProposalRequest):
    proposal = _svc.create_proposal(req.adapters, req.amounts, req.params)
    return {"proposal_hash": proposal["proposal_hash"], "status": "committed"}

@router.post("/reveal/verify")
async def verify_reveal(req: RevealRequest):
    ok = _svc.verify_reveal(req.proposal_hash, req.adapters, req.amounts, req.params, req.salt)
    if not ok:
        raise HTTPException(400, "Reveal does not match commit")
    return {"verified": True}
```

**Step 2: Register in main.py**

Add import and `app.include_router(vault_proposals.router)` alongside existing router registrations.

**Step 3: Test manually**

Run: `curl -X POST http://localhost:8000/api/v1/zkdefi/vault/proposals/commit -H 'Content-Type: application/json' -d '{"adapters":["0xA"],"amounts":[100]}'`
Expected: 200 with proposal_hash

**Step 4: Commit**

```bash
git commit -m "feat: add vault proposal API routes -- commit and reveal endpoints"
```

---

### Task 9: Constraint Hash API Route

Expose constraint hash computation so frontend can register user policies.

**Files:**
- Modify: `backend/app/api/routes/vault_proposals.py` (add endpoint)

**Step 1: Add endpoint**

```python
class PolicyRequest(BaseModel):
    max_position_wei: int = 1_000_000_000_000_000_000
    risk_tolerance: int = 50
    approved_adapters_mask: int = 0b111
    max_single_adapter_pct: int = 60
    cooldown_seconds: int = 43200
    session_duration_hours: int = 24

@router.post("/constraint-hash")
async def compute_hash(req: PolicyRequest):
    from backend.app.services.constraint_hash_service import compute_constraint_hash
    h = compute_constraint_hash(req.dict())
    return {"constraint_hash": hex(h), "policy": req.dict()}
```

**Step 2: Test manually, commit**

```bash
git commit -m "feat: add constraint hash endpoint for vault constitution registration"
```

---

## Phase 3: Frontend UX

### Task 10: Vault Constitution Component

The trust anchor. Shows user policy in plain language, no hashes.

**Files:**
- Create: `frontend/src/components/zkdefi/vault/VaultConstitution.tsx`

**Step 1: Create component**

A card that displays:
- Risk Level gauge (visual, maps risk_tolerance 30/50/70 to Conservative/Balanced/Aggressive)
- Max per Strategy (percentage)
- Allowed Strategies (names, not addresses)
- Rebalance Cooldown (human-readable time)
- AI Boundaries statement: "AI suggests. Smart contracts enforce. Boundaries are user-defined."
- "Update Policy" button that opens editing mode
- Calls POST `/api/v1/zkdefi/vault/proposals/constraint-hash` to compute hash on save

UI language: "Your Vault Constitution" header. No mention of hashes, Merkle trees, or Poseidon. Visual gauge for risk bound (green/yellow/red zones).

**Step 2: Integrate into Profile**

Add VaultConstitution to the Profile trust tab, alongside existing risk passport and compliance cards. This is the trust anchor the user sees every time they check their profile.

**Step 3: Commit**

```bash
git commit -m "feat: add Vault Constitution component -- user-facing policy editor"
```

---

### Task 11: Capital Flow Visual

Show Wallet -> Shield -> Vault -> Strategies pipeline in DepositPanel and PositionsOverview.

**Files:**
- Create: `frontend/src/components/zkdefi/vault/CapitalFlowPipeline.tsx`
- Modify: `frontend/src/components/zkdefi/vault/PositionsOverview.tsx`

**Step 1: Create pipeline component**

A horizontal flow diagram:
- Four nodes: Wallet (wallet icon), Shield (shield icon), Vault (lock icon), Strategies (chart icon)
- Arrows between nodes
- Each node shows a balance: wallet balance, shielded balance, deployed balance, idle balance
- Active node highlighted based on where capital currently is
- Below the pipeline: "Your capital is aggregated with others. Individual allocations are not traceable."

Use Tailwind + lucide-react icons. No external charting libraries.

**Step 2: Integrate into PositionsOverview**

Replace or augment the existing "Capital Deployed" section with CapitalFlowPipeline at the top.

**Step 3: Commit**

```bash
git commit -m "feat: add capital flow pipeline visual -- Shield/Vault/Strategies metaphor"
```

---

### Task 12: Vault Health Meter

Persistent visual showing system health.

**Files:**
- Create: `frontend/src/components/zkdefi/vault/VaultHealthMeter.tsx`
- Modify: `frontend/src/components/zkdefi/vault/VaultSurface.tsx` (mount it)

**Step 1: Create health meter**

A compact row of indicators:
- Risk Bound Used: percentage gauge (colored green < 60%, yellow 60-80%, red > 80%)
- Allocation Distribution: mini horizontal stacked bar (Ekubo blue, Lending green, Staking purple, Idle gray)
- Adapter Health: per-adapter dot (green = healthy, yellow = degraded, red = circuit breaker)
- Cooldown Timer: countdown to next allowed rebalance

Data sources:
- `/api/v1/zkdefi/private-yield/vault/stats` for allocation percentages
- Adapter health: new endpoint or derive from existing pool data
- Cooldown: from VaultController state (when deployed) or backend config

**Step 2: Mount in VaultSurface below the tab bar**

**Step 3: Commit**

```bash
git commit -m "feat: add vault health meter -- risk gauge, allocation bar, adapter health"
```

---

### Task 13: AI Activity Log Enhancement

Plain-language activity entries for AI actions.

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/ActivityTab.tsx`
- Modify: `backend/app/api/routes/vault_activity.py` (add proposal events)

**Step 1: Backend -- add proposal events to activity feed**

When a proposal is committed or executed, write an activity event with plain-language description:

```python
{
    "type": "rebalance_committed",
    "message": "Rebalance pending... (protected from front-running)",
    "timestamp": "...",
}
{
    "type": "rebalance_executed",
    "message": "Rebalance executed. No trade intent was exposed.",
    "detail": "Risk Score: 0.42 (within your bound of 0.5). Reason: APY improved by 1.2%",
    "timestamp": "...",
}
```

**Step 2: Frontend -- render new event types**

In ActivityTab, add rendering for rebalance_committed and rebalance_executed events. Show verification badges: green checkmarks for "Verified by zkML", "Policy enforced", "Dark pool protected".

**Step 3: Commit**

```bash
git commit -m "feat: enhance activity log with plain-language AI rebalance events and verification badges"
```

---

### Task 14: Adapter Safety UI

First-party vs third-party separation, health badges.

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/YieldTab.tsx`

**Step 1: Update yield sources table**

Add to each strategy row:
- "Verified by Obsqra" badge for first-party adapters (Ekubo LP, Lending, Staking)
- Health indicator dot (green/yellow/red)
- Source label (first-party vs third-party)

Add toggle at bottom of strategies section: "Allow external adapters (advanced)" -- default off. When off, only show first-party adapters. When on, show all with clear third-party labeling.

**Step 2: Commit**

```bash
git commit -m "feat: add adapter safety UI -- verified badges, health indicators, third-party toggle"
```

---

### Task 15: Onboarding Constraint Registration

Wire constraint hash computation into the existing onboarding wizard.

**Files:**
- Modify: `frontend/src/components/zkdefi/OnboardingWizard.tsx`

**Step 1: Add vault policy step to onboarding**

After the existing risk disclosure step, add a "Vault Constitution" step that:
1. Shows the same VaultConstitution component (from Task 10) in edit mode
2. User sets risk level, max per strategy, allowed strategies, cooldown
3. On submit: calls `/api/v1/zkdefi/vault/proposals/constraint-hash` to compute hash
4. Stores policy in onboarding state alongside existing fact_hash and identity_commitment
5. When VaultController is deployed: the hash gets registered on-chain

UI language: "Set your vault rules. The AI will operate within these boundaries. You can change them anytime from your Profile."

**Step 2: Commit**

```bash
git commit -m "feat: integrate vault constitution into onboarding wizard"
```

---

### Task 16: IStrategyAdapter Documentation

Public-facing documentation for the composability interface.

**Files:**
- Create: `docs/STRATEGY_ADAPTER_INTERFACE.md`

**Step 1: Write the doc**

Cover:
1. What the interface is and why it exists (privacy + constraints + MEV protection for free)
2. The 6-function spec with parameter descriptions
3. How to implement an adapter (step by step)
4. How the VaultController calls adapters
5. Security requirements (only accept calls from VaultController, health monitoring)
6. Example: skeleton BtcYieldAdapter
7. How to get an adapter whitelisted

This is the document that makes the composability argument tangible. It should be readable by any Cairo developer who has never seen the codebase.

**Step 2: Link from README and HACKATHON_FEATURE_COVERAGE.md**

**Step 3: Commit**

```bash
git commit -m "docs: add IStrategyAdapter interface spec for third-party adapter developers"
```

---

### Task 17: Execution Authority Card

Shows who can move funds. Eliminates AI trust anxiety.

**Files:**
- Create: `frontend/src/components/zkdefi/vault/ExecutionAuthorityCard.tsx`
- Modify: `frontend/src/components/zkdefi/vault/VaultSurface.tsx` (mount it)
- Modify: Profile trust tab (mount it)

**Step 1: Create component**

A card with four rows:
- Session Key: Enabled (expires in Xd) / Disabled -- from `/api/v1/zkdefi/session_keys/list/{address}`
- Vault Controller: Active / Paused -- from vault state
- Admin Breaker: Multisig 3/5 (emergency-only) -- static for now
- Relayer: Enabled (shielded withdrawals) / Disabled -- from relayer state

**Step 2: Mount in VaultSurface and Profile trust tab**

**Step 3: Commit**

```bash
git commit -m "feat: add Execution Authority card -- shows who can move funds"
```

---

### Task 18: Proofs Pill (Header)

Collapsed verification status in vault header.

**Files:**
- Create: `frontend/src/components/zkdefi/vault/ProofsPill.tsx`
- Modify: `frontend/src/components/zkdefi/vault/VaultSurface.tsx`

**Step 1: Create component**

Default: green "Proofs OK" pill. On click/tap, expands to show:
- Policy enforced (check or X)
- Risk within bound (check or X)
- MEV protection active (check or X)

Data sources: derived from vault state and last execution receipt.

**Step 2: Mount in VaultSurface header row**

**Step 3: Commit**

```bash
git commit -m "feat: add Proofs pill -- three-check verification status in header"
```

---

### Task 19: Next Rebalance Strip

Shows rebalance status, reason, and countdown.

**Files:**
- Create: `frontend/src/components/zkdefi/vault/NextRebalanceStrip.tsx`
- Modify: `frontend/src/components/zkdefi/vault/VaultSurface.tsx`

**Step 1: Create component**

Horizontal strip showing:
- Status: Pending (MEV protected) | Cooldown (Xh remaining) | Ready
- Reason: APY +X% / Risk change / Adapter health
- Earliest: countdown timer

Data: from useVaultController hook (cooldown_remaining, pending_proposal, last reason).

**Step 2: Mount below allocation breakdown in VaultSurface**

**Step 3: Commit**

```bash
git commit -m "feat: add Next Rebalance strip -- status, reason, countdown"
```

---

### Task 20: Failure State Banners

Context-sensitive banners for incidents.

**Files:**
- Create: `frontend/src/components/zkdefi/vault/VaultBanner.tsx`
- Modify: `frontend/src/components/zkdefi/vault/VaultSurface.tsx`

**Step 1: Create banner component**

Takes vault_state and adapter states as props. Renders:
- Yellow: "Strategy health degraded -- rebalancing when cooldown ends"
- Red: "Emergency: capital returning to vault from [strategy]"
- Gray: "Rebalance blocked -- your constitution prevents the required move"
- Blue: "Rebalance pending... protected from front-running"
- null: no banner when everything is healthy

Mounted at the very top of VaultSurface, above tabs.

**Step 2: Commit**

```bash
git commit -m "feat: add failure state banners -- yellow/red/gray/blue incident messaging"
```

---

### Task 21: useVaultController and useAdapterRegistry Hooks

Data contract hooks that feed all new UI surfaces.

**Files:**
- Create: `frontend/src/hooks/useVaultController.ts`
- Create: `frontend/src/hooks/useAdapterRegistry.ts`

**Step 1: Create useVaultController**

Fetches vault state from backend (and later from on-chain):
- vault_state, cooldown_remaining_seconds, pending_proposal_exists, last_rebalance_ts
- Returns typed object consumed by ProofsPill, NextRebalanceStrip, VaultBanner, ExecutionAuthorityCard

**Step 2: Create useAdapterRegistry**

Fetches adapter list from backend:
- adapters[]: name, address, type, health, apy_bps, value, max_allocation_bps
- Consumed by YieldTab, VaultHealthMeter, adapter safety UI

**Step 3: Commit**

```bash
git commit -m "feat: add useVaultController and useAdapterRegistry data contract hooks"
```

---

## Task Dependency Graph

```
Phase 1 (Cairo):
  Task 1 (trait) --> Task 2 (VaultController) --> Tasks 3,4,5 (adapters, parallel)

Phase 2 (Backend):
  Task 6 (constraint hash) --> Task 9 (API)
  Task 7 (proposal service) --> Task 8 (API)
  (Phase 2 can run in parallel with Phase 1)

Phase 3 (Frontend):
  Task 21 (hooks) -- foundational, do first
  Task 10 (VaultConstitution) --> Task 15 (onboarding)
  Task 11 (capital flow) -- independent
  Task 12 (health meter) -- uses Task 21 hooks
  Task 13 (activity log) -- depends on Task 8
  Task 14 (adapter safety) -- uses Task 21 hooks
  Task 17 (execution authority) -- uses Task 21 hooks
  Task 18 (proofs pill) -- uses Task 21 hooks
  Task 19 (next rebalance) -- uses Task 21 hooks
  Task 20 (failure banners) -- uses Task 21 hooks
  Task 16 (docs) -- independent
```

Phase 1 and Phase 2 can run in parallel.
Phase 3 starts with Task 21 (hooks), then Tasks 10-20 can mostly run in parallel.
Task 15 depends on Task 10. Task 13 depends on Task 8.
