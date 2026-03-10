# Hackathon MVP Wrap — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all critical/high/medium gaps and consolidate UI into a single Capital OS surface so the hackathon demo shows real privacy-first DeFi — not mocks.

**Architecture:** Two parallel tracks. Track A (backend): make privacy infrastructure real, wire three privacy paths, harden. Track B (frontend): consolidate into Capital OS, fix stability, wire to real backend, polish. Tracks converge on days 6–7 for integration + demo prep.

**Tech Stack:** FastAPI (Python), Next.js 14 (TypeScript), Tailwind, starknet-py, snarkjs, SQLite, Starknet Sepolia.

**Design doc:** `docs/plans/2026-03-10-hackathon-mvp-wrap-design.md`

---

## Track A: Backend

### Task 1: Privacy vault — eliminate silent mock transactions

**Files:**
- Modify: `backend/app/services/privacy_vault_service.py:270-310`
- Modify: `backend/app/main.py` (health endpoint, ~line 545)

**Step 1: Make `_call_shielded_pool_deposit` raise instead of returning mock**

In `backend/app/services/privacy_vault_service.py`, find `_call_shielded_pool_deposit`:

```python
async def _call_shielded_pool_deposit(self, commitment: str, amount_wei: int) -> str:
    if not self.admin_account:
        raise RuntimeError(
            "Privacy vault admin not configured. "
            "Set FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS and "
            "FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY env vars."
        )
    # ... rest of real implementation stays
```

Remove the `return "0xmock_deposit_tx"` line.

**Step 2: Make `_call_shielded_pool_withdraw` raise instead of returning mock**

Same file, find `_call_shielded_pool_withdraw`. If it has a similar `if not self.admin_account: return "0xmock_withdraw_tx"` pattern, replace with the same `raise RuntimeError(...)`.

**Step 3: Verify health endpoint surfaces admin status**

In `backend/app/main.py`, confirm `/health` already returns `privacy_vault_admin_configured`. It does (line ~550). No change needed.

**Step 4: Test manually**

```bash
cd backend
# Without env vars set:
python -c "
import asyncio
from app.services.privacy_vault_service import PrivacyVaultService
svc = PrivacyVaultService()
try:
    asyncio.run(svc._call_shielded_pool_deposit('0x123', 1000))
    print('ERROR: should have raised')
except RuntimeError as e:
    print(f'OK: {e}')
"
```

Expected: `OK: Privacy vault admin not configured...`

**Step 5: Commit**

```bash
git add backend/app/services/privacy_vault_service.py
git commit -m "fix: privacy vault raises 503 instead of returning mock tx when admin not configured"
```

---

### Task 2: Tighten proof generation — no silent mock proofs in production

**Files:**
- Modify: `backend/app/services/stark_proof_generator.py:32-40,78-80,144-146,203-205,270-310`
- Modify: `backend/app/services/dao_voting_service.py:63,142-144`

**Step 1: STARKProofGenerator — flip default**

In `backend/app/services/stark_proof_generator.py`, change constructor:

```python
def __init__(self, use_mock: bool = False):
```

And in each method that checks `self.use_mock` (lines ~78, ~144, ~203), add an else branch:

```python
if self.use_mock:
    proof_hash = self._generate_mock_stark_proof(proof_input)
else:
    proof_hash = await self._generate_real_stark_proof(proof_input, constraints)
```

In `_generate_real_stark_proof`, change the fallback from silently returning mock to:

```python
async def _generate_real_stark_proof(self, proof_input: Dict, constraints: List[ProofConstraint]) -> str:
    import os
    if os.getenv("ALLOW_SIMULATED_PROOFS", "").lower() in ("true", "1"):
        logger.warning("Using simulated STARK proof (ALLOW_SIMULATED_PROOFS=true)")
        return self._generate_mock_stark_proof(proof_input)
    raise RuntimeError(
        "Real STARK prover not available and ALLOW_SIMULATED_PROOFS is not set. "
        "Set ALLOW_SIMULATED_PROOFS=true for development."
    )
```

**Step 2: DAO voting service — tighten mock fallback**

In `backend/app/services/dao_voting_service.py`, find the mock fallback (around line 142):

