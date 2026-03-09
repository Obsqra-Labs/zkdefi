# Privacy, Vault & Dark Ledger — Unified Design

**Date:** 2026-03-09  
**Purpose:** Unify confused concepts (vault vs dark ledger, deposit/withdraw flows, privacy tiers) and align mechanics + UI + AI to a single mental model for the hackathon MVP.  
**Process:** Brainstorming — design only; no implementation until approved.

---

## 1. Where we diverged (current state)

### Intended (original) model

- **Three pools:** Conservative, Moderate, Aggressive — allocation buckets by risk (obsqra.fi does these without AI/LP mixes). You **deposit into the vault**; **user tier** (reputation) governs access. Pools are not "shielded" or "dark"; just risk buckets.
- **Privacy = commitment only.** Deposits can be private (commitment so depositor is not linked). How LP/pool unwinds is implementation detail — must not link back to depositor. No user-facing "shielded vs dark."
- **Vault:** One place; no forced L3 custody to deploy. **Agent:** AI allocates DAO-style; agent never holds custody; **session keys** = A2A access to main wallet; no separate agent wallet on the pool.

### What exists today (overlapping concepts)

| Concept | Where it lives | Problem |
|--------|-----------------|--------|
| **3 DAO pools** | `privacy_pool_service` (CONSERVATIVE/MODERATE/AGGRESSIVE), `PrivacyPoolsPanel`, `PrivacyPoolAdapter` | Clear; but not the only “deposit” surface. |
| **Full Privacy Pool** | `FullyShieldedPool` contract, `FullPrivacyPoolPanel`, `privacy_vault_service` | Single on-chain pool; separate from the 3 DAO pools. |
| **Shielded / commitment** | `DepositPanel` method `commitment_shield`, `ShieldedPoolPanel` | Another deposit path; relationship to 3 pools unclear. |
| **Dark ledger** | `NoteStore`, “sweep to ledger” / “sweep to vault”, `CapitalLedger` DARK LEDGER row | Feels like a second vault; “sweep” and “vault” wording overlap. |
| **Vault V2** | `DoubleEntryLedger`, `VaultAccountService`, deposit intents, deploy, withdrawal, sweep | Internal accounting + deploy lifecycle; not clearly “your balance in the 3 pools”. |

### Resulting confusion

- **Deposit:** User can “deposit” via (1) Privacy Pools tab → one of 3 pools, (2) Full Privacy Pool panel, (3) DepositPanel with method = full_privacy / commitment_shield / dark_ledger. No single answer to “where did my funds go?”
- **Withdraw:** Similarly multiple flows (withdraw from pool, from shielded pool, from vault, from dark ledger).
- **Vault vs dark ledger:** CapitalLedger shows “VAULT” and “DARK LEDGER” and “Sweep to Vault”; it’s unclear that vault = aggregated view of pool positions + ledger, and dark ledger = private notes that can be swept into that view.
- **AI/oracle:** How the oracle or user’s agent “rebalances” between the 3 pools and uses Ekubo strategies, while respecting privacy, is not spelled out in one place.

---

## 2. Intended model (one sentence each)

- **Vault:** One place that holds the user's capital. Deposits can be **private** (commitment so depositor isn't linked). No user-facing "shielded" vs "dark" — just private when we use a commitment. **User tier** (reputation) governs access. **Pools (3):** Conservative, Moderate, Aggressive. **Allocation buckets** by risk only (obsqra.fi-style). Strategy yield (e.g. Ekubo) and DAO lending. Where capital is allocated inside the vault — not "shielded" or "dark" pool types.
- **Privacy:** Only about the **commit**. Private deposit = commitment so depositor is not linked. When LP/pool unwinds, it must not link back to depositor; how is implementation detail.
- **Deploy:** No forced L3 custody. Deploy on L2 (or wherever the pool lives).
- **Agent:** AI allocates DAO-style; agent never holds custody; **session keys** = A2A access to main wallet so agent signs vault/pool actions on user's behalf. No separate agent wallet on the pool.
- **Deposit flow:** User deposits into vault (amount; private via commitment when we use it). Backend allocates to a bucket. No "pick shielded vs dark."
- **Withdraw flow:** User withdraws from vault (or a bucket) to their wallet.
- **MVP:** obsqra.fi-style buckets; we add AI that allocates DAO-style. Internal pools + Ekubo strategies; agent aggregates, user's agent navigates buckets by risk; session keys on main wallet, no custody.

---

## 3. Clarifying question (one at a time)

**On-chain vs internal accounting for the 3 pools**

