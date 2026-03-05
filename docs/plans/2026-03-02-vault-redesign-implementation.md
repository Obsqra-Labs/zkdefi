# Vault Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 6-tab, 5-panel Vault surface with a unified 3-tab Privacy-First Vault: deposit/withdraw side-by-side, 4 programmatic privacy tiers, one commitment store.

**Architecture:** One `VaultSurface` shell with 3 tabs (Vault, Yield, Activity). The Vault tab centers on a tier selector + side-by-side deposit/withdraw panels that adapt their proof pipelines per privacy method. A shared `usePrivacyVault` hook manages tier state, unified commitment storage, and proof generation. Backend adds one aggregation endpoint for the Activity feed.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, lucide-react icons, existing backend FastAPI endpoints + 1 new route.

**Design doc:** `docs/plans/2026-03-02-vault-redesign-design.md`

---

### Task 1: Create `usePrivacyVault` hook

**Files:**
- Create: `frontend/src/hooks/usePrivacyVault.ts`

**Step 1: Create the hook**

This hook manages all shared Vault state. It replaces the scattered `useState` calls in `VaultSurfaceContainer` and the 3 separate localStorage keys.

```typescript
import { useState, useCallback, useEffect } from "react";

export type PrivacyMethod = "commitment_shield" | "nullifier_set" | "hashed_proof" | "dark_ledger";

export interface VaultCommitment {
  id: string;
  method: PrivacyMethod;
  asset: "STRK" | "ETH";
  amount_wei: string;
  commitment_hash: string;
  nullifier?: string;
  secret?: string;
  merkle_index?: number;
  pool_variant?: string;
  deposited_at: string;
  yield_accrued?: string;
}

export type ProofStep = {
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
};

interface UsePrivacyVaultReturn {
  method: PrivacyMethod;
  setMethod: (m: PrivacyMethod) => void;
  commitments: VaultCommitment[];
  addCommitment: (c: VaultCommitment) => void;
  removeCommitment: (id: string) => void;
  depositSteps: ProofStep[];
  withdrawSteps: ProofStep[];
  setDepositSteps: (steps: ProofStep[]) => void;
  setWithdrawSteps: (steps: ProofStep[]) => void;
  migrateOldStorage: () => number;
}

const STORAGE_KEY = (addr: string) => `zkdefi_vault_${addr}`;

const OLD_KEYS = (addr: string) => [
  { key: `zkdefi_commitments_${addr}`, method: "commitment_shield" as PrivacyMethod },
  { key: `zkdefi_shielded_${addr}`, method: "commitment_shield" as PrivacyMethod },
  { key: `zkdefi_fullprivacy_${addr}`, method: "nullifier_set" as PrivacyMethod },
  { key: `zkdefi_poold_${addr}`, method: "hashed_proof" as PrivacyMethod },
];

function loadCommitments(address: string): VaultCommitment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY(address));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCommitments(address: string, cs: VaultCommitment[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY(address), JSON.stringify(cs));
}

function getDepositStepsForMethod(method: PrivacyMethod): ProofStep[] {
  switch (method) {
    case "commitment_shield":
      return [
        { label: "Generate Pedersen commitment", status: "pending" },
        { label: "Approve & sign deposit", status: "pending" },
        { label: "Confirm", status: "pending" },
      ];
    case "nullifier_set":
      return [
        { label: "Generate secret & commitment", status: "pending" },
        { label: "Register in Merkle tree", status: "pending" },
        { label: "Build Groth16 proof", status: "pending" },
        { label: "Approve & sign deposit", status: "pending" },
      ];
    case "hashed_proof":
      return [
        { label: "Generate hash inputs", status: "pending" },
        { label: "Build hash proof", status: "pending" },
        { label: "Register claim", status: "pending" },
        { label: "Approve & sign", status: "pending" },
      ];
    case "dark_ledger":
      return [
        { label: "Verify transaction on-chain", status: "pending" },
        { label: "Credit ledger", status: "pending" },
      ];
  }
}

function getWithdrawStepsForMethod(method: PrivacyMethod): ProofStep[] {
  switch (method) {
    case "commitment_shield":
      return [
        { label: "Verify commitment", status: "pending" },
        { label: "Generate withdraw proof", status: "pending" },
        { label: "Sign transaction", status: "pending" },
      ];
    case "nullifier_set":
      return [
        { label: "Verify commitment", status: "pending" },
        { label: "Generate nullifier", status: "pending" },
        { label: "Build withdraw proof", status: "pending" },
        { label: "Sign transaction", status: "pending" },
      ];
    case "hashed_proof":
      return [
        { label: "Verify commitment", status: "pending" },
        { label: "Build hash proof", status: "pending" },
        { label: "Sign transaction", status: "pending" },
      ];
    case "dark_ledger":
      return [
        { label: "Queue transfer out", status: "pending" },
        { label: "Confirm", status: "pending" },
      ];
  }
}

export function usePrivacyVault(address?: string): UsePrivacyVaultReturn {
  const [method, setMethod] = useState<PrivacyMethod>("commitment_shield");
  const [commitments, setCommitments] = useState<VaultCommitment[]>([]);
  const [depositSteps, setDepositSteps] = useState<ProofStep[]>(getDepositStepsForMethod("commitment_shield"));
  const [withdrawSteps, setWithdrawSteps] = useState<ProofStep[]>(getWithdrawStepsForMethod("commitment_shield"));

  useEffect(() => {
    if (address) setCommitments(loadCommitments(address));
  }, [address]);

  useEffect(() => {
    setDepositSteps(getDepositStepsForMethod(method));
    setWithdrawSteps(getWithdrawStepsForMethod(method));
  }, [method]);

  const addCommitment = useCallback((c: VaultCommitment) => {
    if (!address) return;
    setCommitments(prev => {
      const next = [...prev, c];
      saveCommitments(address, next);
      return next;
    });
  }, [address]);

  const removeCommitment = useCallback((id: string) => {
    if (!address) return;
    setCommitments(prev => {
      const next = prev.filter(c => c.id !== id);
      saveCommitments(address, next);
      return next;
    });
  }, [address]);

  const migrateOldStorage = useCallback((): number => {
    if (!address || typeof window === "undefined") return 0;
    const existing = loadCommitments(address);
    let migrated = 0;
    for (const { key, method: m } of OLD_KEYS(address)) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const items = JSON.parse(raw);
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const already = existing.some(e => e.commitment_hash === (item.commitment || item.commitment_hash));
          if (already) continue;
          existing.push({
            id: crypto.randomUUID(),
            method: m,
            asset: item.asset || "STRK",
            amount_wei: item.amount_wei || item.amount || "0",
            commitment_hash: item.commitment || item.commitment_hash || "",
            nullifier: item.nullifier,
            secret: item.secret,
            merkle_index: item.merkle_index ?? item.leafIndex,
            pool_variant: item.pool_variant || item.pool,
            deposited_at: item.deposited_at || item.timestamp || new Date().toISOString(),
          });
          migrated++;
        }
        localStorage.removeItem(key);
      } catch { /* skip corrupt keys */ }
    }
    if (migrated > 0) saveCommitments(address, existing);
    setCommitments(existing);
    return migrated;
  }, [address]);

  return {
    method, setMethod,
    commitments, addCommitment, removeCommitment,
    depositSteps, withdrawSteps, setDepositSteps, setWithdrawSteps,
    migrateOldStorage,
  };
}

export { getDepositStepsForMethod, getWithdrawStepsForMethod };
```

