# Pools, Rebalance Modes, Intent-Aware Deposit/Withdraw — Design

**Date:** 2026-03-10  
**Status:** Approved (brainstorming session)

**Goal:** Fix deposit/withdraw flows, unify “what’s in the pools” with one ledger, introduce two rebalance modes (user vs oracle), make the deposit/withdraw drawer intent-aware (from pool vs from vault), gate oracle rebalance with zkML only, and cache pool/oracle state for faster load.

---

## 1. Architecture and state model

- **Single ledger:** Double-entry ledger remains the source of truth for pool buckets: `POOL:{pool_id}:idle:{token}` and `POOL:{pool_id}:{adapter}:{pair}`. No separate “user pool” vs “oracle pool”; the bucket is the same. Only who is allowed to move capital (user’s agent vs oracle) changes with mode.

- **Account-level rebalance mode:** One setting per user: `rebalance_mode: "user" | "oracle"`. Stored in backend (user/preferences store or table keyed by `user_address`). When **user**: only that user’s authenticated agent (with their constraints) may call deploy/close for their capital. When **oracle**: the operator/oracle service may propose and execute rebalances for that user’s idle capital, gated by zkML.

- **Deposits (same for both modes):** User always deposits into a chosen pool (Conservative / Moderate / Aggressive). On-chain: existing full-privacy flow. Off-chain: after a successful deposit we credit the bucket via `credit_pool_idle(pool_id, token, amount_wei, ...)` so “what’s in the pools” matches reality. Mode only affects who can rebalance (deploy/close), not who can deposit or which bucket receives the deposit.

- **Withdrawals:** Same withdrawal flow for both modes. Only the actor allowed to rebalance can close positions; withdraw proof flow is unchanged.

---

## 2. Data flow — deposit → ledger, who rebalances

- **Deposit → bucket:** User picks pool, amount, asset; frontend calls `generate_commitment` with `pool_type`. User signs on-chain deposit; frontend calls `register_commitment`. **New:** Backend calls `credit_pool_idle` from `generate_commitment` (see Section 3) so the ledger reflects the deposit.

- **Read:** Both user agent and oracle read the same state via `GET /pools/{pool_id}/composition`.

- **Write (deploy/close):** **User mode:** Only the user’s agent (authenticated) may call `POST /pools/{pool_id}/deploy` and `POST /pools/{pool_id}/close`. **Oracle mode:** Only the operator may call deploy/close for that user’s capital, after zkML risk + anomaly pass.

- **Attribution (MVP):** For MVP we can treat all balance in the pool as rebalanceable by oracle when mode is oracle; per-user attribution in refs can be added later.

---

## 3. Deposit/withdraw — entry points and intent-aware drawer

**Two entry points:**

1. **From the pool (bucket card):** Each pool card has Deposit and Withdraw. Deposit → intent = “Deposit into this pool”. Withdraw → intent = “Withdraw from this pool”.

2. **From the vault:** Vault/identity area has Fund and Withdraw. Fund → intent = “Deposit to my vault” (user chooses destination pool in drawer). Withdraw → intent = “Withdraw from my vault” (show all positions).

**Drawer behavior by intent:**

- **Intent: “Deposit into pool X”** (opened from pool card X): Title e.g. “Deposit to Conservative”. Pool fixed; no pool selector. Asset, amount, submit. Backend receives `pool_id` from context.

- **Intent: “Deposit to vault”** (opened from vault Fund): Title e.g. “Fund vault”. User chooses destination pool (or vault default). Asset, amount, submit.

- **Intent: “Withdraw from pool X”** (opened from pool card X): Title e.g. “Withdraw from Conservative”. List only that pool’s positions; user picks and submits.

- **Intent: “Withdraw from vault”** (opened from vault Withdraw): Title e.g. “Withdraw”. List all positions (optionally grouped by pool). User picks and submits.

**State passed into drawer:** When opening from a pool card: `intent: "deposit" | "withdraw"`, `poolId: "conservative" | "moderate" | "aggressive"`. When opening from vault: `intent`, `poolId: null` (or `source: "vault"`). Drawer branches on `poolId`: if set, pool is fixed; if null, show pool selector (deposit) or all positions (withdraw).

---

## 4. zkML and streams

- **zkML gating:** Required only for **oracle** rebalance (deploy/close). User-mode rebalance is gated by auth and user constraints only; no zkML for MVP.

- **Streams:** Activity stream remains a log of events. For MVP we do not verify every stream item with zkML. Optional follow-up: when the oracle executes a rebalance, record it in the stream with a “zkML-gated” badge so the feed is “intelligent” in the sense of showing which actions were proof-gated.

---

## 5. Caching

- **Pool composition:** Cache `get_composition(pool_id)` (e.g. 15–30s TTL). Key: `composition:{pool_id}`.

- **Prices:** Use existing market cache (or a dedicated price helper) for token prices used by composition so repeated requests don’t hit the oracle every time.

- **Opportunities:** Cache aggregated opportunities response (e.g. 30s) so Capital tab and stream load fast.

- **No cache (or very short):** User-specific withdraw data and auth/mode stay real-time.

---

## 6. Error handling and edge cases

- **Composition fails:** Return 5xx; frontend shows error state and retry. If drawer opens with missing `poolId` when intent expects a pool, fall back to vault flow and log.

- **Deposit:** No credit if generate fails. If credit succeeds but user never registers, accept for MVP; optional “pending” cleanup later. Unconnected user → connect CTA/toast.

- **Withdraw:** Empty state when “Withdraw from pool X” has no positions. Existing proof/stale handling unchanged.

- **Oracle:** zkML fail → no execute; no partial write. User agent errors → log, no partial ledger update.

- **Cache:** Cache miss or backend restart → next request recomputes; optional invalidation on deploy/close for that pool.