```python
except Exception as exc:
    import os
    if os.getenv("ALLOW_SIMULATED_PROOFS", "").lower() in ("true", "1"):
        logger.warning("Groth16 proof failed, falling back to mock: %s", exc)
        # ... existing mock fallback code
    else:
        raise RuntimeError(
            f"Groth16 proof generation failed and ALLOW_SIMULATED_PROOFS is not set: {exc}"
        ) from exc
```

**Step 3: Also update the main.py test entrypoint**

In `stark_proof_generator.py` at the bottom (~line 312), change:

```python
generator = STARKProofGenerator(use_mock=True)
```

to:

```python
generator = STARKProofGenerator(use_mock=os.getenv("ALLOW_SIMULATED_PROOFS", "").lower() in ("true", "1"))
```

**Step 4: Test**

```bash
cd backend
# Without ALLOW_SIMULATED_PROOFS:
python -c "
import asyncio, os
os.environ.pop('ALLOW_SIMULATED_PROOFS', None)
from app.services.stark_proof_generator import STARKProofGenerator
gen = STARKProofGenerator()
print(f'use_mock={gen.use_mock}')
# Should be False
"
```

Expected: `use_mock=False`

**Step 5: Commit**

```bash
git add backend/app/services/stark_proof_generator.py backend/app/services/dao_voting_service.py
git commit -m "fix: proof generators no longer silently return mock proofs in production"
```

---

### Task 3: Ekubo executor — replace mock returns with real LP calldata

**Files:**
- Modify: `backend/app/services/ekubo_executor.py:105-131`

**Step 1: Replace mock in `create_lp_position`**

The real LP calldata builder already exists at `backend/app/services/ekubo_lp_service.py:build_lp_add`. The executor should delegate to it instead of returning a mock hash.

In `ekubo_executor.py`, replace the mock block (lines ~105-131) with:

```python
try:
    from app.services.ekubo_lp_service import build_lp_add
    
    result = await build_lp_add(
        chain_id="SN_SEPOLIA",
        owner=self.owner_address or "0x0",
        token0=pair_data["token0"],
        token1=pair_data["token1"],
        amount0=int(amount0 * 10**18),
        amount1=int(amount1 * 10**18),
        fee_tier=int(pair_data.get("fee_tier", 170141183460469235273462165868118016)),
        lower_tick=lower_tick,
        upper_tick=upper_tick,
    )
    
    return {
        "success": True,
        "tx_hash": result.get("tx_hash"),
        "position_id": result.get("position_id"),
        "pair": pair,
        "amount0": amount0,
        "amount1": amount1,
        "calls": result.get("calls", []),
        "status": "pending",
    }
except Exception as e:
    logger.error(f"Position creation failed: {e}")
    return {"success": False, "error": str(e), "tx_hash": None}
```

**Step 2: Test that it calls build_lp_add**

```bash
cd backend
python -c "
import asyncio
from app.services.ekubo_executor import EkuboContractExecutor
exec = EkuboContractExecutor()
result = asyncio.run(exec.create_lp_position('ETH/USDC', 0.1, 250.0))
print(result.keys())
# Should have 'calls' key with real calldata, not mock hash
"
```

**Step 3: Commit**

```bash
git add backend/app/services/ekubo_executor.py
git commit -m "fix: ekubo executor delegates to real LP calldata builder instead of returning mock"
```

---

### Task 4: Credit line — label simulated execution honestly

**Files:**
- Modify: `backend/app/services/credit_line_service.py` (find `open_credit_line`, `borrow`, `repay`)

**Step 1: Add `execution` field to all responses**

In each method that returns a result dict (`open_credit_line`, `borrow`, `repay`), add:

```python
result["execution"] = "simulated"
result["execution_note"] = "Credit line contracts not deployed on Sepolia — ledger-only"
```

**Step 2: Commit**

```bash
git add backend/app/services/credit_line_service.py
git commit -m "fix: credit line responses honestly label execution as simulated"
```

---

### Task 5: Wire deposit → pool → adapter orchestration path

