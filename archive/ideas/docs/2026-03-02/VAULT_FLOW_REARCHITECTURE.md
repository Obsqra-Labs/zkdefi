# Vault Flow Re-architecture Plan

Date: 2026-03-02  
Scope: VaultSurfaceContainer.tsx rewrite + privacy/LP/yield flow correction  
Depends on: WP-1 through WP-7 (complete)

---

## Problem Statement

The current Vault surface has structural issues:

1. **Privacy pools are destinations, not modes.** The "Privacy Pools" sub-tab presents ShieldedPoolPanel (Pool B), FullPrivacyPoolPanel (Pool C), and HashedWithdrawPoolPanel (Pool D) as three separate UIs. But privacy is a *property of how you deposit/withdraw*, not a place you go. The zombie `PrivacyUnifiedActionCard` actually gets this right — it treats `unlinkable_basic` / `hidden_flow` / `hashed_claims` as **modes** on a single deposit/withdraw card.

2. **JediSwap references everywhere.** `AllocationPools` shows 80/20 JediSwap/Ekubo splits. `MarketData` in the dashboard shows JediSwap APY/TVL side-by-side. Product is Ekubo only.

3. **LP deploy redirects away from the vault.** A link says "Open LP in Trade" — but deploying vault capital into LP positions should happen *from the vault*, where the capital lives. The zombie `VaultDashboardPanel` already has this as a proper inline Deploy mode.

4. **No unified deploy capital flow.** There's no single place where you say "take my idle vault capital and deploy it to LP, privacy pools, staking, etc." VaultDashboardPanel has `executeAllocation()` with risk profiles — this is closer to what's needed.

5. **AI/LLM recommendation and LP management are disconnected from the vault.** The backend has rich capabilities (LLM narration, AI pool recommendations, recenter alerts, yield harvesting, autonomous agent) but the vault surface only shows a static market data card with no actions.

6. **Yield is invisible.** Fee earnings, APR per position, in-range/out-of-range status, harvest triggers — all of this exists in the backend and in `LiquidityTab`/`VaultDashboardPanel` but isn't surfaced as a vault-level view.

---

## Existing Capabilities Inventory

### Backend APIs (already built, ready to surface)

| API Client | Function | What It Does |
|---|---|---|
| `strategies.ts` | `recommend(user, risk, amount)` | AI pool allocation recommendations |
| `strategies.ts` | `executeAllocation(amount, risk, user)` | Deploy capital across recommended pools |
| `strategies.ts` | `getRebalancePlan(owner, risk)` | Drift detection + rebalance actions |
| `strategies.ts` | `getYieldSnapshot(owner)` | Per-position yield: fees USD, APR, harvest status, tick range |
| `strategies.ts` | `harvestYield(owner)` | Trigger fee collection across all positions |
| `strategies.ts` | `fetchNarration(type, data)` | LLM explanations: gate_evaluation, strategy_recommendation, idle_capital, errors, pending_claims |
| `strategies.ts` | `getAutoAgentStatus/start/stop/pause/resume` | Autonomous rebalancing agent lifecycle |
| `strategies.ts` | `getVaultPolicy/updateVaultPolicy` | Full policy: risk budget, strategy perms, venue/token allowlists |
| `strategies.ts` | `getUserConstraints(user)` | Onboarding state, risk profile, session, identity verification |
| `ekubo.ts` | `getLpRecommendation(user, risk)` | AI LP pool/amount suggestions |
| `ekubo.ts` | `getEkuboPositions(owner)` | All tracked LP positions |
| `ekubo.ts` | `buildCollectFeesTx(owner, posId)` | Fee harvest calldata |
| `ekubo.ts` | `importOnchainPositions(owner)` | Discover NFT positions on-chain |
| `ekubo.ts` | `previewLp/buildLpAddTx/buildLpRemoveTx` | Full LP lifecycle |
| `ekubo.ts` | `getMarketSurface()` | Venue stats + opportunity list |

### Frontend Components (existing, to reuse/integrate)

| Component | Status | What's Valuable |
|---|---|---|
| `VaultDashboardPanel` | Zombie | Full deposit flow, deploy mode with risk profiles, yield/rebalance quick-links, live STRK price, active positions list, identity constraints, risk profile selector, framer-motion transitions |
| `LpRecommendationCard` | Active (in LiquidityTab) | AI recommendation with risk profile toggle, pool cards with APY/TVL/volume, "Apply" → prefills LP form |
| `LiquidityTab` | Active (in TradeSurface) | Full LP position management: list, collect fees, close, recenter alerts, import on-chain, available pools browser |
| `EkuboLpPanel` | Active (in LiquidityTab) | Guided + Advanced LP add/remove with gate enforcement, preview, reconciliation |
| `PrivacyUnifiedActionCard` | Zombie | Privacy mode selector (basic shielded / full privacy / hashed claims) as deposit property, not separate panels |
| `MarketIntelligencePanel` | Active (in EkuboOperateHub) | Venue stats, opportunity rows, "Trigger AI" + "Use pair" actions |
| `AutomationControlPanel` | Active (in BrainSurface) | Agent start/stop/pause/resume with LLM narration |
| `AgentRebalancer` | Active (in BrainSurface) | Proposal lifecycle, autonomous agent control, zkML gate checks |
| `PendingClaimsCard` | Active | Yield positions with pending claims, LLM narration |

