# SessionMap for zkde.fi — Implementation Spec

A real-time 2D operations map where **workflow runs** (deposit, withdraw, rebalance, onboarding) move through zones toward **the Gate** (proof-gated execution). Focus: **waiting state when generating STARKs** and a **heat map** of activity. Informed by the zkde.fi codebase (ProofPipeline, ZkdefiAgentService, ReputationRegistry, session keys).

---

## 1. What SessionMap Is

- **Agents** = **Workflow runs** — one deposit, one withdraw, one rebalance, or one onboarding proof run. Each run has a short ID (e.g. `run_3f9a`).
- **The Gate** = Proof-gated execution: only runs that reach **READY** (proofs verified) can move to **EXECUTING** and **SETTLED**.

So: "Workflow runs trying to get through the gate," with special focus on the **waiting state when generating STARKs** and a **heat map** of where activity is (idle, proving, queue, gate).

- **Living dashboard** — real-time counts and positions.
- **Simulation feel** — runs move through zones.
- **Proof pipeline monitor** — especially PROVING (and within it, STARK phase) and queue at gate.

---

## 2. "Session" in zkde.fi Terms

Two notions:

- **(a) Session key** — from `session_keys` API (grant/revoke/list). One "session" = one granted key (owner + session_key_address + constraints).
- **(b) Workflow run** — one attempt to perform an action: one deposit, one withdraw, one rebalance, or one onboarding proof run. Has lifecycle: triggered → proofs → verify → execute → settled/failed.

**Recommendation:** Use **(b) workflow run** as the map unit. Each run gets a **run_id** (e.g. `run_3f9a`). Optionally, a run carries **session_id** (which granted session key is acting) for "my sessions" filtering without leaking identity in public view.

**Backend:** Model a **workflow run** — create run when user/agent triggers deposit/withdraw/rebalance/onboarding; transition state as proofs and tx progress; emit events. Session keys stay as-is (who is allowed to act); the map's "sessions" are runs (execution attempts).

---

## 3. State Machine (Aligned With zkde.fi Flow)

Single spine for all workflow types.

| State | Description | Fail path |
|-------|-------------|-----------|
| **IDLE** | No run yet or run just created | — |
| **ARMED** | Trigger received (user/agent/onboarding) | — |
| **PRECHECK** | Constraints checked (get_constraints, tier limits, daily counts) | REJECTED_POLICY |
| **PROVING** | Proof generation in progress | FAILED_PROOF |
| **PROVING_ZKML** | Risk + anomaly (Groth16) in progress | FAILED_PROOF |
| **PROVING_STARK** | Execution proof (Stone/Integrity) in progress — **2–3 min wait** | FAILED_PROOF |
| **READY** | All proofs verified (zkML + fact_hash) | — |
| **QUEUE_AT_GATE** | Waiting for execution slot | — |
| **EXECUTING** | Tx submitted to chain | EXECUTION_REVERT, TIMEOUT |
| **SETTLED** | Tx confirmed; receipt appended | — |
| **COOLDOWN** | Linger then despawn | — |
| **REJECTED_POLICY** | Constraints or tier/daily limits failed | — |
| **FAILED_PROOF** | zkML or STARK generation/verify failed | — |
| **EXECUTION_REVERT** | Tx reverted | — |
| **TIMEOUT** | Stuck in PROVING or EXECUTING too long | — |
| **REVOKED** | Session revoked mid-run (if supported) | — |

**Workflow-specific:** Deposit/withdraw/rebalance share the spine; onboarding is ARMED → PRECHECK → PROVING_STARK → READY → SETTLED. Rebalance can include allocation-risk check (Cairo) in PRECHECK.

**Codebase touchpoints:**

