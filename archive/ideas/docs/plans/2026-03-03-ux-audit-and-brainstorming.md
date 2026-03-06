# zkde.fi UX Audit & Brainstorming

**Date:** 2026-03-03  
**Scope:** Full site crawl in demo/paper mode (no wallet). Component-by-component and tab-by-tab feedback, plus brainstorming for UX/UI optimization.

---

## 1. Summary

- **Landing (`/`)** is strong: clear value prop, privacy tiers, Risk Passport, CTA. Identity nav link from app goes to Profile; standalone `/identity` returns 404.
- **App (`/agent?mode=demo`)** is the main product: four top-level surfaces (Vault, Trade, Brain, Proofs OK) with sub-tabs. Information density is high; empty states and naming could be refined.
- **Profile (`/profile?mode=demo`)** is clear: Trust & Identity, Reputation, Compliance, Connections; paper-mode banner is visible.
- **Demo/paper mode** works: layout is fully usable without a wallet. Some copy still says "Connect wallet" in places; consider paper-mode–specific empty states and CTAs.

---

## 2. Page-by-Page & Tab-by-Tab Feedback

### 2.1 Home (`/`)

| Element | Feedback |
|--------|----------|
| **Nav** | Solution, How it works, Developers, Docs, Launch App — clear. Duplicate "Launch App" in hero and CTA is fine for conversion. |
| **Hero** | "Private strategy. Provable execution." + one-liner is strong. |
| **Privacy tiers (buttons)** | Tier 1–2–3–2H–Coming: good. Long names in buttons (e.g. "Tier 2H Hashed Claims…") may wrap on small screens; consider short label + tooltip. |
| **Risk Passport / How it works / Who it's for** | Good hierarchy. "How zkde.fi compares" and "For developers" sections complete the story. |
| **Footer** | GitHub, Docs, zkd.app, Privacy, Terms, Obsqra Labs — appropriate. |

**Optimization ideas:**  
- Ensure "Launch App" goes to `/agent` (or `/agent?mode=demo` for first-time try).  
- Optional: single "Try without wallet" link next to Launch App for paper mode.

---

### 2.2 App — Top-Level Navigation

| Element | Feedback |
|--------|----------|
| **Logo + tagline** | "zkde.fi" + "Reputation-tiered private DeFi" — clear. |
| **App / Identity** | App keeps you on agent; Identity → `/profile`. Consider renaming "App" to "Dashboard" or "Vault" if it always lands on vault surface to avoid "App" feeling generic. |
| **Connect Wallet** | Prominent. In demo mode it still shows; consider a small "Paper mode" pill in header when `?mode=demo` so users know why wallet isn’t required. |
| **Vault / Trade / Brain / Proofs OK** | Four surfaces. "Proofs OK" appears as "Proofs Warning" when active (likely state-dependent). Unify label: either always "Proofs" or "Proofs status" with a badge for warning/OK. |

**Optimization ideas:**  
- In demo mode: show "Paper mode" in header and optionally soften or hide "Connect Wallet" (e.g. "Connect for real funds").  
- Breadcrumb or subtle indicator of surface + sub-tab (e.g. "Vault › Yield") for deep links and orientation.

---

### 2.3 App — Vault Surface (default)

| Component | Feedback |
|-----------|----------|
| **Sub-tabs** | Vault, Yield, Lending, Activity. "Vault" (main) vs "Vault" (sub-tab) is redundant. Second "Vault" could be "Deposit & withdraw" or "Portfolio". |
| **Privacy primitives (4 cards)** | Commitment Shield, Nullifier Set, Hashed Proof, Dark Ledger — good. Some metrics show "****"; consider tooltip or short explanation so it doesn’t feel like broken data in demo. |
| **STRK / ETH toggle** | Clear. |
| **Deposit** | Balance: "-- STRK" in one snapshot, "0.0000 STRK" in another; normalize. "Deposit with Privacy" disabled with 0 is correct. |
| **Withdraw** | "Select Position" + "No positions yet. Deposit to get started." — good empty state. |
| **Wallet / Shield / Vault / Strategies** | Four summary buttons (0.00 ETH each). Labels could be slightly clearer (e.g. "Shield" → "Shielded balance" on hover). |
| **Privacy View / Public View** | Good. |
| **Positions Overview / Capital Deployed** | Empty; fine for demo. Consider one sentence: "In paper mode, positions are simulated after you deposit." |

