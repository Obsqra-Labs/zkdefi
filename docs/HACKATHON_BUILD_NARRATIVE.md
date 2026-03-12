# zkde.fi Hackathon Build Narrative

**Project:** zkde.fi by Obsqra Labs  
**Track framing:** Privacy + AI + trust infrastructure on Starknet  
**Positioning:** Private DeFi execution with verifiable intelligence and reputation-aware controls

---

## 1) Core Thesis (Judge-Friendly)

Most privacy products stop at hiding transactions.

zkde.fi goes further: we use zero-knowledge systems to make **private capital flows programmable, policy-aware, and trust-aware**. The user keeps cryptographic privacy, while the system can still verify risk checks, gating decisions, and execution receipts.

Short version:

**We invert the usual ZK story from "hide everything and trust nothing" to "protect identity and intent while still proving enough to coordinate capital safely."**

This is the core privacy-track claim: **cryptographically protected identity + verifiable trust rails**.

---

## 2) What The MVP Can Do Right Now

This is the "you can do this today" section for demo and submission copy.

### A. Private capital in/out with proof-based rails

- Generate private deposit commitments:
  - `POST /api/v1/zkdefi/full_privacy/deposit/generate_commitment`
- Register commitments into Merkle state:
  - `POST /api/v1/zkdefi/full_privacy/deposit/register_commitment`
- Generate withdrawal proofs (full or partial with change):
  - `POST /api/v1/zkdefi/full_privacy/withdraw/generate_proof`
  - `POST /api/v1/zkdefi/full_privacy/withdraw/generate_proof_with_change`
- Optional relayer paths for privacy-preserving execution handoff:
  - `POST /api/v1/zkdefi/relayer/request`

### B. Pool-aware capital controls

- Pool composition and bucket state:
  - `GET /api/v1/zkdefi/pools/{pool_id}/composition`
- Controlled deploy/close flows per pool:
  - `POST /api/v1/zkdefi/pools/{pool_id}/deploy`
  - `POST /api/v1/zkdefi/pools/{pool_id}/close`
- Rebalance mode is account-level:
  - `GET /api/v1/zkdefi/mc/rebalance-mode/{address}`
  - `PUT /api/v1/zkdefi/mc/rebalance-mode/{address}`
  - Modes: `"user"` (self-controlled) or `"oracle"` (operator path with gating)

### C. Trust, reputation, and identity context

- Reputation tiers and user scoring:
  - `GET /api/v1/zkdefi/reputation/tiers`
  - `GET /api/v1/zkdefi/reputation/user/{address}`
- Reputation proof pack and credit-eligibility proof rails:
  - `POST /api/v1/zkdefi/reputation/proof/credit-eligibility`
  - plus solvency/risk-passport/performance/strategy/execution proofs
- Risk Passport summaries for users and pools:
  - `GET /api/v1/zkdefi/risk_passport/user/{address}`
  - `GET /api/v1/zkdefi/risk_passport/pool/{pool_id}`

### D. Intelligence and execution stack

- Opportunity discovery and execution workspace APIs:
  - `GET /api/v1/zkdefi/trade-desk/v2/opportunities`
  - `POST /api/v1/zkdefi/trade-desk/v2/execute/simulate`
  - `POST /api/v1/zkdefi/trade-desk/v2/execute/prepare`
  - `POST /api/v1/zkdefi/trade-desk/v2/execute/submit`
- Rebalancer pipeline (analyze -> propose -> check -> prepare -> execute):
  - `/api/v1/zkdefi/rebalancer/*`
- Autonomous controls + session key management:
  - `/api/v1/zkdefi/rebalancer/autonomous/*`
  - `/api/v1/zkdefi/session_keys/*`

### E. Observable proof trail

- Timeline and receipt surfaces:
  - `/api/v1/zkdefi/mc/stream/{address}`
  - `/api/v1/zkdefi/receipts/*`
- Real-time transport available via WebSocket (`/ws/{user_address}` in backend app).

---

## 3) Proving Stack And Circuit Inventory (Core Technical Story)

### A. Current circuit inventory (repo reality)

- Current tree contains **31 first-party Circom circuits** under `circuits/` (excluding dependency circuits in `circuits/node_modules`).
- That comfortably supports the "over 20 circuits" claim in the submission.
- Historical archive docs captured an earlier snapshot at 26; current repo inventory is larger.

### B. Circuit categories judges can understand quickly

