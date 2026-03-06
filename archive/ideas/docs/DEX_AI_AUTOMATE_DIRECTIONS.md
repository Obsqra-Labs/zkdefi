# DEX + AI automation: directions (thinking)

Ways we could use the DEX so the AI builds or rebalances a portfolio for the user. Not a spec — exploration.

---

## What we have today

- **DEX:** Ekubo Sepolia — quote + swap-calldata endpoints; frontend fills token in/out and user (or agent) signs and submits.
- **Agent / rebalancer:** Allocation targets (protocol weights), rebalance proposals; no swap execution yet.
- **Proof gating:** Risk/anomaly proofs; execution only when proofs pass.

So we have “what to do” (allocation, rebalance) and “how to execute” (DEX swap calldata); we don’t yet wire “rebalance” → “execute via DEX.”

---

## Directions

### 1. Rebalance → DEX (single flow)

- User (or AI) sets **target weights** (e.g. 60% ETH, 40% USDC).
- Backend compares **current holdings** vs target; derives a list of **swaps** (e.g. “sell X of token A, buy Y of token B”).
- For each swap: call our **quote** then **swap-calldata**; return calldata to frontend or agent.
- User approves (or agent submits with session key); tx goes to Ekubo.
- **Gating:** Same as today — only execute if risk/policy proofs pass. So “AI builds portfolio” = proof-gated rebalance via DEX.

### 2. Who executes?

- **User signs each swap:** Frontend shows “Rebalance: 3 swaps”; user signs one by one (or we batch if Ekubo/router supports it).
- **Agent (session key) signs:** Agent has “ekubo” in allowed protocols; backend returns swap-calldata; agent submits. No change to proof-gating; only add “swap” as an allowed action when protocol is ekubo.
- **Hybrid:** Agent proposes; user approves once (“execute rebalance”); agent then signs the list of swaps (or we need a batch contract).

### 3. Where do target weights come from?

- **User-set:** User picks a preset (e.g. “Stable”, “60/40”) or sliders. AI only executes, doesn’t decide weights.
- **AI-suggested:** zkML or heuristic suggests weights (e.g. from risk, momentum); user approves or edits; then execute via DEX.
- **Fully automated:** User sets constraints (e.g. “max 20% any single token”); agent periodically rebalances to stay within bounds. Still proof-gated (e.g. only if risk score &gt; X).

### 4. Batch vs one-by-one

- **One tx per swap:** Simple; we already have quote + swap-calldata per pair. Agent or user signs N txs.
- **Batch / route:** Ekubo might support multi-hop in one lock; we’d need to build one calldata that does “A→B→C” in one callback. Higher effort; better UX and gas if we get it.

### 5. Portfolio “build” from scratch

- User has only one asset (e.g. ETH). Target is “50% ETH, 50% USDC.”
- Backend: one swap (ETH → USDC). Quote + swap-calldata; user or agent signs.
- Same flow as rebalance; “build” is just rebalance from a single-asset state.

### 6. Data we need

- **Current holdings:** Wallet balances (we have or can add position fetch). Or user-stated “I have X of token A.”
- **Target weights:** User or AI input (percentages or dollar amounts).
- **Map weight → swap list:** “Current: 100% ETH. Target: 60% ETH, 40% USDC” → “Swap 40% of ETH for USDC.” Need prices or pool state to convert % to token amounts; DEX quote does the rest.

### 7. UX hooks

- **Dashboard:** “Rebalance” button → “Target allocation” modal → “Execute” → sign swap(s) or approve agent.
- **Agent tab:** “Suggested rebalance” card with target weights and “Approve” / “Execute via DEX.”
- **DEX tab:** Already have pair selection and swap; add “Rebalance to this pair’s tokens” or “Set as target” for a pair (e.g. “Make my portfolio 50% token0, 50% token1”).

---

## Summary

- **Minimal path:** Wire rebalancer to DEX: backend computes “current vs target” → list of swaps → for each swap, quote + swap-calldata; frontend or agent signs. Proof-gating unchanged.
- **Richer path:** AI suggests targets; user approves; agent executes swaps (session key + “ekubo” allowed). Batch swaps if we invest in router/aggregator.
- **Lots of ways to go:** Presets vs AI-suggested vs fully automated; user-signed vs agent-signed; one-by-one vs batch. This doc is a placeholder to resurface when we prioritize.