**Files:**
- Modify: `backend/app/services/privacy_ekubo_orchestrator.py`
- Modify: `backend/app/services/local_orchestrator.py:534`

**Step 1: Read `privacy_ekubo_orchestrator.py` and `local_orchestrator.py` to understand current mock positions**

Check what `local_orchestrator.py:534` returns for "daily positions (mock for now)" and replace with a read from the double-entry ledger or note store.

```python
# Replace mock positions with real ledger query
from app.services.double_entry_ledger import get_ledger
ledger = get_ledger()
positions = ledger.get_balances_for_account(f"VAULT_AVAILABLE:{vault_id}:*")
```

**Step 2: In `privacy_ekubo_orchestrator`, ensure `execute_strategy_impl` uses real pool data**

The orchestrator already imports `fetch_pool_metrics` and `score_risk`. Ensure these read from `real_pool_aggregator` (Ekubo API), not the mock `pool_aggregator`.

**Step 3: Test the orchestration endpoint**

```bash
curl -s http://localhost:8003/api/v1/zkdefi/orchestration/deploy \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"strategy": "balanced", "amount_wei": 1000000}' | python -m json.tool
```

Verify response has real pool IDs from Ekubo, not mock pool_ids.

**Step 4: Commit**

```bash
git add backend/app/services/privacy_ekubo_orchestrator.py backend/app/services/local_orchestrator.py
git commit -m "feat: orchestration reads real positions from ledger and real pools from Ekubo API"
```

---

### Task 6: DAO voting — wire voting power to real position stores

**Files:**
- Modify: `backend/app/api/routes/dao_governance.py` (find `_compute_capital_breakdown`)

**Step 1: Ensure `_compute_capital_breakdown` reads from persisted stores**

Check what it currently reads. If it queries empty stores and returns 0, wire it to:
- LP positions: from `ekubo_lp_service` positions store or `real_pool_aggregator`
- Lending: from `double_entry_ledger` VAULT_AVAILABLE balances
- Staking: from staking service positions

The key is that these stores must be the same ones written to by deposit/execute flows.

**Step 2: Test**

```bash
curl -s http://localhost:8003/api/v1/dao/voting_power?address=0x123 | python -m json.tool
```

Should return `voting_power` based on actual positions, not hardcoded.

**Step 3: Commit**

```bash
git add backend/app/api/routes/dao_governance.py
git commit -m "feat: DAO voting power computed from real position stores"
```

---

### Task 7: Selective disclosure — wire attestation → proof → verify

**Files:**
- Modify: `backend/app/services/compliance_service.py`
- Modify: `backend/app/api/portable_identity.py` or equivalent

**Step 1: Ensure compliance proof methods respect ALLOW_SIMULATED_PROOFS**

Already gated per `MOCK_PROOFS_REMOVED.md`. Verify each of the 4 methods raises when flag is unset and circuits aren't available.

**Step 2: Wire portable_identity to return attestations backed by real reputation/credit data**

Ensure `GET /api/v1/zkdefi/portable-identity/attestations/{address}` calls `get_user_reputation` and `compute_credit_line` to populate attestation fields with real computed values, not placeholders.

**Step 3: Test**

```bash
curl -s http://localhost:8003/api/v1/zkdefi/portable-identity/attestations/0x123 | python -m json.tool
```

Should return attestations with real reputation tier and credit line values.

**Step 4: Commit**

```bash
git add backend/app/services/compliance_service.py backend/app/api/portable_identity.py
git commit -m "feat: selective disclosure attestations backed by real reputation and credit data"
```

---

### Task 8: Reputation feedback loop — tier downgrade on default

**Files:**
- Modify: `backend/app/api/reputation.py` (find `record_transaction_internal` and `compute_reputation_score`)

**Step 1: Add tier downgrade logic**

In `record_transaction_internal`, after updating counters, add:

```python
ratio = user_data["successful_txns"] / max(user_data["transaction_count"], 1)
current_tier = user_data.get("tier", 1)

if ratio < 0.9 and current_tier > 1:
    user_data["tier"] = current_tier - 1
    logger.info(f"Tier downgrade for {address}: {current_tier} -> {current_tier - 1} (ratio={ratio:.2f})")
```

