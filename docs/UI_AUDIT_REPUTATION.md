# Reputation UI Audit

**Date:** 2026-03-05  
**Purpose:** Identify components to keep, replace, or consolidate for Credit & Reputation Hub integration

---

## Current Components (KEEP - Used Elsewhere)

### ProfileJourneyBanner
- **Location:** `frontend/src/components/zkdefi/ProfileJourneyBanner.tsx`
- **Usage:** Profile page - user onboarding guidance
- **Status:** ✅ Keep - provides UX guidance

### RiskProfileSummaryCard
- **Location:** `frontend/src/components/zkdefi/RiskProfileSummaryCard.tsx`
- **Usage:** Profile page - risk assessment summary
- **Status:** ✅ Keep - displays risk passport data

### CompliancePanel
- **Location:** `frontend/src/components/zkdefi/CompliancePanel.tsx`
- **Usage:** Profile page compliance tab - regulatory info
- **Status:** ✅ Keep - handles compliance display

### AIInsightsCard
- **Location:** `frontend/src/components/zkdefi/AIInsightsCard.tsx`
- **Usage:** Various pages - AI-driven insights
- **Status:** ✅ Keep - provides zkML insights

---

## Current Components (REPLACE/CONSOLIDATE)

### Reputation Tab Content (Profile Page)
- **Location:** `frontend/src/app/profile/page.tsx:972-1050+`
- **Current Structure:**
  - **Lines 980-997:** Stats grid (4 cards)
    - Access Tier (tier_name, color-coded)
    - Account Age (tenure_days)
    - Transactions (successful_txns)
    - Collateral (collateral_eth)
  - **Lines 1000-1050+:** On-Chain Reputation section
    - Live contract reads
    - Reputation score, tier, collateral, collaborative score
    - Successful/failed txs, total volume, relayer access
- **Issues:**
  - Basic stats, no credit line context
  - No lending/borrowing integration
  - No FICO pack proof status
  - No explainability (how credit is computed)
  - No system perks display
- **Action:** 🔄 **REPLACE** with `CreditReputationHub`

### Components Referencing Reputation (Scattered)
Found reputation/tier/credit references in 20+ components:
- `AgentBuilder.tsx` - uses reputation for agent creation
- `AgentDashboard.tsx` - displays agent reputation
- `AgentLeaderboard.tsx` - ranks agents by reputation
- `LendingPanel.tsx` - uses credit for borrowing limits
- `MyAgents.tsx` - shows agent tier/reputation
- `AutomationControlPanel.tsx` - tier-based execution permissions
- `CompliancePanel.tsx` - compliance tier requirements
- `DexPanel.tsx` - tier-based swap limits
- `EkuboLpPanel.tsx` - LP access based on tier

**Status:** ✅ Keep - these are valid consumers of reputation data, not display components

---

## Missing (BUILD)

### Credit Line Visualization
- **Need:** Unified display of total credit line
  - Collateral-backed credit (80% LTV)
  - Unsecured credit (reputation-based)
  - Breakdown with visual bar chart
  - Rate display (APY)
  - Active multipliers (cross-chain, credit graph)
- **Component:** `CreditLineVisualizer.tsx`

### FICO Pack Proof Status
- **Need:** Display of all 5 reputation circuit proofs
  - Solvency, Risk Passport, Trader Performance, Strategy Integrity, Execution Integrity
  - Status indicators (complete/pending/available)
  - Perks unlocked by each proof
  - "Generate Proof" buttons
- **Components:** 
  - `ProofCard.tsx` (individual proof)
  - `FicoPackProofPanel.tsx` (all 5 proofs)

### Lending Positions Display
- **Need:** Show lending activity inline with credit
  - Total borrowed (active loans)
  - Total supplied (active supplies)
  - Link to detailed Lending Panel
- **Component:** `LendingPositionsSummary.tsx`

### Explainability Panel
- **Need:** Show how credit line is computed
  - Scoring method (Formulaic / Predictive zkML / RISC Zero)
  - Formula breakdown (tier × letter × credit weights)
  - Factor contributions
  - Multiplier calculations
- **Component:** `ExplainabilityPanel.tsx`

### System Perks Display
- **Need:** Show proof-gated features
  - Unlocked perks (green cards)
  - Available perks (what's needed to unlock)
  - Perk descriptions
- **Component:** `SystemPerksPanel.tsx`

### Tier Card with Upgrade Path
- **Need:** Better tier display than current basic card
  - Current tier with icon & color
  - Tier description (Strict/Standard/Express)
  - Upgrade requirements with progress
  - "Upgrade" button when eligible
- **Component:** `TierCard.tsx`

---

## API Endpoints Used

### Current (Profile Page)
- `GET /api/v1/zkdefi/reputation/user/{address}` → User reputation
- `GET /api/v1/zkdefi/risk_profile/v2/{address}` → Risk profile v2
- `GET /api/v1/zkdefi/onchain_reputation/{address}` → On-chain reputation (contract reads)

### New (Credit Hub)
- `GET /api/v1/zkdefi/profile/decision?address={address}` → Credit line decision
- `GET /api/v1/zkdefi/lending/positions/{address}` → Lending positions
- `GET /api/v1/zkdefi/lending/pool` → Pool stats (for context)
- (Future) `GET /api/v1/zkdefi/reputation/proofs/{address}` → Proof statuses

---

## Integration Points

### Profile Page
- **Current:** Inline reputation tab content (lines 972-1050+)
- **New:** Replace with `<CreditReputationHub address={effectiveAddress!} />`
- **Impact:** Cleaner code, modular components

### Vault Page
- **Current:** Separate LendingPanel
- **New:** Link from CreditReputationHub → LendingPanel
- **Impact:** Better UX flow (credit → lending)

### Agent Page
- **Current:** Uses reputation for autonomous execution permissions
- **New:** Continue using reputation API, no changes needed
- **Impact:** None (consumer only)

---

## Cleanup Tasks

### 1. Remove Old Stats Grid
- **File:** `frontend/src/app/profile/page.tsx:980-997`
- **Action:** Delete (replaced by TierCard + CreditOverviewPanel)

### 2. Remove Old On-Chain Reputation Section
- **File:** `frontend/src/app/profile/page.tsx:1000-1050+`
- **Action:** Consolidate into CreditReputationHub (if needed) or remove
- **Note:** On-chain data still valuable, but should be part of Overview tab, not separate section

### 3. Verify No Orphaned State
- **Check:** Profile page state variables used only by old reputation tab
  - `userRep`, `userRepError`, `onChainRep`, `onChainRepLoading`
- **Action:** Keep (used by new CreditReputationHub via props/context)

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| Keep (unchanged) | 4 | ProfileJourneyBanner, RiskProfileSummaryCard, CompliancePanel, AIInsightsCard |
| Replace/Consolidate | 1 | Reputation tab content (lines 972-1050+) |
| Build (new) | 8 | TierCard, CreditLineVisualizer, LendingPositionsSummary, CreditOverviewPanel, ProofCard, FicoPackProofPanel, ExplainabilityPanel, SystemPerksPanel |
| Cleanup | 2 | Old stats grid, old on-chain section |

**Net Result:** Cleaner, more modular UI with integrated credit/lending/proof status
