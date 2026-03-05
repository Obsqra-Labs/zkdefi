# zkde.fi UX Optimization Changelog

**Started:** 2026-03-03
**Status:** Complete (all 20 items shipped)
**Design:** `docs/plans/2026-03-03-ux-optimization-design.md`

---

## Phase 1 — Structural UX (completed 2026-03-03)

### 1.1 Capital Flow Strip (new component)

**File:** `frontend/src/components/zkdefi/CapitalFlowStrip.tsx` (new)
**Mounted in:** `frontend/src/app/agent/page.tsx`

A slim horizontal strip between the header and surface navigation (Vault | Trade | Brain). Always visible.

- **Left side:** Three proof-gate signals (policy enforced, risk within bound, MEV protection) with click-to-expand detail dropdown. Replaces ProofsPill from VaultSurface header — single source of truth for gate status across all surfaces.
- **Right side:** Context-aware next-step guidance based on user state (not connected → not onboarded → no deposits → no session key → agent idle → agent active → rebalance pending). Includes CTA buttons that navigate to the relevant surface/sub-tab.

Data sources: `useVaultController` for proof state, session key API, strategy recommendation API.

### 1.2 Vault Surface Cleanup

| Change | File | Detail |
|--------|------|--------|
| Sub-tab renamed "Vault" → "Portfolio" | `vault/VaultSurface.tsx` | Eliminates naming collision with the parent surface. Key stays `"vault"` for routing compat. |
| ProofsPill removed from header | `vault/VaultSurface.tsx` | Moved to CapitalFlowStrip (shell-level). |
| Top Pool + TVL stats added to header | `vault/VaultSurface.tsx` | Merged from TrendingBar. Header now shows: STRK/ETH, STRK/USD, Top Pool (pair + APY%), TVL (ETH). Data from `/api/v1/zkdefi/market/surface` and `/api/v1/zkdefi/private-yield/vault/stats`. |
| AIInsight removed from VaultTab | `vault/VaultTab.tsx` | Moved to CapitalFlowStrip's next-step guidance. |
| TrendingBar removed from VaultTab | `vault/VaultTab.tsx` | Stats merged into VaultSurface header. |
| Credit Line removed from YieldTab | `vault/YieldTab.tsx` | Duplicate of Lending tab content. Also cleaned VaultSurface of the `onOpenLending` prop. |
| Deploy to Ekubo promoted | `vault/YieldTab.tsx` | Converted from accordion (toggle + chevron) to always-visible card. |
| "Proofs" filter added to ActivityTab | `vault/ActivityTab.tsx` | Matches entries containing "proof", "groth16", "receipt", "attestation", or "zkml" in type or description. |
| Empty state added to ActivityTab | `vault/ActivityTab.tsx` | Context-aware: "No activity yet" vs "No [filter] activity" with subtitles. |
| Markets tab empty/loading state | `vault/MarketsTab.tsx` | Shows loading spinner when fetching, explicit message when no data. |

### 1.3 Brain Surface Consolidation (6 → 4 tabs)

**File:** `frontend/src/components/zkdefi/surfaces/BrainSurfaceContainer.tsx`

| Before | After | What happened |
|--------|-------|---------------|
| Agent Controls | Agent | Renamed. ActivityLog replaced with `<ProofTimeline>` showing last 10 receipts from risk passport API. |
| zkML Models | Models | Renamed. No content changes. |
| Pipeline | Pipeline | Unchanged. |
| Identity Agents | — | Merged into "Agents" tab. |
| My Agents | — | Merged into "Agents" tab. |
| Disclosure | — | Removed. CompliancePanel already on Profile. |
| — | Agents (new) | Two-column layout: AgentBuilder + AgentDashboard (top), AgentPerformanceDashboard + AgentLeaderboard + SkillMarketplace (bottom 3-col grid). |

Removed imports: `CompliancePanel`, `ActivityLog`, `Eye` icon. Added: `ProofTimeline`, `API_BASE`, proof receipt fetch effect.

### 1.4 Profile & Routing

| Change | File |
|--------|------|
| `/identity` redirect → `/profile` | `frontend/src/app/identity/page.tsx` (new) |
| Stale `/agent?tab=disclosure` link fixed | `frontend/src/app/profile/page.tsx` — now points to `/agent?v=brain&sub=pipeline` |
| Deep-link routing updated | `frontend/src/app/agent/page.tsx` — `LEGACY_TAB_MAP` handles `disclosure` → pipeline, `identity` → agents, `my-agents` → agents, `agents` → agents |