**Step 2: Add tier upgrade when eligible**

After the ratio check, add:

```python
if user_data.get("upgrade_eligible") and ratio >= 0.95:
    max_tier = max(t for t in TIER_INFO.keys())
    if current_tier < max_tier:
        user_data["tier"] = current_tier + 1
        user_data["upgrade_eligible"] = False
        logger.info(f"Tier upgrade for {address}: {current_tier} -> {current_tier + 1}")
```

**Step 3: Persist**

Ensure `_persist_user(address, user_data)` is called after these changes (it should already be).

**Step 4: Test**

```bash
cd backend
python -c "
from app.api.reputation import record_transaction_internal, get_user_data
# Simulate a default
record_transaction_internal('0xtest', success=False, volume=100)
data = get_user_data('0xtest')
print(f'tier={data.get(\"tier\")}, ratio={data[\"successful_txns\"]}/{data[\"transaction_count\"]}')
"
```

**Step 5: Commit**

```bash
git add backend/app/api/reputation.py
git commit -m "feat: reputation tier downgrades on default, upgrades when eligible"
```

---

### Task 9: Lending terms — computed, not hardcoded

**Files:**
- Modify: `backend/app/api/routes/credit_lines.py` or wherever fixed `ltv=0.5, rate=0.08` is returned

**Step 1: Find hardcoded terms**

```bash
cd backend
rg "ltv.*0\.5|rate.*0\.08" app/ --type py
```

**Step 2: Replace with `compute_credit_line` call**

Any endpoint returning fixed terms should instead call:

```python
from app.services.credit_line_service import compute_credit_line
terms = compute_credit_line(address, reputation_data, collateral_data)
```

**Step 3: Commit**

```bash
git add backend/app/api/routes/credit_lines.py
git commit -m "fix: lending terms computed from credit_line_service, not hardcoded"
```

---

### Task 10: Input validation on all POST endpoints

**Files:**
- Modify: key route files in `backend/app/api/routes/` — `full_privacy.py`, `collateral.py`, `credit_lines.py`, `privacy_vault.py`

**Step 1: Add Pydantic validators to deposit/withdraw request models**

Example for deposit:

```python
from pydantic import BaseModel, Field, field_validator

class DepositRequest(BaseModel):
    amount_wei: int = Field(gt=0)
    address: str = Field(min_length=3)
    commitment: str = Field(min_length=3)
    
    @field_validator("address")
    @classmethod
    def validate_hex(cls, v: str) -> str:
        if not v.startswith("0x"):
            raise ValueError("Address must start with 0x")
        return v
```

Apply similar validators to withdraw, borrow, vote endpoints.

**Step 2: Test with invalid input**

```bash
curl -s http://localhost:8003/api/v1/zkdefi/full_privacy/deposit/generate_commitment \
  -X POST -H "Content-Type: application/json" \
  -d '{"amount_wei": -1, "address": "bad"}' | python -m json.tool
```

Expected: 422 with field-level errors.

**Step 3: Commit**

```bash
git add backend/app/api/routes/
git commit -m "fix: add Pydantic input validation to deposit, withdraw, borrow, vote endpoints"
```

---

### Task 11: Rate limiting on sensitive POST routes

**Files:**
- Modify: `backend/app/middleware/rate_limiter.py`
- Modify: key route files to add decorators or path config

**Step 1: Extend existing `RateLimitMiddleware`**

Add path-based limits:

```python
RATE_LIMITS = {
    "/api/v1/zkdefi/full_privacy/deposit": (10, 60),     # 10/min
    "/api/v1/zkdefi/full_privacy/withdraw": (10, 60),
    "/api/v1/dao/proposals/": (5, 60),                    # 5/min for voting
    "/api/v1/zkdefi/proofs": (5, 60),                     # expensive
}
```

**Step 2: Commit**

```bash
git add backend/app/middleware/rate_limiter.py
git commit -m "feat: rate limiting on privacy vault, voting, and proof generation endpoints"
```

---

### Task 12: Proof verification — replace `return True` stub

**Files:**
- Modify: `backend/app/api/routes/batch_verification.py:60`

**Step 1: Replace stub**

