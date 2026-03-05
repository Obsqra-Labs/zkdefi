# ZKML Circuit Deep Dive — Full Report

> Generated from comprehensive codebase analysis of `/opt/obsqra.starknet/zkdefi`

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Circuit Inventory](#3-circuit-inventory)
   - 3A. ML/Scoring Circuits (Circom)
   - 3B. Privacy/Merkle Circuits (Circom)
   - 3C. Cairo On-Chain Contracts
   - 3D. Infrastructure/Tooling
4. [Detailed Circuit Breakdowns](#4-detailed-circuit-breakdowns)
5. [Proof Generation Pipeline](#5-proof-generation-pipeline)
6. [Why Each Circuit Is Where It Is](#6-architectural-placement-rationale)
7. [Current Gaps & Improvement Opportunities](#7-current-gaps--improvement-opportunities)
8. [New Circuits for More Intelligent Data](#8-new-circuits-for-more-intelligent-data)
9. [Recommendations Summary](#9-recommendations-summary)

---

## 1. Executive Summary

The zkde.fi system implements the circuit layer of Obsqra's **verifiable AI agent infrastructure** — a multi-tier zero-knowledge proof architecture across 15 Circom circuits, 4 Cairo contracts, and 1 Garaga-generated verifier. The system serves three purposes:

1. **Privacy-Preserving DeFi Actions** — Deposit, withdraw, and manage liquidity without revealing balances, positions, or strategy details
2. **Verifiable AI/ML Decisions** — Prove that autonomous agent risk assessments, anomaly detection, and portfolio optimization decisions are correct without revealing the model parameters or user data
3. **Computation Oracle Infrastructure** — Enable smart contracts to consume provably computed analytics (risk scores, anomaly classifications, yield forecasts) rather than trusting off-chain assertions

**Architecture**: AI agents call provable skill modules. Each skill maps to a ZK circuit. Each circuit produces a proof. The proof registry (ERC-8004) records it. Smart contracts verify before execution. This makes AI agents whose decisions are backed by cryptographic evidence — the foundation for computation oracles that prove interpretation, not just data.

**Proof stack**: Circom (R1CS) → snarkjs (Groth16/BN254) → Garaga (Starknet-compatible calldata) → Cairo verifier contracts

**Key finding**: The system has a solid foundation with 15 circuits covering 5 ML/scoring, 3 Merkle/privacy selective-disclosure, 3 full-privacy transactional, 3 basic transactional, and 1 credit eligibility circuit. The backend pipeline is well-structured with graceful 3-tier fallback (Groth16 → Stone STARK → Mock). **Primary improvement areas**: missing ONNX/deep-learning integration, no recursive proof composition, limited real-time market data feeding, and several deployable-but-unused circuits that need backend wiring.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                       │
│  ProofTimeline.tsx  ReceiptTimeline.tsx  PerformanceDashboard   │
│       ↕ API calls                                                │
├─────────────────────────────────────────────────────────────────┤
│                      BACKEND (FastAPI/Python)                    │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ zkml_proof_service│  │  proof_pipeline   │  │ receipt_service│ │
│  │  (orchestrator)   │  │  (unified coord)  │  │ (audit trail) │ │
│  └────────┬─────────┘  └────────┬─────────┘  └───────────────┘ │
│           │                      │                                │
│  ┌────────▼─────────┐  ┌────────▼─────────┐                     │
│  │ zkml_risk_service │  │zkml_anomaly_svc  │                     │
│  │ (witness gen +    │  │ (witness gen +   │                     │
│  │  snarkjs invoke)  │  │  snarkjs invoke) │                     │
│  └────────┬─────────┘  └────────┬─────────┘                     │
│           │                      │                                │
│  ┌────────▼──────────────────────▼─────────┐                     │
│  │         circuit_scanner.py               │                     │
│  │  Unified runner for all 8+ circuits      │                     │
│  │  (parallel async, snarkjs subprocess)    │                     │
│  └────────┬────────────────────────────────┘                     │
│           │                                                       │
│  ┌────────▼─────────┐                                            │
│  │ garaga_formatter  │ → garaga_calldata.mjs (Node.js)           │
│  │ (Python→Node.js)  │   Uses `garaga` npm v1.0.1               │
│  └──────────────────┘                                            │
├─────────────────────────────────────────────────────────────────┤
│                    CIRCOM CIRCUITS (15 total)                     │
│  ML/Scoring:     RiskScore, AnomalyDetector, CorrelationRisk,   │
│                  TWAPPosition, SafetyDiversification             │
│  Merkle/Privacy: BalanceAboveThreshold, PoolMembership,         │
│                  TenureAboveThreshold                            │
│  Transactional:  FullPrivacyWithdraw, FullPrivacyWithdrawHashed,│
│                  FullPrivacyWithdrawWithChange,                  │
│                  PrivateDeposit, PrivateWithdraw                 │
│  Credit:         CreditEligibility                               │
├─────────────────────────────────────────────────────────────────┤
│                  STARKNET (Cairo Contracts)                       │
│  zkml_verifier.cairo        → Groth16 verification via Garaga   │
│  cairo_perceptron.cairo     → On-chain ML gatekeeper            │
│  validation_proof_registry  → ERC-8004 proof catalog            │
│  model_registry.cairo       → On-chain model directory          │
│  Garaga groth16_verifier    → Generated BN254 pairing check     │
│  + shielded_pool, hashed_withdraw_pool, fully_shielded_pool     │
│  + batch_verifier, proof_gated_lp_agent, etc.                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Circuit Inventory

### 3A. ML/Scoring Circuits (Circom → Groth16)

| # | Circuit | File | Constraints | Purpose |
|---|---------|------|-------------|---------|
| 1 | **RiskScore** | `circuits/RiskScore.circom` | ~120 | Prove portfolio risk ≤ threshold without revealing score, features, or model weights |
| 2 | **AnomalyDetector** | `circuits/AnomalyDetector.circom` | ~140 | Prove pool/protocol is safe across 6 risk factors without revealing analysis |
| 3 | **CorrelationRisk** | `circuits/CorrelationRisk.circom` | ~166 | Prove portfolio correlation ≤ threshold without revealing positions or corr matrix |
| 4 | **TWAPPosition** | `circuits/TWAPPosition.circom` | ~79 | Prove 7-day TWAP ≤ threshold without revealing daily positions |
| 5 | **SafetyDiversification** | `circuits/SafetyDiversification.circom` | ~160 | Prove portfolio is diversified (Herfindahl-adjusted) across safety-rated protocols |

### 3B. Privacy/Merkle Selective Disclosure Circuits

| # | Circuit | File | Merkle Depth | Purpose |
|---|---------|------|-------------|---------|
| 6 | **BalanceAboveThreshold** | `circuits/BalanceAboveThreshold.circom` | 20 | Prove "balance > X" without revealing exact balance or identity |
| 7 | **PoolMembership** | `circuits/PoolMembership.circom` | 20 | Prove "I'm in pool X" without revealing balance or commitment |
| 8 | **TenureAboveThreshold** | `circuits/TenureAboveThreshold.circom` | 20 | Prove "position age ≥ X blocks" without revealing creation time |

### 3C. Transactional Privacy Circuits

| # | Circuit | File | Purpose |
|---|---------|------|---------|
| 9 | **FullPrivacyWithdraw** | `circuits/FullPrivacyWithdraw.circom` | Full Tornado-style withdraw: Merkle proof + nullifier + amount ≤ balance |
| 10 | **FullPrivacyWithdrawHashed** | `circuits/FullPrivacyWithdrawHashed.circom` | Same + claim hash hiding recipient until reveal |
| 11 | **FullPrivacyWithdrawWithChange** | `circuits/FullPrivacyWithdrawWithChange.circom` | Partial withdraw: exact split into withdraw + change commitment |
| 12 | **PrivateDeposit** | `circuits/PrivateDeposit.circom` | Simple: prove balance ≥ amount, output Poseidon commitment |
| 13 | **PrivateWithdraw** | `circuits/PrivateWithdraw.circom` | Simple: commitment ownership + sufficient balance + nullifier |
| 14 | **CreditEligibility** | `circuits/CreditEligibility.circom` | Prove credit_score ≥ min AND collateral ≥ min (Poseidon commitment binding) |

### 3D. Cairo Contracts & Infrastructure

| # | Contract/Tool | File | Purpose |
|---|--------------|------|---------|
| 15 | **ZkmlVerifier** | `contracts/src/zkml_verifier.cairo` | On-chain Groth16 verification via Garaga dispatcher. Stores proof records. |
| 16 | **CairoPerceptron** | `contracts/src/cairo_perceptron.cairo` | Tier 0 on-chain single-layer perceptron (~10k gas gatekeeper) |
| 17 | **ValidationProofRegistry** | `contracts/src/validation_proof_registry.cairo` | ERC-8004-aligned proof catalog with multi-index discovery |
| 18 | **ModelRegistry** | `contracts/src/model_registry.cairo` | On-chain zkML model directory with type indexes |
| 19 | **Garaga Groth16VerifierBN254** | `circuits/build/garaga_verifier/src/groth16_verifier.cairo` | Generated Garaga v1.0.1 BN254 pairing check (MSM + multi-pairing) |
| 20 | **garaga_calldata.mjs** | `circuits/garaga_calldata.mjs` | Node.js bridge: snarkjs proof → Garaga calldata format |
| 21 | **garaga_formatter.py** | `backend/app/services/garaga_formatter.py` | Python wrapper invoking garaga_calldata.mjs via subprocess |

---

## 4. Detailed Circuit Breakdowns

### 4.1 RiskScore Circuit
**File**: `circuits/RiskScore.circom` (120 lines)  
**Category**: ML/Scoring  
**Template**: `RiskScoreModel(N_FEATURES=8)` + `RiskScoreVerifier()`

**How it works:**
1. Takes 8 portfolio features (balance, concentration, diversity, volatility, liquidity, time, drawdown, correlation) as **private** inputs
2. Takes model weights (8) and bias as **private** inputs — protects ML model IP
3. Computes `weighted_sum = Σ(feature_i × weight_i) + bias`
4. Verifies `actual_score = weighted_sum / scale` (integer division with rounding tolerance)
5. Checks `actual_score ≤ threshold` (public)
6. Outputs `is_compliant` (boolean) and `public_commitment` (anti-replay)

**Public signals**: `threshold, scale, user_address, commitment_hash`  
**Why here**: This is the **primary gate** for every LP allocation. Before the agent moves funds, it must prove the risk score for the target pool/position is acceptable. Keeping the model weights private prevents MEV bots from reverse-engineering the agent's allocation strategy.

**Backend integration**: `zkml_risk_service.py` → `RiskScoreModel.compute_risk_score()` mirrors the circuit's weighted sum computation exactly, then generates witness input and invokes snarkjs via `circuit_scanner.py`.

---

### 4.2 AnomalyDetector Circuit
**File**: `circuits/AnomalyDetector.circom` (135 lines)  
**Category**: ML/Scoring  
**Template**: `AnomalyScorer(N_FACTORS=6)` + `AnomalyDetectorVerifier()`

**How it works:**
1. Takes 6 risk factors as **private**: TVL volatility, liquidity concentration, price impact, deployer age, volume anomaly, contract risk
2. Takes per-factor weights and thresholds as **private** (model parameters)
3. Each factor checked against its threshold via `SafetyCheck` sub-template
4. Failed checks contribute weighted penalty: `penalty_i = (1 - pass_i) × weight_i`
5. Total anomaly score = sum of penalties
6. `is_safe = (total_anomaly_score < max_anomaly_score)`

**Public signals**: `max_anomaly_score, pool_id, user_address, commitment_hash`  
**Why here**: Runs **before any deposit into a new pool**. Detects rug pulls, liquidity manipulation, and suspicious volume patterns. The scoring model stays private so attackers can't game individual factor thresholds.

**Backend integration**: `zkml_anomaly_service.py` → `AnomalyDetectionModel.analyze_pool()` mirrors the circuit's penalty logic, generates witness, invokes snarkjs.

---

### 4.3 CorrelationRisk Circuit
**File**: `circuits/CorrelationRisk.circom` (166 lines)  
**Category**: ML/Scoring  
**Template**: `CorrelationModel(N_ASSETS=5)` + `CorrelationRiskVerifier()`

**How it works:**
1. Takes positions array (5 assets) and full correlation matrix (5×5) as **private**
2. Computes weighted correlation: `Σ Σ (pos_i × pos_j × corr[i][j])`
3. Normalizes by `total_position²`
4. Verifies `actual_correlation` matches computation (within integer rounding)
5. Checks `correlation ≤ threshold` (public)

**Example**: 60% ETH + 40% wstETH → correlation = 97.6 (fails 70 threshold)  
**Public signals**: `threshold, scale, user_address, commitment_hash`  
**Why here**: Prevents **fake diversification**. Users or agents might claim portfolio diversity while actually holding highly correlated assets (ETH/wstETH, USDC/DAI). This circuit is the mathematical proof that real diversification exists.

---

### 4.4 TWAPPosition Circuit
**File**: `circuits/TWAPPosition.circom` (79 lines)  
**Category**: ML/Scoring  
**Template**: `TWAPModel(N_DAYS=7)` + `TWAPPositionVerifier()`

**How it works:**
1. Takes 7 daily position values as **private**
2. Computes sum, verifies `actual_twap = sum / 7` (with rounding)
3. Checks `actual_twap ≤ threshold`

**Public signals**: `threshold, scale, user_address, commitment_hash`  
**Why here**: Used by the **rebalancing engine** to prove that time-weighted exposure hasn't exceeded risk limits. Prevents flash-concentration attacks where a user briefly holds a massive single-asset position.

---

### 4.5 SafetyDiversification Circuit
**File**: `circuits/SafetyDiversification.circom` (160 lines)  
**Category**: ML/Scoring  
**Template**: `DiversificationModel(N_PROTOCOLS=6)` + `SafetyDiversificationVerifier()`

**How it works:**
1. Takes per-protocol allocations as **private**, safety scores (0-100) as **public**
2. Computes weighted safety: `Σ(allocation_i × safety_score_i) / total_allocation`
3. Computes Herfindahl-Hirschman Index (HHI): `Σ(allocation_i²) / total²` (measures concentration)
4. Diversification score = safety-weighted, HHI-adjusted metric
5. Checks `actual_score ≥ threshold`

**Example protocols**: JediSwap(85), Ekubo(90), zkLend(80), Nostra(75), Haiko(70), Other(50)  
**Public signals**: `safety_scores[], threshold, scale, user_address, commitment_hash`  
**Why here**: Ensures the agent doesn't concentrate all capital in a single protocol (even a "safe" one). The HHI adjustment penalizes concentration even when safety-weighted scores look good.

---

### 4.6 BalanceAboveThreshold Circuit
**File**: `circuits/BalanceAboveThreshold.circom` (109 lines)  
**Category**: Merkle/Privacy (Selective Disclosure)  
**Template**: `BalanceAboveThreshold(merkleLevels=20)`

**How it works:**
1. Computes commitment = `Poseidon(userSecret, amount, poolType, nonce, blinding)`
2. Verifies Merkle membership of commitment in tree with **public** root
3. Proves `amount > threshold` using `GreaterThan(252)` comparator
4. Never reveals: exact amount, commitment identity, pool type

**Public inputs**: `root, threshold`  
**Why here**: Used for **DeFi credit/reputation** — "prove you have > $10k deposited without revealing your actual balance." Enables tiered access to features, lower fees for larger depositors, and cross-protocol reputation.

---

### 4.7 PoolMembership Circuit
**File**: `circuits/PoolMembership.circom` (108 lines)  
**Category**: Merkle/Privacy (Selective Disclosure)

**How it works:**
1. Creates and verifies commitment in Merkle tree
2. Proves `claimedPool === actual poolType` via equality constraint
3. Hides: balance, commitment identity

**Public inputs**: `root, claimedPool`  
**Why here**: Enables **cross-protocol attestation** — "prove you're an Aggressive pool participant" to get access to high-risk strategies on another protocol. Foundation for reputation composability.

---

### 4.8 TenureAboveThreshold Circuit
**File**: `circuits/TenureAboveThreshold.circom` (118 lines)  
**Category**: Merkle/Privacy (Selective Disclosure)

**How it works:**
1. Uses `CommitmentWithTimestampHasher` (includes `creationBlock` in Poseidon hash)
2. Verifies Merkle membership
3. Proves `creationBlock ≤ currentBlock - minBlocks` (tenure check)

**Public inputs**: `root, minBlocks, currentBlock`  
**Why here**: Rewards **long-term participants** without revealing their exact entry time. Used for tier upgrades and loyalty rewards.

---

### 4.9-4.11 Full Privacy Withdraw Circuits
Three evolution stages of the withdrawal circuit:

| Version | Key Addition | Public Outputs |
|---------|-------------|----------------|
| **FullPrivacyWithdraw** | Core: Merkle + nullifier + amount ≤ balance + pool match | root, nullifier, recipient, withdrawAmount, poolType |
| **FullPrivacyWithdrawHashed** | + `claimHash = Poseidon(recipient, amount, salt)` → hides recipient until claim | root, nullifier, claimHash, poolType |
| **FullPrivacyWithdrawWithChange** | + change output → exact split (withdraw + redeposit remainder) | root, nullifier, recipient, withdrawAmount, changeAmount, changeCommitment, poolType |

**Architecture**: All use 20-level Merkle tree (supports ~1M deposits), Poseidon(5) commitments, Poseidon(2) nullifiers.

**Why three versions**: Progressive enhancement. V1 exposed recipient on-chain. V2 hid it behind `claimHash`. V3 added UTXO-style change outputs for partial withdrawals without full re-deposit flows.

---

### 4.12-4.13 Simple Private Deposit/Withdraw
**PrivateDeposit**: Minimal circuit — proves `balance ≥ amount`, outputs `Poseidon(amount, nonce)` commitment.  
**PrivateWithdraw**: Proves commitment ownership (`Poseidon(balance, nonce) == commitment_public`), sufficient balance, outputs nullifier.

**Why here**: These are the **v1 circuits** for basic confidential transfer support. Simpler than the full Merkle variants but sufficient for the initial shielded pool implementation.

---

### 4.14 CreditEligibility Circuit
**File**: `circuits/CreditEligibility.circom` (53 lines)  
**Purpose**: Prove `credit_score ≥ min` AND `collateral ≥ min` without revealing exact values.

**How it works:**
1. Commitment binding: `hasher = Poseidon(3)(credit_score, collateral_wei, blinding)`
2. Verify commitment equals public `commitment_hash`
3. `GreaterEqThan(32)` for score check, `GreaterEqThan(128)` for collateral check
4. `eligible = score_check.out × collateral_check.out` (boolean AND)
5. Hard constraint: `eligible === 1`

**Why here**: Gateway for **lending/borrowing** features. Users prove creditworthiness without revealing their exact score or collateral amount. Links to the identity/onboarding system.

---

### 4.15 CairoPerceptron (On-Chain ML)
**File**: `contracts/src/cairo_perceptron.cairo` (279 lines)  
**Purpose**: Tier 0 on-chain gatekeeper — single-layer perceptron at ~10k gas.

**How it works:**
1. Stores pre-trained weights (up to 8), bias, and threshold in contract storage
2. `predict(inputs)`: computes `weighted_sum = Σ(input_i × weight_i) + bias`
3. Returns `sum_u256 > threshold_u256`
4. `predict_and_log()`: same but emits event + updates pass/fail statistics
5. `update_weights()`: admin can retrain by updating weights on-chain

**Why here**: Runs **before** expensive Groth16 proofs. If the perceptron rejects an action (obviously bad input), no need to spend gas on proof generation + verification. Think of it as a cheap email spam filter before the full malware scanner.

**Stats tracking**: `total_predictions`, `total_passes`, `total_fails` — provides on-chain model performance monitoring.

---

### 4.16 ZkmlVerifier Cairo Contract
**File**: `contracts/src/zkml_verifier.cairo` (284 lines)  
**Purpose**: On-chain Groth16 proof verification through Garaga.

**Functions:**
- `verify_risk_score_proof()` → calls Garaga, stores `ZkmlProofRecord`, emits `RiskScoreVerified`
- `verify_anomaly_proof()` → same for anomaly proofs, includes `pool_id`
- `verify_combined_proofs()` → verifies BOTH risk + anomaly in one tx (both must pass)

**Storage**: `proof_records` (by commitment_hash), `verified_proofs` (quick lookup), `user_proof_count` + `user_proofs` (per-user indexing)

---

### 4.17 ValidationProofRegistry — AI Verifiability Middleware
**File**: `contracts/src/validation_proof_registry.cairo` (401 lines)  
**Purpose**: The trust bridge between off-chain AI computation and on-chain execution.

The proof registry is the most architecturally significant contract in the system. It enables a new pattern: any smart contract can query whether an AI agent's claim is backed by verified computation before allowing that agent to act. This transforms AI agents from "trust me" black boxes into verifiable entities with cryptographic evidence of their computations.

**What it enables:**
- **AI agents** → generate proofs and build verifiable track records
- **Smart contracts** → query `is_proof_valid(fact_hash)` before authorizing capital movement
- **Cross-agent trust** → agents can verify each other's proof history via ERC-8004 discovery
- **Computation oracles** → external protocols can consume proven risk/anomaly/yield signals

**Key features:**
- Multi-proof-type support: `groth16`, `risc_zero`, `stark`
- Multi-action-type: `deposit`, `withdraw`, `rebalance`, `init`
- Rich indexing: by agent, by type, by action, recent (circular buffer of 100)
- Authorized verifier system
- Batch registration

---

### 4.18 ModelRegistry
**File**: `contracts/src/model_registry.cairo` (200 lines)  
**Purpose**: Directory of registered zkML models.

**Features**: Register models with `name, type, verifier_address, fee_bps`. Query by type. Activate/deactivate. Poseidon-hashed unique IDs.

---

## 5. Proof Generation Pipeline

### Full Flow: User Action → On-Chain Verification

```
1. User triggers action (deposit/withdraw/rebalance) via frontend
       ↓
2. Backend receives request
       ↓
3. zkml_proof_service.py orchestrates proof generation
       ↓
4. Priority cascade:
   a. circuit_scanner.py → parallel snarkjs Groth16 proof generation
      - Writes witness input JSON to temp file
      - Spawns: node generate_witness.js <wasm> <input.json> <witness.wtns>
      - Spawns: snarkjs groth16 prove <zkey> <witness.wtns> <proof.json> <public.json>
      - Returns proof_hash, public_signals, is_compliant
       ↓
   b. If (a) fails → StoneProverClient (STARK proof via Obsqra API)
       ↓
   c. If (b) fails → Mock proof (dev only, synthetic hash)
       ↓
5. garaga_formatter.py converts snarkjs proof → Garaga calldata
   - Invokes garaga_calldata.mjs (Node.js) with proof.json + public.json + vkey.json
   - garaga npm package generates MSM hints + pairing precomputation
   - Returns ~2000 felt252 calldata entries
       ↓
6. On-chain submission:
   - zkml_verifier.cairo receives calldata
   - Dispatches to Garaga Groth16VerifierBN254
   - Garaga performs BN254 pairing check via ECIP ops
   - If valid: stores ZkmlProofRecord, emits event
   - validation_proof_registry registers proof for ERC-8004 discovery
       ↓
7. receipt_service.py creates local receipt
   - Links proof_hash, action_type, timestamp
   - Persists to data/orchestration_receipts.json
       ↓
8. Frontend displays in ProofTimeline / ReceiptTimeline components
```

### Circuit Scanner Architecture

The `circuit_scanner.py` is the central nervous system:
- **Registry**: 8 circuits with paths to `.wasm`, `.zkey`, and `generate_witness.js`
- **Parallel execution**: `asyncio.gather()` runs multiple circuits concurrently
- **Default input builders**: Each ML circuit has a dedicated builder function (`build_risk_score_inputs`, `build_anomaly_detector_inputs`, etc.)
- **Merkle circuits**: Skipped unless explicit inputs provided (need real Merkle proofs)
- **Result aggregation**: Each circuit result includes `success`, `is_compliant`, `proof_hash`, `duration_ms`

---

## 6. Architectural Placement Rationale

### Why Circom for ML Circuits (not pure Cairo)?

1. **Groth16 proofs are succinct** (~128 bytes) and **constant-time to verify** on-chain. Cairo STARKs scale linearly with computation size.
2. **BN254 pairing check via Garaga** is highly optimized for Starknet — precomputed lines, MSM batching
3. **snarkjs ecosystem** provides trusted setup, Powers of Tau, and battle-tested prover
4. **Privacy**: Circom circuits keep ALL inputs private by default. Cairo programs expose their execution trace.

### Why CairoPerceptron On-Chain?

1. **10k gas** vs **~500k gas** for full Groth16 verification — 50× cheaper as a pre-filter
2. **No prover needed** — executes directly in EVM-equivalent transaction
3. **Admin-updatable weights** — model can be retrained without redeploying circuits
4. **Defense-in-depth**: Even if the off-chain prover is compromised, the on-chain perceptron catches obvious outliers

### Why Three Withdraw Circuit Versions?

Evolutionary design pattern:
- **V1 (FullPrivacyWithdraw)**: MVP — functional but recipient visible on-chain
- **V2 (FullPrivacyWithdrawHashed)**: Added `claimHash` to hide recipient until reveal (commit-reveal pattern)
- **V3 (FullPrivacyWithdrawWithChange)**: Added UTXO-style change outputs, eliminating the "withdraw all then re-deposit difference" pattern that doubled gas costs

### Why Separate ValidationProofRegistry from ZkmlVerifier?

**Separation of concerns**: ZkmlVerifier handles the cryptographic verification (Garaga calls). ValidationProofRegistry is the **discovery and attestation layer** — it doesn't care HOW a proof was verified, just that it WAS. This enables:
- Multiple verifier types (Groth16, RISC Zero, STARK) coexisting
- Cross-agent proof discovery (ERC-8004 compliance)
- Proof invalidation without re-verifying

---

## 7. Current Gaps & Improvement Opportunities

### 7.1 Missing ONNX/Deep Learning Integration
**Current state**: All ML circuits use simple weighted-sum (perceptron-level) models. The code comments say "Can be replaced with actual ML model (ONNX, scikit-learn)" but no ONNX integration exists.

**Improvement**: Implement ONNX-to-Circom compilation for depth-2 or depth-3 neural networks. EZKL or Giza frameworks can convert ONNX models to R1CS circuits. This would enable:
- Non-linear risk scoring (ReLU activations)
- Learned anomaly detection (autoencoder latent space thresholding)
- Multi-layer portfolio optimization

### 7.2 No Recursive Proof Composition
**Current state**: Each proof is independently verified. `verify_combined_proofs` just calls Garaga twice.

**Improvement**: Implement Nova/Protogalaxy-style recursive composition:
- Fold multiple circuit proofs into one (risk + anomaly + correlation → single proof)
- ~3× gas savings on combined verification
- Enables "proof chains" where each rebalance builds on the previous proof

### 7.3 Merkle Circuits Not Backend-Wired
**Current state**: `circuit_scanner.py` skips `BalanceAboveThreshold`, `PoolMembership`, `TenureAboveThreshold` unless explicit Merkle inputs are provided. No backend service generates these inputs.

**Improvement**: Build a `MerkleProofService` that:
- Maintains off-chain Merkle tree state synced with on-chain `shielded_pool` / `fully_shielded_pool` contracts
- Auto-generates Merkle proofs for selective disclosure requests
- Wire into the circuit scanner as default builders

### 7.4 CairoPerceptron Not Wired to Proof Pipeline
**Current state**: The perceptron contract exists on-chain but isn't called as a pre-filter before Groth16 proofs in the backend pipeline.

**Improvement**: Add a pre-check step in `proof_pipeline.py`:
```python
# Before generating expensive Groth16 proof:
if not await cairo_perceptron.predict(feature_vector):
    return {"can_execute": False, "reason": "perceptron_reject", "gas_saved": "~500k"}
```

### 7.5 Stale Mock Fallback for Production
**Current state**: All proof services fall back to mock mode (SHA-256 hash) if Groth16 and Stone both fail. In production, this creates unverifiable "proofs."

**Improvement**: 
- Remove mock fallback for production builds (`ZKDEFI_ENV=production`)
- Add circuit compilation status to health check endpoint
- Alert on fallback activation

### 7.6 Missing Proof Expiration
**Current state**: Proofs stored forever. No TTL or staleness concept.

**Improvement**: Add `expires_at` to `ZkmlProofRecord` and `ProofRecord`. Risk conditions change — a proof from 24 hours ago may not reflect current market conditions. Implement:
- Configurable TTL per proof type (risk: 1h, anomaly: 6h, credit: 30d)
- Auto-invalidation job
- Freshness check in `is_proof_verified`

### 7.7 No On-Chain Model Versioning
**Current state**: `ModelRegistry` stores models but no version chain. When weights change, the old model ID becomes stale.

**Improvement**: Add `version`, `parent_model_id`, and `weight_hash` fields:
```cairo
pub struct Model {
    // ... existing fields ...
    version: u32,
    parent_model_id: felt252,
    weight_hash: felt252,  // Poseidon hash of model weights
}
```

### 7.8 Duplicated MerkleTreeChecker
**Current state**: The MerkleTreeChecker template is copy-pasted in 6 different circuit files.

**Improvement**: Extract to `circuits/lib/MerkleTreeChecker.circom` and include it. Reduces maintenance burden and ensures consistent behavior.

---

## 8. New Circuits for More Intelligent Data

### 8.1 🆕 ImpermanentLossPredictor Circuit
**Purpose**: Prove predicted IL ≤ user's max tolerance without revealing position details.

```
Private: position_size, entry_price, current_price, pool_fee_rate, predicted_price_range
Public: max_il_tolerance, time_horizon
Output: is_acceptable (boolean)
```

**Value**: The agent can prove it's not putting users into positions with unacceptable IL risk. Use a polynomial approximation of the IL formula inside the circuit.

### 8.2 🆕 YieldOptimality Circuit
**Purpose**: Prove that the chosen allocation is within ε of the optimal allocation from the agent's model.

```
Private: allocation_vector, model_predicted_yields[], historical_volatilities[]
Public: optimality_threshold (e.g., "within 5% of best")
Output: is_near_optimal (boolean)
```

**Value**: Users gain confidence that the agent isn't just randomly allocating — it's provably near-optimal. Agents can justify their rebalancing decisions.

### 8.3 🆕 SlippageBound Circuit
**Purpose**: Prove that expected slippage for a trade ≤ max_slippage without revealing trade size.

```
Private: trade_amount, current_liquidity, price_impact_model_params
Public: max_slippage_bps
Output: is_within_slippage (boolean)
```

**Value**: Critical for large rebalances. Users know the agent won't execute trades with excessive slippage.

### 8.4 🆕 AgentReputationScore Circuit
**Purpose**: Prove an agent's composite reputation score ≥ threshold across multiple dimensions.

```
Private: total_volume, successful_rebalances, failed_rebalances, avg_return, max_drawdown
Public: min_reputation_score
Output: is_reputable (boolean)
```

**Value**: Enables trustless agent selection. Users can verify an agent meets minimum performance standards without the agent revealing its full track record.

### 8.5 🆕 CrossProtocolArbitrage Circuit
**Purpose**: Prove that a cross-protocol rebalance is profitable (net of fees) without revealing the specific opportunity.

```
Private: source_price, dest_price, source_fees, dest_fees, gas_estimate, amount
Public: min_profit_bps
Output: is_profitable (boolean)
```

**Value**: The agent can justify why it moved funds between protocols — there was a provable profit opportunity – without revealing the exact spread (which would invite front-running).

### 8.6 🆕 LiquidationRisk Circuit
**Purpose**: Prove that a lending position's health factor > minimum without revealing exact collateral/debt ratios.

```
Private: collateral_value, debt_value, oracle_prices[], liquidation_threshold
Public: min_health_factor
Output: is_healthy (boolean)
```

**Value**: For lending integration — prove position safety without revealing leverage.

### 8.7 🆕 HistoricalPerformanceAttestation Circuit
**Purpose**: Prove that historical returns over N periods have mean ≥ X and drawdown ≤ Y, without revealing the actual return series.

```
Private: period_returns[N], balances[N]
Public: min_mean_return, max_drawdown_pct, num_periods
Output: meets_criteria (boolean)
```

**Value**: Enables verifiable marketing claims. Agents can prove "average 12% APY with max 5% drawdown" without exposing their complete P&L history.

### 8.8 🆕 MEVResistanceProof Circuit
**Purpose**: Prove that a transaction was submitted through a private mempool or with MEV-protection parameters.

```
Private: submission_timestamp, block_inclusion_timestamp, relay_signature
Public: max_delay_blocks, relay_id
Output: is_mev_protected (boolean)
```

**Value**: Transparency about MEV protection for user transactions.

---

## 9. Recommendations Summary

### Immediate (Week 1-2)
1. **Wire CairoPerceptron as pre-filter** → saves ~500k gas per rejected action
2. **Disable mock fallback in production** → enforce real proofs
3. **Extract shared MerkleTreeChecker** → reduce code duplication
4. **Add proof expiration/TTL** → prevent stale proof reuse

### Short-Term (Week 3-4)
5. **Build MerkleProofService** → enable BalanceAboveThreshold, PoolMembership, TenureAboveThreshold in circuit scanner
6. **Add model versioning** → weight_hash + parent_model_id in ModelRegistry
7. **Implement ImpermanentLossPredictor circuit** → most impactful new circuit for user trust
8. **Add YieldOptimality circuit** → justifies agent allocation decisions

### Medium-Term (Month 2-3)
9. **ONNX-to-Circom pipeline via EZKL** → upgrade from perceptron to real neural networks
10. **Recursive proof composition** → fold risk + anomaly + correlation into single proof
11. **SlippageBound + LiquidationRisk circuits** → complete the lending integration privacy story
12. **AgentReputationScore circuit** → enable trustless agent marketplace

### Long-Term (Month 4+)
13. **HistoricalPerformanceAttestation** → verifiable agent marketing
14. **CrossProtocolArbitrage** → justify cross-protocol moves without leaking alpha
15. **MEVResistanceProof** → transparency about trade execution quality
16. **Full RISC Zero integration** → for circuits too complex for R1CS (tree-based ML models, transformers)

---

*Report covers 15 Circom circuits, 5 Cairo contracts, 7 backend services, 2 frontend components, and 1 bridge tool across the zkde.fi codebase.*