### 1.5 Shell Integration

**File:** `frontend/src/app/agent/page.tsx`

- Imported `CapitalFlowStrip`, `useVaultController`, `API_BASE`
- Added shell-level state: `shellSessionCount`, `shellAgentStatus`, `shellAiInsight`, `shellCommitmentCount`
- Added useEffect to fetch session key count and AI strategy insight
- Mounted CapitalFlowStrip above surface navigation with all props wired
- Removed unused icon imports (`User`, `TrendingUp`)

---

## Phase 2 — Data Integration (completed 2026-03-04)

### 2.1 Receipt Aggregator Wired into Activity

**File:** `frontend/src/components/zkdefi/vault/ActivityTab.tsx`

The `useReceiptAggregator` hook (dual-source: backend timeline + on-chain indexer) was already defined but unused. Now wired into ActivityTab:

- Calls `useReceiptAggregator(address, refreshKey)` alongside the existing vault activity API fetch
- Maps `AggregatedReceipt` → `ActivityEntry` (proof_type, action, result, timestamp, tx_hash)
- Merges with API activity entries, deduplicates by `tx_hash`, sorts newest-first
- Loading guard updated to account for both sources

This means the Activity tab now shows proof receipts from both the backend timeline AND on-chain indexer, reconciled by the aggregator's `confirmed`/`pending`/`on-chain`/`diverged` status logic.

### 2.2 Shared Gate Context Hook

**File:** `frontend/src/hooks/useGateContext.ts` (new)

SwapTab and LiquidityTab both had identical ~15-line blocks fetching `getRiskPassport` + `listSessionKeys` with 30s polling. Extracted to a shared hook:

```
useGateContext(userAddress, gateMode) → { passportScore, activeSessionId, gateConfig, refresh }
```

- Fetches risk passport and session keys in parallel
- Derives `gateConfig` object (gateMode, sessionId, passportScore, manual override settings)
- Polls every 30s via `useVisibilityPolling`

Both `SwapTab.tsx` and `LiquidityTab.tsx` now use `useGateContext` instead of inline fetch logic. Removed `getRiskPassport`/`listSessionKeys` imports from both.

### 2.3 Token Context Bar Sync (SwapTab ↔ TradeContext)

**File:** `frontend/src/components/zkdefi/SwapTab.tsx`

The Trade surface has a shared `TradeContext` powering a token context bar (tokenIn, tokenOut, amount, slippage). SwapTab previously kept its own local token state disconnected from this context.

Now bidirectionally synced:
- Local state initializes from `trade.tokenIn` / `trade.tokenOut`
- Wrapper setters update both local state and TradeContext
- useEffect syncs context changes back to local state (for when user edits the context bar directly)
- EkuboSwapPanel's `onTokenChange` flows through the wrappers automatically

---

## Phase 3 — Trust & Transparency (completed 2026-03-04)

### 3.1 Proof Generation Feedback

Added compact informational strips near every action button that triggers ZK proof generation, showing estimated time, what happens, and privacy guarantee.

| Location | File | Detail shown |
|----------|------|-------------|
| Deposit button | `vault/DepositPanel.tsx` | ~10-15s Groth16, Commitment + Pedersen hash + Merkle insert, amount/wallet concealed |
| Withdraw button | `vault/WithdrawPanel.tsx` | ~10-15s Groth16, Nullifier reveal + Merkle proof + balance verify, source commitment hidden |
| Brain Check button | `BrainVisualizer.tsx` | Compact line: "Runs zkML risk model (Cairo perceptron) · ~3-5s · result feeds agent gate decisions" |
| Rebalance execute | `AgentRebalancer.tsx` | ~15-30s pipeline: Commit → zkML verify → Groth16 proof → on-chain execute → receipt |

All strips use consistent `zinc-700/50 border`, `zinc-800/30 bg`, `text-xs` styling with `Clock` icon.

### 3.2 Privacy Callouts

Added emerald-tinted privacy callouts across all major surfaces, each explaining the specific cryptographic mechanism in play.

