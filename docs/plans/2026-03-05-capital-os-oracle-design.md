# Capital OS + AI Oracle — Design (Phase 1)

**Date:** 2026-03-05  
**Status:** Approved  
**Scope:** Frontend reshell — unify agent layout into Capital OS mental model, add Oracle surface (Signals / Radar / Genome), restructure Vault to absorb execution (Trade, Lending, Staking). No new backend services in Phase 1.

---

## 1. Objective

Evolve zkde.fi from a 3-surface tab layout (Vault | Trade | Brain) into a **Capital OS** layout:

- **Capital OS strip** — Identity | Gate | Ledger (replaces CapitalFlowStrip + AIZkmlBanner).
- **Vault** — Capital layer; absorbs Trade execution (Swap, LP, Limits, Lending, Staking) and keeps Portfolio, Yield, Activity.
- **Oracle** — New surface replacing Trade: AI Oracle (Signals, Radar, Genome).
- **Brain** — Unchanged: agent controls, zkML models, pipeline, agents.

Design principles: clarity, verifiability, capital flow, explainability. Functional over decorative.

---

## 2. Page Layout

### 2.1 Overall structure

```
Header (logo, nav, ConnectButton)
Capital OS Strip [ Identity | Gate | Ledger ]
Surface tabs: Vault | Oracle | Brain
Surface content
```

- **Capital OS Strip:** Single compact bar, always visible. Replaces existing CapitalFlowStrip and AIZkmlBanner.
- **Surface tabs:** Three tabs only. "Trade" is removed; its execution content moves into Vault; its intelligence content becomes Oracle.

### 2.2 URLs

- `?v=vault` — Vault surface (default sub: portfolio).
- `?v=oracle` — Oracle surface (default sub: signals).
- `?v=brain` — Brain surface.
- Sub-tabs: `&sub=portfolio|yield|trade|lending|staking|activity` (Vault); `&sub=signals|radar|genome` (Oracle).
- **Redirects:** `?v=trade` → `?v=oracle`. Legacy `?tab=...` mapped to appropriate `v` and `sub` so bookmarks keep working.

---

## 3. Capital OS Strip

Three segments in one horizontal bar.

### 3.1 Identity segment

- Truncated address or Stark ID (e.g. `0x91a7...3fa`).
- Agent tier badge (Pathfinder / Standard / Strict).
- Proof count (e.g. "342 proofs").
- **Click:** navigates to `/profile`.

**Data:** Risk passport v2, reputation tier APIs, proof/receipt counts. Demo: hardcoded sample (tier + count).

### 3.2 Gate segment

- Risk tolerance label (Conservative / Moderate / Aggressive).
- Policy status indicator (dot: green = all clear, yellow = warnings, red = blocked).
- Allowed strategy count (e.g. "4/6 strategies allowed").
- **Click:** opens Gate detail popover (allowed vs blocked strategy types, zkML policy verification, last proof ref).

**Data:** Vault policy, user constraints (`/strategies/user-constraints/{address}`). Demo: "Moderate", "4/6 allowed".

### 3.3 Ledger segment

- Last entry summary (e.g. "LP Deploy +2,400 STRK").
- Total receipt count.
- **Click:** scrolls to Vault → Activity or opens ledger overlay (Phase 1: scroll to Activity).

**Data:** Activity API, receipts API. Demo: 2–3 sample ledger lines.

### 3.4 Demo mode

When `?mode=demo` or no wallet: strip shows seeded data (e.g. "Demo Agent | Moderate | 12 receipts"). Optional "Demo mode" pill in strip or header.

---

## 4. Oracle Surface (replaces Trade)

Three sub-tabs: **Signals** | **Radar** | **Genome**.

### 4.1 Sub-tab: Signals

- **Signal stream:** Cards per strategy. Each card: strategy name, yield trend (Growing/Stable/Surging/Declining), volatility (Low/Moderate/High), risk scan (Safe/Warning/Elevated), proof status (Verified/Experimental).
- **Recommended actions:** List of Oracle proposals (e.g. "Allocate 12% to STRK/ETH Ekubo LP"). Each row: [Approve] [Modify] [Ignore]. If no proposals API, derive 1–2 from top opportunities for Phase 1.
- **Model transparency:** Collapsible section — active models (Yield Forecast, Anomaly Detector, Volatility), model hash, last proof hash, [View Proofs] link.

**Data:** `POST /strategies/opportunities`; recommend/allocate endpoints; zkML/proof APIs for model hashes. Demo: 4–6 seeded signal cards, 2–3 sample recommendations.

### 4.2 Sub-tab: Radar

- **Opportunity map:** Interactive scatter plot (e.g. Recharts). X = risk score, Y = yield (APY). Each point = one strategy; size = signal strength; color = green/yellow/red by opportunity level. Tooltip on hover; click → navigate to Genome for that strategy.
- **Top opportunities:** Ranked list below the plot. Each row: name, signal strength bar, risk, yield, [Allocate] CTA. Allocate deep-links to Vault (e.g. Trade or allocation flow).

**Data:** Same `POST /strategies/opportunities`. No new backend.

