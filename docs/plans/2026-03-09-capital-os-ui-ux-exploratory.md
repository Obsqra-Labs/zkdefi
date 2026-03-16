# Capital OS UI/UX — Exploratory Feedback & Unification

**Date:** 2026-03-09  
**Purpose:** Deep exploratory feedback on why the app feels disconnected, how the navbar/vault/trade-desk/oracle diverged, and what we need to do to unify unified deposit/accounting + AI-managed pools + agentic rebalancing inside a single Capital OS. Brainstorming only; no implementation until we have a solid direction.

---

## 1. What you’re seeing (and why it feels wrong)

### 1.1 Two nav systems, one “main” screen

- **Landing / products:** `SiteHeader` — Products, Docs, Forecaster, **Launch App** → `/agent`.
- **In-app pages:** `AppNavbar` — Dashboard, Trade, Marketplace, Lending, Oracle, Vault, Forecaster, Profile.

**The agent page (`/agent`) does not use `AppNavbar`.** It uses `MissionControlLayout` with `HeaderStrip` only. So:

- On **Dashboard (agent)** you see: zkde.fi / Capital OS, Agent ID, Gate, Deploy, Design, Govern, Brain, Connect. **No links to Trade, Vault, Lending, Oracle.**
- To get to Vault or Trade you must know the URL or use a different entry point. So the “new navbar” (AppNavbar) is **external** to the Capital OS: it appears on `/vault`, `/trade`, `/lending`, `/oracle`, `/marketplace`, `/profile`, but **not** on the one screen that is the “Capital OS” (agent).

Result: Capital OS feels like a separate app; the other pages feel like a different app with a strip of links. They don’t feel like one integrated surface.

### 1.2 Capital OS = only `/agent`

The **only** place that uses `MissionControlLayout` (left rail = Capital Ledger, center = Center Stage, right = Control Plane) is `/agent`. So:

- **Capital Ledger** (vault summary, deposit/withdraw, dark ledger, zkd synthetic, positions, yield sparkline) exists only on the agent page.
- **Unified deposit/withdraw** (slideouts: DepositPanel, WithdrawPanel, FullPrivacyPoolPanel, ShieldedPoolPanel) exist only on the agent page.
- **Privacy pools** (Conservative / Moderate / Aggressive) appear only inside **Deploy** overlay → tab “Vault Rails (Advanced)” → `PrivacyPoolsPanel`. So they’re buried under Agent → Deploy → second tab.
- **Trade Desk** (opportunities, action panel, memory lane) appears in two places: (1) inside agent’s **Deploy** overlay (first tab), and (2) on the standalone **/trade** page (AppNavbar + full-page TradeDesk). So we have two copies of Trade Desk: one inside Capital OS (Deploy) and one as a separate page.

So: the “unified” mental model (one ledger, one deposit/withdraw, privacy pools as allocation buckets, trade desk as opportunities) is **only** on agent, and even there it’s split across default view (ledger + intelligence stream) and Deploy overlay (trade desk + privacy pools). The standalone pages (Vault, Trade, Lending, Oracle) are **not** the Capital OS; they’re separate full-page UIs with a shared thin nav.

### 1.3 Vault page vs Capital OS ledger

- **/vault:** Renders `AppNavbar` + `VaultSurface`. VaultSurface has tabs: **Portfolio, Yield, Trade, Lending, Staking, Activity.** So it’s the “legacy” vault: positions, yield chart (APY), vault health, next rebalance, oracle strip, etc. It does **not** show the three privacy pools (C/M/A) as the main allocation buckets; those live only in the agent’s Deploy → Vault Rails.
- **Agent left rail:** `CapitalLedger` — vault stats, positions, dark ledger, zkd synthetic, deposit/withdraw buttons. So we have:
  - **Capital OS ledger** = summary + deposit/withdraw + dark ledger (on agent only).
  - **Vault page** = full vault surface with Yield/Portfolio/Trade/Lending/Staking/Activity (no privacy pools, no unified “this is your single vault” story).

You said: “The Vault is our legacy vault but the LP integrations are stubbed. It used to show our current APY on our positions and generating yield.” That’s **VaultSurface’s YieldTab** (and portfolio). So the legacy vault **is** there on `/vault`, but:

- It’s not inside the Capital OS (agent).
- It doesn’t show privacy pools (C/M/A) as the main buckets.
- So you can’t “use /vault to see how our privacy pools work” — privacy pools are only in agent → Deploy → Vault Rails.

### 1.4 Oracle, Lending, Marketplace