| Location | File | Privacy mechanism explained |
|----------|------|-----------------------------|
| VaultTab (above deposit/withdraw grid) | `vault/VaultTab.tsx` | Pedersen commitments, nullifier unlinkability |
| YieldTab (after performance summary) | `vault/YieldTab.tsx` | Shielded capital deployment, private yield harvesting |
| SwapTab (above EkuboSwapPanel) | `SwapTab.tsx` | Proof-gated execution, commit-reveal MEV protection |
| LiquidityTab (top of panel) | `LiquidityTab.tsx` | Privacy-layer LP management, zkML-verified allocations |
| Brain Agent (above SessionKeyManager) | `BrainSurfaceContainer.tsx` | Session key scope, proof-verified execution |
| Profile Risk Passport | `profile/page.tsx` | Cryptographic attestation without exposing positions/balances |

All callouts use `border-emerald-700/20`, `bg-emerald-950/10`, `text-emerald-400/80` with `Shield` icon.

### 3.3 Risk Passport → Borrowing Terms

**File:** `frontend/src/components/zkdefi/vault/LendingPanel.tsx`

Added a "Your Borrowing Terms" card at the top of the Lending tab that maps the user's risk passport to concrete lending parameters.

- Fetches passport from `/api/v1/zkdefi/risk_passport/user/{address}` on mount
- `deriveBorrowingTerms()` maps `credit_tier` to: LTV (30-80%), Credit Limit (0.5-10 ETH), Interest Rate (2.5-10%)
- 4-column grid: Max LTV, Credit Limit, Interest Rate, Passport Score
- Color-coded tier badge (Prime/Near-Prime/Standard/Substandard/Restricted)
- Empty states: "Connect wallet" vs "Build your risk passport"
- Footer: "Improve your score by completing more transactions and maintaining collateral"

### 3.4 Session Key Wizard

**File:** `frontend/src/components/zkdefi/SessionKeyManager.tsx`

Two additions:

**When no session active:** A 3-column "What you're granting" explainer card appears:
- **Scope:** Rebalances/yield within vault, no external withdrawals or risk profile changes
- **Duration:** User-set expiry (default 24h), revocable anytime
- **Constraints:** Max position size, risk profile, allowed adapters — enforced on-chain with zkML proofs

Footer note: "Session keys use Starknet's native account abstraction — no separate approval transaction needed."

**When session active:** A compact emerald status bar showing "Session active — agent can execute within your constraints" with expiration timestamp.

### 3.5 Interactive Pipeline

**File:** `frontend/src/components/zkdefi/ZKGatePipeline.tsx`

Made all 5 pipeline steps clickable. Each step now has:
- `role="button"`, `tabIndex={0}`, keyboard (`Enter`/`Space`) and click handlers
- `cursor-pointer` class with `hover:border-zinc-500` affordance
- Selected step gets `ring-2 ring-emerald-400/60` highlight

When a step is selected, a detail card renders below the pipeline with:
- Step title and description (what happens at this stage)
- Two-column grid: **Privacy guarantee** (emerald-tinted) and **Output** (neutral)
- Close button to dismiss

Step detail content covers: AI Decision, zkML Circuit Evaluation, Proof Generation (Groth16), On-chain Verification (Garaga), and Execution & Receipt.

### 3.6 LLM Provider Transparency

**File:** `frontend/src/components/zkdefi/BrainVisualizer.tsx`

Added a "Model transparency" section below the brain check results showing the full inference stack:

| Row | Value |
|-----|-------|
| Decision engine | GPT-4o-mini (gpt-4o-mini-2024-07-18) |
| Risk model | Cairo Perceptron v1 (on-chain) |
| Proof system | Groth16 / BN254 (Circom 2.1.6) |
| Verifier | Garaga (Starknet Sepolia) |

Header includes "Deterministic fallback available" note. Values are hardcoded as the inference APIs don't return model metadata.

### 3.7 Cross-Chain Reputation Walkthrough

**File:** `frontend/src/app/profile/page.tsx`

Added a "How Cross-Chain Reputation Works" card as the first element in the Profile Connections tab, before the Dual-Wallet Session section.

4-step visual flow:
1. **Link Wallets** — Connect Ethereum, Arbitrum, Base, or Optimism addresses
2. **Verify Ownership** — Sign a challenge with each EVM wallet
3. **Aggregate History** — Cross-chain DeFi activity privately aggregated into risk passport score
4. **Unlock Benefits** — Higher score → better credit tier → lower rates, higher LTV, priority access