```python
def verify_proof(proof: str, vkey: str = None) -> bool:
    if not proof or proof == "0x0":
        return False
    try:
        from app.services.groth16_prover import verify_groth16_proof
        return verify_groth16_proof(proof, vkey)
    except ImportError:
        import os
        if os.getenv("ALLOW_SIMULATED_PROOFS", "").lower() in ("true", "1"):
            return len(proof) >= 10 and proof.startswith("0x")
        return False
```

**Step 2: Commit**

```bash
git add backend/app/api/routes/batch_verification.py
git commit -m "fix: proof verification calls real verifier instead of returning True"
```

---

### Task 13: Pagination on list endpoints

**Files:**
- Modify: `backend/app/api/routes/dao_governance.py` (proposals list)
- Modify: `backend/app/api/routes/credit_lines.py` (credit lines list)
- Modify: `backend/app/api/routes/trade_desk_v2.py` (opportunities — already has limit)

**Step 1: Add limit/offset parameters**

For each list endpoint, add:

```python
@router.get("/proposals")
async def list_proposals(limit: int = 20, offset: int = 0, status: str = None):
    # ... existing query logic
    items = results[offset:offset + min(limit, 100)]
    return {"items": items, "total": len(results), "next_offset": offset + len(items)}
```

**Step 2: Commit**

```bash
git add backend/app/api/routes/dao_governance.py backend/app/api/routes/credit_lines.py
git commit -m "feat: pagination (limit/offset) on proposals and credit lines list endpoints"
```

---

### Task 14: Single source of truth for positions

**Files:**
- Modify: `backend/app/services/collateral_service.py`
- Modify: `backend/app/api/routes/dao_governance.py`
- Modify: `backend/app/api/routes/vault.py` or `vault_v2.py`

**Step 1: Identify the canonical position store**

The double-entry ledger (`double_entry_ledger.py`) and note store (`note_store.py`) are the canonical stores for vault balances. Collateral, DAO, and vault status should all read from these.

**Step 2: Wire `get_user_positions` in collateral to read from ledger**

```python
from app.services.double_entry_ledger import get_ledger
ledger = get_ledger()
balances = ledger.get_balances_for_vault(vault_id)
```

**Step 3: Wire vault/status to return real allocations from the same source**

**Step 4: Test coherence**

Deposit → check collateral positions → check vault status → check DAO voting power. All should reflect the deposit.

**Step 5: Commit**

```bash
git add backend/app/services/collateral_service.py backend/app/api/routes/dao_governance.py backend/app/api/routes/vault_v2.py
git commit -m "feat: collateral, DAO, and vault all read from canonical ledger + note store"
```

---

## Track B: Frontend

### Task 15: Standalone pages → Capital OS mode redirects

**Files:**
- Modify: `frontend/src/app/vault/page.tsx`
- Modify: `frontend/src/app/trade/page.tsx`
- Modify: `frontend/src/app/oracle/page.tsx`
- Modify: `frontend/src/app/lending/page.tsx`
- Modify: `frontend/src/app/marketplace/page.tsx`

**Step 1: Make each page a redirect**

`/vault` and `/trade` already redirect. Do the same for oracle, lending, marketplace:

```typescript
// frontend/src/app/oracle/page.tsx
import { redirect } from "next/navigation";
export default function OraclePage() {
  redirect("/agent?v=oracle");
}
```

```typescript
// frontend/src/app/lending/page.tsx
import { redirect } from "next/navigation";
export default function LendingPage() {
  redirect("/agent?v=lending");
}
```

```typescript
// frontend/src/app/marketplace/page.tsx
import { redirect } from "next/navigation";
export default function MarketplacePage() {
  redirect("/agent?v=marketplace");
}
```

**Step 2: Commit**

```bash
git add frontend/src/app/oracle/page.tsx frontend/src/app/lending/page.tsx frontend/src/app/marketplace/page.tsx
git commit -m "feat: oracle, lending, marketplace pages redirect to Capital OS modes"
```

---