- **/oracle:** AppNavbar + policy/oracle UI (gate rules, execution rules, gated signals, oracle status). It’s a separate “brain”/policy config page. You said “Oracle is new brain I’ve never seen” — it exists as a standalone page, not wired into the agent’s “Brain” overlay or the Capital OS as the single place you set policy.
- **/lending:** AppNavbar + lending-specific UI. Wired to lending services but not clearly part of “one ledger, one deposit, allocation buckets.”
- **/marketplace:** AppNavbar + marketplace content. Feels like another product surface.

So: most navbar items are **separate pages**; they don’t live inside the Capital OS. The only “brain” that’s inside the agent is the **Brain** overlay (BrainVisualizer), not the Oracle page. So there are effectively two “brains”: the overlay on agent vs the Oracle page.

### 1.5 Privacy pools crash

Privacy pools appear in:

1. **Agent → Deploy → “Vault Rails (Advanced)”** → `PrivacyPoolsPanel`.
2. **TradeDesk** → `PrivacyPoolPanel` (e.g. via PrivacySidebar).
3. **Agent slideout** “Advanced Privacy Pool” → `FullPrivacyPoolPanel` (when `NEXT_PUBLIC_ENABLE_ADVANCED_PRIVACY_RAILS=1`).

`PrivacyPoolsPanel` loads data with:

- `PrivacyPoolAdapter.getPoolStats(pool)` and `PoolLiquidityManager.getPoolLiquidity(pool)` for each of the three pools.
- If any request fails (e.g. `/api/v1/dao/pools/.../liquidity` 404 or 500), the whole `Promise.all` rejects and the panel shows an error state. If the error isn’t caught (e.g. unhandled rejection or throw in render), the app can crash.

There’s also a **dependency bug** in `PrivacyPoolsPanel`: `load` is in a `useCallback` that depends on `rows`. So every time `setRows` runs, `load` changes, and the `useEffect` that runs `load` and sets an interval will re-run. That can cause repeated loads or state thrash. So the crash or hang could be from: (1) API failure with no error boundary, (2) dependency loop, or (3) a throw in a child component when data is missing.

**Recommendation (short):** Wrap `PrivacyPoolsPanel` (and the Deploy overlay tab content) in an error boundary; fix `load` dependency (remove `rows` from deps, use functional updates for `setRows`); ensure adapter/liquidity calls handle 404/500 and set error state instead of throwing. Then we can confirm whether “privacy pools crash” is this panel or another (e.g. FullPrivacyPoolPanel).

---

## 2. How we got here (divergence)

- **Intended:** One Capital OS main screen: ledger (vault + dark ledger) + unified deposit/withdraw + allocation buckets (privacy pools C/M/A) + opportunities (trade-desk-like) + agent/oracle rebalancing. Vault V2 = unification of dark ledger and private vault in that one screen.
- **What happened:**  
  - Agent page became the only “Capital OS” layout (MissionControlLayout).  
  - Standalone pages (Vault, Trade, Lending, Oracle, etc.) were added with AppNavbar and full-page content, so they look like separate products.  
  - Privacy pools were put inside Deploy → “Vault Rails (Advanced)” instead of being the main allocation view in the ledger.  
  - Trade Desk was both embedded in Deploy (agent) and duplicated on /trade.  
  - Vault page stayed the “legacy” vault (Yield/Portfolio/Trade/Lending/Staking/Activity) without privacy pools and without being the same “unified vault” as the ledger.  
  - So: Vault V2 (unified deposit/accounting) lives in the agent’s ledger + slideouts, but the **vault page** is still the old vault surface. The “unified” behavior is not surfaced in one place that feels like “the” Capital OS.

---

## 3. What “unified” should feel like (goal)

- **One main screen** = Capital OS: left rail = **ledger** (vault + dark ledger + allocation buckets C/M/A + deposit/withdraw), center = **opportunities** (trade-desk-style list + deploy/execute), right = **control plane** (agent, policy, brain).  
- **Unified deposit/withdraw:** One flow from the ledger (e.g. “Deposit” / “Withdraw” in the left rail) that updates the same accounting and allocation buckets (privacy pools). No separate “vault page” that feels like a different product.  
- **Privacy pools** = allocation buckets (C/M/A) visible in the ledger and in the deposit flow, not hidden under Deploy → second tab.  
- **Trade desk** = the main “opportunities” view in the center (swap, LP, lend, limit, DCA, etc.), not a separate route that duplicates it.  
- **Oracle / Brain / Lending** = either inside the same screen (e.g. overlays or right-rail panels) or clearly secondary routes that “open from” Capital OS, not a navbar full of equal-weight pages that compete with the main screen.

