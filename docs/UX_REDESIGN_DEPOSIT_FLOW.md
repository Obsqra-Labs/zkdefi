# UX Redesign: Deposit Flow (DeFi + UX Expert Lens)

**Problem in one sentence:** The UI implies "deposit to Pools / Ekubo / JediSwap" but the product actually does "deposit to the agent contract, credited to an allocation bucket." That mental-model mismatch plus overloaded words (Pools, Deposit) makes the flow confusing.

**Design principle:** Match the UI to the real model. One primary action, custody stated upfront, protocol/bucket as a secondary choice (or deferred).

---

## 1. What’s Wrong Today

| Issue | Why it hurts |
|-------|----------------|
| **"Pools \| Ekubo \| JediSwap" as equal tabs** | Suggests "pick where to send funds." Funds don’t go to those protocols; they go to the agent. So users think they’re depositing "to JediSwap" and get confused when nothing shows up on JediSwap. |
| **"Proof-Gated Deposit" + "Pools"** | Two axes (action vs destination) look like one. "Deposit" and "Pools" both sound like targets. |
| **"Pools" as a protocol name** | In DeFi, "pools" = liquidity pools. Here it’s protocol_id 0 (default bucket). Same word, different meaning. |
| **Custody never stated** | Users don’t know that the agent contract holds the funds and that Pools/Ekubo/JediSwap are ledger labels until they read code or docs. |
| **Too many choices before "add funds"** | User goal: add funds. Forcing "Pick protocol" first adds cognitive load and reinforces the wrong model ("I’m depositing to Ekubo"). |

---

## 2. Target Mental Model (State This Clearly)

- **Agent account** = one proof-gated balance held by the ProofGatedYieldAgent contract. You add funds (deposit) and remove funds (withdraw); both are proof-gated.
- **Allocation buckets** = how we label your balance internally: Default, Ekubo, JediSwap. Right now these are ledger labels only (no automatic send to external protocols). Later, "deploy to protocol" can be a separate flow.
- **Deposit** = "Add funds to my agent account (proof-gated)." Optional: "Credit to bucket: Default / Ekubo / JediSwap."

So: **one place (agent), one primary action (add funds), optional bucket (where to credit).**

---

## 3. Redesigned Information Architecture

### 3.1 One primary flow: "Add funds"

- **Label:** "Add funds" or "Deposit to agent" (not "Proof-Gated Deposit" as the main title; "proof-gated" is the mechanism).
- **Subline:** "Proof-gated · Your constraints are verified on-chain before any move."
- **Steps:**
  1. **Amount** (required) + **Max position** (optional, constraint).
  2. **Allocation bucket** (optional, default: Default): "Credit this deposit to: Default | Ekubo | JediSwap." With tooltip: "Your balance is tracked per bucket. Funds are held by your agent contract."
  3. **Generate proof** → **Review** → **Sign & add funds**.

Do **not** lead with three protocol tabs. Lead with one "Add funds" card; bucket is a single dropdown or radio in step 1 or in Review.

### 3.2 State custody once, clearly

- **Place:** Top of the Agent tab or inside the first "Add funds" card (collapsible "Where do my funds go?").
- **Copy (short):** "Your funds are held by your proof-gated agent contract on Starknet. You can add funds, withdraw (with proof), and allocate across buckets (Default, Ekubo, JediSwap). Only you can move funds, and only with a valid proof."
- **Place (alternative):** Onboarding or first-time tooltip: "Think of it like a proof-gated wallet: you deposit here, we track your balance per bucket; withdrawals require a proof."

### 3.3 Separate "Positions" from "Add funds"

- **Positions / Allocation** = "How is my agent balance split across Default, Ekubo, JediSwap?" (read-only or future rebalance). This is a **view**, not the deposit flow.
- **Add funds** = single flow: amount → (optional bucket) → proof → sign. No "choose protocol" as the first decision.

So in the nav/sections:

- **Agent:**  
  - One card: **"Add funds"** (primary CTA).  
  - One card: **"Withdraw"** (proof-gated).  
  - One card: **"Private transfer"** (stealth deposit/withdraw).  
  - Then: **Positions** (summary by bucket: Default, Ekubo, JediSwap).

- Remove the prominent **"Proof-Gated Deposit" | "Withdraw"** tabs with **"Pools | Ekubo | JediSwap"** as a row of equal choices. Replace with:
  - One "Add funds" flow that includes an optional "Credit to: [Default ▼]" (or Default | Ekubo | JediSwap).
  - "Withdraw" flow: same idea — "Withdraw from: [bucket]" + amount + proof.

### 3.4 Naming

