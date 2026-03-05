# zkde.fi — Verifiable AI Agent Architecture

> **Protocol**: zkde.fi — the first application built on Obsqra's verifiable AI infrastructure
> **Parent**: Obsqra Labs (obsqra.fi) — infrastructure for verifiable AI agents
> **Chain**: Starknet (Sepolia testnet)
> **Date**: March 2026
> **Stack**: Circom 2.1.6 · snarkjs · EZKL · Garaga BN254 · Cairo 2 · FastAPI · Next.js 14 · OpenAI GPT-4o-mini

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Layer Architecture](#2-layer-architecture)
3. [AI Agent System](#3-ai-agent-system)
4. [zkML Circuit Suite](#4-zkml-circuit-suite)
5. [LLM Decision Engine](#5-llm-decision-engine)
6. [Groth16 Proof Pipeline](#6-groth16-proof-pipeline)
7. [On-Chain Smart Contracts (Cairo)](#7-on-chain-smart-contracts-cairo)
8. [Receipts and Attestation System](#8-receipts-and-attestation-system)
9. [Agent Skill Service — Bridge Between LLM and ZK](#9-agent-skill-service--bridge-between-llm-and-zk)
10. [Poseidon Hashing Bridge](#10-poseidon-hashing-bridge)
11. [Frontend Surfaces](#11-frontend-surfaces)
12. [Threat Model](#12-threat-model)
13. [Linkability Threat Model and Privacy Mitigations](#13-linkability-threat-model-and-privacy-mitigations)
14. [Security Model](#14-security-model)
15. [Ceremony and Key Management](#15-ceremony-and-key-management)
16. [Model and Circuit Versioning](#16-model-and-circuit-versioning)
17. [Event Schema and Indexing](#17-event-schema-and-indexing)
18. [Circuit Inventory Reference](#18-circuit-inventory-reference)
19. [Contract Inventory Reference](#19-contract-inventory-reference)

---

## 1. System Overview

zkde.fi is the first application built on Obsqra's **verifiable AI agent infrastructure** — a framework for building AI agents whose decisions are backed by cryptographic proofs of the computations that produced them.

The architecture introduces a new primitive: **computation oracles**. Where data oracles (Chainlink, Pyth) prove *what happened on-chain*, computation oracles prove *what the data means*. An AI agent analyzes pool metrics, produces a risk classification, and generates a ZK proof that the classification was computed correctly. Smart contracts verify that proof before allowing capital to move.

```
           AI AGENT LAYER
         (LLM orchestration)
                │
                ▼
        PROVABLE SKILL MODULES
         (EZKL + Circom circuits)
                │
                ▼
        PROOF REGISTRY
       (ERC-8004 verifiability middleware)
                │
                ▼
        SMART CONTRACTS
     (verify before action)
```

The core thesis: **Every execution is provably constrained by policy and risk bounds. Every constraint check produces a verifiable ZK proof. Every proof is verified on-chain. Every verification yields a tamper-evident receipt.**

> **Important distinction**: The system proves that *executions satisfy constraints* (risk bounds, slippage limits, allocation caps). It does not prove that *LLM reasoning is correct* — LLM decisions are advisory off-chain recommendations; ZK circuits enforce that those recommendations fall within user-authorized policy. The `llm_provider_hash` on-chain provides *auditability* of which model was used, not a proof of inference. This is the correct trust boundary: LLM reasoning is advisory; ML inference is proven.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            zkde.fi SYSTEM                                   │
│                                                                             │
│   ┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌────────────────┐   │
│   │   LLM    │───▶│  Agent   │───▶│  ZK Circuit  │───▶│   On-Chain     │   │
│   │ Decision │    │  Skills  │    │  Proof Gen   │    │   Verifier     │   │
│   │ Engine   │    │  Bridge  │    │  (Groth16)   │    │   (Garaga)     │   │
│   └──────────┘    └──────────┘    └──────────────┘    └────────────────┘   │
│         │                                                      │           │
│         │              ┌──────────────┐                        │           │
│         └─────────────▶│   Receipt    │◀───────────────────────┘           │
│                        │   Service    │                                    │
│                        └──────────────┘                                    │
│                              │                                             │
│                        ┌──────────────┐                                    │
│                        │  Frontend    │                                    │
│                        │  Timeline    │                                    │
│                        └──────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Properties**:
- **22 Circom circuits** producing real Groth16 proofs (BN254 curve)
- **34 Cairo smart contracts** (7 critical core + 27 supporting) deployed to Starknet Sepolia
- **LLM reasoning** via GPT-4o-mini with deterministic fallback
- **Identity-bound agents** minted as SRC-721 NFTs
- **Dual-source receipt reconciliation** (backend + on-chain) with cryptographic anchoring
- All proofs verified on-chain via Garaga's `verify_groth16_proof_bn254`

---

## 2. Layer Architecture

The system operates across five distinct layers:

### Layer 0: Cryptographic Primitives
- **Poseidon hash** (circomlibjs BN254) for commitments, nullifiers, identity binding
- **Merkle trees** (20-level, Poseidon-based) for pool membership and balance proofs
- **Groth16** proving system on BN254 elliptic curve
- **Garaga** pairing library for on-chain BN254 verification on Starknet

### Layer 1: Circuit Layer (Circom)
- 22 parameterized circuits compiled to R1CS + WASM
- Trusted setup via powers-of-tau (`pot14_final.ptau`)
- Circuit categories: Privacy (deposits/withdrawals), ML/Scoring (risk/anomaly), Agent Skills (IL/yield/slippage/arbitrage/liquidation), Selective Disclosure (balance/pool/tenure)

### Layer 2: Proof Generation Layer (Backend Python + Node.js)
- `circuit_scanner.py` — unified parallel proof runner for all 16 scanner circuits
- `groth16_prover.py` — deposit/withdraw proof generator
- `garaga_formatter.py` — converts snarkjs proofs → Garaga calldata format
- `poseidon_bridge.js` — Node subprocess for BN254 Poseidon matching circuit hashes
- `circomlib_poseidon.py` — Python wrapper for the Node bridge

### Layer 3: Intelligence Layer (LLM + Agent)
- `llm_engine.py` — GPT-4o-mini allocation recommendations
- `llm_provider_registry.py` — multi-provider routing with fallback
- `llm_narration.py` — contextual natural-language explanations
- `agent_orchestrator.py` — the brain: LLM reasoning → skill execution → synthesis
- `agent_skill_service.py` — maps ZK circuits to LLM-callable tools
- `agent_store.py` — SQLite persistence for agents, bindings, performance

### Layer 4: On-Chain Layer (Cairo 2 / Starknet)
- `vault_controller.cairo` — policy-gated proposal/execute with circuit breaker
- `zkml_verifier.cairo` — Garaga-backed proof verification and storage
- `confidential_transfer.cairo` — shielded deposit/withdraw with Groth16 gates
- `agent_identity.cairo` — SRC-721 NFT agent identity registry
- `constraint_receipt.cairo` — on-chain attestation of constraint checks
- 27 additional contracts (adapters, pools, registries, utils)

### Layer 5: Presentation Layer (Next.js 14)
- `ReceiptTimeline` — reconciled proof/receipt viewer
- `AgentDashboard` — agent management and performance
- `ZKGatePipeline` — real-time constraint gate visualization
- `BrainSurfaceContainer` — LLM reasoning + proof pipeline UI

---

## 3. AI Agent System

### 3.1. Identity Model

Every agent is an **identity-bound entity** represented by:

| Component | Source | Purpose |
|-----------|--------|---------|
| Agent ID | Generated | Unique identifier (UUID) |
| Owner Address | Starknet wallet | Who controls the agent |
| Identity Commitment | Poseidon hash | Cryptographic identity binding |
| SRC-721 NFT | `agent_identity.cairo` | On-chain discoverable identity |
| Reputation Tier | 0=Strict, 1=Standard, 2=Express | Execution privilege level |
| Bound Skills | Circuit list | Which ZK proofs agent can generate |
| LLM Provider | Provider registry | Which model makes decisions |

### 3.2. Agent Lifecycle

```
Registration                 Execution                      Attestation
────────────                 ─────────                      ───────────
  Owner calls               Agent receives                Proof receipts
  register_agent() ──▶      execute_goal() ──▶            stored + reconciled
       │                         │                              │
       ├─ Persist to SQLite      ├─ LLM Reasoning              ├─ Backend JSON
       ├─ Bind LLM provider      ├─ Skill Execution (ZK)       ├─ On-chain events
       ├─ Mint SRC-721 NFT       ├─ LLM Synthesis              └─ Frontend timeline
       └─ Return config_hash     └─ Emit receipt
```

### 3.3. Agent Orchestrator — The Core Loop

File: `backend/app/services/agent_orchestrator.py`

The `AgentOrchestrator` is the central brain. For each goal, it executes a three-phase pipeline:

**Phase 1 — LLM Reasoning**: The agent's bound LLM provider receives the goal, the agent's context, and a list of available skills (formatted as OpenAI function-calling tools). The LLM decides which skills to invoke and with what parameters.

**Phase 2 — Skill Execution**: Each skill call maps to a specific Circom circuit. The `agent_skill_service` builds the circuit inputs from the LLM's parameters, then `circuit_scanner` generates a real Groth16 proof via snarkjs. Multiple skills can execute in parallel via `asyncio`.

**Phase 3 — LLM Synthesis**: Proof results (pass/fail, proof hashes, compliance flags) are fed back to the LLM. It produces a final decision incorporating the verified results — e.g., "Rebalance 60% to Ekubo ETH/USDC, 40% to Vesu USDC lending. Risk proof passed. Slippage within bounds."

```python
@dataclass
class OrchestrationResult:
    agent_id: str
    goal: str
    steps: list[OrchestrationStep]       # Each step is reasoning, skill, or synthesis
    final_decision: dict[str, Any]
    all_proofs_pass: bool                 # True only if every ZK proof passed
    llm_tokens_used: int
    llm_provider_used: str               # "openai_gpt" or "deterministic" (fallback)
    llm_fallback_reason: str | None      # Why fallback triggered (if applicable)
```

### 3.4. Agent Persistence (`agent_store.py`)

SQLite-backed storage with three tables:

| Table | Fields | Purpose |
|-------|--------|---------|
| `agents` | agent_id, owner_address, name, identity_commitment, reputation_tier, bound_skills (JSON), llm_provider_id, llm_model, active, created_at, updated_at | Agent configuration |
| `llm_bindings` | agent_id, provider_id, config_hash, bound_at | Which LLM provider is bound to each agent |
| `performance` | agent_id, period, total_executions, successful_proofs, failed_proofs, total_tokens, avg_latency_ms, sharpe_ratio, apy_bps, max_drawdown_bps | Historical performance metrics |

---

## 4. zkML Circuit Suite

### 4.1. Architecture

All circuits are written in **Circom 2.1.6** and compiled to:
- R1CS (rank-1 constraint system) for proof generation
- WASM (via `generate_witness.js`) for browser/server witness computation
- Verification keys exported for on-chain verification

The circuits use **circomlib** components:
- `poseidon.circom` — BN254 Poseidon hash for commitments
- `comparators.circom` — `LessThan`, `GreaterEqThan`, `LessEqThan` for range proofs
- `bitify.circom` — `Num2Bits` for bit decomposition
- `mux1.circom` — `MultiMux1` for Merkle path selection

### 4.2. Circuit Categories

#### Privacy Circuits (6 circuits)

| Circuit | Purpose | Private Inputs | Public Output |
|---------|---------|----------------|---------------|
| `PrivateDeposit` | Shielded deposit | amount, nonce, balance | commitment, amount_public |
| `PrivateWithdraw` | Shielded withdrawal | amount, nonce, balance, user_secret | commitment, amount_public, nullifier |
| `FullPrivacyWithdraw` | Merkle-tree pool withdraw | secret, amount, path[], indices[] | root, nullifier, recipient, amount |
| `FullPrivacyWithdrawHashed` | Withdraw with claim hash | + claimSalt, recipient | + claimHash |
| `FullPrivacyWithdrawWithChange` | Partial withdraw with change | + changeNonce, changeBlinding | + changeCommitment |
| `CreditEligibility` | Credit score range proof | credit_score, collateral, blinding | eligible (boolean) |

**Core privacy property**: A user can deposit into, withdraw from, and prove membership in a shielded pool without revealing their balance, identity, or position size. Only the validity of the computation is made public.

#### ML/Scoring Circuits (5 circuits)

| Circuit | Purpose | Model |
|---------|---------|-------|
| `RiskScore` | Portfolio risk below threshold | Weighted sum: `risk = Σ(feature_i × weight_i) / scale` |
| `AnomalyDetector` | Pool safety across 6 factors | Multi-factor scorer: TVL stability, liquidity concentration, price impact, deployer reputation, volume pattern |
| `CorrelationRisk` | Portfolio correlation below limit | Weighted correlation: `corr = ΣΣ(pos_i × pos_j × corr_matrix[i][j]) / total²` |
| `TWAPPosition` | 7-day TWAP below threshold | Time-weighted average: `twap = Σ(daily_positions) / N_DAYS` |
| `SafetyDiversification` | Diversified across safe protocols | Herfindahl-adjusted safety: `score = Σ(alloc_i × safety_i) / total` |

**These are "zkML" circuits** — they encode machine learning model logic (weighted sums, scoring functions) directly in arithmetic constraints so that the model evaluation is provable without revealing the inputs.

#### Agent Skill Circuits (8 circuits)

| Circuit | Purpose | Key Computation |
|---------|---------|-----------------|
| `ImpermanentLossPredictor` | IL within tolerance | `il_bps = 2×sqrt(price_ratio)/(1+price_ratio) - 1` |
| `YieldOptimality` | Near-optimal allocation | `gap = (max_yield - portfolio_yield) / max_yield` |
| `SlippageBound` | Trade slippage within limit | `slippage = trade_amount × impact_coeff / liquidity` |
| `AgentReputationScore` | Agent meets min reputation | 7-metric weighted score with positive/negative weights |
| `CrossProtocolArbitrage` | Arbitrage profitable after fees | `profit = (dest_price - source_price) × amount - fees - gas` |
| `LiquidationRisk` | All positions healthy | `health_factor_i = collateral_i × threshold_i / debt_i` per position |
| `HistoricalPerformanceAttestation` | Performance meets criteria | Mean return and max drawdown over N periods |
| `MEVResistanceProof` | Transaction MEV-protected | Block delay and price deviation within bounds |

#### Selective Disclosure Circuits (3 circuits)

| Circuit | Purpose | Revealed |
|---------|---------|----------|
| `BalanceAboveThreshold` | Balance > X without revealing exact amount | Only "above threshold" flag |
| `PoolMembership` | "I'm in pool X" without revealing which position | Only pool type |
| `TenureAboveThreshold` | "Position > N blocks old" without revealing creation time | Only tenure flag |

### 4.3. Circuit Compilation Pipeline

```
                                Circom 2.1.6
                                ─────────────
  .circom source ──▶ circom --r1cs --wasm --sym -o build/
                          │                │
                          ▼                ▼
                    .r1cs file      .wasm + generate_witness.js
                          │
              snarkjs groth16 setup (pot14_final.ptau)
                          │
                          ▼
                    .zkey (proving key)
                          │
              snarkjs zkey export verificationkey
                          │
                          ▼
                verification_key.json
```

Each circuit produces 4 artifacts in `circuits/build/`:
1. `{Circuit}_js/{Circuit}.wasm` — witness generator
2. `{Circuit}_js/generate_witness.js` — Node.js witness driver
3. `{Circuit}_final.zkey` — proving key (from Groth16 setup ceremony)
4. `{Circuit}_verification_key.json` — for on-chain verification reference

---

## 5. LLM Decision Engine

### 5.1. Provider Architecture

The system supports multiple LLM backends via `llm_provider_registry.py`:

```
┌─────────────────────────────────────────────────────┐
│                  LLMProviderRegistry                 │
│                                                     │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────┐ │
│  │  openai_gpt     │  │  clawbot     │  │ determ │ │
│  │  GPT-4o-mini    │  │  DeFi model  │  │ always │ │
│  │  OpenAI API     │  │  Custom      │  │ avail  │ │
│  └─────────────────┘  └──────────────┘  └────────┘ │
│                                                     │
│  Agent Bindings: Map<agent_id, provider_id>         │
│  Usage Stats:    Map<provider_id, ProviderUsageStats>│
│  Fallback:       Always routes to "deterministic"   │
└─────────────────────────────────────────────────────┘
```

| Provider | Model | API | Use Case |
|----------|-------|-----|----------|
| `openai_gpt` | GPT-4o-mini (default) | OpenAI-compatible | Production allocation + reasoning |
| `clawbot` | Custom DeFi model | Custom adapter | DeFi-specialized reasoning |
| `deterministic` | Rule-based | None (always available) | Guaranteed fallback |

### 5.2. Decision Flow

```
User Goal: "Optimize my portfolio yield with max 30% risk"
         │
         ▼
   ┌───────────────────────────────────────┐
   │        LLM Engine (GPT-4o-mini)       │
   │                                       │
   │  System Prompt:                       │
   │  "You are an expert DeFi portfolio    │
   │   manager. Given risk profile and     │
   │   available pools, recommend how to   │
   │   allocate capital."                  │
   │                                       │
   │  Available Tools (from skill_service):│
   │  - il_predictor                       │
   │  - yield_optimality                   │
   │  - risk_score                         │
   │  - slippage_bound                     │
   │  - ...                                │
   │                                       │
   │  Output: JSON allocation + reasoning  │
   └───────────────────────────────────────┘
         │
         ▼
   Each tool call triggers a ZK proof...
```

### 5.3. LLM Narration Service

`llm_narration.py` generates human-readable explanations for six context types:

| Context | Purpose | Example Output |
|---------|---------|----------------|
| `gate_evaluation` | Explain what constraint gate is checking | "Checking portfolio correlation risk against your Balanced constraint set — this takes ~10s." |
| `strategy_recommendation` | Personalized strategy reasoning | "Based on your aggressive profile and $5,000 balance, shifting 60% to Ekubo STRK/ETH for higher yield exposure." |
| `idle_capital` | Proactive suggestion for unallocated funds | "You have $2,100 idle. Consider deploying to Vesu USDC lending for ~6% APY." |
| `gate_rate_explanation` | Explain gate pass/fail statistics | "Your gate pass rate is 94% — the 6% failures are slippage checks during high-volatility periods." |
| `error_decode` | Rewrite raw errors into guidance | "Your withdrawal couldn't be processed because the commitment nonce doesn't match. Try re-creating the deposit commitment." |
| `pending_claims` | Prioritize claimable rewards | "You have 3 claimable rewards totaling ~$180. The Ekubo LP rewards ($120) expire in 48h — claim those first." |

### 5.4. Provider Identity Binding

Each agent's LLM provider binding produces a **config_hash** — a deterministic SHA-256 of the provider configuration. This hash is stored:
- In the `llm_bindings` SQLite table
- In the on-chain `AgentMetadata.llm_provider_hash` field

This means the LLM model used for any decision is **auditable on-chain**: anyone can verify which model was bound to which agent at what time.

---

## 6. Groth16 Proof Pipeline

### 6.1. End-to-End Flow

```
Circuit Input         Witness             Proof               Garaga              On-Chain
(JSON)                Generation          Generation          Formatting          Verification
──────                ──────              ──────              ──────              ──────
build_*_inputs() ──▶  generate_witness.js  ──▶  snarkjs       ──▶  garaga_calldata  ──▶  verify_groth16_
                      (Node.js WASM)          groth16 prove       .mjs (MSM hints)     proof_bn254()
                                              (.zkey + .wtns)     ~2000 felt252s        (Garaga lib)
                                                                                           │
                                                                                           ▼
                                                                                   ZkmlProofRecord
                                                                                   stored on-chain
```

### 6.2. Circuit Scanner (`circuit_scanner.py`)

The unified proof runner supports all 16 scanner circuits (excludes 6 privacy circuits which use dedicated `groth16_prover.py`):

```python
CIRCUIT_REGISTRY = {
    "RiskScore":      {"wasm": ..., "zkey": ..., "category": "ml_scoring"},
    "AnomalyDetector": {"wasm": ..., "zkey": ..., "category": "ml_scoring"},
    # ... 14 more circuits
}

async def _generate_proof(circuit_name: str, inputs: dict) -> dict:
    """Generate a real Groth16 proof via snarkjs subprocess."""
    # 1. Write inputs to temp JSON file
    # 2. Run generate_witness.js via Node subprocess
    # 3. Run snarkjs groth16 prove with .zkey
    # 4. Read proof.json + public.json
    # 5. Hash proof for receipt
    # Return: {compliant: bool, proof_hash: str, duration_ms: int, ...}
```

**Production Gate** (`REQUIRE_REAL_PROOFS`): When the environment variable `ZKDEFI_REQUIRE_REAL_PROOFS=true` is set, any failed proof generation raises `ProofGenerationError` — a hard failure that prevents the system from continuing with unverified data.

### 6.3. Input Builders

Each circuit has a dedicated input builder function that translates high-level parameters into the exact signal format the circuit expects:

```python
def build_risk_score_inputs(features=None, weights=None, threshold=500, scale=10000, **kw) -> dict:
    """Build inputs for RiskScore circuit (N_FEATURES=8)."""

def build_il_predictor_inputs(position_size=1000, entry_price=2000, current_price=2100,
                               fee_earned_bps=50, max_il_tolerance_bps=500, scale=10000, **kw) -> dict:
    """Build inputs for ImpermanentLossPredictor circuit."""

# ... 13 more builders, one per circuit
```

### 6.4. Garaga Formatter (`garaga_formatter.py`)

Converts snarkjs proof outputs to Garaga's expected calldata format:

1. Write proof.json and public.json to temp files
2. Run `garaga_calldata.mjs` Node.js script (uses `garaga` npm package v1.0.1)
3. The script computes MSM (multi-scalar multiplication) hints and pairing precomputations
4. Output: ~2000 `felt252` values as hex strings
5. These are passed directly to `verify_groth16_proof_bn254()` on-chain

---

## 7. On-Chain Smart Contracts (Cairo)

### 7.1. Core Contracts

#### `vault_controller.cairo` — Autonomous Vault Manager
The central execution contract. Manages:
- **Adapter registry**: Protocol adapters (Ekubo LP, Vesu lending, staking) with max allocation caps
- **Policy root**: Merkle root of approved constraint sets
- **Commit-reveal proposals**: Two-phase execution (commit → execute after cooldown)
- **Circuit breaker**: Emergency disable per adapter
- **Constraint registration**: Session key → constraint hash binding

**Policy / Constitution Binding**: Constraints are registered per session key (or per account if no session key is active), not per commitment or per deposit. This means:
- A constraint update does not create a linkable event correlated with a specific deposit.
- Constraint hashes bind to the user's session scope, not to individual pool commitments.
- The `policy_root` Merkle tree captures the full set of active constraints; individual constraint updates are absorbed into the next root update without revealing which constraint changed.

```
VaultController
├── register_adapter(adapter, max_bps)
├── commit_proposal(proposal_hash)        ──▶ block number recorded
├── execute_proposal(adapters, amounts, salt)  ──▶ hash verified, cooldown checked
├── trigger_circuit_breaker(adapter)
├── register_constraint(constraint_hash, session_key_hash)
└── update_policy_root(new_root)
```

#### `zkml_verifier.cairo` — ZK Proof Verification Hub
Routes Groth16 proofs to Garaga for verification and maintains an on-chain proof registry:

```
ZkmlVerifier
├── verify_risk_score_proof(calldata, commitment_hash) → bool
├── verify_anomaly_proof(calldata, pool_id, commitment_hash) → bool
├── verify_combined_proofs(risk_calldata, anomaly_calldata, pool_id, commitment_hash) → bool
├── is_proof_verified(commitment_hash) → bool
├── get_proof_record(commitment_hash) → ZkmlProofRecord
└── get_user_proof_count(user) → u64
```

Each verification:
1. Calls Garaga's `verify_groth16_proof_bn254()` with the calldata
2. Stores a `ZkmlProofRecord` (proof_type, user, commitment_hash, is_valid, timestamp)
3. Emits an event (`RiskScoreVerified`, `AnomalyProofVerified`, `CombinedProofsVerified`)

> **Storage note**: The current per-proof `ZkmlProofRecord` storage pattern is gas-expensive and grows linearly. The recommended migration path (see §17) is: emit events for full history, store only a rolling window of the last N verified hashes per user on-chain for liveness checks, and rely on an off-chain indexer for historical queries.

#### `confidential_transfer.cairo` — Shielded Pool
Implements private deposits and withdrawals gated by Groth16 proofs:

- **Deposit**: User submits commitment (u256: low, high) + amount + proof_calldata. Contract verifies proof via Garaga, then transfers ERC20 tokens to contract and stores commitment balance.
- **Withdraw**: User submits nullifier + commitment + amount + proof_calldata + recipient. Contract checks nullifier not spent, verifies proof, marks nullifier, transfers tokens to recipient.

Storage uses `u256` commitment keys (BN254 Poseidon outputs can exceed felt252 range) via `poseidon_hash_span(low, high)` for map indexing.

#### `agent_identity.cairo` — SRC-721 Agent Registry
Each agent is minted as an NFT with metadata:

```cairo
struct AgentMetadata {
    owner: ContractAddress,
    name: felt252,
    created_at: u64,
    identity_commitment: felt252,
    reputation_tier: u8,          // 0=Strict, 1=Standard, 2=Express
    model_count: u8,
    skill_count: u8,
    llm_provider_hash: felt252,   // Auditable model binding
    active: bool,
    last_execution: u64,
    total_executions: u64,
}
```

Interface includes:
- `mint_agent(owner, name, identity_commitment)` — creates agent NFT
- `bind_model(token_id, model_id)` — binds AI model to agent
- `bind_skill(token_id, skill_id)` — registers ZK circuit capability
- `update_reputation(token_id, new_tier)` — adjusts trust level
- `record_execution(token_id)` — increments execution counter

### 7.2. Supporting Contracts

| Contract | Purpose |
|----------|---------|
| `constraint_receipt.cairo` | On-chain attestation of constraint gate evaluations |
| `agent_performance_store.cairo` | Provable historical performance records per agent |
| `agent_skill_registry.cairo` | On-chain registry of available ZK skills and their parameters |
| `agent_composer.cairo` | Compose multi-skill execution flows |
| `session_key_manager.cairo` | Session key registration, expiry, permission scoping |
| `compliance_profile.cairo` | Risk profile + tier management with on-chain enforcement |
| `selective_disclosure.cairo` | Credential disclosure without revealing underlying data |
| `intent_commitment.cairo` | Commit-reveal for user intents (anti-frontrunning) |
| `reputation_registry.cairo` | Cross-protocol reputation aggregation |
| `model_registry.cairo` | On-chain AI model metadata and hash registry |
| `validation_proof_registry.cairo` | General proof validation and storage |
| `batch_verifier.cairo` | Batch verification of multiple proofs in a single tx |
| `ekubo_lp_adapter.cairo` | Strategy adapter for Ekubo concentrated LP |
| `lending_adapter.cairo` | Strategy adapter for Vesu lending |
| `staking_adapter.cairo` | Strategy adapter for native staking |
| `strategy_adapter.cairo` | Base adapter trait (interface contract) |
| `fully_shielded_pool.cairo` | Full privacy pool with Merkle tree |
| `hashed_withdraw_pool.cairo` | Pool with hashed claim-based withdrawals |
| `merkle_tree.cairo` | On-chain incremental Merkle tree (20 levels) |
| `relayer.cairo` | Gas-relay execution for privacy-preserving transactions |
| `tiered_agent_controller.cairo` | Tier-based access control for agent operations |
| `tier2h_escrow.cairo` | Escrow for tier-2 hybrid (L1↔L2) operations |
| `allocation_router.cairo` | Routes capital allocation across adapters |
| `obsqra_fact_registry.cairo` | Custom fact registry for cross-contract attestation |
| `mock_fact_registry.cairo` | Test fact registry for development |
| `collateral_vault.cairo` | Collateral management for lending positions |
| `lending_pool.cairo` | Pool logic for lending protocol integration |
| `proof_gated_yield_agent.cairo` | Yield agent gated by ZK proof verification |
| `cairo_perceptron.cairo` | On-chain neural network perceptron (ML inference in Cairo) |
| `erc20_interface.cairo` | Standard ERC-20 interface trait |

---

## 8. Receipts and Attestation System

### 8.1. Receipt Lifecycle

Every significant protocol action generates a **receipt** — a cryptographic attestation that ties together the user, the constraints checked, the proof generated, and the on-chain result.

```
Action Triggered          Receipt Created            On-Chain Confirmed
────────────────          ───────────────            ──────────────────
  Deposit/Withdraw        receipt_id = SHA-256(      tx_hash recorded on
  Rebalance               user + constraints_hash    receipt after block
  Agent Execution         + proof_hash + timestamp)  inclusion
  Credit Check                    │                        │
                                  ▼                        ▼
                          orchestration_receipts     ReceiptService
                          .json (persisted)          .confirm_receipt()
```

### 8.2. Backend Receipt Service (`receipt_service.py`)

Currently file-backed (`data/orchestration_receipts.json`) with in-memory indexing. **Migration to SQLite planned** for durability and concurrent access (agents already use SQLite via `agent_store.py`).

```python
class ReceiptService:
    def create_receipt(self, user, constraints_hash, proof_hash, action_type, protocol_id, amount):
        """Generate receipt_id = SHA-256(user + constraints_hash + proof_hash + timestamp)"""

    def confirm_receipt(self, receipt_id, tx_hash):
        """Update receipt with on-chain tx_hash after block inclusion"""

    def get_user_receipts(self, user_address) -> list[dict]:
        """Return all receipts for a user address"""
```

### 8.2.1. Receipt Integrity Hardening (Planned)

The current `receipt_id = SHA-256(...)` scheme provides content-addressing but not tamper-proofness — anyone with the inputs can fabricate a receipt. The hardening roadmap:

| Layer | Mechanism | Status |
|-------|-----------|--------|
| **Server Signature** | Ed25519 signature over `(receipt_id, tx_hash, proof_hash, timestamp)` using a server keypair. Receipts become signed envelopes. | Planned |
| **Durable Storage** | Migrate from JSON file to SQLite (same pattern as `agent_store.py`). WAL mode for concurrent access. | Planned |
| **On-Chain Anchoring** | Backend-confirmed receipts are already anchored by `tx_hash`. For backend-only receipts, publish a daily Merkle root of all receipt_ids to `constraint_receipt.cairo`. | Planned |
| **Receipt Merkle Root** | `receipt_root = Poseidon(receipt_id_1, receipt_id_2, ..., receipt_id_n)` published on-chain daily. Any receipt can prove inclusion via Merkle path. | Planned |

Once hardened, the "backend-only confirmed" status means: *signed by the server, included in the daily receipt root, awaiting on-chain tx anchor*. Not just *"the JSON file says so."*

### 8.3. On-Chain Constraint Receipts (`constraint_receipt.cairo`)

The Cairo contract stores on-chain attestations of constraint evaluations:
- Constraint hash (what was checked)
- User address
- Result (pass/fail)
- Timestamp
- Linked proof commitment hash

### 8.4. History Timeline API

**Endpoint**: `GET /api/v1/zkdefi/history/timeline/{user_address}`

Returns a `TimelineResponse` with all receipt events mapped to `HistoryTimelineEvent`:

```typescript
interface HistoryTimelineEvent {
    id: string;
    timestamp: string;          // ISO 8601
    type: string;               // "deposit", "withdraw", "rebalance", etc.
    title: string;
    status: "pending" | "confirmed" | "failed" | "info";
    tx_hash?: string;
    receipt_id?: string;
    venue?: string;             // "ekubo", "vesu", etc.
    execution_path?: string;
    policy_hash?: string;
    details?: string;
    meta?: Record<string, unknown>;
}
```

### 8.5. Dual-Source Reconciliation (`useReceiptAggregator`)

The frontend reconciles two independent data sources:

**Source A — Backend API**: `getHistoryTimeline(address)` → backend receipt events
**Source B — On-Chain Indexer**: `apiFetch("/receipts/on-chain/{address}")` → indexed on-chain events

Reconciliation algorithm (hash-map merge keyed by `tx_hash`):

```
IF backend AND chain:
    normalize both statuses
    IF statuses match → "confirmed"
    ELSE → "diverged"         ⚠ Critical anomaly
ELSE IF backend only:
    IF status == "pending" → "pending"
    ELSE → "confirmed"       (terminal bookkeeping event)
ELSE (chain only):
    → "on-chain"             (receipt from external tooling)
```

Result: `AggregatedReceipt[]` sorted newest-first, rendered in `ReceiptTimeline` component.

### 8.6. Receipt Status State Machine

```
                    ┌─────────────────────────────────────────┐
                    │     RECEIPT RECONCILIATION STATES        │
                    │                                         │
                    │  ● confirmed  — Both sources agree      │
                    │  ● pending    — Backend only, awaiting  │
                    │                 block inclusion          │
                    │  ● on-chain   — Chain only, backend     │
                    │                 unaware                  │
                    │  ● diverged   — Sources disagree        │
                    │                 (investigate)            │
                    └─────────────────────────────────────────┘
```

---

## 9. Agent Skill Service — Bridge Between LLM and ZK

### 9.1. The Skill Abstraction

`agent_skill_service.py` is the critical bridge layer that makes ZK circuits invocable by an LLM:

```
LLM (natural language)              Skill Service                    Circuit (arithmetic)
──────────────────────              ─────────────                    ────────────────────
"Check if IL is within              SkillDefinition:                 ImpermanentLossPredictor
 tolerance for my                   - skill_id: "il_predictor"       template ILModel()
 ETH/USDC position"                 - parameters: JSON Schema         signal input position_size
        │                           - circuit_name                    signal input entry_price
        ▼                           - input_builder                   signal output is_acceptable
 LLM tool call:                           │
 {skill_id: "il_predictor",               ▼
  position_size: 1000,              build_il_predictor_inputs()
  entry_price: 2000,                      │
  current_price: 2100}                    ▼
                                    circuit_scanner._generate_proof()
                                          │
                                          ▼
                                    {compliant: true,
                                     proof_hash: "0xa3f...",
                                     duration_ms: 2340}
```

### 9.2. Skill Definitions

13 skills registered, each mapping to one circuit:

| Skill ID | Circuit | Category | Min Tier |
|----------|---------|----------|----------|
| `il_predictor` | ImpermanentLossPredictor | agent_skill | 0 |
| `yield_optimality` | YieldOptimality | agent_skill | 0 |
| `slippage_bound` | SlippageBound | agent_skill | 0 |
| `reputation_check` | AgentReputationScore | agent_identity | 0 |
| `arb_check` | CrossProtocolArbitrage | agent_skill | 1 |
| `liquidation_check` | LiquidationRisk | agent_skill | 0 |
| `performance_attestation` | HistoricalPerformanceAttestation | agent_identity | 1 |
| `mev_resistance` | MEVResistanceProof | agent_skill | 1 |
| `risk_score` | RiskScore | ml_scoring | 0 |
| `anomaly_detector` | AnomalyDetector | ml_scoring | 0 |
| `correlation_risk` | CorrelationRisk | ml_scoring | 0 |
| `twap_position` | TWAPPosition | ml_scoring | 0 |
| `safety_diversification` | SafetyDiversification | ml_scoring | 0 |

### 9.3. LLM Tool Format

Skills are exported as OpenAI function-calling compatible tool definitions:

```json
{
  "type": "function",
  "function": {
    "name": "il_predictor",
    "description": "Predict if impermanent loss on an LP position is within tolerance...",
    "parameters": {
      "type": "object",
      "properties": {
        "position_size": {"type": "integer", "description": "LP position size in base units"},
        "entry_price": {"type": "integer", "description": "Price when position was entered"},
        "current_price": {"type": "integer", "description": "Current market price"},
        "fee_earned_bps": {"type": "integer", "description": "Fees earned in bps"},
        "max_il_tolerance_bps": {"type": "integer", "description": "Maximum acceptable IL in bps"}
      },
      "required": ["position_size", "entry_price", "current_price"]
    }
  }
}
```

---

## 10. Poseidon Hashing Bridge

### 10.1. The Problem

Circom circuits use BN254-field Poseidon hashing (via `circomlib/circuits/poseidon.circom`). The backend needs to compute identical hashes outside circuits for:
- Generating commitments before proof generation
- Computing nullifiers for withdrawal verification
- Building Merkle tree paths

### 10.2. The Solution: Node.js Bridge

File: `circuits/poseidon_bridge.js`

A Node.js script using `circomlibjs.buildPoseidon()` — the exact same Poseidon implementation used by circomlib:

```javascript
// Input:  {"values": [123, 456]}
// Output: {"hash": "18297631..."}  (BN254 field element as decimal string)

const { buildPoseidon } = require("circomlibjs");
const poseidon = await buildPoseidon();
const hash = poseidon(values.map(v => BigInt(v)));
console.log(JSON.stringify({ hash: F.toString(hash, 10) }));
```

### 10.3. Python Wrapper

File: `backend/app/services/circomlib_poseidon.py`

```python
def poseidon_hash(values: list[int]) -> int:
    """Compute BN254 Poseidon hash matching circomlib circuits."""
    result = subprocess.run(
        ["node", str(POSEIDON_BRIDGE)],
        input=json.dumps({"values": values}),
        capture_output=True, text=True, timeout=10,
    )
    return int(json.loads(result.stdout)["hash"])
```

This ensures hash consistency across all layers — circuit constraints, backend computation, and on-chain verification all use the same mathematical function.

---

## 11. Frontend Surfaces

### 11.1. Component Architecture

| Component | Purpose | Data Source |
|-----------|---------|-------------|
| `ReceiptTimeline` | Chronological proof receipt viewer | `useReceiptAggregator` (dual-source) |
| `AgentDashboard` | Agent CRUD, performance, execution history | Agent builder API |
| `AgentPerformanceDashboard` | APY charts, Sharpe ratios, drawdown | Performance tracker API |
| `AgentLeaderboard` | Ranked agents by performance | Leaderboard API |
| `AgentBuilder` | Create/configure agents with skill selection | Agent builder API |
| `ZKGatePipeline` | Real-time constraint gate visualization | Gate evaluation API |
| `PrivateYieldPanel` | Shielded deposit/withdraw UI | Groth16 prover API |
| `ProofTimeline` | Proof generation history and status | Proof history API |
| `RiskProfileSummaryCard` | User risk tier and limits | Profile decision service |
| `VaultDashboardPanel` | Vault TVL, adapters, proposals | Vault controller API |
| `LpRecommendationCard` | AI-recommended LP positions | LLM engine API |
| `StrategyTemplates` | Pre-built strategy templates | Strategy catalog |
| `TrustDisclosureCards` | Selective disclosure credential viewer | Disclosure API |

### 11.2. Toast Notifications

Provider visibility is surfaced to users via toast notifications when LLM fallback occurs:

```
[!] Decision made using deterministic fallback
    Original provider (openai_gpt) was unavailable.
    Recommendation quality may differ.
```

---

## 12. Threat Model

This section makes the adversary landscape and trust assumptions explicit. Everything else in the document should be interpretable through this lens.

### 12.1. Adversary Classes

| Adversary | Capability | What They See | What They Don't See |
|-----------|-----------|---------------|---------------------|
| **Chain Observer** | Read all Starknet calldata, events, state | Proof calldata, commitment hashes, nullifiers, tx_hash, timestamps, agent NFT metadata, `llm_provider_hash` | Private witness inputs (amounts, balances, secrets, nonces), LLM reasoning text, portfolio composition |
| **Relayer Operator** | Relay transactions on behalf of users | Encrypted transaction payloads (or plaintext if user doesn't encrypt), gas patterns, submission timing | User identity (if properly relayed), deposit amounts behind commitments |
| **Compromised Backend** | Full access to proving server memory and disk | All private witness inputs, all receipt data, LLM prompts and responses, user addresses, SQLite database contents | Nothing — the backend is the current single point of trust (see §12.5 for planned mitigations) |
| **Malicious LLM Provider** | Control model output, log prompts | Agent goals, portfolio context sent in prompts, all function-call parameters the LLM chooses | Private circuit inputs (these are built by input_builders from LLM outputs, not sent to the LLM). Note: LLM-chosen parameters *become* circuit inputs, so a malicious LLM can steer constraint checks. |
| **Malicious Adapter** | Return false yield/price data to vault | Adapter interface calls, vault capital flow | Other adapters' assets, user commitments in shielded pools |
| **Colluding Validators** | Reorder or censor Starknet transactions | All on-chain data (same as chain observer) + transaction ordering | Same as chain observer for private data; commit-reveal mitigates reordering attacks on proposals |

### 12.2. Trust Assumptions (Current State)

| Component | Trust Level | Justification | Path to Trustlessness |
|-----------|------------|---------------|----------------------|
| **Backend proving server** | **Fully trusted** | Holds all private witness data, generates all proofs | Client-side WASM proving, TEE enclaves, MPC witness generation |
| **LLM provider** | **Semi-trusted** | Sees goal context but not private inputs. `llm_provider_hash` provides auditability, not integrity. | On-chain model hash approval (§16), deterministic fallback as safety net |
| **Starknet L1/L2** | **Protocol-trusted** | Validity proofs guarantee state transition correctness | Standard Starknet security model applies |
| **Garaga verifier** | **Cryptographically trusted** | Pairing-check math is sound if BN254 assumptions hold | Formal verification of Garaga contracts (external dependency) |
| **snarkjs prover** | **Cryptographically trusted** | Open-source, widely reviewed Groth16 implementation | Powers-of-tau ceremony integrity is the binding constraint (§15) |
| **Receipt service** | **Backend-trusted** | JSON file-backed, no signatures yet | Ed25519 signatures + on-chain Merkle root (§8.2.1) |

### 12.3. What Is Hidden vs. Public — Per Layer

| Layer | Hidden (Private Witness) | Public (On-Chain / Verifiable) |
|-------|--------------------------|-------------------------------|
| **Privacy circuits** | amount, balance, nonce, user_secret, Merkle path | commitment, nullifier, root, recipient (if withdraw), amount_public (if non-shielded) |
| **ML/Scoring circuits** | feature values, weights, raw scores | compliant flag (pass/fail), commitment_hash, proof_hash |
| **Agent skill circuits** | position sizes, prices, fee data, tolerance thresholds | compliant flag, proof_hash |
| **Selective disclosure** | exact balance, exact tenure, exact pool index | "above threshold" boolean, pool type, "tenure sufficient" boolean |
| **LLM reasoning** | Full prompt/response text, tool-call parameters | `llm_provider_hash` (which model), `config_hash` (binding), tokens_used |
| **Receipts** | Receipt creation context, backend-only receipts (pre-anchor) | `tx_hash`, `constraint_hash`, `proof_hash`, reconciliation status |

---

## 13. Linkability Threat Model and Privacy Mitigations

Even with zero-knowledge proofs, metadata leakage can undermine privacy. This section catalogs linkability vectors and the planned mitigations.

### 13.1. Linkability Vectors

| Vector | Attack | Severity | Example |
|--------|--------|----------|---------|
| **Timing correlation** | Correlate deposit timestamp with subsequent vault deployment | High | User deposits at 14:03:22, vault executes at 14:03:25 — trivially linked |
| **Amount correlation** | Match deposit amount to withdrawal amount | High | Deposit 1,337.42 USDC → withdraw 1,337.42 USDC — unique amount fingerprint |
| **Deposit-to-action delay** | Short delay between deposit and first agent action reveals depositor | Medium | Only one new commitment in pool, next block agent acts on exactly that amount |
| **Gas payer correlation** | Same EOA pays gas for deposit and later actions | High | Without relayer, gas source links all transactions |
| **Agent NFT linkage** | Agent NFT ownership links all agent actions to one wallet | Medium | Public SRC-721 ownership graph reveals which wallet controls which agent |
| **Withdrawal pattern** | Repeated withdrawal-deposit cycles at predictable intervals | Medium | Weekly yield harvesting at the same time links positions across epochs |

### 13.2. Planned Mitigations

| Mitigation | Addresses | Mechanism | Status |
|------------|-----------|-----------|--------|
| **Batching windows** | Timing correlation | Backend queues deposits/withdrawals and submits in randomized batches (e.g., every 5-15 minutes with jitter). Multiple users' commitments enter the pool in a single transaction. | Planned |
| **Denomination buckets** | Amount correlation | Deposits rounded to standard denominations: 100, 500, 1000, 5000, 10000 USDC. Change returned as a separate shielded commitment (uses `FullPrivacyWithdrawWithChange` circuit). | Planned |
| **Delayed execution** | Deposit-to-action delay | Configurable delay between commitment insertion and first eligible agent action. Minimum 1 epoch (~6 hours on Starknet). | Planned |
| **Relayer as default** | Gas payer correlation | `relayer.cairo` already deployed. Roadmap: make relayer the default path for all privacy-tier operations. User signs a meta-transaction; relayer submits and pays gas. | Planned (contract deployed, integration pending) |
| **Privacy delay toggle** | Timing, all | Per-user setting: "aggressive privacy" adds random 1-24h delay to all vault operations. Trades latency for unlinkability. | Planned |
| **Agent ownership shielding** | Agent NFT linkage | Future: agent NFTs owned by a shielded account (commitment-based ownership) rather than a public EOA. Requires additional circuit for "prove I own agent X without revealing my address." | Research |

### 13.3. Anonymity Set Analysis

The strength of the shielded pool's privacy is bounded by the **anonymity set** — the number of commitments in the pool at any given time:

| Pool State | Anonymity Set | Privacy Level |
|------------|---------------|---------------|
| < 10 commitments | Weak | Timing + amount analysis trivially deanonymizes |
| 10–100 commitments | Moderate | Denomination buckets help; timing still a risk |
| 100–1000 commitments | Strong | With batching + denomination buckets, practical deanonymization is expensive |
| > 1000 commitments | Full | Statistical attacks become infeasible given sufficient denomination diversity |

**Current testnet state**: Anonymity set is effectively 0 (test transactions only). Mainnet launch should target >100 commitments before marketing privacy guarantees.

---

## 14. Security Model

### 14.1. Proof Security

| Property | Mechanism |
|----------|-----------|
| **Soundness** | Groth16 proofs: computationally infeasible to create valid proof for false statement |
| **Zero-Knowledge** | Private inputs remain at the proving site (see §14.5 for trust boundary); only public signals revealed |
| **Non-Malleability** | Garaga verifier checks pairing equations — modified proofs fail verification |
| **Commitment Binding** | Poseidon hash is collision-resistant — can't find two inputs with same commitment |
| **Double-Spend Prevention** | Nullifier derivation: `nullifier = Poseidon(commitment, user_secret)` — deterministic per commitment |

### 14.5. Private Input Trust Boundaries

The claim "private inputs never leave computation" requires nuance per circuit category:

| Category | Proving Site | Who Holds Private Inputs | Trust Assumption |
|----------|-------------|--------------------------|------------------|
| **Privacy circuits** (deposit/withdraw) | Backend server (snarkjs) | Server builds witness from user-supplied secrets | Trusted backend **or** future client-side witness generation. Users currently trust the backend not to log/exfiltrate inputs. TEE or client-side proving is the path to full trustlessness. |
| **ML/Scoring circuits** (risk, anomaly, etc.) | Backend server | Server-derived features (portfolio data from APIs) | Backend sees derived features by design — these are protocol-computed, not user secrets. Privacy guarantee is against *on-chain observers*, not against the backend itself. |
| **Agent skill circuits** (IL, yield, slippage) | Backend server | LLM-chosen parameters + market data | Same as ML — inputs are market-observable or LLM-generated. ZK hides them from chain observers. |
| **Selective disclosure** (balance, pool, tenure) | Backend server | User commitment preimages | Same trust model as privacy circuits. Client-side proving recommended for production. |

**Planned mitigations**:
- Client-side witness generation for privacy circuits (WASM in browser)
- Confidential compute (TEE) for backend proof generation
- Relayer model where user encrypts inputs to a relayer's enclave key

### 14.2. Agent Security

| Property | Mechanism |
|----------|-----------|
| **Identity Binding** | Agent operations tied to SRC-721 NFT ownership |
| **Model Audibility** | `llm_provider_hash` on-chain — anyone can verify which model made decisions |
| **Skill Gating** | Agents can only invoke their bound skills |
| **Reputation Tiers** | Higher-risk operations require higher reputation |
| **Session Keys** | Time-bounded execution authorization with constraint scope |

### 14.3. Financial Security

| Property | Mechanism |
|----------|-----------|
| **Circuit Breaker** | Per-adapter emergency disable on `vault_controller` |
| **Commit-Reveal** | Two-phase proposal execution prevents frontrunning |
| **Cooldown** | Minimum time between rebalances (`min_cooldown_seconds`) |
| **Max Allocation** | Per-adapter BPS cap prevents concentration |
| **Proof-Gated Execution** | No vault operation without verified ZK proof |

### 14.4. Receipt Integrity

| Property | Mechanism |
|----------|-----------|
| **Content Addressing** | Receipt ID = SHA-256(user + constraints + proof + timestamp) |
| **Server Signature** | Ed25519 signed envelope over receipt payload (planned) |
| **On-Chain Anchoring** | Confirmed receipts linked to `tx_hash`; daily receipt Merkle root published on-chain (planned) |
| **Dual-Source Verification** | Backend + on-chain sources independently confirm |
| **Divergence Detection** | `diverged` status flags inconsistencies for investigation |
| **Graceful Degradation** | Either source failing still provides partial timeline |

---

## 15. Ceremony and Key Management

The security of every Groth16 proof in the system ultimately depends on the integrity of the trusted setup ceremony and the correct management of proving/verification keys. A compromised ceremony or mismatched keys invalidates all proofs.

### 15.1. Powers-of-Tau Provenance

| Parameter | Value |
|-----------|-------|
| **Ceremony file** | `pot14_final.ptau` (Hermez phase-1 ceremony) |
| **Max constraints** | 2^14 = 16,384 (sufficient for all 22 circuits; largest is ~6000) |
| **Source** | Hermez Network trusted setup — multi-party ceremony with 54+ participants |
| **Integrity check** | SHA-256 hash of `pot14_final.ptau` must match published Hermez hash |
| **Location** | `circuits/pot14_final.ptau` (not committed to git; fetched during setup) |

> **Risk**: If the ptau file is replaced with a malicious version, an adversary can forge proofs for any circuit. The build pipeline should verify the ptau checksum before any `snarkjs groth16 setup` call.

### 15.2. Per-Circuit Key Registry

Each circuit's trusted setup produces a proving key (`.zkey`) and verification key (`verification_key.json`). These must be checksummed and version-tracked:

| Artifact | Path Pattern | Verification |
|----------|-------------|--------------|
| Proving key | `circuits/build/{Circuit}_final.zkey` | SHA-256 checksum in `circuits/build/checksums.json` |
| Verification key | `circuits/build/{Circuit}_verification_key.json` | SHA-256 checksum; must match VK registered on-chain |
| Witness generator | `circuits/build/{Circuit}_js/{Circuit}.wasm` | SHA-256 checksum; rebuild from source to verify |

**Planned**: `checksums.json` manifest file listing all 22 circuits × 3 artifacts = 66 checksums. Build script validates checksums before proof generation. CI/CD rejects mismatches.

### 15.3. Circuit Versioning and Rotation

When a circuit is modified (constraint logic changes, parameter updates):

1. **New compilation** produces new R1CS, WASM, and requires a fresh `snarkjs groth16 setup`
2. **New zkey** is generated — old proofs remain valid under old VK, but new proofs require new VK
3. **On-chain VK update**: `zkml_verifier.cairo` must be updated or a new verifier deployed with the new VK
4. **Version tag**: Circuit version encoded in build artifacts (e.g., `RiskScore_v2_final.zkey`)
5. **Receipt linkage**: Receipts reference the circuit version so historical proofs remain auditable against their original VK

### 15.4. Deployment Key Matching

The deployment process must enforce that the verification key registered on-chain matches the proving key used by the backend:

```
Build Time                              Deploy Time                         Runtime
──────────                              ───────────                         ───────
circom compile ──▶ snarkjs setup ──▶    Deploy zkml_verifier with VK  ──▶  Proof generated with
                   (ptau + r1cs)        from same setup ceremony           matching .zkey
                        │                        │                              │
                        ▼                        ▼                              ▼
                   .zkey + vk.json         VK stored on-chain          Garaga verifies against
                   (MUST be from           (MUST match .zkey)          stored VK (MUST match)
                    same ceremony)
```

**Invariant**: `VK_on_chain == export_vk(.zkey)` — if this invariant breaks, all proofs fail verification silently (they verify as false).

---

## 16. Model and Circuit Versioning

AI models evolve. Circuit logic changes. The system must track which version of each component produced each proof, ensuring historical auditability and preventing silent model/circuit swaps.

### 16.1. Model Hash as Public Input

Currently, `llm_provider_hash` is stored in `AgentMetadata` on `agent_identity.cairo`. This provides *model audibility* but not *model integrity* — the backend can claim any hash.

**Planned enhancement**:

| Step | Mechanism |
|------|-----------|
| 1. **Compute `model_hash`** | `SHA-256(provider_id + model_name + model_version + config_params)` computed at agent binding time |
| 2. **Register on `model_registry.cairo`** | Admin-approved set of `model_hash` values with metadata (model name, version, capabilities) |
| 3. **Include in proof context** | Receipt `model_hash` field references which model's output was used as input to ZK circuits |
| 4. **Verifier checks approval** | `model_registry.is_approved(model_hash)` called during execution — unapproved models cannot trigger vault operations |

### 16.2. Circuit Version Tracking

| Field | Where Stored | Purpose |
|-------|-------------|---------|
| `circuit_name` | Receipt JSON, on-chain proof record | Which circuit was used |
| `circuit_version` | Receipt JSON (planned), checksum manifest | Which version of the circuit |
| `vk_hash` | On-chain verifier storage | Cryptographic binding to specific trusted setup |
| `zkey_checksum` | Build manifest (`checksums.json`) | Proves backend used the canonical proving key |

### 16.3. Version Upgrade Protocol

```
1. New model version approved:
   ├─ model_registry.approve_model(new_model_hash, metadata)
   ├─ Agent owner calls agent_identity.bind_model(token_id, new_model_id)
   └─ New llm_provider_hash stored on-chain

2. New circuit version deployed:
   ├─ New trusted setup ceremony (or re-use ptau + new r1cs)
   ├─ New .zkey and VK generated
   ├─ New zkml_verifier deployed with updated VK
   ├─ Old verifier remains for historical proof validation
   └─ Receipts reference circuit_version to distinguish old vs new proofs

3. Model + Circuit combined update:
   ├─ Both model_hash and vk_hash change
   ├─ Receipts capture the full version tuple: (model_hash, circuit_version, vk_hash)
   └─ Historical query: "show me all proofs from model_v1 + circuit_v2"
```

> **Key principle**: Weights are currently hardcoded in circuit templates (e.g., `RiskScore` weights are compile-time constants). Moving weights to public inputs would allow model updates without re-compilation, but would also make weights public on-chain. The current approach trades flexibility for weight privacy.

---

## 17. Event Schema and Indexing

### 17.1. On-Chain Storage vs. Events

The current `zkml_verifier.cairo` stores a `ZkmlProofRecord` per verified proof in contract storage. This is expensive and does not scale:

| Approach | Cost | Queryability | Scalability |
|----------|------|-------------|-------------|
| **Storage mapping** (current) | ~20,000 gas per proof record | Direct `get_proof_record(hash)` | O(n) storage growth — unsustainable at volume |
| **Events only** | ~375 gas per event | Requires off-chain indexer | Constant on-chain cost; indexer handles history |
| **Hybrid (recommended)** | ~5,000 gas per proof | Rolling window on-chain + full history via events | Bounded on-chain state + complete off-chain history |

**Recommended pattern**: Store a rolling window of the last K verified proof hashes per user (e.g., K=10) on-chain for liveness checks, and emit detailed events for full history. An off-chain indexer consumes events to build the queryable proof/receipt database.

### 17.2. Canonical Event Schema

Events already emitted by core contracts:

| Contract | Event | Fields |
|----------|-------|--------|
| `zkml_verifier.cairo` | `RiskScoreVerified` | user, commitment_hash, is_valid, timestamp |
| `zkml_verifier.cairo` | `AnomalyProofVerified` | user, pool_id, commitment_hash, is_valid, timestamp |
| `zkml_verifier.cairo` | `CombinedProofsVerified` | user, pool_id, commitment_hash, is_valid, timestamp |
| `confidential_transfer.cairo` | `Deposit` | commitment, amount (public component) |
| `confidential_transfer.cairo` | `Withdrawal` | nullifier, recipient, amount |
| `constraint_receipt.cairo` | `ConstraintEvaluated` | user, constraint_hash, result, proof_hash, timestamp |
| `agent_identity.cairo` | `AgentMinted` | token_id, owner, name, identity_commitment |
| `vault_controller.cairo` | `ProposalCommitted` | proposal_hash, block_number |
| `vault_controller.cairo` | `ProposalExecuted` | adapters, amounts, timestamp |
| `vault_controller.cairo` | `CircuitBreakerTriggered` | adapter, timestamp |

### 17.3. Indexer Architecture (Planned)

```
Starknet Node                    Indexer                          Receipt Service
─────────────                    ───────                          ───────────────
  Emit events ──▶  Apibara / Substreams  ──▶  PostgreSQL  ──▶  Reconciliation
  (each block)     stream processor           (indexed by        endpoint feeds
                   filters by contract        user, type,        ReceiptTimeline
                   + event selector           timestamp)         component
                         │
                         ▼
                   Webhook → Receipt Service
                   (confirm receipts with
                    on-chain tx_hash)
```

**Recommended stack**: [Apibara](https://www.apibara.com/) for Starknet-native event streaming, or a custom `starknet_getEvents` polling loop for simpler deployments. PostgreSQL as the indexed store with materialized views per user.

### 17.4. Migration Path

| Phase | Change | Impact |
|-------|--------|--------|
| **Phase 1** (current) | Keep storage mapping + events | No breaking changes |
| **Phase 2** | Add rolling-window storage (last 10 per user), keep events | `get_proof_record` still works for recent proofs; historical queries go to indexer |
| **Phase 3** | Remove per-proof storage mapping; events-only for new proofs | Significant gas savings; all queries go through indexer API |
| **Phase 4** | Batch proof anchoring — single `proof_batch_root` per block | Maximum gas efficiency; individual proof verification via Merkle inclusion |

---

## 18. Circuit Inventory Reference

| # | Circuit | File | Category | Constraints (approx) |
|---|---------|------|----------|---------------------|
| 1 | PrivateDeposit | `PrivateDeposit.circom` | privacy | ~500 |
| 2 | PrivateWithdraw | `PrivateWithdraw.circom` | privacy | ~800 |
| 3 | FullPrivacyWithdraw | `FullPrivacyWithdraw.circom` | privacy | ~5000 (20-level Merkle) |
| 4 | FullPrivacyWithdrawHashed | `FullPrivacyWithdrawHashed.circom` | privacy | ~5500 |
| 5 | FullPrivacyWithdrawWithChange | `FullPrivacyWithdrawWithChange.circom` | privacy | ~6000 |
| 6 | CreditEligibility | `CreditEligibility.circom` | privacy | ~400 |
| 7 | RiskScore | `RiskScore.circom` | ml_scoring | ~200 |
| 8 | AnomalyDetector | `AnomalyDetector.circom` | ml_scoring | ~400 |
| 9 | CorrelationRisk | `CorrelationRisk.circom` | ml_scoring | ~600 |
| 10 | TWAPPosition | `TWAPPosition.circom` | ml_scoring | ~150 |
| 11 | SafetyDiversification | `SafetyDiversification.circom` | ml_scoring | ~300 |
| 12 | ImpermanentLossPredictor | `ImpermanentLossPredictor.circom` | agent_skill | ~300 |
| 13 | YieldOptimality | `YieldOptimality.circom` | agent_skill | ~400 |
| 14 | SlippageBound | `SlippageBound.circom` | agent_skill | ~200 |
| 15 | AgentReputationScore | `AgentReputationScore.circom` | agent_identity | ~250 |
| 16 | CrossProtocolArbitrage | `CrossProtocolArbitrage.circom` | agent_skill | ~300 |
| 17 | LiquidationRisk | `LiquidationRisk.circom` | agent_skill | ~500 |
| 18 | HistoricalPerformanceAttestation | `HistoricalPerformanceAttestation.circom` | agent_identity | ~400 |
| 19 | MEVResistanceProof | `MEVResistanceProof.circom` | agent_skill | ~300 |
| 20 | BalanceAboveThreshold | `BalanceAboveThreshold.circom` | selective_disclosure | ~5000 |
| 21 | PoolMembership | `PoolMembership.circom` | selective_disclosure | ~5000 |
| 22 | TenureAboveThreshold | `TenureAboveThreshold.circom` | selective_disclosure | ~5200 |

---

## 19. Contract Inventory Reference

| # | Contract | File | Category | Deployed |
|---|----------|------|----------|----------|
| 1 | VaultController | `vault_controller.cairo` | core | Sepolia |
| 2 | ZkmlVerifier | `zkml_verifier.cairo` | core | Sepolia |
| 3 | ConfidentialTransfer | `confidential_transfer.cairo` | core | Sepolia |
| 4 | AgentIdentity | `agent_identity.cairo` | agent | Sepolia |
| 5 | AgentPerformanceStore | `agent_performance_store.cairo` | agent | Sepolia |
| 6 | AgentSkillRegistry | `agent_skill_registry.cairo` | agent | Sepolia |
| 7 | AgentComposer | `agent_composer.cairo` | agent | Sepolia |
| 8 | ConstraintReceipt | `constraint_receipt.cairo` | receipt | Sepolia |
| 9 | SessionKeyManager | `session_key_manager.cairo` | auth | Sepolia |
| 10 | ComplianceProfile | `compliance_profile.cairo` | risk | Sepolia |
| 11 | SelectiveDisclosure | `selective_disclosure.cairo` | privacy | Sepolia |
| 12 | IntentCommitment | `intent_commitment.cairo` | execution | Sepolia |
| 13 | ReputationRegistry | `reputation_registry.cairo` | identity | Sepolia |
| 14 | ModelRegistry | `model_registry.cairo` | identity | Sepolia |
| 15 | ValidationProofRegistry | `validation_proof_registry.cairo` | proof | Sepolia |
| 16 | BatchVerifier | `batch_verifier.cairo` | proof | Sepolia |
| 17 | EkuboLpAdapter | `ekubo_lp_adapter.cairo` | adapter | Sepolia |
| 18 | LendingAdapter | `lending_adapter.cairo` | adapter | Sepolia |
| 19 | StakingAdapter | `staking_adapter.cairo` | adapter | Sepolia |
| 20 | StrategyAdapter | `strategy_adapter.cairo` | adapter | Sepolia |
| 21 | FullyShieldedPool | `fully_shielded_pool.cairo` | pool | Sepolia |
| 22 | HashedWithdrawPool | `hashed_withdraw_pool.cairo` | pool | Sepolia |
| 23 | MerkleTree | `merkle_tree.cairo` | util | Sepolia |
| 24 | Relayer | `relayer.cairo` | execution | Sepolia |
| 25 | TieredAgentController | `tiered_agent_controller.cairo` | agent | Sepolia |
| 26 | Tier2hEscrow | `tier2h_escrow.cairo` | bridge | Sepolia |
| 27 | AllocationRouter | `allocation_router.cairo` | execution | Sepolia |
| 28 | ObsqraFactRegistry | `obsqra_fact_registry.cairo` | proof | Sepolia |
| 29 | MockFactRegistry | `mock_fact_registry.cairo` | test | Sepolia |
| 30 | CollateralVault | `collateral_vault.cairo` | vault | Sepolia |
| 31 | LendingPool | `lending_pool.cairo` | pool | Sepolia |
| 32 | ProofGatedYieldAgent | `proof_gated_yield_agent.cairo` | agent | Sepolia |
| 33 | CairoPerceptron | `cairo_perceptron.cairo` | ml | Sepolia |
| 34 | ERC20Interface | `erc20_interface.cairo` | util | (trait only) |

---

*This document describes the production state of the zkde.fi system as of March 2026. All 22 circuits generate real Groth16 proofs, 7 critical contracts are deployed to Starknet Sepolia, and the full AI → ZK → on-chain → receipt pipeline is operational.*