### Task 16: Extend VaultCenterStage with oracle, lending, marketplace, trade modes

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/VaultCenterStage.tsx:71-77`
- Modify: `frontend/src/lib/agentState.ts` (VaultTab type)

**Step 1: Extend VaultTab type**

In `frontend/src/lib/agentState.ts`, find the `VaultTab` type and add:

```typescript
export type VaultTab = "overview" | "pools" | "ekubo" | "lending" | "activity" | "oracle" | "trade" | "marketplace";
```

**Step 2: Add tabs to VaultCenterStage**

In `VaultCenterStage.tsx`, extend the TABS array:

```typescript
import { Radio, Store } from "lucide-react";
// Add to existing imports if not present

const TABS: Array<{ id: VaultTab; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { id: "pools", label: "Pools", icon: <Droplets className="w-3.5 h-3.5" /> },
  { id: "trade", label: "Trade", icon: <LineChart className="w-3.5 h-3.5" /> },
  { id: "ekubo", label: "Ekubo LP", icon: <CreditCard className="w-3.5 h-3.5" /> },
  { id: "lending", label: "Lending", icon: <Landmark className="w-3.5 h-3.5" /> },
  { id: "oracle", label: "Oracle", icon: <Radio className="w-3.5 h-3.5" /> },
  { id: "marketplace", label: "Marketplace", icon: <Store className="w-3.5 h-3.5" /> },
  { id: "activity", label: "Activity", icon: <Activity className="w-3.5 h-3.5" /> },
];
```

**Step 3: Add tab content for new modes**

In the tab content section, add:

```typescript
{tab === "trade" && (
  <ErrorBoundary>
    <TradeDesk address={address} />
  </ErrorBoundary>
)}
{tab === "oracle" && (
  <ErrorBoundary>
    <OracleSurfaceContainer address={address} />
  </ErrorBoundary>
)}
{tab === "marketplace" && (
  <ErrorBoundary>
    <MarketplaceConsole address={address} />
  </ErrorBoundary>
)}
```

Import these components at the top.

**Step 4: Wire `?v=` param in agent page**

In `frontend/src/app/agent/page.tsx`, map `?v=` query param to `initialVaultTab`:

```typescript
const vParam = searchParams.get("v");
const initialVaultTab = (vParam as VaultTab) || "overview";
```

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/VaultCenterStage.tsx frontend/src/lib/agentState.ts frontend/src/app/agent/page.tsx
git commit -m "feat: Capital OS center stage includes trade, oracle, marketplace, lending as tabs"
```

---

### Task 17: Unified nav inside Capital OS

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/HeaderStrip.tsx`

**Step 1: Add nav links to HeaderStrip**

Add mode-switch buttons that change the vault tab:

```typescript
const NAV_ITEMS: Array<{ id: VaultTab; label: string }> = [
  { id: "overview", label: "Dashboard" },
  { id: "trade", label: "Trade" },
  { id: "pools", label: "Vault" },
  { id: "oracle", label: "Oracle" },
  { id: "lending", label: "Lending" },
  { id: "marketplace", label: "Marketplace" },
];
```

Render these as pill buttons in the header, calling `onOverlayChange` or a new `onModeChange` callback.

**Step 2: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/HeaderStrip.tsx
git commit -m "feat: unified nav in Capital OS header — mode switches for all surfaces"
```

---

### Task 18: Privacy pools as primary vault view

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/VaultCenterStage.tsx`
- Modify: `frontend/src/components/zkdefi/mission-control/DeployOverlay.tsx`

**Step 1: Move PrivacyPoolsPanel into vault "pools" tab**

In VaultCenterStage, the "pools" tab currently renders `PoolIntelligencePanel`. Change it to render `PrivacyPoolsPanel` as the primary view with `PoolIntelligencePanel` below it:

```typescript
{tab === "pools" && (
  <ErrorBoundary>
    <div className="space-y-4 p-4">
      <PrivacyPoolsPanel address={address} />
      <PoolIntelligencePanel address={address} onDeposit={() => onDeposit?.()} embedded />
    </div>
  </ErrorBoundary>
)}
```

**Step 2: Simplify DeployOverlay**

Remove the "Vault Rails (Advanced)" tab from DeployOverlay since privacy pools now live in the main vault view. Keep Trade Desk as the Deploy overlay content.

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/mission-control/VaultCenterStage.tsx frontend/src/components/zkdefi/mission-control/DeployOverlay.tsx
git commit -m "feat: privacy pools are primary vault view, not buried in Deploy overlay"
```