| Current | Prefer | Reason |
|--------|--------|--------|
| Proof-Gated Deposit | **Add funds** (or "Deposit to agent") | Action-oriented; "proof-gated" in subline. |
| Pools | **Default** (or "Default bucket") | Avoids "pools" = liquidity pools. |
| Pools \| Ekubo \| JediSwap (tabs) | **Credit to: Default / Ekubo / JediSwap** (dropdown or radio in one step) | Makes clear it’s "where to credit," not "where funds go on-chain." |
| Sign & Deposit | **Sign & add funds** | Matches "Add funds." |

Keep "Ekubo" and "JediSwap" so power users recognize protocols; add short tooltip that for now this is allocation bucket only (no direct deployment to that protocol in this flow).

---

## 4. Concrete UI Changes (Implementation Checklist)

### 4.1 Agent tab layout

1. **Custody blurb** (once per agent view):  
   "Funds are held by your proof-gated agent contract. Add funds, withdraw with proof, and see your balance by allocation bucket below."

2. **Single "Add funds" card** (replaces "Proof-Gated Deposit" + "Withdraw" tabs + "Pools | Ekubo | JediSwap" row):
   - Title: **Add funds**
   - Subline: **Proof-gated · Constraints verified on-chain**
   - Step 1: Amount (required), Max position (optional).
   - Step 1 (same screen): **Credit to:** [Default ▼] (Default | Ekubo | JediSwap). Small tooltip: "Balance is tracked per bucket; funds are held by the agent contract."
   - Step 2: Generate proof.
   - Step 3: Review — e.g. "You’re adding **X** to your agent account. Credited to **Default**. Your constraints will be verified on-chain."
   - Step 4: **Sign & add funds**.

3. **Withdraw** in the same card or a second card:
   - Title: **Withdraw**
   - **From bucket:** [Default ▼] (Default | Ekubo | JediSwap), **Amount**, then proof → sign.

4. **Positions** (existing or new component):
   - Title: **Your balance by bucket**
   - Rows: Default, Ekubo, JediSwap with amounts. Subline: "Held by your agent contract. Withdrawals are proof-gated."

### 4.2 ProtocolPanel / deposit component

- **Props:** Keep `protocolId` internally but don’t expose it as "Pools | Ekubo | JediSwap" tabs.
- **Default:** `protocolId = "pools"` (Default). In the UI, show "Credit to: Default" unless user opens dropdown and picks Ekubo/JediSwap.
- **Copy in panel:** "Add funds to your agent account" and "Credited to: [Default]" (or selected bucket). Remove headline that says e.g. "Pools" or "Proof-gated deposit" as the main title for a protocol; the main title is "Add funds."

### 4.3 Agent page (agent/page.tsx)

- Remove the row of protocol buttons (Pools | Ekubo | JediSwap) as the primary choice before the panel.
- Use one "Add funds" flow; inside the flow, one "Credit to" control (dropdown or radio) with options Default, Ekubo, JediSwap.
- Optional: keep a **Positions** section that shows balance per bucket (Default, Ekubo, JediSwap) so "allocation" is visible without implying "deposit to protocol."

---

## 5. Summary: Before vs After

| Before | After |
|--------|--------|
| Tabs: Proof-Gated Deposit \| Withdraw; then Pools \| Ekubo \| JediSwap | One "Add funds" flow; optional "Credit to: Default / Ekubo / JediSwap" inside the flow. |
| Custody unclear | One line: "Funds are held by your agent contract; balance is tracked per bucket." |
| "Pools" = protocol tab | "Default" = default allocation bucket; Ekubo/JediSwap as other buckets. |
| User thinks: "I’m depositing to JediSwap" | User thinks: "I’m adding funds to my agent account, credited to JediSwap bucket." |
| Two axes (action + destination) look the same | One action (add funds); destination is "agent"; bucket is a secondary attribute (where to credit). |

---

## 6. DeFi UX Principles Used

1. **Match the contract** — UI says "add funds to agent, credited to bucket" because that’s what the contract does.
2. **One primary action** — "Add funds" first; bucket second. No "choose protocol" before "how much."
3. **Custody explicit** — Users know who holds the funds (agent contract) and that buckets are labels.
4. **Progressive disclosure** — Amount and optional max position first; "Credit to" can be defaulted so most users don’t have to choose.
5. **Consistent nouns** — "Add funds" / "Withdraw" = actions; "Default / Ekubo / JediSwap" = allocation buckets, not "where funds go on-chain" in this flow.
6. **Reduce jargon upfront** — "Proof-gated" in subline, not in the main CTA; "bucket" instead of "protocol" for allocation to avoid implying external protocol deployment.

This keeps the same contract and API but aligns the UI with how the product actually works and removes the confusion between "deposit," "pools," and "where the money goes."
