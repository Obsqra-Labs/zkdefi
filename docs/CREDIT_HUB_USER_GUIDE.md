# Credit & Reputation Hub — User Guide

**Location**: Profile → **Reputation** tab (after connecting wallet or using Demo Mode)

---

## What It Is

The Credit & Reputation Hub is your central place for:

- **Tier & upgrade path** — See your access tier (Strict / Standard / Express) and what’s needed to upgrade
- **Credit line** — Total available credit, split into collateral-backed and reputation-based (unsecured)
- **Lending positions** — Borrowed and supplied amounts with a link to the full Lending panel
- **FICO Pack proofs** — Status of the 5 reputation proofs and what each unlocks
- **Explainability** — How your credit line is computed (formula or predictive model)
- **System perks** — Which perks are unlocked now and which are still locked (and what’s required)

---

## Tabs

### 1. Overview

- **Tier card**: Current tier (0/1/2), short description, and “Next tier requires” with progress.  
  If you’re eligible, an **Upgrade to Tier X** button is shown.
- **Credit line**: Total available (ETH), bar breakdown (collateral vs unsecured), borrow rate, and any active boosts (e.g. cross-chain, credit graph).
- **Lending positions**: Total supplied and borrowed (ETH) and number of positions.  
  If none: “No active lending positions” and a link to the Lending pool.  
  **Manage Positions →** goes to `/vault?tab=lending`.

### 2. FICO Pack Proofs

Lists the 5 proofs with:

- **Title & short description**
- **Status**: Complete ✅ / Pending ⏳ / Available 🔓
- **Unlocks**: Bullet list of perks that proof gives
- **Generate Proof** (only when status is “Available”)

Proofs:

- **Solvency** — Assets > liabilities without revealing amounts  
  Unlocks: higher credit line, unsecured lending, reduced liquidation penalty
- **Risk Passport** — Risk tier meets minimum  
  Unlocks: Express tier, autonomous agents, priority access
- **Trader Performance** — Positive P&L / win rate  
  Unlocks: trading fee discount, leveraged strategies
- **Strategy Integrity** — Strategy parameters within bounds  
  Unlocks: custom strategies, higher limits
- **Execution Integrity** — Execution within slippage/deviation rules  
  Unlocks: relayer fee discount, MEV protection

### 3. Explainability

- **Scoring method**: Formulaic / Predictive zkML / RISC Zero
- **Formulaic**: Unsecured capacity formula (tier × letter × credit × 5 ETH), factor weights, cross-chain and credit-graph boosts, total unsecured
- **Predictive**: Credit class (e.g. AAA/AA/A) and short note on model (e.g. XGBoost zkML, 38 features)
- **Collateral-backed**: Staked ETH × 80% LTV and resulting collateral-backed credit (ETH)

### 4. System Perks

- **Unlocked**: Green cards — perks you have (proofs + tier met)
- **Available to unlock**: Grey cards — what’s still locked and what’s required (e.g. “solvency proof + Tier 2”)

---

## Tier Upgrades

- **Tier 0 → 1 (Standard)**: 7+ days account age, 3+ successful transactions  
  Use **Upgrade to Tier 1** in the Overview tier card when shown.
- **Tier 1 → 2 (Express)**: 1+ ETH staked collateral and (in practice) Risk Passport proof  
  Stake in Vault/collateral flow, then complete Risk Passport in FICO Pack Proofs; **Upgrade to Tier 2** appears when eligible.

---

## Lending

- Overview shows a **Lending positions** summary (supplied/borrowed).
- Use **Visit Lending Pool** or **Manage Positions →** to go to the full Lending UI at `/vault?tab=lending`.

---

## FAQ

**Why is my unsecured credit 0?**  
You need at least Standard tier (1), a letter rating of C or better, and a credit tier (e.g. B or better). If any of these are missing, unsecured capacity is 0.

**How do I increase my credit line?**  
(1) Stake more collateral (80% LTV), (2) Upgrade tier, (3) Complete FICO Pack proofs (e.g. Solvency gives a +20% style boost where configured).

**What’s the difference between Formulaic and Predictive scoring?**  
Formulaic uses fixed rules (tier/letter/credit weights). Predictive uses an ML model (e.g. XGBoost zkML with 38 features) and can give different (often higher) capacity for complex profiles.

**Can I borrow without collateral?**  
Yes, if you have Express tier (2), Solvency + Risk Passport proofs, and are within the unsecured cap. The hub and Lending panel reflect your current limits.

---

## Support

Docs: [obsqra.xyz/docs](https://obsqra.xyz/docs)  
For product or API issues, refer to project support channels.