- Privacy primitives: `PrivateDeposit`, `PrivateWithdraw`, `FullPrivacyWithdraw*`
- Risk and safety scoring: `RiskScore`, `AnomalyDetector`, `CorrelationRisk`, `SafetyDiversification`, `TWAPPosition`
- Strategy and execution integrity: `YieldOptimality`, `StrategyIntegrity`, `SlippageBound`, `ExecutionIntegrity`, `LiquidationRisk`, `MEVResistanceProof`
- Reputation and passport rails: `AgentReputationScore`, `SolvencyProof`, `RiskPassportTier`, `TraderPerformanceProof`, `HistoricalPerformanceAttestation`
- Advanced/market circuits: `CrossProtocolArbitrage`, `ImpermanentLossPredictor`, `RebalanceTimingCommitment`, `RobustnessCertificate`
- Governance/privacy extension: `private_vote`

### C. Hybrid proving stack (what makes this compelling)

- **Circom + Groth16**: primary proving path for policy, risk, execution, and privacy circuits.
- **Cairo + Garaga verification**: on-chain verification/enforcement layer on Starknet.
- **RISC Zero path**: cross-chain credit scoring model type in agent/model registry.
- **EZKL path**: zkML inference path plus bridge semantics (`ModelBridge`) into Groth16-compatible flows.
- **Onyx LLM routing**: provider orchestration layer for agent reasoning with deterministic fallback discipline.

Judge summary line:

**This is not one circuit demo. It is a full proving stack across Circom, Cairo, Groth16, RISC Zero, EZKL, and Onyx.**

---

## 3.5) Bridge Roadmap Status (Where We Are Now)

This is the direct "full roadmap" readout for judges:

- **Path A (Noir HONK):** Implemented in code and wired in proving-path routing. The remaining ops milestone is collecting stable live `noir_honk` receipts in the target environment and promoting that to a repeatable runbook.
- **Path C (L1 verifier + L1->L2 bridge):** Implemented end-to-end in code (L1 verifier lane, sender/receiver flow, and polling API). Current work is operational hardening and recurring live bridge confirmations.
- **Path B (Native Cairo KZG):** Strict lane is active (non-placeholder gating + `kzg_mpcheck_v1` trailer checks + on-chain path routing). Remaining work is broadening real MPCheck extraction coverage across all live model flows and expanding receipt evidence.

Roadmap phase framing:

- **Phase 2:** Delivered (Noir bridge stack in place).
- **Phase 3:** Implemented and now being operationalized with live bridge confirmations.
- **Phase 4:** In progress with strict semantics active; focused on coverage and production-grade reliability.

---

## 4) Agent Builder Formatting Standard (Important For Demo Credibility)

This is the canonical format story for "visual compose -> runtime execution."

### A. Circuit Board handoff draft (frontend contract)

```json
{
  "name": "My Risk Agent",
  "processors": ["risk_scoring", "correlation_risk", "twap_position"],
  "decisionLogic": "AND"
}
```

### B. Agent create API payload (backend contract)

```json
{
  "user_address": "0x...",
  "name": "My Risk Agent",
  "processors": ["risk_scoring", "correlation_risk", "twap_position"],
  "decision_logic": { "type": "AND" },
  "llm": {
    "provider": "deterministic",
    "model": "deterministic-v1",
    "temperature": 0,
    "max_tokens": 512,
    "top_p": 1
  }
}
```

### C. Agent object shape returned by API

```json
{
  "id": "abc123...",
  "owner": "0x...",
  "name": "My Risk Agent",
  "processors": ["risk_scoring", "correlation_risk", "twap_position"],
  "decision_logic": { "type": "AND" },
  "llm": { "provider": "deterministic", "model": "deterministic-v1" },
  "active": true,
  "created_at": 1741632000
}
```

### D. Standardization rules to state in the pitch

- Processor IDs are source-of-truth from `GET /api/v1/agents/models/list`.
- Decision logic currently supports `AND` / `OR`.
- UI handoff uses `decisionLogic` (camelCase); API/runtime uses `decision_logic.type` (snake_case + typed object).
- This gives a stable schema for composing agents, replaying configs, and auditing execution behavior.

---

## 5) Product Surface Today (Not A Single Demo Screen)

The current build spans multiple user surfaces:

- `/agent` (Capital OS / Mission Control)
- `/profile` (trust, identity, reputation context)
- `/trade` (opportunity-to-execution flow)
- `/products` (category-first catalog with standalone product demos)
- `/mvp` (fast path: risk -> recommend -> deploy)

The important narrative point:

**This is not just one isolated privacy primitive. It is a composable product stack: private rails + policy + intelligence + receipts.**

---

## 6) Why This Is Strong For A Privacy Track