---

## Target Architecture: New Vault Sub-tabs

### Tab 1: **Portfolio** (replaces "overview")

Unified portfolio view — the "home" of your capital.

**Top banner:**
- Total vault value (idle + deployed + yield earned)
- Live STRK/ETH/USD prices (from VaultDashboardPanel's oracle feed)
- Privacy tier badge + session key status

**Portfolio cards row:**
- Vault balance (idle capital available to deploy)
- Total deployed (across LP + privacy pools)
- Total yield earned
- Estimated APY (blended across all positions)

**Allocation breakdown bar:**
- LP % / Privacy Pool % / Staking % / Idle %  (already exists in VaultStore)

**Active positions list:**  (pattern from VaultDashboardPanel)
- Each position: venue, pair, amount, allocation, in-range indicator
- Quick actions: collect fees, close position

**Deposit / Withdraw section:**
- `VaultFundingCard` (existing) for deposits
- Privacy mode selector (from `PrivacyUnifiedActionCard` pattern):
  - Basic Shielded (unlinkable_basic)
  - Full Privacy (hidden_flow)  
  - Hashed Claims (hashed_claims)
  - Mode applies to deposit routing, not pool selection
- `UnifiedWithdrawCard` (existing) for withdrawals

---

### Tab 2: **Deploy** (replaces "dashboard")

THE canonical place to deploy idle vault capital. Merges the best of VaultDashboardPanel + LpRecommendationCard + MarketIntelligencePanel.

**Available capital card:**
- Liquid balance ready to deploy
- Risk profile selector: Conservative / Balanced / Aggressive  (from VaultDashboardPanel)

**AI Recommendation section:**
- `LpRecommendationCard` (move from Trade → Vault) — "AI LP Recommendation"
  - Risk-profile-aware pool suggestions
  - Per-pool: pair, APY, TVL, volume, fee tier, suggested allocation %
  - "Apply" button feeds into inline deploy

**Deploy targets:**

*Ekubo LP Positions:*
- Inline `EkuboLpPanel` (guided mode) — add liquidity from vault  
- Pool browser from `MarketIntelligencePanel` opportunity data
- Pre-fill from AI recommendation "Apply" flow

*Privacy Pools:*
- Privacy deposit using current mode (from Portfolio's mode selector)
- Amount + pool type selection
- Commitment generation + on-chain deposit
- (This replaces the separate ShieldedPoolPanel/FullPrivacyPoolPanel tabs)

*One-Click AI Allocation:*
- `executeAllocation()` — AI deploys capital across multiple pools in one action
- Shows deployment plan before execution
- Post-deploy: position confirmation + yield tracking begins

**Market intelligence:**
- Venue opportunity cards (from `MarketIntelligencePanel`)
- "Trigger AI" → LLM narration of recommendation reasoning

---

### Tab 3: **Yield** (replaces "pools")

Unified earnings + position optimization across ALL deployed capital.

**Yield summary cards:**
- Total fees earned (USD)
- Active positions count
- Average APR across portfolio
- Pending unharvested fees

**Per-position yield table:** (from `getYieldSnapshot` + `getEkuboPositions`)
- Position: pair, venue, fee tier
- Amounts: deposited, current
- Fees: earned USD, APR estimate
- Range status: in-range / near-range / out-of-range (live tick comparison)
- Actions: Harvest fees, Close position

**Rebalance analysis:** (from `getRebalancePlan`)
- Drift detection: current weight vs target weight per pool
- Needs rebalance banner (amber if drift > threshold)
- Action items: add / remove / rotate with amounts
- One-click rebalance execution
- Attestation hash for audit trail

**Recenter alerts:**
- Positions that have drifted out of range
- "Recenter" one-click action

**LLM narration:**
- `fetchNarration("idle_capital", ...)` — explain why idle funds should be deployed
- `fetchNarration("strategy_recommendation", ...)` — explain rebalance reasoning

---

### Tab 4: **Ledger** (keep as-is)

Already clean: VaultLedger + Receipt Aggregator timeline. No changes needed.

---

## Components to Remove from Vault Pools Tab

| Component | Action |
|---|---|
| `ShieldedPoolPanel` | Remove as separate tab panel. Privacy deposit becomes a mode on the Deploy tab. Component stays importable for the privacy deposit flow within Deploy. |
| `FullPrivacyPoolPanel` (+ pool_c variant) | Same — moves into Deploy as the "Full Privacy" mode deposit path. |
| `HashedWithdrawPoolPanel` | Remove entirely (was a stub/placeholder). |
| `AllocationPools` | Rewrite to be Ekubo-only. Remove JediSwap allocation splits. |
| Market data JediSwap section | Remove from dashboard. Ekubo only. |
| "Deploy to Ekubo" redirect link | Replace with inline Deploy tab. |

## Components to Resurrect / Move

| Component | From | To |
|---|---|---|
| `VaultDashboardPanel` patterns | Zombie | Portfolio tab (deposit flow, live prices, active positions, risk profiles) + Deploy tab (deploy mode, risk selector) |
| `PrivacyUnifiedActionCard` patterns | Zombie | Portfolio tab (privacy mode selector on deposit card) |
| `LpRecommendationCard` | Trade LiquidityTab | Deploy tab (AI LP recommendation) |
| `MarketIntelligencePanel` | EkuboOperateHub (zombie) | Deploy tab (opportunity cards) |
| `PendingClaimsCard` | Unknown mount | Yield tab (pending harvest claims) |

## Components NOT Moved (stay in their current surface)

| Component | Surface | Reason |
|---|---|---|
| `LiquidityTab` | Trade | Advanced LP management (guided/advanced add, pool browser) stays in Trade. Vault Deploy provides the "quick deploy" path. |
| `EkuboLpPanel` | Trade (via LiquidityTab) | Inline LP form. Can be imported into Vault Deploy tab for simple add-liquidity flow. |
| `AgentRebalancer` | Brain | Proposal lifecycle + autonomous agent control is Brain-surface responsibility. |
| `AutomationControlPanel` | Brain | Agent start/stop/pause/resume stays in Brain. |

---

## JediSwap Removal Scope

| File | What to Change |
|---|---|
| `VaultSurfaceContainer.tsx` | Remove `jediswap` from `MarketData` interface. Remove JediSwap market data card from Dashboard. |
| `AllocationPools.tsx` | Rewrite: remove "80/20 JediSwap/Ekubo" splits. Pools become Ekubo risk tiers (conservative/balanced/aggressive Ekubo pools). |
| `AgentRebalancer.tsx` | `PROTOCOL_NAMES` array includes "JediSwap (legacy)" — remove or relabel. |
| Backend `strategies.py` | Already Ekubo-centric via `fetch_pool_metrics()` from Ekubo API. The `recommend` endpoint may still reference JediSwap in older pool data — check and clean. |

---

## Implementation Sequence

### WP-8a: Portfolio Tab Rewrite (2-3 days)
- Restructure overview tab as Portfolio
- Add privacy mode selector (from PrivacyUnifiedActionCard)
- Add active positions list (from VaultDashboardPanel pattern)
- Add live prices (from VaultDashboardPanel)
- Remove JediSwap from MarketData interface
- Add total yield display

### WP-8b: Deploy Tab (2-3 days)  
- Replace dashboard tab with Deploy
- Move LpRecommendationCard into Deploy
- Inline EkuboLpPanel for quick LP deployment
- Privacy pool deposit as mode (not separate panels)
- One-click AI allocation flow (executeAllocation)
- Market intelligence opportunity cards

### WP-8c: Yield Tab (2-3 days)
- Replace pools tab with Yield
- Yield summary cards from getYieldSnapshot
- Per-position table with range status + harvest actions
- Rebalance analysis panel from getRebalancePlan
- LLM narration integration
- Recenter alerts

### WP-8d: Cleanup + JediSwap Removal (1 day)
- Remove JediSwap references across codebase
- Clean AllocationPools to Ekubo-only
- Remove/archive HashedWithdrawPoolPanel
- Update types (remove jediswap from MarketData)

---

## Acceptance Criteria

- [ ] Vault Portfolio shows total capital: idle + deployed + earned
- [ ] Privacy tier is a deposit mode, not a tab destination
- [ ] Deploy tab has AI recommendation (LpRecommendationCard) + risk profile selector
- [ ] Deploy tab can add LP position inline without redirecting to Trade
- [ ] Deploy tab has one-click AI allocation (executeAllocation)
- [ ] Yield tab shows per-position earnings with in-range indicators
- [ ] Yield tab has harvest action (buildCollectFeesTx) per position
- [ ] Yield tab has rebalance analysis with drift detection
- [ ] LLM narration appears for strategy recommendations + idle capital
- [ ] No JediSwap references anywhere in the frontend
- [ ] Ledger tab unchanged
- [ ] Build succeeds, PM2 restart, no regressions