Privacy footer: "Linked addresses are verified off-chain. Your cross-chain history is used as private input to zkML risk models — no raw transaction data is stored or shared."

### 3.8 Expanded zkML Model List

**File:** `frontend/src/components/zkdefi/ModelComposer.tsx`

Expanded from 5 to 12 zkML models. Added `circuit` and `tier` fields to the Model interface.

**New models:**

| Model | Circuit | Description |
|-------|---------|-------------|
| Anomaly Detector | `anomaly_detector.circom` | Flags unusual pool behavior (TVL drops, volume spikes, price manipulation) |
| Impermanent Loss Predictor | `il_predictor.circom` | Estimates IL risk for a given pool pair based on historical volatility |
| Slippage Bound | `slippage_bound.circom` | Proves trade execution stays within slippage tolerance without revealing order size |
| Max Drawdown Guard | `max_drawdown.circom` | Ensures portfolio drawdown stays below threshold before rebalancing |
| Liquidity Depth | `liquidity_depth.circom` | Verifies sufficient pool depth for intended trade size |
| Volatility Regime | `volatility_regime.circom` | Classifies current market conditions (low/medium/high vol) for strategy selection |
| Position Concentration | `position_concentration.circom` | Prevents over-concentration in a single pool or adapter |

Existing models now also show `circuit` and `tier` fields. UI updated to show circuit filename in monospace below descriptions.

---

## Phase 4 — Final Polish (completed 2026-03-04)

### 4.1 Staking Privacy (Hashed Delegation)

**File:** `frontend/src/components/zkdefi/NativeStakingPanel.tsx`

Three additions:

1. **Privacy callout strip** between Network Banner and Global Stats: "Delegation uses a hashed commitment — the staking pool sees a proof of your delegation amount, not your wallet's total balance."

2. **Delegation button privacy note:** "Delegation proof generated locally · ~5s · pool receives commitment only" with Shield icon below the Delegate STRK button.

3. **How Native Staking Works footer** expanded from 3 to 4 columns. Added "Privacy" item: "Delegation amount is committed via Pedersen hash — the pool verifies your stake without seeing your total balance."

### 4.2 Limit Orders Privacy (Commit-Reveal)

**File:** `frontend/src/components/zkdefi/LimitOrdersPanel.tsx`

Four changes:

1. **Added `Shield` import** from lucide-react.

2. **Privacy callout strip** after header, before summary bar: "Limit orders use commit-reveal: your target price and size are committed as a hash. The order fills privately — other traders cannot front-run your limit."

3. **Create form privacy note** below the Place Limit Order button: "Order intent is hashed before submission · revealed only at fill time."

4. **How Limit Orders Work footer** expanded from 3 to 4 columns. Added "4. Privacy Layer": "Your order parameters are committed as a Pedersen hash. The matching engine verifies the commitment at fill time — no price or size leakage before execution."

### 4.3 Interactive Landing Page Flow

**File:** `frontend/src/app/page.tsx`

**"How it works" section** — Converted from 3 static cards to an interactive stepped flow:

- Added `activeStep` state (default 0)
- Three cards are now `<button>` elements with click handlers
- Active step highlighted with emerald border, glow shadow
- Detail panel below shows: extended description, privacy guarantee (with Shield icon), and deep-link to relevant app section

Step detail links:
1. Set constraints → `/agent?v=brain&sub=agent` ("Configure in Brain")
2. Generate proof → `/agent?v=brain&sub=pipeline` ("View Pipeline")
3. Execute → `/agent?v=vault&sub=activity` ("View Activity")

**Solution cards** — Added action links to all 4 "Why zkde.fi is different" cards:
- Programmable Privacy → "Explore in Vault" (`/agent?v=vault`)
- Proof-Gated Execution → "View Pipeline" (`/agent?v=brain&sub=pipeline`)
- Risk Passport → "View Profile" (`/profile`)
- Starknet-Native → "Explore Models" (`/agent?v=brain&sub=models`)

---

## Files Changed (cumulative)

### New files
- `frontend/src/components/zkdefi/CapitalFlowStrip.tsx`
- `frontend/src/app/identity/page.tsx`
- `frontend/src/hooks/useGateContext.ts`

