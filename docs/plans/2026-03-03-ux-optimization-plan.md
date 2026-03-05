# UX Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Optimize zkde.fi UX by adding a Capital flow strip, consolidating Brain tabs, removing redundancy, and fixing naming across all surfaces.

**Architecture:** Shell-level CapitalFlowStrip component replaces scattered proof/insight components. Brain surface drops from 6 sub-tabs to 4 by merging agent tabs and removing Disclosure. Vault sub-tab renamed, redundant sections removed. All changes are frontend-only (React/Next.js).

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, lucide-react icons. Existing hooks: `useVaultController`, `useExecutionContext`, `useReceiptAggregator`, `useAccount` (starknet-react).

---

### Task 1: Fix `/identity` redirect

**Files:**
- Create: `frontend/src/app/identity/page.tsx`

**Step 1: Create the redirect page**

```tsx
import { redirect } from "next/navigation";

export default function IdentityPage() {
  redirect("/profile");
}
```

**Step 2: Verify**

Run: `cd frontend && npx next build 2>&1 | grep -i identity`
Expected: identity page compiles without error.

**Step 3: Commit**

```bash
git add frontend/src/app/identity/page.tsx
git commit -m "fix: redirect /identity to /profile"
```

---

### Task 2: Rename Vault sub-tab "Vault" → "Portfolio"

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/VaultSurface.tsx`

**Step 1: Change the tab label**

In `VaultSurface.tsx`, find the `tabs` array (around line 177):

```tsx
const tabs: { key: Tab; label: string }[] = [
  { key: "vault", label: "Vault" },
```

Change to:

```tsx
const tabs: { key: Tab; label: string }[] = [
  { key: "vault", label: "Portfolio" },
```

**Step 2: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds. The `key` stays "vault" for routing compat; only the visible label changes.

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/vault/VaultSurface.tsx
git commit -m "refactor: rename Vault sub-tab to Portfolio"
```

---

### Task 3: Remove AIInsight and TrendingBar from VaultTab

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/VaultTab.tsx`

**Step 1: Remove AIInsight and TrendingBar imports and usage**

In `VaultTab.tsx`, remove the import lines for `AIInsight` and `TrendingBar`, and remove `<AIInsight address={address} />` and `<TrendingBar />` from the JSX. The remaining render should be:

```tsx
return (
  <div className="space-y-4">
    <TierSelector selected={method} onSelect={setMethod} commitments={commitments} />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <DepositPanel method={method} depositSteps={depositSteps} setDepositSteps={setDepositSteps} addCommitment={addCommitment} address={address} />
      <WithdrawPanel method={method} setMethod={setMethod} commitments={commitments} removeCommitment={removeCommitment} withdrawSteps={withdrawSteps} setWithdrawSteps={setWithdrawSteps} address={address} selectedCommitmentId={selectedCommitmentId} />
    </div>
    <PositionsOverview commitments={commitments} onSelectCommitment={handleSelectCommitment} address={address} />
  </div>
);
```

**Step 2: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds. AIInsight and TrendingBar components still exist as files (used later by CapitalFlowStrip and VaultSurface header).

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/vault/VaultTab.tsx
git commit -m "refactor: remove AIInsight and TrendingBar from VaultTab"
```

---

### Task 4: Merge TrendingBar stats into VaultSurface header

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/VaultSurface.tsx`

**Step 1: Add TrendingBar data to the header stats row**

The VaultSurface header already shows STRK/ETH and STRK/USD prices. Add Top Pool and Vault TVL from the TrendingBar data source. Import and use the same market surface API fetch that TrendingBar uses, or inline the stats.

In the header `<div>` (around line 195), after the existing STRK/USD price display, add:

```tsx
{/* After existing STRK/USD span */}
<span className="text-white/20">|</span>
<span className="text-white/40">Top Pool</span>
<span className="text-white">{topPool ?? "--"}</span>
<span className="text-white/20">|</span>
<span className="text-white/40">TVL</span>
<span className="text-white">{vaultTvl ?? "--"}</span>
```

Add state and fetch for `topPool` and `vaultTvl` using the same API calls as TrendingBar (`/api/v1/zkdefi/market/surface` and `/api/v1/zkdefi/private-yield/vault/stats`). Merge into the existing `fetchPrices` effect or add a parallel effect.

**Step 2: Remove the ProofsPill import and usage from VaultSurface**

Remove `import { ProofsPill } from "./ProofsPill";` and `<ProofsPill proofsState={proofsState} />` from the header. ProofsPill will be used by the CapitalFlowStrip instead.

**Step 3: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/vault/VaultSurface.tsx
git commit -m "refactor: merge TrendingBar stats into vault header, remove ProofsPill"
```

---

### Task 5: Create CapitalFlowStrip component

**Files:**
- Create: `frontend/src/components/zkdefi/CapitalFlowStrip.tsx`

**Step 1: Create the component**

The component renders a single row with:
- Left: proof gate status (3 icons from `proofsState`)
- Right: next step text + optional CTA button

Props:
```tsx
interface CapitalFlowStripProps {
  proofsState: {
    policyEnforced: "OK" | "WARNING" | "FAIL";
    riskWithinBound: "OK" | "WARNING" | "FAIL";
    mevProtection: "OK" | "WARNING" | "FAIL";
    overall: "OK" | "WARNING" | "FAIL";
  };
  isConnected: boolean;
  hasOnboarded: boolean;
  commitmentCount: number;
  activeSessionCount: number;
  agentStatus: "idle" | "monitoring" | "executing";
  pendingRebalance: boolean;
  aiInsight: string | null;
  onNavigate: (surface: string, subTab?: string) => void;
}
```

Next-step derivation logic: check states in priority order (no wallet → not onboarded → no deposits → no session → no agent → idle capital → all deployed → rebalance pending).

UI: `rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5` row with flex layout. Left side has 3 status dots with expand-on-click dropdown (reuse ProofsPill expand logic). Right side has text + optional small button.

**Step 2: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds (component created but not yet mounted).

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/CapitalFlowStrip.tsx
git commit -m "feat: add CapitalFlowStrip component"
```

---

### Task 6: Mount CapitalFlowStrip in app shell

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`

**Step 1: Import and mount**

Import `CapitalFlowStrip` and mount it between the header and the surface navigation buttons (Vault | Trade | Brain). Wire props from existing state:
- `proofsState` from `useVaultController` (need to call it at shell level or pass down)
- `isConnected`, `hasOnboarded` from existing shell state
- `commitmentCount` from a lightweight check (existing vault state or API)
- `activeSessionCount` from session key API
- `agentStatus` from agent status API
- `aiInsight` from strategy recommend API
- `onNavigate` from the existing `setSurface` / `setSubTabOverride` handlers

Add the necessary hooks/state at the shell level. For `proofsState`, either call `useVaultController` at the shell level (it currently lives inside VaultSurface) or lift the hook call up. Since `useVaultController` takes an address, this is straightforward to call in the shell.

Place the strip JSX:

```tsx
{/* After header, before surface navigation */}
<CapitalFlowStrip
  proofsState={proofsState}
  isConnected={hasAccount}
  hasOnboarded={hasOnboarded}
  commitmentCount={commitmentCount}
  activeSessionCount={activeSessionCount}
  agentStatus={agentStatus}
  pendingRebalance={pendingProposal}
  aiInsight={aiInsight}
  onNavigate={(surface, sub) => {
    setSurface(surface as Surface);
    setSubTabOverride(sub);
  }}
/>
```

**Step 2: Add lightweight data fetching**

For data not already available at shell level (session count, agent status, AI insight), add `useEffect` fetches similar to existing patterns in the codebase. Keep them lightweight with `AbortSignal.timeout(6000)`.

**Step 3: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds. Strip visible on `/agent`.

**Step 4: Commit**

```bash
git add frontend/src/app/agent/page.tsx
git commit -m "feat: mount CapitalFlowStrip in app shell"
```

---

### Task 7: Remove Credit Line from YieldTab

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/YieldTab.tsx`

**Step 1: Remove credit line section**

Remove the entire credit line card (the `<div>` containing "Credit Line" heading, `creditFields` grid, and "Open Lending Actions" button). This is approximately lines 496-543 in the current file. Also remove the `credit` state, `setCredit`, `creditFields`, `hasCredit`, the `CreditCard` icon import (if unused elsewhere), and the credit-related API fetches from the `useEffect`.

Keep: summary cards, sources table, Deploy to Ekubo, YieldChart.

**Step 2: Promote Deploy to Ekubo**

Change the "Deploy Capital to Ekubo" from a collapsed accordion to always-visible when `address` exists. Remove the `showDeploy` state and the toggle button wrapper. Replace with a direct render:

```tsx
{address && (
  <div className="border border-emerald-500/20 rounded-xl bg-emerald-500/[0.03] p-4">
    <div className="flex items-center gap-2 mb-3">
      <Zap className="w-4 h-4 text-emerald-400" />
      <span className="text-sm font-medium text-emerald-400">Deploy Capital to Ekubo</span>
    </div>
    <DeployToEkuboCard userAddress={address} />
  </div>
)}
```

**Step 3: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/vault/YieldTab.tsx
git commit -m "refactor: remove credit line from YieldTab, promote Deploy to Ekubo"
```

---

### Task 8: Add Proofs filter and empty state to ActivityTab

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/ActivityTab.tsx`

**Step 1: Add "Proofs" to filter options**

In `ActivityTab.tsx`, the `FilterType` type is `"all" | "deposits" | "withdrawals" | "yields" | "rebalances"`. Add `"proofs"`:

```tsx
type FilterType = "all" | "deposits" | "withdrawals" | "yields" | "rebalances" | "proofs";
```

Add the "Proofs" button to the filter bar alongside the existing filter buttons.

In `inferCategory`, add proof handling:

```tsx
if (t === "proof" || t === "disclosure" || t === "zkml_proof" || t === "constraint_check") return "proofs";
```

In the filter logic, add:

```tsx
if (actionFilter === "proofs") return inferCategory(e) === "proofs";
```

**Step 2: Add empty state**

Find the empty render path (when filtered list is empty) and add:

```tsx
<div className="text-center py-12 text-zinc-500">
  <p className="text-sm">No activity yet.</p>
  <p className="text-xs mt-1">Deposits, withdrawals, and proof receipts will appear here.</p>
</div>
```

**Step 3: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/vault/ActivityTab.tsx
git commit -m "feat: add Proofs filter and empty state to ActivityTab"
```

---

### Task 9: Consolidate Brain sub-tabs (6 → 4)

**Files:**
- Modify: `frontend/src/components/zkdefi/surfaces/BrainSurfaceContainer.tsx`

**Step 1: Update sub-tab type and navigation**

Change the type:

```tsx
type BrainSubTab = "agent" | "models" | "pipeline" | "agents";
```

Update the sub-tab buttons:

```tsx
<button onClick={() => setSubTab("agent")} ...>
  <Brain className="w-4 h-4" /> Agent
</button>
<button onClick={() => setSubTab("models")} ...>
  <Boxes className="w-4 h-4" /> Models
</button>
<button onClick={() => setSubTab("pipeline")} ...>
  <GitBranch className="w-4 h-4" /> Pipeline
</button>
<button onClick={() => setSubTab("agents")} ...>
  <Bot className="w-4 h-4" /> Agents
</button>
```

Remove the "Identity Agents" and "Disclosure" buttons entirely.

**Step 2: Merge Identity Agents + My Agents into "Agents" tab**

Replace the separate `{subTab === "identity" && ...}` and `{subTab === "my-agents" && ...}` blocks with a single `{subTab === "agents" && ...}` block:

```tsx
{subTab === "agents" && !address && (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <Bot className="w-12 h-12 text-zinc-600 mb-4" />
    <h3 className="text-lg font-semibold text-zinc-300 mb-2">Connect Wallet</h3>
    <p className="text-sm text-zinc-500 max-w-md">
      Connect your wallet to build, manage, and compete with identity-bound agents.
    </p>
  </div>
)}

{subTab === "agents" && address && (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div className="lg:col-span-2 space-y-6">
      <div className="glass rounded-xl border border-zinc-800 p-6">
        <AgentBuilder address={address} />
      </div>
      <div className="glass rounded-xl border border-zinc-800 p-6">
        <AgentDashboard address={address} />
      </div>
    </div>
    <div className="space-y-6">
      <div className="glass rounded-xl border border-zinc-800 p-6">
        <AgentLeaderboard onSelectAgent={(id) => setSelectedAgentId(id)} />
      </div>
      <div className="glass rounded-xl border border-zinc-800 p-6">
        <AgentPerformanceDashboard agentId={selectedAgentId} />
      </div>
      <div className="glass rounded-xl border border-zinc-800 p-6">
        <SkillMarketplace />
      </div>
    </div>
  </div>
)}
```

**Step 3: Remove Disclosure tab**

Delete the `{subTab === "disclosure" && ...}` block entirely. CompliancePanel will be wired to Profile in Task 10.

**Step 4: Replace ActivityLog with ProofTimeline on Agent tab**

In the Agent tab content, find `<ActivityLog />` and replace with:

```tsx
<div className="glass rounded-xl border border-zinc-800 p-6">
  <ProofTimeline receipts={[]} compact title="Recent Proofs" />
</div>
```

Wire receipts from `useReceiptAggregator` (import the hook, call it with `address`, pass the last 5 receipts). Update imports accordingly.

**Step 5: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds. Brain surface shows 4 tabs.

**Step 6: Commit**

```bash
git add frontend/src/components/zkdefi/surfaces/BrainSurfaceContainer.tsx
git commit -m "refactor: consolidate Brain to 4 tabs, merge agents, remove Disclosure"
```

---

### Task 10: Move CompliancePanel to Profile

**Files:**
- Modify: `frontend/src/app/profile/page.tsx`

**Step 1: Import and render CompliancePanel**

In `profile/page.tsx`, import CompliancePanel:

```tsx
import { CompliancePanel } from "@/components/zkdefi/CompliancePanel";
```

Find the Compliance tab content area (the tab already exists in the Profile page with key "compliance"). Add `<CompliancePanel />` as the content for that tab, replacing any placeholder content.

**Step 2: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/app/profile/page.tsx
git commit -m "feat: wire CompliancePanel into Profile Compliance tab"
```

---

### Task 11: Trade surface polish

**Files:**
- Modify: `frontend/src/components/zkdefi/MarketsTab.tsx`

**Step 1: Add empty state for Markets**

Find the render path where opportunities list is empty. Add:

```tsx
{rows.length === 0 && (
  <div className="text-center py-12">
    <TrendingUp className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
    <p className="text-sm text-zinc-400">Market intelligence is loading.</p>
    <p className="text-xs text-zinc-500 mt-1">Prices refresh every 30 seconds.</p>
  </div>
)}
```

**Step 2: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/components/zkdefi/MarketsTab.tsx
git commit -m "polish: add empty state to Markets tab"
```

---

### Task 12: Update deep-link routing for renamed tabs

**Files:**
- Modify: `frontend/src/app/agent/page.tsx`

**Step 1: Update LEGACY_TAB_MAP for new Brain sub-tab names**

In the `LEGACY_TAB_MAP`, update entries that pointed to old Brain sub-tab names:

```tsx
agent: { surface: "brain", sub: "agent" },      // unchanged
models: { surface: "brain", sub: "models" },     // unchanged
pipeline: { surface: "brain", sub: "pipeline" }, // unchanged
disclosure: { surface: "brain", sub: "agents" }, // redirect old disclosure links
```

Remove or redirect any entries for "identity" or "my-agents" sub-tabs to "agents":

```tsx
// Legacy compat for old sub-tab names
"my-agents": { surface: "brain", sub: "agents" },
"identity-agents": { surface: "brain", sub: "agents" },
```

**Step 2: Update BrainSurfaceContainer props type**

In `agent/page.tsx`, update the `initialSubTab` cast for Brain:

```tsx
initialSubTab={subTabOverride as "agent" | "models" | "pipeline" | "agents" | undefined}
```

**Step 3: Verify**

Run: `cd frontend && npx next build 2>&1 | tail -20`
Expected: Build succeeds. Deep links like `?tab=disclosure` redirect to agents tab.

**Step 4: Commit**

```bash
git add frontend/src/app/agent/page.tsx
git commit -m "fix: update deep-link routing for renamed Brain sub-tabs"
```

---

### Task 13: Final build verification

**Step 1: Full build**

Run: `cd frontend && npm run build 2>&1`
Expected: Build succeeds with no errors. Warnings about `<img>` and exhaustive deps are pre-existing and acceptable.

**Step 2: Lint check**

Run: `cd frontend && npx next lint 2>&1 | tail -30`
Expected: No new lint errors introduced.

**Step 3: Manual smoke test**

Navigate to `http://localhost:3001/agent?mode=demo` and verify:
- Capital flow strip visible between header and Vault | Trade | Brain tabs
- Vault sub-tabs show "Portfolio" (not "Vault")
- Brain shows 4 sub-tabs: Agent | Models | Pipeline | Agents
- No "Disclosure" tab on Brain
- `/identity` redirects to `/profile`
- Yield tab shows Deploy to Ekubo card (not accordion) and no Credit Line section

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete UX optimization — capital flow strip, consolidated Brain, cleaned Vault"
```