So: **navbar should either be inside the Capital OS** (e.g. as mode switcher or rail tabs) **or** the “app” should be the Capital OS and other links should be clearly secondary (e.g. Profile, Settings, Docs). Right now the navbar is external and treats Dashboard, Trade, Vault, Lending, Oracle as peers, while the real “main” experience (Capital OS) is only on Dashboard and doesn’t show that nav.

---

## 4. Options (2–3 approaches)

### Option A — Capital OS as the only in-app shell (single layout)

- **Idea:** Every in-app route (agent, trade, vault, lending, oracle, marketplace, profile) is rendered **inside** `MissionControlLayout`. So we have one shell: left rail = ledger (always), center = route-dependent content (e.g. trade desk for “trade”, vault surface for “vault”, oracle for “oracle”), right = control plane (always).  
- **Navbar:** Becomes a **mode/tab strip inside the shell** (e.g. in HeaderStrip or directly under it): Dashboard | Trade | Vault | Lending | Oracle | … So there’s one navbar, and it switches the **center** (and maybe right) content, not the whole page.  
- **Trade:** “Trade” mode = center shows TradeDesk (opportunities + action panel). No standalone /trade page; /trade could redirect to /agent?mode=trade or the route becomes /agent with a query or segment for mode.  
- **Vault:** “Vault” mode = center shows the **unified** vault: allocation buckets (C/M/A) + positions + yield, with deposit/withdraw coming from the **left rail** (same ledger). So the “vault” is not a separate page with its own layout; it’s the ledger (left) + vault-focused center (positions, APY, rebalance).  
- **Pros:** One mental model; no “external” navbar; ledger and deposit/withdraw always visible; privacy pools can live in the ledger and in the center when mode = Vault.  
- **Cons:** Large refactor; every current page (VaultSurface, TradeDesk, Oracle, Lending, Marketplace) becomes a “center stage” or “right rail” content; routing might be /agent?tab=vault or /agent/vault, etc.

### Option B — Agent = Capital OS; other routes = secondary with same nav

- **Idea:** Keep agent as the only full Capital OS (MissionControlLayout). Make **AppNavbar** appear on the **agent** page too (e.g. above or below HeaderStrip), so from the agent you see: Dashboard (current), Trade, Vault, Lending, Oracle, … Clicking “Vault” or “Trade” navigates to /vault or /trade, but those pages are **redesigned** to feel like “extensions” of the same app: e.g. same header strip (with “Back to Dashboard”) and a layout that echoes the three rails (e.g. left = mini-ledger or summary, center = main content). So we don’t unify everything into one URL; we unify **look and feel** and make it clear that Dashboard is “home” and the rest are sections.  
- **Vault page:** Becomes “Vault view” of the same ledger: show allocation buckets (C/M/A), positions, APY (from YieldTab), and reuse the same deposit/withdraw flow (or deep-link to agent with slideout open). So /vault is “see your vault in detail” with the same accounting as the agent’s ledger.  
- **Trade page:** Same TradeDesk but with a persistent “Back to Dashboard” and maybe a compact ledger summary on the left so it doesn’t feel like a different app.  
- **Pros:** Smaller refactor than A; we don’t have to squash every route into one layout immediately; we can add AppNavbar to agent and unify vault content (privacy pools + APY) on /vault step by step.  
- **Cons:** Still two layouts (full Capital OS on agent vs “section” pages); user can land on /vault or /trade and never see the full Capital OS unless they click Dashboard.

### Option C — Single route: /agent (or /app) with hash or query modes

- **Idea:** Remove standalone /vault, /trade, /lending, /oracle as separate routes (or redirect them to /agent?mode=vault|trade|lending|oracle). The only in-app URL is /agent (or /app). The navbar is inside the agent page and sets `?mode=vault` or `#trade`, and the center stage (and maybe right rail) switches by mode. So Trade Desk, Vault view, Oracle view, Lending view are all **modes** of the same page.  
- **Pros:** Single source of truth; no “external” feeling; every link is “same app, different mode.”  
- **Cons:** URL design (hash vs query); deep-linking and bookmarks; potentially heavy center-stage switching (lots of components mounted by mode).

---

## 5. Recommendation (direction)