### Modified files (Phase 1-2)
- `frontend/src/app/agent/page.tsx`
- `frontend/src/app/profile/page.tsx`
- `frontend/src/components/zkdefi/vault/VaultSurface.tsx`
- `frontend/src/components/zkdefi/vault/VaultTab.tsx`
- `frontend/src/components/zkdefi/vault/YieldTab.tsx`
- `frontend/src/components/zkdefi/vault/ActivityTab.tsx`
- `frontend/src/components/zkdefi/vault/MarketsTab.tsx`
- `frontend/src/components/zkdefi/surfaces/BrainSurfaceContainer.tsx`
- `frontend/src/components/zkdefi/SwapTab.tsx`
- `frontend/src/components/zkdefi/LiquidityTab.tsx`

### Modified files (Phase 3)
- `frontend/src/components/zkdefi/vault/DepositPanel.tsx` — proof generation feedback strip
- `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx` — proof generation feedback strip
- `frontend/src/components/zkdefi/vault/LendingPanel.tsx` — borrowing terms card
- `frontend/src/components/zkdefi/BrainVisualizer.tsx` — brain check timing note, model transparency section
- `frontend/src/components/zkdefi/AgentRebalancer.tsx` — execution pipeline feedback strip
- `frontend/src/components/zkdefi/ZKGatePipeline.tsx` — interactive step detail cards
- `frontend/src/components/zkdefi/SessionKeyManager.tsx` — session key wizard explainer + active status bar
- `frontend/src/components/zkdefi/ModelComposer.tsx` — expanded model list (5 → 12), circuit/tier fields
- `frontend/src/app/profile/page.tsx` — cross-chain reputation walkthrough, risk passport description

### Modified files (Phase 4)
- `frontend/src/components/zkdefi/NativeStakingPanel.tsx` — hashed delegation privacy callout + footer expansion
- `frontend/src/components/zkdefi/LimitOrdersPanel.tsx` — commit-reveal privacy callout + footer expansion
- `frontend/src/app/page.tsx` — interactive how-it-works flow, solution card deep-links

---

## Phase 5 — Dark Ledger Deposit Flow (2026-03-04)

**Status:** Complete

### Problem
Dark Ledger deposits required users to manually transfer tokens to the operator wallet externally, then paste the transaction hash into the UI. This was a broken UX: users had no way to know the operator address, the tx hash field was confusing, and there was no toast feedback.

### Solution
Automated the entire Dark Ledger deposit flow end-to-end:

1. **Auto-execute ERC20 transfer** — the system fetches the operator vault address via `GET /vault/operator-address`, then executes the token transfer directly through the connected wallet (just like commitment_shield/nullifier_set do approve+deposit).
2. **Auto-capture tx hash** — the transaction hash is captured from the wallet response, eliminating manual input.
3. **Auto-verify and credit** — submits to `POST /ledger/transfer_in/request` which verifies the on-chain transfer receipt and credits the Dark Ledger balance.
4. **Toast notifications** — fires a toast with "View tx" link after the transfer is sent, and a success toast with credited amount after ledger confirmation.
5. **Updated proof stepper** — Dark Ledger deposit steps now show: "Transfer to operator vault" → "Verify on-chain" → "Credit ledger".
6. **Replaced tx hash input** with an info callout explaining the automated flow.
7. **Fixed API URL mismatch** — frontend was calling `/ledger/transfer-in` but backend defines `/ledger/transfer_in/request`.
8. **Added `dark_ledger` to PoolSource** — activity feed now correctly labels Dark Ledger events.

### Double-spend protection
The backend already enforces idempotency: `_has_manual_wallet_receipt_for_tx` rejects duplicate tx hashes (HTTP 409). Tokens physically move to the operator wallet, so they are locked by custody.

### Modified files
- `frontend/src/components/zkdefi/vault/DepositPanel.tsx` — rewrote `depositDarkLedger`, removed manual tx hash input
- `frontend/src/hooks/usePrivacyVault.ts` — updated dark_ledger deposit steps (2 → 3 steps)
- `frontend/src/lib/AppContext.tsx` — added `dark_ledger` to `PoolSource` union
- `frontend/src/components/zkdefi/ActivityLog.tsx` — added Dark Ledger label and color to activity feed