**Optimization ideas:**  
- Rename sub-tab "Vault" to "Portfolio" or "Deposit & withdraw".  
- In paper mode, optional "Simulated allocation" preview (e.g. example 40% LP / 30% Lending) so the layout doesn’t look barren.  
- Short info tooltips on primitive cards: what the metric is and why it might be hidden.

---

### 2.4 App — Vault › Yield

| Component | Feedback |
|-----------|----------|
| **Content** | Switch, "Deploy Capital to Ekubo", "Open Lending Tab", and line "Stake collateral or build reputation to unlock borrowing." |
| **Switch** | No accessible name in snapshot; add `aria-label` (e.g. "Enable yield deployment"). |
| **Deploy / Open Lending** | Clear. "Open Lending Tab" could scroll to or open Lending sub-tab with focus. |

**Optimization ideas:**  
- Single flow: "Deploy to Ekubo" could show a short checklist (connect → deposit → deploy) for first-time users.  
- In demo: show a disabled or simulated "Deploy" with tooltip "Connect wallet to deploy."

---

### 2.5 App — Vault › Lending

| Component | Feedback |
|-----------|----------|
| **Your Credit Line / Lending Pool** | Clear. |
| **Supply / Borrow** | Amount (ETH) + Supply / Borrow buttons (disabled). "Improve your line" and "Risk Profile" links — good. |
| **Copy** | "Earn yield by supplying" / "Borrow against your collateral + reputation" — clear. |

**Optimization ideas:**  
- In demo: show example credit line (e.g. "0 ETH" with "Complete onboarding to unlock") and keep Supply/Borrow disabled with one-line explanation.  
- "Risk Profile" could open in same tab or modal so users don’t lose context.

---

### 2.6 App — Vault › Activity

| Component | Feedback |
|-----------|----------|
| **Filters** | Refresh, All, Deposits, Withdrawals, Yields, Rebalances — good. |
| **Empty state** | Only "Activity" heading in snapshot; ensure there’s an explicit empty message (e.g. "No activity yet. Deposits and withdrawals will appear here."). |

**Optimization ideas:**  
- In paper mode: optional "Sample activity" (clearly labeled) to show how the feed looks.  
- Date range or "Last 7 days" filter for when there is data.

---

### 2.7 App — Trade Surface

| Component | Feedback |
|-----------|----------|
| **Sub-tabs** | Markets, Swap, LP, Limits, Staking, Refresh. |
| **Market Intelligence** | "Live signals from Ekubo Sepolia — risk-scored by zkML" — good. |
| **Risk-Scored Opportunities** | Snapshot truncated; ensure table or list has clear headers and empty state when no data. |

**Optimization ideas:**  
- In demo: show 1–2 example risk-scored rows (with "Demo" badge) so the table isn’t empty.  
- Refresh: clarify what it refreshes (e.g. "Refresh prices and signals").

---

### 2.8 App — Brain Surface