---

### Task 19: Fix PrivacyPoolsPanel stability

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/PrivacyPoolsPanel.tsx` (or wherever it lives — may be in `surfaces/` or `vault/`)

**Step 1: Find the file**

```bash
rg "PrivacyPoolsPanel" frontend/src --type tsx -l
```

**Step 2: Fix useCallback dependency bug**

Find the `useCallback` for `load` that depends on `rows`. Change to functional update:

```typescript
const load = useCallback(async () => {
  try {
    // ... fetch data
    setRows(prev => newData); // functional update, no rows dependency
  } catch (err) {
    setError(String(err));
  }
}, [address]); // remove rows from deps
```

**Step 3: Wrap in error boundary (already done in VaultCenterStage from Task 18)**

**Step 4: Handle API errors per pool**

```typescript
const results = await Promise.allSettled([
  fetchPoolStats("conservative"),
  fetchPoolStats("moderate"),
  fetchPoolStats("aggressive"),
]);
// Map fulfilled/rejected individually instead of Promise.all
```

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/
git commit -m "fix: PrivacyPoolsPanel stability — dependency bug, per-pool error handling"
```

---

### Task 20: Unify API client usage across all components

**Files:**
- Modify: 12+ components listed in design doc Section D5

**Step 1: For each component, replace local API_BASE with import**

Pattern: remove local `const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api"` and add `import { API_BASE } from "@/lib/api/client"` (or use `apiFetch`).

Components to update:
- `ShieldedPoolPanel.tsx`
- `CompliancePanel.tsx`
- `OnboardingWizard.tsx`
- `ProtocolPanel.tsx`
- `PrivateTransferPanel.tsx`
- `DexPanel.tsx`
- `PositionChart.tsx`
- `AgentRebalancer.tsx`
- `SessionKeyManager.tsx`
- `AllocationPools.tsx`
- `DeployToEkuboCard.tsx`
- `FullPrivacyPoolPanel.tsx`

**Step 2: Verify build**

```bash
cd frontend && npm run build
```

**Step 3: Commit**

```bash
git add frontend/src/components/
git commit -m "refactor: unify all components to use shared API_BASE from lib/api/client"
```

---

### Task 21: Loading states + component error boundaries

**Files:**
- Modify: `frontend/src/components/zkdefi/mission-control/VaultCenterStage.tsx`
- Create: `frontend/src/components/ui/Skeleton.tsx` (if not exists)

**Step 1: Create a skeleton component if needed**

```typescript
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-zinc-800/60 ${className}`} />
  );
}
```

**Step 2: Add skeletons to each tab in VaultCenterStage**

Wrap each tab's content in a Suspense-like loading state. Since these are client components, use a loading state from each component's internal fetch.

**Step 3: Error boundaries already added in Task 18 — verify they're on every tab.**

**Step 4: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: skeleton loaders and error boundaries on all Capital OS tabs"
```

---

### Task 22: Wire frontend privacy flows to real backend

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/DepositPanel.tsx`
- Modify: `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx`
- Modify: `frontend/src/components/zkdefi/mission-control/GovernanceOverlay.tsx`
- Modify: `frontend/src/components/zkdefi/CompliancePanel.tsx`

**Step 1: DepositPanel — show proof status**

After calling `/full_privacy/deposit/generate_commitment`, show the proof hash returned by the backend. After `/register_commitment`, show the tx hash. Replace any `toastSuccess("done")` with actual status display.

**Step 2: GovernanceOverlay — show proof generation status for votes**

When submitting a vote, show "Generating ZK proof..." → "Proof verified" → "Vote submitted" with the real proof hash.

**Step 3: CompliancePanel — show proof lifecycle**

After generating a selective disclosure proof, show the proof hash and "Verified" status.

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/
git commit -m "feat: frontend shows real proof status and tx hashes from backend"
```

---

### Task 23: Dead code cleanup