- PRECHECK: `get_constraints`, ReputationRegistry tier limits and daily deposit/withdrawal counts.
- PROVING_ZKML: `ProofPipeline.generate_rebalancing_proofs` / `generate_deposit_proofs` (risk + anomaly).
- PROVING_STARK: `ZkdefiAgentService.deposit_with_constraints` / `withdraw_with_constraints` (Stone prover), onboarding route (Stone prover, 2–3 min).
- READY: fact_hash from Integrity; zkML passed.
- EXECUTING / SETTLED: frontend or backend submits tx to ProofGatedYieldAgent; tx confirmed.

---

## 4. Data Sources and Event Emission

**Current backend:**

- Session keys: `app/api/session_keys.py` — grant, list, validate.
- Proof pipeline: `app/services/proof_pipeline.py` — generate_rebalancing_proofs, generate_deposit_proofs.
- Agent service: `app/services/zkdefi_agent_service.py` — deposit_with_constraints, withdraw_with_constraints (Stone prover, fact_hash).
- Onboarding: `app/api/routes/onboarding.py` — STARK proof via Stone prover (2–3 min).
- Reputation: `contracts/src/reputation_registry.cairo` — get_user_tier, get_tier_limits, get_daily_deposit_count, get_daily_withdrawal_count.

**Add:**

1. **Workflow run store** (in-memory or DB): create run at trigger, update state at each step.
2. **Event emission** at each transition: `run.created`, `run.updated` (state, optional sub_state), `proof.started`, `proof.progress` (phase: zkml | stark), `proof.verified`, `proof.failed`, `tx.submitted`, `tx.confirmed`, `tx.reverted`, `run.ended`.
3. **Real-time transport:** WebSocket (or SSE) from FastAPI; optionally Redis pub/sub. Client subscribes and keeps in-memory run store.

**STARK waiting:** When state = PROVING and phase = stark, map shows run in "Proof Forge" with distinct visual ("STARK pending"); optionally coarse progress if prover exposes it.

---

## 5. Disclosure (Tier + "Private Budget" → What Map Can Show)

**ReputationRegistry already has:**

- Tiers: Strict (0), Standard (1), Express (2).
- Per-tier limits: max_deposits_per_day, max_withdrawals_per_day, max_position, etc.
- Daily counters: get_daily_deposit_count, get_daily_withdrawal_count.

**"Private budget"** = remaining allowance for the day (e.g. deposits/withdrawals left) from tier limits minus current usage. No new token; "PU" = remaining private actions per day (or points on top of same limits).

**Disclosure profile:**

| Level | When | Map shows |
|-------|------|-----------|
| **FULL_PRIVATE** | High tier + budget left | run_id, state, proof status, tier bucket; no wallet, amount, venue, intent |
| **PARTIAL** | Mid tier or budget low | wallet hashed (0xA3…91), intent category (deposit/withdraw/rebalance), output bucketed (small/medium/large) |
| **PUBLIC_ENFORCED** | Budget exhausted or low tier | Per policy: wallet and/or intent and/or output; still no shame copy, "rules of the world" |

**Policy engine:** Inputs: run_id, user/session, action_type, tier, budget remaining (from ReputationRegistry + daily counts). Output: DisclosureProfile (level + per-field: wallet, intent, output, venue, constraints). Every run.updated event includes this so client never guesses.

**Map rendering:**

- Privacy shield on avatar: solid (FULL_PRIVATE), cracked (PARTIAL), broken (PUBLIC_ENFORCED).
- Reveal badges only when policy allows (wallet / intent / output).
- Click panel: timeline + proof status always; wallet/intent/output lines only if disclosed; short explanation ("Private budget exhausted for today", "Tier requirement not met for fully private withdraws").

**Anti-abuse:** Rate limit and time-box reveals; public view only bucketed outputs; full amounts only in authenticated "my runs" view.

---

## 6. Movement and Zones (Spatial Metaphor)

