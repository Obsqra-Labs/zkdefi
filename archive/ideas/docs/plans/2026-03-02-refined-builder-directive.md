# Refined Builder-Grade Directive (Hardened)

Paste this directly into your engineering agent. This version removes ambiguity, forces structural decisions, and anchors session keys + privacy-first so the product truly groks both.

---

## EXECUTION DIRECTIVE

Re-architect zkde.fi/agent into a **vault-centric autonomous capital OS**.

You are **not** redesigning screens. You are **rewriting the product architecture**.

Refactor `/agent` and `/profile` into a unified system built around:

**Vault → Brain → Session key → ZK Gate → Execution → Ledger → Reputation**

Privacy is an allocation type and a disclosure choice, not a separate tab. Session keys are the gate for Assist/Autonomous; they must be visible and manageable.

Do **not** preserve existing tab structure. Delete what does not serve capital flow.

---

## 1. Top-Level Routing (Hard Constraint)

**Maximum 4 top-level routes:**

- `/vault` (or `/agent` defaulting to Vault)
- `/trade`
- `/brain`
- `/identity` (Profile becomes this)

On the app, only expose: **Vault | Trade | Brain | Identity**.

- No nested tab hell.
- No "Automate" tab.
- No "Intelligence" tab.
- No "Analytics" tab.
- No duplicate LP/Swap pages.

Everything collapses into these four surfaces.

---

## 2. Vault Is The Root State

Create a single global store: **VaultStore**.

VaultStore **owns**:

- `walletBalance`
- `vaultBalance`
- `allocationBreakdown` (LP / Limit / **Private** / Idle)
- **`sessionKeyState`** (active sessions, permissions, expiry, pending grant/revoke)
- `activeAgents`
- `riskLimits`
- `ledgerEntries`
- `proofEvents`

No other store manages capital. Trade and Brain **consume** VaultStore. Session key state is **not** optional; Autonomous/Assist execution depends on it.

---

## 3. Mandatory Capital Loop

The only valid user flow:

1. Connect wallet
2. Deposit to Vault
3. Choose execution mode (Manual / Assist / Autonomous)
4. **If Assist or Autonomous → grant session key** (scope: max capital, allowed pools, duration)
5. AI generates allocation suggestion
6. User approves constraints
7. AI decision runs
8. zkML circuit executes
9. Proof verified
10. Ledger logs entry (including session id when applicable)

If a screen does not fit in this loop, remove it.

---

## 4. VAULT Surface Specification

Vault **must** contain:

**Header panel**

- Wallet Balance
- Vault Balance
- Active Mode (Manual / Assist / Autonomous)
- Risk Tier
- **Session key status (required):** In the Vault header, show a single-line indicator: **"Session: none"** or **"Session: active until [expiry]"**. Link to Brain’s session key control. If user chooses Assist or Autonomous but no session exists, prompt here to grant a session key (e.g. "Grant session key in Brain").

**Session keys (required on Vault)**

- **SessionKeysSummary:** List active session(s) with: **session ID**, expiry, scope (max capital, allowed protocols/pools), **Revoke** action. Session key structure (from docs): owner, max position, protocol bitmap, expiry; delegation is limited execution rights; proofs required for execution; keys are revocable.
- If mode is Assist or Autonomous and **no active session**, show clear CTA: **"Grant session key in Brain"** (link to /brain with focus on session key UI).
- Do not allow Autonomous/Assist to run without a granted session; block or prompt grant.

**Allocation panel**

- Breakdown: **LP % | Limit % | Private % | Idle %**
- Each clickable; must link to trade context (e.g. Private → Trade with privacy routing).
- **Private** = privacy-pool allocation (first-class, not a separate page).

**Ledger feed (required)**

Each entry:

- Timestamp
- Action (Deposit, Rebalance, Pool Rotation, Harvest)
- Capital delta
- **AI reason** (why it happened)
- **Proof status** (Pending / Verified / Failed)
- **View Proof** button
- **Session ID** when the action was executed under a session (so users can trace which key authorised which trade)
- **Routing** when applicable: whether the action used private or public routing and whether the amount was hidden (private deposit)

No passive log. Every action must show **why** it happened. Proof-gated execution must be visible: the contract only executes when a valid proof attests to constraints; ledger reflects that.

---

## 5. TRADE Surface Specification

Single unified component: **`<TradingHub />`**

**Persistent**

- Token selector
- Amount input

**Modes inside hub:** Swap | LP | Limit | Stake

Switching modes must **not** reset token context.

**AI Suggestion Engine**

When pair selected, display:

