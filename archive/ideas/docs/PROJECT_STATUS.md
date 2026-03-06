# zkde.fi — Complete Project Status

**By Obsqra Labs · Live:** [zkde.fi](https://zkde.fi)

---

## 1. Overview

**zkde.fi** is an open-source privacy-first DeFi agent on **Starknet (Sepolia)**:

- **Full Privacy Pool** — Note-unlinkable deposit/withdraw (Merkle + Garaga SNARK); root synced on-chain.
- **MVP yield flow** — Risk profile → recommendation → deploy (or sign on Dashboard); optional AI rebalancing.
- **Agent & session keys** — Delegated execution with constraints; rebalancer (propose → zkML check → execute); autonomous mode.
- **Hybrid proofs** — Garaga (Groth16/SNARK) for privacy/zkML; Integrity (STARK) for execution. Proof-gated: no proof, no execution.

---

## 2. Front-to-back architecture

### Flow

```
User → Wallet → Frontend (:3001) → Backend (:8003) → Proofs (Garaga / obsqra.fi) → Starknet Sepolia
                                                      ├─ Full privacy: merkle + withdraw proof
                                                      ├─ zkML: risk_score, anomaly, combined
                                                      ├─ Rebalancer: propose → check → execute
                                                      └─ Strategies: recommend; vault/execute (where mounted)
```

### Frontend (Next.js, :3001)

| Route | Purpose |
|-------|--------|
| `/` | Landing: privacy tiers, value prop. |
| `/agent` | **Primary product surface**. Dashboard: ProtocolPanel, pools (Shielded A, Full Privacy B/C, HashedWithdraw D), ActivityLog, CompliancePanel, PositionChart, SessionKeyManager, AgentRebalancer, OnboardingWizard, DexPanel, ModelComposer, MyAgents. |
| `/mvp` | **Experimental automation lane**. Connect → RiskProfileForm (Conservative/Balanced/Aggressive) → recommendation → deploy; success: positions/tx links + "When does AI redeploy?" + link back to `/agent`. |
| `/profile` | Reputation, collateral, relayer, onboarding, Risk Passport, linked addresses, compliance; tabs: overview, collateral, relayer, agents, compliance. |
| `/marketplace` | Model marketplace. |
| `/phase4a` | Phase 4a orchestration. |
| `/privacy`, `/terms` | Policy pages. |

**Root layout:** StarknetProvider → AppProvider. Profile: Suspense for useSearchParams.

### Backend (FastAPI, :8003)

**Canonical entrypoint:** `zkdefi/backend/app/main.py` (FastAPI `app.main:app`).

**Mounted route families:** zkdefi_agent, zkml, session_keys, rebalancer, oracle, reputation, relayer, full_privacy, identity, onboarding, risk_passport, linked_addresses, dex, agents, strategies, deployments, vault_execute (plus optional vault_execute_live and phase4a).

**Key APIs:** full_privacy (deposit generate/register, withdraw generate_proof), zkML (risk_score, anomaly, combined), session_keys (grant, revoke, list), rebalancer (propose, check, prepare, execute; autonomous/start, status), strategies/recommend + strategies/execute-advanced (shared `/agent` and `/mvp` execution path), relayer (Tier 2/3 request/calldata/execute), reputation, oracle, onboarding.

**Compatibility alias:** `/api/v2/strategies/*` is still exposed for older `/mvp` clients.

**Key env:** STARKNET_RPC_URL, FULL_PRIVACY_MERKLE_TREE_ADDRESS, FULL_PRIVACY_MERKLE_TREE_ADMIN_*, FULL_PRIVACY_POOL_V2_ADDRESS.

### Contracts (Sepolia)

ProofGatedYieldAgent, SelectiveDisclosure, ConfidentialTransfer, GaragaVerifier, FullyShieldedPool + Merkle tree, SessionKeyManager, IntentCommitment, ConstraintReceipt, ComplianceProfile, ZkmlVerifier, AgentIdentity, ReputationRegistry, ValidationProofRegistry, ModelRegistry, AgentComposer, Integrity Fact Registry. See [CONTRACTS.md](CONTRACTS.md).

---

## 3. Specs (summary)

### Privacy tiers

| Tier | What is hidden | Status |
|------|----------------|--------|
| 1 | Deposit↔withdraw link only | **Live** (Pool B/C). |
| 2 | + Recipient/amount on withdraw (relayer) | **Implemented** (API + contract). |
| 3 | + Depositor on deposit (relayer) | **Implemented** (API + calldata). |
| 4 | + Association set (compliance) | **Scoped** (circuit + contract + API). |

### Pool labels

- **A (Shielded):** ShieldedPoolPanel, PrivateDeposit/PrivateWithdraw.
- **B (Full Privacy):** FullPrivacyPoolPanel, `/full_privacy/*`, FullyShieldedPool + Merkle tree, FullPrivacyWithdraw circuit.
- **C (Tornado-style):** Same as B; panel variant="pool_c".
- **D (Hashed Withdraw):** HashedWithdrawPoolPanel (stub); relayer/ledger backend.

### Proof flows

- **Full Privacy:** generate_commitment → user deposits → register_commitment (tree + root sync) → withdraw: generate_proof (root ensured on-chain) → user submits withdraw with Garaga calldata.
- **zkML / rebalancer:** propose → check_zkml_gates (risk + anomaly) → prepare → execute (session key).

---

## 4. Functionality (what each area does)

| Area | What it does |
|------|----------------|
| Full Privacy | Deposit: generate commitment → user signs pool.deposit → register_commitment. Withdraw: generate_proof → user signs pool.withdraw with Garaga calldata. |
| Strategies | recommend: risk_profile + amount → allocation (pools, APY, reasoning). analyze: zkML pool analysis. |
| Deploy / vault execute | Execute strategy (deployments/execute or vault_execute when mounted). |
| zkML | risk_score, anomaly, combined; pool-safety; receipts. |
| Session keys | Grant/revoke/list; used for rebalancer and autonomous agent. |
| Rebalancer | Analyze → propose → check → prepare → execute; autonomous/start (session_id, interval, risk_threshold). |
| Relayer | Tier 2 withdraw request/calldata/execute; Tier 3 deposit request/calldata/execute. |
| Reputation | Tiers, user stats, stake-collateral, upgrade-tier. |
| Oracle | market-data, recommendation, pool-apys. |
| Onboarding | Authorization, submit_agent, status, identity/credit proof. |
| Risk Passport | User: composite score, letter, tier, proof_receipts. Pool: safe, health_score, proof_receipts. |

---

## 5. What's done (working state)

- **Full Privacy (Pool B) deposit and withdraw** — End-to-end with root sync; critical path in [WORKING_STATE_DEPOSIT_WITHDRAW.md](WORKING_STATE_DEPOSIT_WITHDRAW.md).
- **Frontend:** Landing, Agent dashboard (primary), MVP page (experimental risk → recommend → deploy), Profile (reputation, collateral, relayer, passport), Marketplace, phase4a, privacy/terms. Root layout (AppProvider + StarknetProvider); profile Suspense.
- **Backend (`app.main`) unified:** `/agent`, `/mvp`, and `/profile` consume one mounted API surface. full_privacy route mounts successfully (with `merkle_tree_onchain_sync` present), and relayer routes include queue stats + ledger views.
- **Strategies, deployments, vault execute:** Mounted under canonical prefixes; `/api/v1/strategies/execute-advanced` maps MVP payloads into vault execution, with `/api/v2/strategies/execute-advanced` kept as alias.
- **Relayer:** Tier 2 and Tier 3 API implemented.
- **Risk Passport:** User and pool endpoints and response shapes.
- **zkML + rebalancer:** risk_score, anomaly, combined; agent_rebalancer (propose → check → prepare → execute; autonomous start/stop/status). Execute can be simulated or wired to contract.
- **Contracts:** Deployed on Sepolia (see CONTRACTS.md).
- **Privacy → Ekubo orchestration (personal v1):** Implemented per [plans/2026-02-19-privacy-ekubo-orchestration-design.md](plans/2026-02-19-privacy-ekubo-orchestration-design.md) and [plans/2026-02-19-privacy-ekubo-orchestration-implementation.md](plans/2026-02-19-privacy-ekubo-orchestration-implementation.md): deployable amount → recommend (Ekubo-only) → vault execute → receipt; API `POST /api/v1/zkdefi/orchestration/deploy`.
- **Frontend runtime sync guard:** `deploy_production.sh` now enforces build/runtime integrity (clean `.next`, restart `zkdefi-frontend`, verify local+live `/agent` chunk URLs resolve, and ensure live agent chunk matches built chunk) to prevent `ChunkLoadError` drift.

---

## 6. What's scoped (not done or partial)

- **Optional routers:** `phase4a` and `vault_execute_live` remain deployment-dependent (skipped when optional service dependencies are absent).
- **Pool A:** Can hard-fail on Garaga WASM; full robustness scoped.
- **Pool D:** Frontend stub; full relayer/ledger flow and UI scoped.
- **Tier 4 (Association set):** Circuit + verifier + contract + backend API scoped.
- **Execution path:** Rebalancer/vault execute real on-chain execution depends on deployment (contract executor, env); full wiring scoped.
- **zkML improvements:** Snapshot_hash binding, predictive (breach, drawdown, stress), yield-focused (APY, drift), execution proof in pipeline, receipts with model hash — see [ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md](ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md).
- **Risk Passport UI:** Full proof timeline and checklist everywhere scoped.
- **CLI wallet e2e:** Full deposit/withdraw (Pool B/C) with sncast/starkli not in automated tests; doc/script scoped.

---

## 7. Doc index

| Doc | Content |
|-----|--------|
| [README.md](../README.md) | Overview, quick start, API, doc index. |
| [ENV.md](ENV.md) | Backend/frontend env (including EKUBO_CHAIN_ID). |
| [plans/2026-02-19-privacy-ekubo-orchestration-design.md](plans/2026-02-19-privacy-ekubo-orchestration-design.md) | Privacy → Ekubo orchestration (personal v1; Ekubo Sepolia realistic methods; shared Phase 2). |
| [plans/2026-02-19-privacy-ekubo-orchestration-implementation.md](plans/2026-02-19-privacy-ekubo-orchestration-implementation.md) | Implementation plan (tasks 1–6) for orchestration. |
| [plans/2026-02-19-agent-deploy-to-ekubo-ux.md](plans/2026-02-19-agent-deploy-to-ekubo-ux.md) | Agent / Deploy to Ekubo holistic UX plan and implementation. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Proof system, components, agent flow. |
| [WORKING_STATE_DEPOSIT_WITHDRAW.md](WORKING_STATE_DEPOSIT_WITHDRAW.md) | Full Privacy critical path and env. |
| [PRIVACY_TIERS.md](PRIVACY_TIERS.md) | Tiers 1–4; relayer Tier 2/3. |
| [POOL_TYPES_AND_ROADMAP.md](POOL_TYPES_AND_ROADMAP.md) | Pools A/B/C; roadmap. |
| [PROOF_FLOWS.md](PROOF_FLOWS.md) | Private transfer, shielded, B/C, zkML. |
| [CONTRACTS.md](CONTRACTS.md) | Sepolia addresses and functions. |
| [SETUP.md](SETUP.md) | Prerequisites, deploy, env. |
| [../deploy_production.sh](../deploy_production.sh) | Production frontend deploy with post-restart local/live chunk integrity checks. |
| [AGENT_FLOW.md](AGENT_FLOW.md) | Session keys, delegation UX. |
| [DEV_LOG.md](DEV_LOG.md) | Fixes and findings. |
| [RISK_PASSPORT_IMPLEMENTATION.md](RISK_PASSPORT_IMPLEMENTATION.md) | Risk Passport API. |
| [ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md](ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md) | zkML improvements (scoped). |