| Component | Feedback |
|-----------|----------|
| **Sub-tabs** | Agent Controls, zkML Models, Pipeline, Identity Agents, My Agents, Disclosure. Good range. |
| **Session Keys** | "0 active sessions" / "No session keys granted" / "Grant a session key…" — clear. |
| **zkML Brain Visualization** | Sliders: Volatility, Concentration, Age, Volume; "Sum = 310 (needs > 200 for Tier 0)" — good. Copy for on-chain quick check and Groth16 steps is clear. |
| **How Autonomous Triggering Works** | Numbered list 1–5 — good. |
| **Agent Rebalancer** | "Propose Rebalance", "Enable" (disabled), Gas Mode (Auto/Wallet/Paymaster). |
| **Execution Control** | Passport, Sessions, Dual Wallet Session, Compliance, Gas Mode, Trust decisions. "Identity linkage: not linked (missing)" — clear. |
| **Activity Feed** | "Connect wallet to see your activity" — in demo mode this could say "Paper mode: no live activity" to avoid implying they must connect. |

**Optimization ideas:**  
- In demo: keep sliders and visualization interactive; show "Simulated tier" or "Demo" so users can play without connecting.  
- One-line explanation at top of Brain: "Configure your agent and session keys; in paper mode no real execution occurs."  
- Disclosure sub-tab: ensure it’s obvious what is disclosed to whom (e.g. short summary + link to docs).

---

### 2.9 App — Proofs OK (Proofs Warning)

| Component | Feedback |
|-----------|----------|
| **Label** | Shows as "Proofs Warning" when active. Same content area as Vault (Deposit/Withdraw, etc.). |
| **Intent** | Likely proof status or compliance view; if content is shared with Vault, consider making Proofs a sidebar widget or a distinct content pane (e.g. proof list + status) instead of reusing the vault layout. |

**Optimization ideas:**  
- If this tab is "proof status": show a dedicated proof timeline or list (pending/success/failed) and keep vault content under Vault only.  
- If it’s a gate before actions: name it "Proofs & compliance" and add one sentence describing what "Proofs OK" means (e.g. "All actions are proof-gated; this tab shows status.").

---

### 2.10 Profile (`/profile?mode=demo`)

| Component | Feedback |
|-----------|----------|
| **Nav** | Dashboard, Profile, Connect Wallet; tabs: Trust & Identity, Reputation, Compliance, Connections. |
| **Paper mode banner** | "Paper mode — viewing with demo data. Connect a wallet for your real profile." — good. |
| **CTAs** | "Complete onboarding", "Get Credit Tier", "Build your Risk Profile" — clear. |
| **Portable Identity (ERC-8004) / Risk Passport / Credit Score** | Headings and short copy present; in demo, content may be placeholder. |
| **Identity & Constraints** | "Set up your identity to build your Risk Profile…" — good. |

**Optimization ideas:**  
- Ensure all profile sections have an explicit empty state (e.g. "Complete onboarding to see your Risk Passport").  
- "Dashboard" link: confirm it goes to `/agent` (or intended app entry).  
- Consider same "Paper mode" pill in profile header when `?mode=demo`.

---

## 3. Component-Level Notes

| Component / pattern | Note |
|---------------------|------|
| **Connect Wallet** | Shown even in demo; consider contextual label or "Paper mode" indicator so users aren’t pushed to connect when trying the UI. |
| **Disabled buttons** | Many actions disabled (Deposit, Withdraw, Enable, Supply, Borrow). Good. Add tooltip on hover where possible (e.g. "Enter amount" or "Connect wallet to enable"). |
| **Balance strings** | Mix of "--", "0.00", "0.0000"; standardize format and placeholder (e.g. "0.00" and "--" only when data unavailable). |
| **Sliders (Brain)** | Accessible (readonly in snapshot); ensure labels and "Sum" update are announced for screen readers. |
| **Combobox (Gas Mode)** | Options: Auto, Wallet, Paymaster — clear. |
| **Links** | Identity → Profile; App → stays on agent. No broken links except `/identity` (404). Fix or redirect `/identity` → `/profile`. |

---

## 4. Brainstorming: How to Optimize UX/UI

### 4.1 Onboarding & first run