- Suggested LP range
- Suggested limit price
- Suggested staking %
- Risk explanation

Add: **Apply AI Suggestion** — must pre-fill form.

**Risk and proof inline (required)**

When the user proposes a swap, LP position or rebalance, display **risk score and anomaly detector checks inline**. Show which of the eight portfolio features (balance, concentration, diversification, volatility exposure, liquidity depth, time in position, recent drawdown, correlation) or pool factors affect the risk score, and whether the proposed allocation **passes or fails** the thresholds. Annotate pool lists with risk model output (e.g. "Anomaly risk flagged; proof required"). When Vault deposit routing is Private, preselect the private-pool option for swap/LP where available.

---

## 6. BRAIN Surface Specification

Brain is an **orchestration layer**, not a toggle page.

**Section 1 — Strategy templates**

Four cards:

- Conservative Yield
- Balanced Growth
- Aggressive LP
- Privacy Allocator

Each card shows: Expected APY, Risk tier, Historical drawdown, Proof compliance %. Clicking applies configuration to VaultStore.

**Section 2 — Session key control (required)**

- **Grant / Revoke session key** UI (primary placement; not buried).
- Define scope: **max position**, **allowed protocols** (protocol bitmap), **duration** (expiry). Session key structure: owner, max position, protocol bitmap, expiry; delegation grants limited execution rights; execution still requires proofs; keys can be revoked.
- Use **inline tooltips or info modals** to explain what each constraint means and why proofs are still required for execution (reference docs).
- Show active session(s) and expiry; revoke from here or from Vault summary.
- Copy: "Assist and Autonomous require a session key. Grant one to let the Brain execute on your behalf within these limits."

**Section 3 — Custom Agent Builder**

Models exposed: **RiskScore**, **CorrelationRisk**, **VolatilityGuard**, **TWAP**, **Diversification**, **CreditWeighting**.

**Risk-score model (from docs):** Eight features — balance, concentration, diversification, volatility exposure, liquidity depth, time in position, recent drawdown, correlation. Proves score is below threshold without revealing the score. Groth16 proof verified on-chain.

**Anomaly detector (from docs):** Pool safety check; proves no anomaly without revealing analysis. Groth16 verified on-chain.

Each model **must** show:

- **Input parameters** (e.g. the eight features for risk score)
- **Output signal**
- **Effect on execution gating**
- **"This model blocks execution if X"**

No blank toggles. The relationship between models, risk thresholds and actual execution gating must be explicit. Provide **controls to adjust risk thresholds** in Brain. Integrate a simplified risk-score and anomaly visualisation into Brain (advanced circuit inspect optional, hidden by default).

**Section 4 — ZK Gate Pipeline (mandatory)**

Visual pipeline:

- AI Decision → zkML Circuit → Proof Generated → On-chain Verify → Execution

Live status indicator. When AI fires, show animation. Proof state must sync with backend response.

---

## 7. IDENTITY Surface Specification

Profile becomes the **system trust dashboard**.

**Reputation tier and passport (required)**

- Show **Reputation tier** (Strict, Standard, Express) with **implications**: proof requirement, rate limits, fees (from reputation API). **Upgrade path** (e.g. stake collateral) in the same view.
- Show **Risk Passport**: composite score (0–100), letter rating (A/B/C/D), tier, optional credit score. **Link passport to gating:** make the rule explicit (e.g. manual trading allowed for letter B or above; Assist or Autonomous may require A). When an action is blocked, show why (e.g. "Passport rating below required for this mode").

**Reputation score**

- Breakdown: Address age, Strategy performance, Risk discipline, Liquidation history, Vault tenure.
- Show formula (or factor list).

**Strategy reputation**

- Per strategy: APY, Volatility, Risk score, Adoption %.

**Agent reputation**

- Per deployed agent: ROI, Proof compliance %, Failure rate.

**Compliance profiles and selective disclosure (required)**

- **Compliance profiles** (from GET /compliance/profiles/{address}): List each profile with **when it was generated**, **which statement it proves** (e.g. yield above X, risk compliance), and **proof receipt ID**. Option to **generate new proofs** (yield threshold, risk compliance, KYC eligibility).
- **Selective disclosure toggles:** Reveal KYC tier | Reveal capital band | Reveal risk tier | Stay private.
- **Each toggle must explain ZK selective disclosure** (e.g. "Prove a fact without revealing raw data; you choose what to show"). Replace the separate compliance/disclosure tab with this Identity dashboard content.

---

## 8. Session Keys — First-Class (Mandatory)

Session keys are **not** implied by "Autonomous" or hidden in settings.