### 4.3 Sub-tab: Genome

- **Strategy selector:** Dropdown or list from same opportunity set. Single or multi-select for compare.
- **Bar view (default):** For selected strategy(s), five horizontal bars: Yield source, Risk exposure, Volatility sensitivity, Liquidity depth, Capital efficiency (0–100). Phase 1: derived in frontend from opportunity fields (e.g. apy → yield factor, risk_score → risk factor, tvl → liquidity).
- **Compare mode:** When 2+ strategies selected: bars side-by-side; optional radar chart (5 axes, one polygon per strategy).
- **Proof refs:** Per strategy, link(s) to relevant proofs when available from existing APIs.

No new backend in Phase 1; no persistent Strategy table.

---

## 5. Vault Surface Restructure

### 5.1 Sub-tabs

**Before:** Portfolio (Vault) | Yield | Lending | Activity.  
**After:** Portfolio | Yield | Trade | Lending | Staking | Activity.

### 5.2 Content

- **Portfolio:** Unchanged — deposit/withdraw, positions, privacy tier, risk board.
- **Yield:** Unchanged — blended APY, yield sources (Ekubo LP, Lending, Staking, Idle), Deploy to Ekubo card, yield chart.
- **Trade:** Content moved from old Trade surface. Inner sub-tabs or segmented control: **Swap** (existing swap UI), **LP** (add/remove LP, positions, recenter), **Limits** (limit orders). Optional: compact "Top opportunities" strip or CTA "See full list in Oracle".
- **Lending:** Unchanged, first-class — supply, borrow, repay, positions (LendingPanel).
- **Staking:** Promoted to own sub-tab — delegation, rewards, exit (NativeStakingPanel).
- **Activity:** Unchanged — activity log, proof timeline, filters.

All execution (Swap, LP, Limits, Lending, Staking) lives under Vault. Oracle "Allocate" CTAs route user to Vault (e.g. Trade or allocation flow).

---

## 6. Brain Surface

No structural change. Sub-tabs: Agent Controls | zkML Models | Pipeline | Agents. All existing components retained. Optional: "View recommendations → Oracle" link when viewing Brain.

---

## 7. Data Flow (Phase 1)

| Source | Use |
|--------|-----|
| Risk passport / reputation / receipts | Capital OS Strip Identity |
| User constraints / vault policy | Capital OS Strip Gate |
| Activity / receipts | Capital OS Strip Ledger |
| `POST /strategies/opportunities` | Oracle Signals stream, Radar plot, Genome strategy list |
| `/strategies/recommend` or allocate (read-only) | Oracle Recommended actions |
| zkML circuits / proof stats / model hashes | Oracle Model transparency |
| Existing DEX/Ekubo/strategies/staking APIs | Vault Trade (Swap, LP, Limits, Staking), Lending |

Genome factors in Phase 1: computed in frontend from opportunity payload (e.g. apy, risk_score, tvl, volatility if present). No Strategy Intelligence Service yet.

---

## 8. Demo Mode

- **Detection:** Existing (`?mode=demo` or no wallet).
- **Seeded data:** One fixture: 4–6 strategies, 2–3 recommended actions, 2–3 ledger entries, strip Identity/Gate/Ledger copy.
- **No writes:** Approve/Modify/Allocate in demo only simulate (toast or local state). No real tx or state-changing API calls.
- **Indicator:** Optional "Demo mode" pill in strip or header.

---

## 9. Error Handling and Edge Cases

- **Opportunities API fails:** Oracle Signals/Radar show empty state + retry. Genome shows "Select a strategy", compare disabled until data loads.
- **No wallet:** Strip shows demo or "Connect wallet"; Oracle/Vault show demo or empty states as today.
- **Deep links:** `?v=oracle&sub=radar`, `?v=vault&sub=trade` supported. `?v=trade` → `?v=oracle`.
- **Mobile/narrow:** Strip wraps or collapses to icons + tooltips; Oracle sub-tabs horizontal scroll if needed; Radar plot responsive; Genome bars stack vertically.

---

## 10. Out of Scope for Phase 1

- New backend services (Strategy Intelligence Service, Oracle Service, zkGraph service).
- Persistent Strategy entities and computed genome factors in backend.
- zkGraph integration (obsqra.fi zkRAG/zkGraph) — Phase 2.
- Ledger overlay (Strip Ledger click scrolls to Activity only).
- Strategy evolution tracking over time.

---

## 11. Success Criteria

- Single Capital OS Strip replaces CapitalFlowStrip + AIZkmlBanner.
- Three surfaces: Vault | Oracle | Brain; Trade removed, its execution in Vault, its intelligence in Oracle.
- Oracle has three sub-tabs (Signals, Radar, Genome) with data from existing APIs.
- Vault has six sub-tabs including Trade (Swap, LP, Limits), Lending, Staking.
- Demo mode shows coherent seeded data across strip, Oracle, and ledger.
- Deep links and legacy `?tab`/`?v=trade` handled without breaking bookmarks.

---

*Next: Implementation plan (writing-plans) for Phase 1 tasks.*