**Step 2: Verify no lint errors**

Run: `cd frontend && npx tsc --noEmit src/hooks/usePrivacyVault.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/hooks/usePrivacyVault.ts
git commit -m "feat(vault): add usePrivacyVault hook with unified commitment storage and tier-adaptive proof steps"
```

---

### Task 2: Create `TierSelector` component

**Files:**
- Create: `frontend/src/components/zkdefi/vault/TierSelector.tsx`

**Step 1: Create the component**

4 cards in a row, each showing privacy method name, description, strength indicator, tooltip, and active commitment count.

```typescript
"use client";
import { useState } from "react";
import { Shield, TreePine, Hash, BookLock, Info } from "lucide-react";
import type { PrivacyMethod, VaultCommitment } from "@/hooks/usePrivacyVault";

interface TierSelectorProps {
  selected: PrivacyMethod;
  onSelect: (method: PrivacyMethod) => void;
  commitments: VaultCommitment[];
}

const TIERS: {
  method: PrivacyMethod;
  label: string;
  description: string;
  icon: typeof Shield;
  strength: number;
  tooltip: string;
}[] = [
  {
    method: "commitment_shield",
    label: "Commitment Shield",
    description: "Amount hidden via Pedersen commitment",
    icon: Shield,
    strength: 1,
    tooltip: "Your deposit amount is hidden behind a cryptographic commitment. The deposit event is visible on-chain but the value is not. Fastest, lowest gas.",
  },
  {
    method: "nullifier_set",
    label: "Nullifier Set",
    description: "Anonymity set with unlinkable withdrawals",
    icon: TreePine,
    strength: 2,
    tooltip: "Your deposit joins an anonymity set. Withdrawals use a nullifier so no one can link your withdraw to your deposit. Supports selective disclosure.",
  },
  {
    method: "hashed_proof",
    label: "Hashed Proof",
    description: "Prove claims without revealing values",
    icon: Hash,
    strength: 3,
    tooltip: "Prove things about your position (balance above threshold, pool membership, tenure) without revealing the values themselves. Claims are verified against hashed inputs.",
  },
  {
    method: "dark_ledger",
    label: "Dark Ledger",
    description: "No on-chain footprint, operator pattern",
    icon: BookLock,
    strength: 4,
    tooltip: "Maximum privacy. Your position is tracked in an encrypted off-chain ledger. No individual deposit/withdraw events on-chain. The protocol operates on your behalf.",
  },
];

export function TierSelector({ selected, onSelect, commitments }: TierSelectorProps) {
  const [hoveredTooltip, setHoveredTooltip] = useState<PrivacyMethod | null>(null);

  return (
    <div className="grid grid-cols-4 gap-3">
      {TIERS.map(tier => {
        const count = commitments.filter(c => c.method === tier.method).length;
        const isSelected = selected === tier.method;
        const Icon = tier.icon;

        return (
          <button
            key={tier.method}
            onClick={() => onSelect(tier.method)}
            className={`relative p-4 rounded-xl border text-left transition-all ${
              isSelected
                ? "border-blue-500 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <Icon className={`w-5 h-5 ${isSelected ? "text-blue-400" : "text-white/50"}`} />
              <div
                className="relative"
                onMouseEnter={() => setHoveredTooltip(tier.method)}
                onMouseLeave={() => setHoveredTooltip(null)}
              >
                <Info className="w-3.5 h-3.5 text-white/30 hover:text-white/60 cursor-help" />
                {hoveredTooltip === tier.method && (
                  <div className="absolute right-0 top-6 z-50 w-64 p-3 rounded-lg bg-slate-800 border border-white/10 text-xs text-white/70 leading-relaxed shadow-xl">
                    {tier.tooltip}
                  </div>
                )}
              </div>
            </div>
            <div className={`text-sm font-medium mb-1 ${isSelected ? "text-white" : "text-white/80"}`}>
              {tier.label}
            </div>
            <div className="text-xs text-white/40 mb-3">{tier.description}</div>
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full ${
                      i <= tier.strength
                        ? isSelected ? "bg-blue-400" : "bg-white/40"
                        : "bg-white/10"
                    }`}
                  />
                ))}
              </div>
              {count > 0 && (
                <span className="text-xs text-white/40">
                  {count} position{count !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

**Step 2: Verify no lint errors**

Run: `cd frontend && npx tsc --noEmit src/components/zkdefi/vault/TierSelector.tsx`

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/vault/TierSelector.tsx
git commit -m "feat(vault): add TierSelector component with 4 privacy method cards and tooltips"
```

---

### Task 3: Create `ProofStepper` component

**Files:**
- Create: `frontend/src/components/zkdefi/vault/ProofStepper.tsx`

**Step 1: Create the component**

Vertical step list with status indicators. Inspired by obsqra.fi `DataPathVisualization`.

```typescript
"use client";
import { Check, Loader2, Circle, AlertCircle } from "lucide-react";
import type { ProofStep } from "@/hooks/usePrivacyVault";

interface ProofStepperProps {
  steps: ProofStep[];
  title?: string;
}

const STATUS_CONFIG = {
  done:    { icon: Check,       color: "text-emerald-400", bg: "bg-emerald-400/10", line: "bg-emerald-400/40" },
  active:  { icon: Loader2,     color: "text-blue-400",    bg: "bg-blue-400/10",    line: "bg-white/10" },
  pending: { icon: Circle,      color: "text-white/20",    bg: "bg-white/[0.03]",   line: "bg-white/10" },
  error:   { icon: AlertCircle, color: "text-red-400",     bg: "bg-red-400/10",     line: "bg-red-400/40" },
};

export function ProofStepper({ steps, title }: ProofStepperProps) {
  if (steps.every(s => s.status === "pending")) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      {title && <div className="text-xs font-medium text-white/50 mb-3">{title}</div>}
      <div className="space-y-0">
        {steps.map((step, i) => {
          const cfg = STATUS_CONFIG[step.status];
          const Icon = cfg.icon;
          const isLast = i === steps.length - 1;

          return (
            <div key={i} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center ${cfg.bg}`}>
                  <Icon className={`w-3.5 h-3.5 ${cfg.color} ${step.status === "active" ? "animate-spin" : ""}`} />
                </div>
                {!isLast && <div className={`w-px h-6 ${cfg.line}`} />}
              </div>
              <div className="pt-1">
                <div className={`text-sm ${step.status === "active" ? "text-white" : step.status === "done" ? "text-white/70" : "text-white/30"}`}>
                  {step.label}
                </div>
                {step.detail && (
                  <div className="text-xs text-white/40 mt-0.5">{step.detail}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/zkdefi/vault/ProofStepper.tsx
git commit -m "feat(vault): add ProofStepper component with status indicators"
```

---

### Task 4: Create `DepositPanel` component

**Files:**
- Create: `frontend/src/components/zkdefi/vault/DepositPanel.tsx`

**Step 1: Create the component**

Left panel in the side-by-side layout. Adapts proof flow per privacy method. Contains amount input, allocation preview, proof stepper, and submit button.

The component should:
- Accept `method` from `usePrivacyVault` to determine which API endpoints to call
- Show asset selector (STRK / ETH)
- Show amount input with balance and MAX
- Show allocation preview (Ekubo LP %, Lending %, Staking %, Idle %) pulled from user's risk profile
- Show proof pipeline when deposit is in progress
- Call the correct deposit endpoint per method:
  - `commitment_shield` -> `POST /zkdefi/shielded_deposit`
  - `nullifier_set` -> `POST /zkdefi/full_privacy/deposit/generate_commitment` then `/register_commitment`
  - `hashed_proof` -> `POST /zkdefi/full_privacy/deposit/generate_commitment` (pool_c variant)
  - `dark_ledger` -> `POST /zkdefi/ledger/transfer-in`
- On success, call `addCommitment` from the hook

**Reference existing code for API call patterns:**
- `frontend/src/components/zkdefi/ShieldedPoolPanel.tsx` lines 200-270 (shielded deposit flow)
- `frontend/src/components/zkdefi/FullPrivacyPoolPanel.tsx` lines 250-350 (full privacy deposit flow)
- `frontend/src/components/zkdefi/PrivateTransferPanel.tsx` lines 180-250 (private transfer deposit)

Extract the deposit logic from each panel into this unified component. The proof stepper steps come from `usePrivacyVault` and are updated as each API call completes.

**Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/vault/DepositPanel.tsx
git commit -m "feat(vault): add unified DepositPanel with tier-adaptive proof flow"
```

---

### Task 5: Create `WithdrawPanel` component

**Files:**
- Create: `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx`

**Step 1: Create the component**

Right panel. Starts with commitment picker (all tiers), then amount input, relayer toggle, proof stepper.

The component should:
- Show all commitments from `usePrivacyVault` in a selectable list, tagged by method
- Selecting a commitment auto-sets the method via `setMethod`
- Show amount input (partial withdraw grayed for commitment_shield)
- Show relayer toggle only when user reputation tier qualifies (fetch from `/zkdefi/reputation/user/{addr}`)
- Show yield accrued next to each commitment
- Call correct withdraw endpoint per method:
  - `commitment_shield` -> `POST /zkdefi/shielded_withdraw`
  - `nullifier_set` -> `POST /zkdefi/full_privacy/withdraw/generate_proof` or `/generate_proof_with_change`
  - `hashed_proof` -> same as nullifier_set with pool_c
  - `dark_ledger` -> `POST /zkdefi/ledger/transfer-out`
- On success, call `removeCommitment`

**Reference existing code:**
- `frontend/src/components/zkdefi/ShieldedPoolPanel.tsx` lines 270-370 (shielded withdraw)
- `frontend/src/components/zkdefi/FullPrivacyPoolPanel.tsx` lines 350-480 (full privacy withdraw)

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/vault/WithdrawPanel.tsx
git commit -m "feat(vault): add unified WithdrawPanel with commitment picker and relayer toggle"
```

---

### Task 6: Create `PositionsOverview` component

**Files:**
- Create: `frontend/src/components/zkdefi/vault/PositionsOverview.tsx`

**Step 1: Create the component**

Below deposit/withdraw. Shows:
- Summary row: total value, privacy coverage %, 30d yield
- Allocation bar by privacy method (color-coded)
- Positions table (all commitments, clickable to select in WithdrawPanel)
- Capital deployed bar (Ekubo, Lending, Staking, Idle)
- Privacy/Public view toggle

Data sources:
- Commitments from `usePrivacyVault`
- Yield data from `GET /zkdefi/private-yield/positions/{address}`
- Capital allocation from `GET /zkdefi/private-yield/vault/stats`
- Position aggregation from `GET /zkdefi/position/aggregate/{address}`

**Step 2: Commit**

```bash
git add frontend/src/components/zkdefi/vault/PositionsOverview.tsx
git commit -m "feat(vault): add PositionsOverview with unified commitment table and privacy toggle"
```

---

### Task 7: Create `AIInsight` and `TrendingBar` components

**Files:**
- Create: `frontend/src/components/zkdefi/vault/AIInsight.tsx`
- Create: `frontend/src/components/zkdefi/vault/TrendingBar.tsx`

**Step 1: Create AIInsight**

Compact recommendation card. Fetches from existing `/zkdefi/agent/recommendation` or `/strategies/recommendation/{address}`. Dismissable (state persisted in sessionStorage so it stays dismissed for the session).

**Step 2: Create TrendingBar**

Slim stats row. Fetches from `/zkdefi/market/surface` and `/zkdefi/oracle/pool-apys`. Shows STRK/ETH 24h change, top pool + APY, vault TVL, depositor count, avg APY.

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/vault/AIInsight.tsx frontend/src/components/zkdefi/vault/TrendingBar.tsx
git commit -m "feat(vault): add AIInsight recommendation card and TrendingBar market stats"
```

---

### Task 8: Create `VaultTab` component

**Files:**
- Create: `frontend/src/components/zkdefi/vault/VaultTab.tsx`

**Step 1: Create the component**

Assembles all Vault tab pieces in order:
1. TierSelector
2. AIInsight
3. TrendingBar
4. Side-by-side grid: DepositPanel (left) | WithdrawPanel (right)
5. PositionsOverview

Passes `usePrivacyVault` state down. The `onSelectCommitment` callback from PositionsOverview selects the commitment in WithdrawPanel and sets the method.

**Step 2: Commit**

```bash
git add frontend/src/components/zkdefi/vault/VaultTab.tsx
git commit -m "feat(vault): add VaultTab assembling tier selector, deposit/withdraw, positions"
```

---

### Task 9: Create `YieldTab` component

**Files:**
- Create: `frontend/src/components/zkdefi/vault/YieldTab.tsx`

**Step 1: Create the component**

Three sections:
1. **Yield Summary + Sources table** -- fetches from `/zkdefi/private-yield/vault/stats`, `/zkdefi/private-yield/yield/blended`, `/strategies/staking/dashboard`
2. **Credit Line card** -- collapsed from `LendingPanel`. Fetches from `/lending/pools`, `/risk_passport/user/{addr}/attestation`. Supply/Borrow inline expanders.
3. **Performance sparkline** -- fetches from `/strategies/yield/{address}`. Shows cumulative yield, rebalance count + timing.

**Reference existing code:**
- `frontend/src/components/zkdefi/LendingPanel.tsx` for credit line logic
- `frontend/src/components/zkdefi/PrivateYieldPanel.tsx` for yield sources
- `frontend/src/components/zkdefi/PerformanceDashboard.tsx` for performance chart (if it exists as separate component)

**Step 2: Commit**

```bash
git add frontend/src/components/zkdefi/vault/YieldTab.tsx
git commit -m "feat(vault): add YieldTab merging performance, private yield, and lending"
```

---

### Task 10: Create backend activity aggregation endpoint

**Files:**
- Create: `backend/app/api/routes/vault_activity.py`
- Modify: `backend/app/main.py` (add router)

**Step 1: Create the route**

```python
from fastapi import APIRouter, Query
from backend.app.services.json_store import JsonStore
import httpx, asyncio, os

router = APIRouter(prefix="/zkdefi/vault", tags=["vault"])

BASE = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

@router.get("/activity/{address}")
async def get_vault_activity(address: str, limit: int = Query(50, le=200)):
    """Aggregate vault activity from ledger, receipts, rebalance logs, yield events."""
    async with httpx.AsyncClient(timeout=10) as client:
        tasks = [
            client.get(f"{BASE}/zkdefi/ledger/entries/{address}"),
            client.get(f"{BASE}/zkdefi/receipts/{address}"),
            client.get(f"{BASE}/zkdefi/rebalancer/history/{address}"),
            client.get(f"{BASE}/zkdefi/private-yield/positions/{address}"),
        ]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

    entries = []
    # Parse each response, normalize into unified activity entry format
    # { type, description, method, timestamp, hashes: {tx, commitment, nullifier, proof}, asset, amount }
    # Sort by timestamp descending, apply limit

    for i, resp in enumerate(responses):
        if isinstance(resp, Exception):
            continue
        if resp.status_code != 200:
            continue
        data = resp.json()
        source = ["ledger", "receipt", "rebalance", "yield"][i]
        if isinstance(data, list):
            for item in data:
                entries.append(_normalize(item, source))
        elif isinstance(data, dict):
            items = data.get("entries", data.get("receipts", data.get("history", [])))
            if isinstance(items, list):
                for item in items:
                    entries.append(_normalize(item, source))

    entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return {"activity": entries[:limit]}


def _normalize(item: dict, source: str) -> dict:
    return {
        "type": source,
        "description": item.get("description", item.get("action", item.get("reason", source))),
        "method": item.get("method", item.get("privacy_mode", "")),
        "timestamp": item.get("timestamp", item.get("created_at", item.get("time", ""))),
        "hashes": {
            "tx": item.get("tx_hash", item.get("transaction_hash", "")),
            "commitment": item.get("commitment", item.get("commitment_hash", "")),
            "nullifier": item.get("nullifier", ""),
            "proof": item.get("proof_hash", item.get("proof", "")),
        },
        "asset": item.get("asset", item.get("token", "STRK")),
        "amount": item.get("amount", item.get("value", "")),
    }
```

**Step 2: Register router in main.py**

Add to `backend/app/main.py`:
```python
from backend.app.api.routes.vault_activity import router as vault_activity_router
app.include_router(vault_activity_router)
```

**Step 3: Commit**

```bash
git add backend/app/api/routes/vault_activity.py backend/app/main.py
git commit -m "feat(api): add /zkdefi/vault/activity/{address} aggregation endpoint"
```

---

### Task 11: Create `ActivityTab` component

**Files:**
- Create: `frontend/src/components/zkdefi/vault/ActivityTab.tsx`

**Step 1: Create the component**

Chronological feed grouped by day. Filter bar (All, Deposits, Withdrawals, Yields, Proofs). Each entry shows action icon, description, method badge, timestamp, hashes, Starkscan link.

Fetches from: `GET /zkdefi/vault/activity/{address}` (Task 10).

Group entries by date. Use existing `explorer.ts` for Starkscan links.

**Step 2: Commit**

```bash
git add frontend/src/components/zkdefi/vault/ActivityTab.tsx
git commit -m "feat(vault): add ActivityTab with chronological feed and filters"
```

---

### Task 12: Create `VaultSurface` shell and replace `VaultSurfaceContainer`

**Files:**
- Create: `frontend/src/components/zkdefi/vault/VaultSurface.tsx`
- Modify: `frontend/src/components/zkdefi/surfaces/VaultSurfaceContainer.tsx` (gut and re-export)

**Step 1: Create VaultSurface**

The shell component:
- Header with live price ticker (reuse existing `usePriceFeed` or inline fetch from `/zkdefi/market/surface`)
- Summary cards row: Total Position, Privacy Coverage, Total Earned, Session Key status
- 3-tab navigation: Vault | Yield | Activity
- Tab content: VaultTab, YieldTab, ActivityTab
- Initializes `usePrivacyVault` hook and passes state to children
- Calls `migrateOldStorage()` once on mount

**Step 2: Replace VaultSurfaceContainer**

Change `VaultSurfaceContainer.tsx` to re-export `VaultSurface`:

```typescript
export { VaultSurface as default } from "./vault/VaultSurface";
export { VaultSurface } from "./vault/VaultSurface";
```

This preserves the import path used by `agent/page.tsx` without touching the parent.

**Step 3: Verify full build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/vault/ frontend/src/components/zkdefi/surfaces/VaultSurfaceContainer.tsx
git commit -m "feat(vault): replace VaultSurfaceContainer with unified 3-tab VaultSurface"
```

---

### Task 13: Cleanup dead components

**Files:**
- Delete: `frontend/src/components/zkdefi/ShieldedPoolPanel.tsx`
- Delete: `frontend/src/components/zkdefi/FullPrivacyPoolPanel.tsx`
- Delete: `frontend/src/components/zkdefi/PrivateTransferPanel.tsx`
- Delete: `frontend/src/components/zkdefi/AllocationPools.tsx`
- Delete: `frontend/src/components/zkdefi/PortfolioTab.tsx` (if it exists as standalone)
- Modify: any files that import the deleted components (update or remove imports)

**Step 1: Search for imports of deleted components**

Run: `rg "ShieldedPoolPanel|FullPrivacyPoolPanel|PrivateTransferPanel|AllocationPools|PortfolioTab" frontend/src --files-with-matches`

Update each importing file to remove the dead imports.

**Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no import errors

**Step 3: Commit**

```bash
git add -A frontend/src/
git commit -m "chore(vault): remove dead panels replaced by unified VaultSurface"
```

---

### Task 14: Visual verification and polish

**Step 1: Start dev server**

Run: `cd frontend && npm run dev`

**Step 2: Browse `/agent?mode=demo`**

Verify:
- Vault tab shows: tier selector (4 cards), AI insight, trending bar, side-by-side deposit/withdraw, positions overview
- Clicking a tier card highlights it and adapts deposit/withdraw panels
- Tooltips appear on hover for each tier
- Yield tab shows: sources table, credit line card, performance section
- Activity tab shows: filter bar, chronological feed
- No layout overflow, no missing styles
- Privacy/Public toggle in positions overview works

**Step 3: Fix any visual issues found**

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix(vault): visual polish and layout fixes"
```