| Zone | State(s) | Behavior |
|------|----------|----------|
| **Wander Field** | IDLE | Gentle drift or static |
| **Trigger Beacons** | — | User/agent triggers "pull" runs from IDLE to ARMED (pulse) |
| **Proof Forge** | PROVING, PROVING_ZKML, PROVING_STARK | Cluster here; PROVING_STARK orbit/pulse ("STARK in progress") |
| **Gate Queue Lane** | READY, QUEUE_AT_GATE | Line up toward gate |
| **The Gate** | EXECUTING | Pass through; "receipt flash" on SETTLED |
| **Exit Path** | SETTLED | Move out, COOLDOWN, despawn |
| **Reject eddy** | REJECTED_POLICY, FAILED_PROOF, TIMEOUT, etc. | Bump out, cool down |

Trust/tier: higher tier = smoother movement; revoked/blocked = cannot approach gate (soft force field). Optional: tier affects queue order (politically sensitive).

---

## 7. Event Schema (Minimum Viable)

**Event types:** `run.created` | `run.updated` | `proof.started` | `proof.progress` | `proof.verified` | `proof.failed` | `tx.submitted` | `tx.confirmed` | `tx.reverted` | `run.ended`.

**Common fields:**

- `type`: string
- `runId`: string (e.g. `run_3f9a`)
- `state`: string (see state machine)
- `subState` (optional): e.g. `zkml` | `stark` when state = PROVING
- `tier`: 0 | 1 | 2 (Strict / Standard / Express)
- `trustBucket` (optional): low | med | high
- `workflow`: deposit | withdraw | rebalance | onboarding
- `createdAt`, `updatedAt`: number (Unix)
- `publicMeta`: object (e.g. `{ "workflow": "deposit", "status": "pending" }`) — no sensitive data
- `disclosure` (optional): DisclosureProfile

**Example (waiting on STARKs):**

```json
{
  "type": "run.updated",
  "runId": "run_3f9a",
  "state": "PROVING",
  "subState": "stark",
  "tier": 1,
  "workflow": "deposit",
  "updatedAt": 1700000123,
  "publicMeta": { "workflow": "deposit", "status": "proving_stark" },
  "disclosure": {
    "level": "FULL_PRIVATE",
    "reveals": {
      "wallet": "hidden",
      "intent": "hidden",
      "output": "hidden",
      "venue": "hidden",
      "constraints": "hidden"
    },
    "reasonCodes": []
  }
}
```

**DisclosureProfile type:**

```ts
type DisclosureProfile = {
  level: "FULL_PRIVATE" | "PARTIAL" | "PUBLIC_ENFORCED";
  reveals: {
    wallet: "hidden" | "hashed" | "full";
    intent: "hidden" | "category" | "full";
    output: "hidden" | "bucketed" | "full";
    venue: "hidden" | "category" | "full";
    constraints: "hidden" | "commitment_only" | "full";
  };
  reasonCodes: string[];
  expiresAt?: number;
};
```

---

## 8. Client Systems (Phaser + Vite or Next Route)

- **SessionStore** — authoritative run list from events.
- **EventIngestor** — WebSocket → update store.
- **Spawner** — run created → create avatar (run_id, tier, disclosure).
- **StateDirector** — state/subState → target zone + animation (Proof Forge for PROVING, queue lane for READY, gate for EXECUTING).
- **MovementSystem** — steering toward target zone; PROVING_STARK distinct orbit/pulse.
- **GateSystem** — queue slots + pass-through + receipt flash.
- **VFXSystem** — scan beams, receipt flash, rejection pulse.
- **UIOverlay** — total active runs; counts by state (IDLE / PROVING / READY / EXECUTING / FAILED); filters (workflow, tier, "my runs," stuck > X s); click run → side panel (public-safe fields + timeline + disclosure-aware fields).

Tech: Phaser + Vite as standalone, or Next route embedding same client; WebSocket to FastAPI (or Node/TS gateway over Redis).

---

## 9. Backend Touchpoints (Where to Instrument)