### Privacy is operational, not cosmetic

We preserve private inputs (strategy intent, commitment material, decision context) while emitting proofs and receipts for verifiable action trails.

### Identity is protected but still useful

Reputation and passport layers let users unlock better routes and less friction without exposing raw sensitive state.

### Automation is constrained, not blind

Rebalancing and execution flows have explicit gating and policy checkpoints instead of opaque autonomous behavior.

### Practicality over theory-only architecture

The system already exposes integrated APIs and UI pathways that judges can test end-to-end in one session.

---

## 7) 3-5 Minute Live Demo Flow (Hackathon Stage)

1. Open `/agent`, connect wallet, show Identity + Agent Controls + pool cards.
2. Deposit into a selected pool using private commitment flow.
3. Show pool composition endpoint update (`/pools/{pool_id}/composition`).
4. Toggle rebalance mode (`My Agent` vs `Oracle`) and explain control semantics.
5. Open opportunities/execution simulation in Trade Desk v2.
6. Show trust context in `/profile` (reputation + risk passport) and explain "privacy with accountability."
7. End with receipt/stream proof trail.

If time is short, compress to:
- private deposit -> mode toggle -> simulated execution -> proof/receipt timeline.

---

## 8) Terminal-First Judge Demo (Backend > UI)

Use this when frontend is lagging or you want a pure engineering demo:

```bash
python3 scripts/hackathon_backend_showcase.py --base-url http://127.0.0.1:8003
```

What it validates live:

- backend health and proof pack manifest
- agent composition + execution
- proof-backed deployment plan and generated on-chain calldata
- private commitment generation rail
- vault policy control mutations
- on-chain reads + Starknet RPC contract class-hash checks

Optional hard-mode checks in the same script:

- batch skill proof runtime
- credit eligibility proof generation

These two optional checks are Poseidon-bridge sensitive and can fail even when the core demo claims all pass.

---

## 9) Road To Capital OS Finalization (Post-Hackathon)

This keeps momentum clear without weakening the MVP story.

### Near-term (next sprint)

- Tighten pool composition UX and richer valuation overlays.
- Complete intent-consistent drawer copy and state transitions across all entry points.
- Expand integration tests for pool deploy/close mode gating matrix.
- Harden error and retry behavior for commitment registration + relayer edges.

### Mid-term

- Strengthen oracle-mode governance and richer zkML attestation visibility in-stream.
- Improve per-user capital attribution semantics inside pooled buckets.
- Expand execution adapters and route explainability in Trade Desk.

### Longer-term Capital OS vision

- Unified policy compiler + automation state machine across all product surfaces.
- Stronger portable trust primitives (passport + reputation + selective disclosure).
- Deeper settlement and attestation pathways on Starknet/L3 rails.

---

## 10) Ready-To-Use Submission Copy

### 1-liner

zkde.fi is a privacy-first Capital OS on Starknet that combines private execution rails with verifiable intelligence, reputation-aware gating, and cryptographic trust trails across a 20+ circuit proving stack.

### Short paragraph (application form)

zkde.fi lets users move and manage capital privately without giving up verifiability. We use commitment/proof-based DeFi rails for deposits and withdrawals, enforce policy and rebalance controls at the account level, and expose trust context through reputation and risk-passport primitives. Under the hood, the stack combines Circom + Groth16 circuits, Cairo verification on Starknet, and hybrid RISC Zero/EZKL paths for advanced scoring. The result is a full-stack system where identity and strategy intent stay protected, but risk checks, execution decisions, and receipts remain auditable.

### Privacy-track framing

Most ZK apps focus only on concealment. Our approach treats privacy as programmable infrastructure: users keep cryptographic protection over identity and intent, while the protocol can still prove safety, enforce policy, and build trust over time.

---

## 11) Tone Guidance For Pitches

- Lead with outcomes ("private capital, verifiable controls"), then mention primitives.
- Avoid "future-only" claims. Separate live capabilities from roadmap clearly.
- Emphasize that privacy and trust are not competing goals in this system.
- Keep language concrete: endpoints, flows, receipts, gating, and user control.

---

## 12) Sanity Checks To Confirm Before Final Submission

- Confirm whether you want to market the circuit count as "26 documented" (archive milestone framing) or "31 currently in-repo" (latest snapshot framing).
- Confirm whether you want "Onyx" positioned as active runtime branding in this submission, or as part of broader Obsqra infrastructure narrative.
- Confirm if you want Agent Builder schema shown exactly as above in the public submission, or trimmed to a one-line summary for non-technical judges.