- **Problem:** Dense screens and many concepts (privacy tiers, proofs, session keys, risk passport).  
- **Ideas:**  
  - Optional 3–4 step product tour on first visit (skip + "Don’t show again").  
  - Tooltips or (i) on privacy primitives, "Proofs OK", and Risk Passport.  
  - Dedicated "How it works" under Brain or in footer that mirrors landing but in-app.  
  - Paper mode entry from landing: single "Try app without wallet" that goes to `/agent?mode=demo` and shows a one-time hint: "You’re in paper mode. Connect wallet when ready."

### 4.2 Naming & hierarchy

- **Problem:** "Vault" (surface) vs "Vault" (sub-tab); "Proofs OK" vs "Proofs Warning"; "App" vague.  
- **Ideas:**  
  - Rename sub-tab "Vault" → "Portfolio" or "Deposit & withdraw".  
  - One term for proof status: e.g. "Proofs" with badge (OK / Warning) or "Proof status".  
  - Top-level: "Dashboard" (or keep "App") with sub-navigation making it clear: Vault | Trade | Brain | Proofs.

### 4.3 Empty & demo states

- **Problem:** Many zeros and "---" in paper mode; tables (Trade, Activity) empty.  
- **Ideas:**  
  - Paper mode: optional "Show sample data" toggle for allocations, one or two example activity rows, and example risk-scored opportunities (all clearly "Demo" or "Sample").  
  - Empty states: one sentence per section (e.g. "Deposit to see positions here." / "Connect wallet for live activity.").  
  - In demo, replace "Connect wallet to see…" with "Paper mode: no live data" where appropriate.

### 4.4 Information density

- **Problem:** Lots of info on one screen (vault: primitives + deposit + withdraw + positions + allocation).  
- **Ideas:**  
  - Collapsible sections (e.g. "Privacy primitives", "Positions overview") with "Expand" / "Collapse all".  
  - Optional "Compact" view (fewer cards, smaller type) in settings or toggle.  
  - Sticky sub-tabs on scroll so users don’t lose navigation when scrolling.

### 4.5 Consistency & polish

- **Ideas:**  
  - Standardize number format (e.g. 2 decimals for tokens, "--" when N/A).  
  - Standardize button states: disabled + tooltip; loading state for async actions.  
  - Ensure "Proofs Warning" has one place that explains why (e.g. tooltip or link to status/FAQ).  
  - Fix `/identity` → redirect to `/profile` or add a minimal Identity page that redirects.

### 4.6 Accessibility & clarity

- **Ideas:**  
  - `aria-label` on icon-only or unclear controls (e.g. Yield switch, Refresh).  
  - Headings hierarchy: one `h1` per page, then `h2`/`h3` for sections (already largely in place).  
  - Focus management: after tab switch or modal close, focus moves to the new content or a logical target.

### 4.7 Paper mode as a first-class path

- **Ideas:**  
  - Header pill: "Paper mode" when `?mode=demo`, with optional "Connect wallet" secondary.  
  - From landing: "Launch App" and "Try without wallet" (→ `/agent?mode=demo`).  
  - In app, when in paper mode: soft CTA at bottom or in sidebar: "Ready to use real funds? Connect wallet."

---

## 5. Suggested Priorities

1. **Quick wins:** Fix `/identity` (redirect to `/profile`). Unify "Proofs OK" / "Proofs Warning" label. Add "Paper mode" indicator in header when `?mode=demo`. Standardize balance/placeholder copy.  
2. **Clarity:** Rename Vault sub-tab "Vault" → "Portfolio" (or similar). Add one-line empty states and optional tooltips on disabled actions.  
3. **Demo experience:** Optional sample data toggle in paper mode; replace "Connect wallet" copy in key empty states with "Paper mode" where appropriate.  
4. **Deeper:** Optional product tour; collapsible sections; dedicated Proofs content if the tab is meant to show proof status.

---

*Crawl performed in browser (demo mode) on 2026-03-03. Screenshot captured for Vault surface.*