- **Short term (to unblock and align):**  
  - **Option B** is the most realistic: keep agent as the main Capital OS; add **AppNavbar (or an equivalent in-app nav) to the agent page** so Dashboard/Trade/Vault/Oracle are visible from the main screen.  
  - Make **/vault** the “vault view” of the **same** accounting: show privacy pools (C/M/A) as allocation buckets, plus positions and APY (current YieldTab content). Reuse or link to the same deposit/withdraw as the agent (e.g. “Deposit” on /vault opens the same flow or deep-links to agent with deposit slideout). So “unified deposit/accounting” is reflected on both agent (ledger) and /vault (detailed vault).  
  - Make **/trade** clearly “Trade Desk from Capital OS”: e.g. add a small ledger summary or “Back to Dashboard” so it doesn’t feel external. Optionally, make “Trade” in the navbar open the Deploy overlay with Trade Desk tab by default (so power users stay on agent and use Deploy for trade).  
  - Fix **privacy pools crash**: error boundary around PrivacyPoolsPanel; fix `load` dependency in PrivacyPoolsPanel; ensure API failures show error state, not white screen.

- **Medium term (unified experience):**  
  - Move toward **Option A**: one shell (MissionControlLayout) for all in-app routes, with navbar as mode switcher in the shell. Then Trade, Vault, Lending, Oracle become “center stage” modes with the same left rail (ledger) and right rail (control plane).  
  - Align with **2026-03-09-privacy-vault-unified-design.md**: one vault, private deposit by commitment only, three allocation buckets (C/M/A), no “shielded/dark” as user-facing pool types; deposit/withdraw from ledger; agent uses session keys, no custody.

---

## 6. Trade Desk vs “current vault look”

You said: “Make the trade desk functional and more like the current vault look minus the deposit/withdraw vault function but that layout of opportunities.”

- **Current vault look (VaultSurface):** Tabs (Portfolio, Yield, Trade, Lending, Staking, Activity), banner, health meter, next rebalance strip, oracle strip, constraint guard. So “opportunities” there are mixed into Trade / Lending / Staking tabs.  
- **Trade Desk:** Section tabs (All | Swap | LP | Lend | Stake | Limit | DCA | Privacy | Dark), opportunity list, action panel, memory lane. So it’s already an “opportunities” layout.

To make Trade Desk “more like the current vault look” **minus** deposit/withdraw:

- Reuse **visual language** from VaultSurface: cards, health/rebalance strips, maybe a compact “vault summary” (total, allocation by bucket) at the top, but no deposit/withdraw primary actions (those stay in the ledger).  
- Keep the **opportunities layout** (section tabs + list + action panel) as the main content. So we’re not removing the trade desk; we’re giving it a “vault-aware” chrome (summary, strips) so it feels like the same system as the vault, with deposit/withdraw living in the ledger (left rail when in Capital OS).

So the recommendation: **In the Capital OS, center stage “Trade” (or Deploy → Trade Desk) should have a small “vault summary” strip or card at the top** (e.g. total in vault, allocation C/M/A, link to “Deposit” in the ledger), then the existing opportunity list and action panel below. That aligns “trade desk = opportunities” with “vault = ledger + allocation” without duplicating deposit/withdraw in the trade view.

---

## 7. Summary: what we need to do

1. **Prove the worry wrong:** We can unify unified deposit/accounting and AI-managed pools with agentic rebalancing. The backend and concepts (unified design doc) are there; the gap is **UI/UX**: many surfaces live outside the Capital OS and privacy pools are hidden. So: bring nav into the Capital OS, make vault page show the same buckets + APY, and fix privacy pools crash so the panel is usable.  
2. **Navbar:** Put an in-app nav (AppNavbar or equivalent) **on the agent page** so Dashboard, Trade, Vault, Oracle, etc. are visible from the main screen. Decide whether “Trade” / “Vault” switch center content (Option A/C) or navigate to /trade, /vault with a consistent shell (Option B).  
3. **Vault page:** Make it the “vault view” of the same system: show privacy pools (C/M/A) as allocation buckets, positions, APY (current YieldTab). Reuse or link to the same deposit/withdraw as the agent. So /vault is not a different product; it’s “see your vault in detail.”  
4. **Trade Desk:** Keep opportunities layout; add vault-aware chrome (summary strip, link to ledger deposit/withdraw) so it feels part of the Capital OS.  
5. **Privacy pools crash:** Error boundary + fix `load` deps in PrivacyPoolsPanel + robust API error handling.  
6. **Oracle / Lending:** Either integrate as overlays or secondary views from the same shell, or keep as separate pages but linked from the in-app nav so they feel part of the same app.

Once this direction is approved, the next step is to write a **concrete implementation plan** (e.g. using the writing-plans skill): phased changes to layout, routing, and content so we get to a single, coherent Capital OS without a big-bang rewrite.