**Files:**
- Potentially delete: old TradeDesk V1 components

**Step 1: Grep for unused imports**

```bash
cd frontend
rg "AdvisoryMode|ExecutionPanel|CreditLinePanel" src/ --type tsx -l
```

If no imports found, these are dead. Move to archive or delete.

**Step 2: Commit**

```bash
git add -A frontend/src/
git commit -m "chore: remove dead TradeDesk V1 components"
```

---

## Integration (Days 6–7)

### Task 24: Backend test suite

**Step 1: Run existing tests**

```bash
cd backend
python -m pytest tests/ -v --timeout=30 2>&1 | head -60
```

**Step 2: Fix any failures from Tasks 1–14**

**Step 3: Commit fixes**

```bash
git add backend/
git commit -m "fix: test suite passes after privacy infrastructure changes"
```

---

### Task 25: Frontend build + test

**Step 1: Build**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

**Step 2: Run vitest**

```bash
cd frontend && npx vitest run 2>&1 | tail -30
```

**Step 3: Fix failures from Tasks 15–23**

**Step 4: Commit**

```bash
git add frontend/
git commit -m "fix: frontend builds and tests pass after Capital OS consolidation"
```

---

### Task 26: Demo walkthrough + polish

**Step 1: Start backend and frontend**

```bash
cd backend && uvicorn app.main:app --port 8003 --reload &
cd frontend && npm run dev &
```

**Step 2: Walk demo script**

Open browser, follow `docs/DEMO_SCRIPT_3MIN.md` beat by beat. Note anything that:
- Shows mock/placeholder data
- Crashes or hangs
- Looks wrong (wrong labels, broken layout)
- Console errors

**Step 3: Fix each issue**

**Step 4: Update demo script if needed**

If labels or flows changed, update `docs/DEMO_SCRIPT_3MIN.md`.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: hackathon MVP complete — real privacy paths, consolidated Capital OS, polished demo"
```

---

### Task 27: Favicon + meta

**Files:**
- Add: `frontend/public/favicon.ico` (if missing)
- Modify: `frontend/src/app/layout.tsx` (verify title/description)

**Step 1: Check if favicon exists**

```bash
ls frontend/public/favicon*
```

If missing, add one (Obsqra brand).

**Step 2: Verify meta in layout.tsx**

Already has correct title: "zkde.fi by Obsqra Labs | zkDE + GATE". Keep it.

**Step 3: Commit**

```bash
git add frontend/public/ frontend/src/app/layout.tsx
git commit -m "fix: favicon and meta tags for production"
```

---

## Summary

| Task | Track | Section | What |
|------|-------|---------|------|
| 1 | A | A1 | Privacy vault — no silent mock tx |
| 2 | A | A2 | Proof gen — no silent mocks |
| 3 | A | A3 | Ekubo executor — real calldata |
| 4 | A | A3 | Credit line — label simulated |
| 5 | A | B1 | Orchestration — real positions + pools |
| 6 | A | B2 | DAO voting power — real stores |
| 7 | A | B3 | Selective disclosure — real attestations |
| 8 | A | B4 | Reputation — tier downgrade/upgrade |
| 9 | A | B4 | Lending terms — computed |
| 10 | A | C1 | Input validation |
| 11 | A | C2 | Rate limiting |
| 12 | A | C3 | Proof verification |
| 13 | A | C4 | Pagination |
| 14 | A | C5 | Single source of truth |
| 15 | B | D1 | Standalone → redirect |
| 16 | B | D1 | VaultCenterStage — new modes |
| 17 | B | D2 | Unified nav |
| 18 | B | D3 | Privacy pools primary view |
| 19 | B | D4 | PrivacyPoolsPanel stability |
| 20 | B | D5 | Unify API client |
| 21 | B | E2 | Loading states + error boundaries |
| 22 | B | E1 | Wire privacy flows to real backend |
| 23 | B | E3 | Dead code cleanup |
| 24 | — | F1 | Backend test suite |
| 25 | — | F1 | Frontend build + test |
| 26 | — | F3-F4 | Demo walkthrough + polish |
| 27 | — | F4 | Favicon + meta |
