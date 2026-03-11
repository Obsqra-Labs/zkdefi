# Product & MVP

**Last updated:** 2026-03-10  
Circuit count and API list reflect repo state as of this date.

---

## 1. Thesis

zkde.fi inverts the usual ZK story: we protect identity and intent while still proving enough to coordinate capital safely. Privacy is operational, not cosmetic — private inputs (strategy intent, commitment material, decision context) stay hidden while proofs and receipts provide a verifiable action trail. The result is **cryptographically protected identity + verifiable trust rails**.

---

## 2. Product surfaces

- **Private Vault** — Shielded deposits, withdrawals, and policy-gated capital with configurable privacy tiers and pool buckets.
- **Privacy Pools** — Tiered commitment/nullifier pools for capital entry and exit; pool selector and intent (deposit/withdraw from bucket vs vault-level).
- **Dark Ledger** — Private internal settlement with no public transfer trail; double-entry accounts (e.g. `POOL:{pool_id}:idle:{token}`, `POOL:{pool_id}:deployed:{adapter}:{token}`).
- **Private Swaps** — Swap execution with private intent and slippage constraints.
- **Private Lending** — Supply and borrow with proof-backed eligibility and liquidation safety.
- **Private LP + Yield** — LP and yield allocation with privacy tiers, anomaly checks, and exposure controls.
- **Private Staking** — Staking and delegation integrated with vault privacy and proof-aware execution.
- **Risk Passport** — Portable trust and risk attestations; profile, passport, and receipt rails (Credit & Reputation Hub, FICO pack proofs).
- **Private Governance** — Private proposal and voting workflows with ZK verification (DAO).
- **Adapters** — Composable strategy adapters for protocol-specific private deployment paths.

---

## 3. Execution and intelligence

- **Capital OS / Mission Control** (`/agent`) — Identity, agent controls, pool cards, rebalance mode (user vs oracle), unified stream. Rebalance mode is account-level: **My Agent** (`user`) = only wallet owner deploys/closes pool capital; **Oracle** (`oracle`) = operator can trigger rebalances gated by zkML via policy engine.
- **Trade Desk** — Opportunities discovery, simulate/prepare/submit execution; execution adapters.
- **Rebalancer** — Propose → zkML gate check → execute; autonomous loop; session keys for delegation.
- **Proof trail** — Stream (`mc/stream/{address}`), receipts, WebSocket `/ws/{user_address}` for real-time updates.

---

## 4. Frontend routes

| Route | Purpose |
|-------|---------|
| `/agent` | Capital OS / Mission Control: dashboard, execution, pool cards, rebalance mode, stream. |
| `/products` | Category-first catalog: vault, pools, ledger, swaps, lending, LP, staking, risk passport, governance, adapters. |
| `/trade` | Opportunity-to-execution flow (Trade Desk). |
| `/profile` | Credit & Reputation Hub; trust and identity context. |
| `/governance` | DAO proposals and voting. |
| `/vault` | Vault-focused surface (deposit, withdraw, strategy). |
| `/mvp` | Fast path: risk → recommend → deploy. |

---

## 5. Proof stack

| Path | Role |
|------|------|
| **Circom + Groth16 (Garaga)** | Primary proving path for policy, risk, execution, and privacy circuits; on-chain verification via Garaga BN254. Used for reputation proofs, full-privacy withdrawals, zkML risk/anomaly, ModelBridge EZKL bridge. |
| **Cairo + Garaga verification** | On-chain verification/enforcement on Starknet (ObsqraFactRegistry, verifier contracts). |
| **RISC Zero** | Cross-chain credit scoring model type in agent/model registry. |
| **EZKL (zkML + ModelBridge)** | zkML inference path; ModelBridge circuit bridges EZKL output into Groth16-compatible flow (~34M gas). Off-chain EZKL verify, then commit model output + proof hash in Groth16. |
| **STARK (Integrity/Stone)** | Execution and reputation passport proofs; L3/Madara settlement path when enabled. |

Proof-gated: no proof, no execution. Session keys allow delegation; rebalancer and agent tooling support autonomous flows.

---

## 6. Circuit inventory

Source of truth: `backend/app/services/zkml/circuit_scanner.py` — `CIRCUIT_REGISTRY`. The scanner documents **25 circuits** (Groth16 via snarkjs). Categories:

- **ML / scoring:** RiskScore, AnomalyDetector, CorrelationRisk, TWAPPosition, SafetyDiversification.
- **Merkle / privacy:** BalanceAboveThreshold, PoolMembership, TenureAboveThreshold.
- **Agent / identity:** ImpermanentLossPredictor, YieldOptimality, SlippageBound, AgentReputationScore, CrossProtocolArbitrage, LiquidationRisk, HistoricalPerformanceAttestation, MEVResistanceProof.
- **EZKL / safety:** ModelBridge, ModelBridgeHeavy, RebalanceTimingCommitment, RobustnessCertificate.
- **Reputation:** SolvencyProof, RiskPassportTier, TraderPerformanceProof, StrategyIntegrity, ExecutionIntegrity.
- **Governance:** private_vote.

Full-privacy deposit/withdraw circuits (e.g. PrivateDeposit, PrivateWithdraw, FullPrivacyWithdraw*) live under `circuits/` and are used by the full-privacy API; the scanner registry focuses on zkML/reputation/agent circuits. Total first-party Circom circuits under `circuits/` is larger (see repo); the **25** above are those in `CIRCUIT_REGISTRY` for parallel proof generation.

---

## 7. Agent Builder

- **Processor IDs:** Source of truth is `GET /api/v1/agents/models/list` (returns model list for palette/canvas).
- **Decision logic:** AND / OR over selected processors.
- **Payload shape:** Agent create accepts `user_address`, `name`, `processors` (list of model IDs), `decision_logic` (e.g. `{ "type": "AND" }`), `llm` (provider, model, temperature, max_tokens, etc.). UI handoff uses camelCase (`decisionLogic`); API uses snake_case (`decision_logic`).
- **Reference:** [HACKATHON_BUILD_NARRATIVE.md](HACKATHON_BUILD_NARRATIVE.md) §4 for judge-facing schema; backend agent create route and `backend/app/api/routes/agents.py` for request schemas.

---

## 8. Key APIs

Base prefix for zkdefi: `/api/v1/zkdefi`. Request/response schemas: see OpenAPI at `http://localhost:8003/docs` (or `https://zkde.fi/api/docs` in production).

| Domain | Endpoints (representative) |
|--------|----------------------------|
| **Full privacy** | `POST .../full_privacy/deposit/generate_commitment`, `.../full_privacy/deposit/register_commitment`, `.../full_privacy/withdraw/generate_proof`, `.../full_privacy/withdraw/generate_proof_with_change`; `POST .../relayer/request`. |
| **Pools** | `GET .../pools/{pool_id}/composition`; `POST .../pools/{pool_id}/deploy`, `.../pools/{pool_id}/close`. |
| **Rebalance mode** | `GET .../mc/rebalance-mode/{address}`; `PUT .../mc/rebalance-mode/{address}` (body: `rebalance_mode`: `user` \| `oracle`). |
| **Reputation** | `GET .../reputation/tiers`, `.../reputation/user/{address}`; `POST .../reputation/proof/credit-eligibility`, `.../reputation/proof/solvency`, `.../reputation/proof/risk-passport`, `.../reputation/proof/performance`, `.../reputation/proof/strategy-integrity`, `.../reputation/proof/execution-integrity`; `GET .../reputation/proofs/{address}`. |
| **Risk passport** | `GET .../risk_passport/user/{address}`, `.../risk_passport/pool/{pool_id}`. |
| **Trade desk v2** | `GET .../trade-desk/v2/opportunities`; `POST .../trade-desk/v2/execute/simulate`, `.../execute/prepare`, `.../execute/submit`. |
| **Rebalancer** | `.../rebalancer/*` (propose, check, execute); `.../rebalancer/autonomous/*` (start, status). |
| **Session keys** | `.../session_keys/*` (grant, revoke, list). |
| **Stream & receipts** | `GET .../mc/stream/{address}`; `.../receipts/*`. |
| **WebSocket** | `WS /ws/{user_address}` (backend). |

Other prefixes: `/api/v1/agents` (agents, marketplace), `/api/v1/strategies`, `/api/v1/vault`, `/api/v1/deployments`, `/api/v1/dao`, `/api/v1/identity`, `/api/v2/vault`, etc. See [API_OVERVIEW.md](API_OVERVIEW.md) and OpenAPI for full list.