Today the 3 pools (Conservative / Moderate / Aggressive) are backed by `privacy_pool_service` (JSON metrics + positions) and DAO pool APIs. The **FullyShieldedPool** (full privacy pool) is a separate on-chain contract.

For the unified model, which do you want for the **3 tiers**?

- **A)** **3 pools = on-chain contracts** (each tier has its own pool contract, or one contract with 3 pool_type slots). Deposit/withdraw hit the chain; vault “tracks” what’s on-chain. (Closest to “deposit into a privacy pool” as a chain action.)
- **B)** **3 pools = internal allocation buckets** (current style). On-chain we have one or more liquidity destinations (e.g. Ekubo + maybe FullyShieldedPool); the “3 pools” are our internal allocation view (Conservative / Moderate / Aggressive) that we use for risk and rebalancing. Deposit goes to “vault” or a single pool contract; we **account** which bucket it’s in internally. (Easier to ship; no need for 3 separate contracts.)
- **C)** **Hybrid:** One shared on-chain pool (or FullyShieldedPool) for **private** (commitment-based) deposits; 3 pools are internal allocation buckets. No "shielded vs dark" as pool types — privacy is commit-only. User deposits into vault; we record bucket in our ledger and submit with a commitment when private. Withdraw: we know which bucket the commitment belongs to from our ledger.

Recommendation: **B** or **C** — 3 pools = internal allocation buckets (obsqra.fi-style). No forced L3 custody. Agent uses **session keys** on main wallet (A2A, no custody).

---

## 4. Proposed approaches (2–3 options)

### A. Mechanics: one deposit, one withdraw

- **Option 1 — Single API, one payload:**  
  `POST /vault/deposit` body: `{ pool: "CONSERVATIVE_POOL" | "MODERATE_POOL" | "AGGRESSIVE_POOL", amount_wei, privacy_method: "public" | "shielded" | "dark_ledger", ... }`. Backend routes to the right rail (DAO pool API + optional shielded/dark path) and updates vault + pool position. Same for withdraw: `POST /vault/withdraw` with pool (or “vault”) + privacy_method for output.
- **Option 2 — Keep multiple endpoints, one UX:**  
  Keep existing endpoints (e.g. DAO pool deposit, vault V2 deposit, sweep) but **frontend exposes one flow**: “Deposit” → pick pool + privacy method → frontend calls the appropriate backend API and shows one success state. Same for withdraw. Mechanics unchanged; UI and copy unified.
- **Option 3 — Vault V2 as single gateway:**  
  All deposit/withdraw go through V2 (deposit intent → confirm; withdraw request → route). The 3 pools become “rails” or “targets” of the vault (e.g. deploy step sends to the chosen pool). Dark ledger remains “notes”; sweep = note → vault ledger.

**Recommendation:** Option 1 if we can refactor backend cleanly; else Option 2 for hackathon (unify UI and mental model without big backend churn). Option 3 if we want everything to go through V2 ledger and deploy lifecycle.

### B. UI: one place for “my money”

- **Option 1 — Single “Vault” view:**  
  One screen (e.g. CapitalLedger or a dedicated Vault page): (1) **Vault** = balance in the 3 pools + ledger (one number or breakdown by pool). (2) **Dark ledger** = notes + “Sweep to Vault” (clearly “private pocket → into vault”). (3) **Deposit** = one CTA: “Deposit” → pool selector + amount + privacy method. (4) **Withdraw** = one CTA: “Withdraw” → source (pool or vault) + amount + output privacy method.
- **Option 2 — Privacy Pools as primary:**  
  “Privacy Pools” tab is the main view: 3 cards (Conservative / Moderate / Aggressive) with your position per pool and “Deposit” / “Withdraw” per pool. “Vault” is a summary (total across pools). Dark ledger is a separate small section: “Private notes” + “Sweep to Vault.”
- **Option 3 — Wizard-style:**  
  One “Deposit” and one “Withdraw” wizard: step 1 pool (or “from vault”), step 2 amount, step 3 privacy method. No separate Full Privacy / Shielded / Dark panels; they become options inside the wizard.

**Recommendation:** Option 1 — single Vault view with vault = pools + ledger, dark ledger = notes + sweep, and one deposit/one withdraw flow. Easiest to explain: “Vault is what you have in the system; dark ledger is your private pocket; deposit/withdraw are one flow each.”

### C. AI / oracle: rebalance and privacy

- **Option 1 — Pools as buckets, signals drive allocation:**  
  Oracle (or internal agent) produces **allocation targets** per pool (e.g. 40% Conservative, 35% Moderate, 25% Aggressive) from risk profile + signals. User’s agent (or relayer) **executes rebalance**: withdraw from pool A, deposit to pool B, using the same privacy method the user prefers. Execution goes through existing adapters (LPAdapter, etc.) with `privacyMode` set. No new “AI-only” path; AI just decides pool mix and the same deposit/withdraw + adapter execution is used.