| Location | File / area | Emit |
|---------|-------------|------|
| Trigger: deposit | Frontend or API that starts deposit flow | run.created (ARMED), run.updated (PRECHECK) |
| Trigger: withdraw | Same for withdraw | run.created (ARMED), run.updated (PRECHECK) |
| Trigger: rebalance | Same for rebalance | run.created (ARMED), run.updated (PRECHECK) |
| Trigger: onboarding | `app/api/routes/onboarding.py` (e.g. generate_authorization) | run.created (ARMED), run.updated (PRECHECK) |
| Proof start (zkML) | `app/services/proof_pipeline.py` (generate_rebalancing_proofs, generate_deposit_proofs) | proof.started (phase: zkml), run.updated (PROVING_ZKML) |
| Proof start (STARK) | `app/services/zkdefi_agent_service.py` (deposit_with_constraints, withdraw_with_constraints); onboarding | proof.started (phase: stark), run.updated (PROVING_STARK) |
| Proof verified | After Stone returns fact_hash; after zkML pass | proof.verified, run.updated (READY) |
| Proof failed | On exception or prover error | proof.failed, run.updated (FAILED_PROOF) |
| Tx submit | Where frontend/backend calls ProofGatedYieldAgent | tx.submitted, run.updated (EXECUTING) |
| Tx confirmed | Chain watcher or frontend confirmation | tx.confirmed, run.updated (SETTLED) |
| Tx reverted | Chain watcher or frontend | tx.reverted, run.updated (EXECUTION_REVERT) |
| Tier / daily limits | Before executing; when building disclosure | Policy engine input (tier, daily counts from ReputationRegistry) |

---

## 10. Build Phases

| Phase | Scope | Duration |
|-------|--------|----------|
| **A: Live map skeleton** | Phaser world, zones, gate; WebSocket + mock event stream; spawn runs, move by state; basic counts + filters; mock PROVING_STARK | 2–3 days |
| **B: Real sessions** | Workflow run store in backend; emit events on real deposit/withdraw/rebalance/onboarding; client to real WS; tier from ReputationRegistry (or cached) | 2–5 days |
| **C: Proof pipeline** | ProofPipeline + ZkdefiAgentService emit proof.started / proof.progress (zkml \| stark) / proof.verified / proof.failed; map shows PROVING_ZKML vs PROVING_STARK and Proof Forge heat | 2–5 days |
| **D: Execution** | Tx submit/confirm/revert emit tx.submitted / tx.confirmed / tx.reverted; gate pass-through and receipt flash; stuck detection (e.g. PROVING > 5 min) | 2–5 days |
| **E: Polish + safety** | Disclosure policy engine (tier + daily limits → DisclosureProfile); include in events; client render by profile; "my runs" auth mode; performance (caps, pooling); replay (last N min) | Ongoing |

---

## 11. Spec Kit for a Dev

1. **Event schema** — TypeScript types or JSON Schema for event types, runId, state, subState, workflow, tier, disclosure (this doc §7).
2. **State machine** — Table in §3; transitions and codebase touchpoints.
3. **Disclosure profile** — Type and rules in §5; policy inputs from ReputationRegistry.
4. **Backend touchpoints** — Table in §9 (files and what to emit).
5. **WS stub** — FastAPI WebSocket endpoint that broadcasts mock events (then real from run store).
6. **Phaser client skeleton** — Zones, gate, spawn on run.created, StateDirector (state → zone), MovementSystem, basic UI (counts, filters, click panel). Mock event generator for Phase A.

---

## References

- Session keys: `backend/app/api/session_keys.py`, `backend/app/services/session_key_service.py`
- Proof pipeline: `backend/app/services/proof_pipeline.py`
- Agent service (Stone prover): `backend/app/services/zkdefi_agent_service.py`
- Onboarding (STARK): `backend/app/api/routes/onboarding.py`
- Reputation: `contracts/src/reputation_registry.cairo` (ProofTier, TierLimits, daily counts)
- Proof-gated agent: `contracts/src/proof_gated_yield_agent.cairo`