**State:** VaultStore owns `sessionKeyState`. Backend: `GET/POST /api/v1/zkdefi/session_keys/list/{address}`, grant, revoke.

**Vault surface**

- SessionKeysSummary: active session(s), expiry, scope (max capital, pools), **Revoke**.
- If mode is Assist/Autonomous and no session: CTA **"Grant session key in Brain"**.

**Brain surface**

- Session key grant/revoke is **primary** (Section 2). User sets max position, allowed pools, duration.
- Execution mode (Manual / Assist / Autonomous) must reference session: "Autonomous requires an active session key."

**Capital loop**

- "Session key granted" is a **visible step**. Ledger entries for AI actions can show "Under session &lt;id&gt;" so the user sees that execution was scoped.

**Rule:** You may not offer Autonomous or Assist execution without a way to grant and see session keys in the main flow.

---

## 9. Privacy — First-Class (Mandatory)

Privacy is **not** a separate tab. It is allocation type + deposit routing + selective disclosure.

**Vault**

- Allocation breakdown includes **Private %** (privacy-pool allocation). Clickable → Trade with privacy context.
- Deposit flow: when depositing, user can choose **routing**: Public pools | Private pools | Mixed. Default can favor Mixed or Private for privacy-first posture.

**Trade**

- When adding liquidity or swapping, context can include "Use private pool" where available (from allocation or pair options).

**Identity**

- Selective disclosure toggles with **ZK explanation**: "Reveal only what's needed; proofs verify without exposing raw data."

**Rules**

- Privacy is an **allocation type** (Public / Private / Mixed), not a separate page.
- No standalone "Privacy" tab; privacy lives in Vault allocation, deposit flow, and Identity disclosure.
- Copy and defaults should reflect **privacy-first** (e.g. "Private" and "Mixed" are first-class options, not afterthoughts).

---

## 10. Demo Mode Requirements

Demo mode must:

- Auto-seed vault with demo capital
- Simulate AI rebalances
- Simulate proof-verified events
- Populate ledger
- **Show at least one active session** (or clear "Grant session key" flow) so session keys are visible
- Show **Private %** in allocation (e.g. 30% Private) so privacy is visible

No empty screens. No static placeholders. Use existing backend where possible.

---

## 11. Backend Requirements

Add if missing:

- **GET /api/v1/zkdefi/ledger/transfers** (user_address, limit, offset) — for Vault ledger feed.
- Execution responses must include: **proofId**, **proofStatus**, **verifyTxHash**.
- Ledger must reflect proof status changes.
- Session key list/grant/revoke already exist; ensure responses are consumed by VaultStore and SessionKeysSummary.

---

## 12. Enforcement Rules

You **may**:

- Delete legacy components
- Refactor state architecture
- Remove unused analytics dashboards

You **may not**:

- Add more than 4 top-level routes
- Fake proof data
- Leave AI decisions unexplained
- Leave vault without ledger
- Offer Assist/Autonomous without visible session key grant/revoke
- Treat privacy as a separate page or hide Private allocation
- Show Risk Passport or reputation tier without tying them to execution gating (when an action is allowed or blocked, the user must see why)
- Retain a standalone Analytics or Intelligence tab — feed metrics into Vault, Trade and Brain instead

---

## FINAL STANDARD

When complete, zkde.fi must feel like:

- Capital flows are visible
- AI decisions are justified
- **Session keys are visible and scoped — no execution without them in Assist/Autonomous**
- **Privacy is selectable in allocation and deposit, and disclosure is under user control**
- Proofs are real and trackable
- Identity affects strategy
- Everything revolves around the Vault

If it feels like a DEX with extra tabs, or if session keys and privacy are buried, you failed.

---

## Why this truly groks with session keys and privacy-first

- **Session keys:** They own a slice of VaultStore, a dedicated summary on Vault, and primary grant/revoke in Brain. The capital loop explicitly includes "Session key granted." Autonomous/Assist cannot run without a session; the UI enforces visibility and control.
- **Privacy-first:** Private is an allocation bucket (Private %) and a deposit routing choice. There is no separate Privacy tab; privacy is how capital is allocated and what Identity reveals. Selective disclosure in Identity explains ZK. Demo mode shows Private % and session flow so both are present from first use.

Use with: `docs/plans/2026-03-02-agent-profile-rearchitecture-implementation.md` and `docs/plans/2026-03-02-agent-profile-megaprompt-builder.md`.

**Doc-backed alignment:** For what the system actually does (session keys, proof-gating, zkML models, Risk Passport, reputation, selective disclosure, private deposits) and how the UI must surface each, see **Appendix A** of the implementation plan.