- **Option 2 — Oracle proposes, user approves:**  
  Oracle shows “Recommended: move 10% from Moderate to Aggressive”; user approves; one “Apply” executes the move (with user’s chosen privacy). Same mechanics as Option 1, with explicit approval step in UI.
- **Option 3 — Full agent rebalance:**  
  User delegates “rebalance by risk profile”; agent (with session key or relayer) moves value between pools and into Ekubo strategies without per-action approval. Still uses same adapters + privacy; only automation level differs.

**Recommendation:** Option 1 for MVP: pools as allocation buckets; signals (or risk profile) drive targets; one clear path “execute rebalance” (manual or one-click) that uses the unified deposit/withdraw and adapters with privacy. Option 2 or 3 can build on that.

---

## 5. Design summary (for approval)

### 5.1 Concepts (canonical)

- **Vault:** One place that holds the user's capital. Deposits can be **private** (commitment so depositor is not linked). **User tier** governs access. No "shielded" vs "dark" as user choices.
- **Pools (3):** Conservative, Moderate, Aggressive. **Allocation buckets** by risk only (obsqra.fi-style). Where capital is allocated — not "shielded" or "dark" pool types.
- **Privacy:** Only about the commit; no "shielded/dark" as user choices. **Deploy:** No forced L3. **Agent:** Session keys = A2A, no custody.

### 5.2 Mechanics

- **One deposit flow:** User deposits into vault (amount; private via commitment when we use it). Backend allocates to a bucket (C/M/A). No "pick shielded vs dark."
- **One withdraw flow:** User withdraws from vault (or a bucket) to their wallet.
- **Adapters:** Execution must not link back to depositor; implementation detail. Agent uses **session keys** on the main wallet to sign; no custody.

### 5.3 UI

- **Single Vault view:** Vault = breakdown by pool (C/M/A buckets) + ledger. One “Deposit” (amount; optional bucket), one “Withdraw” (source + amount). No “shielded” / “dark” as user choices.
- **Remove or hide:** Separate “Full Privacy Pool,” “Shielded Pool,” and “Dark ledger” as **primary** entry points; one vault, one deposit, one withdraw.
- **Copy:** Short blurbs: “Vault = your balance across the 3 allocation buckets and ledger.” No copy that suggests picking a “privacy method” (shielded vs dark).

### 5.4 AI / MVP

- **Pools = allocation buckets:** Internal agent aggregates opportunities (e.g. Ekubo strategies). AI allocates **DAO-style**; user’s agent rebalances between C/M/A from risk profile and signals.
- **Execution:** Agent **never holds custody**. **Session keys** = agent has A2A access to main wallet and signs vault/pool actions. No separate agent wallet on the pool. Rebalance uses same deposit/withdraw; execution does not link back to depositor.
- **MVP narrative:** “obsqra.fi-style buckets; we add AI that allocates DAO-style. Internal pools + Ekubo strategies; agent aggregates, user's agent navigates buckets by risk; session keys on main wallet, no custody. Privacy = commit only.”

---

## 6. Design decision: agent access (no custody)

- **Session keys, not custody:** The agent never holds funds. We **assign session keys** to the agent so it has A2A (agent-to-wallet) access to the user's main wallet and can sign vault/pool actions (rebalance, deploy) on the user's behalf.
- **No agent wallet on the pool:** We do **not** give the agent a separate wallet on the privacy pool. One wallet (the user's); the agent acts via delegated keys. That avoids the complexity of "agent wallet on the pool but never custody" — the agent just signs with session keys on the main wallet.

## 7. What to drop or defer (YAGNI)

- **Multiple competing “deposit” entry points** in the UI (full privacy panel, shielded panel, deposit panel with 3 methods) → collapse to one deposit flow (vault + optional bucket; no shielded/dark as user choices).
- **Vault V2 as the only gateway** for everything (Option 3 in mechanics) → defer unless we explicitly choose it; otherwise unify at API or UI as in Option 1 or 2.
- **Madara/L3 for settlement** → keep in backlog; not required to unify the mental model or the MVP story.

---

## 8. Next step

Once you answer the **clarifying question** (A vs B vs C for on-chain vs internal 3 pools) and confirm or adjust **Sections 5.1–5.4**, the next step is to invoke **writing-plans** to produce a concrete implementation plan (unify APIs or UI first, copy changes, adapter wiring, then AI rebalance flow). No implementation before that.