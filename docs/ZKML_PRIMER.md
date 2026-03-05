# zkde.fi — Verifiable AI Infrastructure for DeFi

## A Technical Primer on Provable AI Agents, Zero-Knowledge Machine Learning, and On-Chain Proof Verification

> *Built on [Obsqra](https://obsqra.fi) — infrastructure for verifiable AI agents whose decisions are backed by cryptographic proofs of the computations that produced them.*

---

## Table of Contents

1. [The Core Concept](#1-the-core-concept)
2. [Why This Matters](#2-why-this-matters)
3. [Why Zero-Knowledge Proofs for ML?](#3-why-zero-knowledge-proofs-for-ml)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [The ML Models — What Gets Proven](#5-the-ml-models--what-gets-proven)
6. [From PyTorch to ZK Circuit — The EZKL Pipeline](#6-from-pytorch-to-zk-circuit--the-ezkl-pipeline)
7. [Cairo Contracts — On-Chain Verification](#7-cairo-contracts--on-chain-verification)
8. [Onyx and the LLM Layer](#8-onyx-and-the-llm-layer)
9. [Agent Trust Architecture — Guardrails and Constraints](#9-agent-trust-architecture--guardrails-and-constraints)
10. [How It All Connects — The Full Pipeline](#10-how-it-all-connects--the-full-pipeline)
11. [The Three Circuits in Detail](#11-the-three-circuits-in-detail)
12. [The Proof Registry — Verifiability Middleware](#12-the-proof-registry--verifiability-middleware)
13. [MEV Resistance — Commit-Reveal Execution](#13-mev-resistance--commit-reveal-execution)
14. [Security Model](#14-security-model)
15. [Current Limitations and How We Can Improve](#15-current-limitations-and-how-we-can-improve)
16. [Glossary](#16-glossary)

---

## 1. The Core Concept

Traditional DeFi protocols make decisions using code that runs on a server somewhere. You deposit funds, and an algorithm decides where to place your liquidity, what credit score to assign you, or whether a pool is safe. But here's the problem: **you have no way to verify that the algorithm actually ran, or that it ran on your real data, without trusting the operator.**

zkde.fi solves this by building **provable AI agents** — autonomous systems whose critical decisions are backed by cryptographic proofs of the computations that produced them. The architecture is:

```
AI Agent (LLM orchestration)
       │
       ▼
Provable Skill Modules (EZKL ML circuits)
       │
       ▼
Proof Registry (ERC-8004 on-chain catalog)
       │
       ▼
Smart Contracts (verify proofs before allowing DeFi operations)
```

Every time an ML model makes a decision that affects your funds — "this user's credit grade is AA," "this pool's yield is growing," "this pool has no anomalies" — the system generates a **cryptographic proof** that the model ran correctly on the exact inputs claimed. That proof can be:

- **Verified locally** by anyone, instantly
- **Submitted on-chain** to a Starknet smart contract
- **Checked by other smart contracts** before they allow DeFi operations to proceed (e.g., you cannot borrow without a valid credit proof attestation)
- **Accumulated into agent reputation** — a verifiable track record of correct computation

The result is not just "AI-powered DeFi." It's **verifiable AI-driven capital allocation infrastructure** — the first system where AI agents build cryptographic evidence for every decision they make.

---

## 2. Why This Matters

Traditional DeFi automation relies on opaque off-chain bots. A vault strategy bot might claim to run sophisticated risk analysis, but users have no way to verify that claim. The bot could be running a coin flip for all they know.

zkde.fi introduces a fundamentally different trust model:

| Traditional DeFi Bot | zkde.fi Provable Agent |
|---------------------|----------------------|
| "Trust me, I ran the analysis" | "Here's a cryptographic proof I ran the analysis" |
| Strategy is a black box | Every ML inference produces a verifiable proof |
| No audit trail | On-chain proof registry with full history |
| Operator can lie about inputs | Inputs are public in the proof's instances |
| No reputation system | Agent reputation built from verified proof count |

This enables:

- **Provable risk checks** — credit assessments backed by ZK proofs, not just API responses
- **Provable pool analysis** — yield forecasts and anomaly scans with cryptographic receipts
- **Auditable AI agents** — every decision an agent makes is traceable to a specific proof
- **Proof-gated DeFi operations** — smart contracts that refuse to execute without valid proof attestations
- **Agent reputation systems** — on-chain track records that can't be fabricated

### Obsqra Labs — The Framework Layer

zkde.fi is the first application built on the **Obsqra** framework for verifiable AI agents.

```
┌───────────────────────────────┐
│        Obsqra Labs            │
│  Verifiable AI Infrastructure │
└───────────────┬───────────────┘
                │
      Proof Infrastructure Layer
        ├─ EZKL model circuits
        ├─ Proof registry (ERC-8004)
        ├─ Verification contracts (Garaga)
        └─ Agent identity system
                │
          Agent Runtime
        ├─ LLM orchestration
        ├─ Skill execution
        ├─ Policy engine + constraint gates
        ├─ Proof generation + recording
        └─ Commit-reveal execution
                │
         Applications
        ├─ zkde.fi (DeFi capital allocation)
        ├─ Risk oracles
        ├─ Trading agents
        └─ Governance advisors
```

The separation is deliberate: **Obsqra** is the infrastructure for building any verifiable AI agent. **zkde.fi** is the flagship product — an AI-driven capital allocator for DeFi whose risk analysis and strategy signals are provably computed.

### Why This Matters

Traditional DeFi automation relies on opaque off-chain bots. zkde.fi introduces **verifiable AI agents** where critical decisions are backed by cryptographic proofs of the underlying computations. This enables:

- **Provable risk checks** — contracts verify risk scores before allowing capital deployment
- **Provable pool analysis** — anomaly detection produces evidence, not just assertions
- **Provable credit scoring** — creditworthiness grades come with mathematical proof of correctness
- **Auditable AI agents** — every skill invocation produces a proof recorded on-chain
- **Reputation systems for autonomous agents** — proof history builds verifiable track records

The broader implication: this is infrastructure for **computation oracles** — where oracle providers don't just report data, they prove the interpretation. Data oracles (Chainlink, Pyth) prove *what happened*. Computation oracles prove *what the data means*.

---

## 3. Why Zero-Knowledge Proofs for ML?

### The Problem with "Trust Me" AI

When an AI model says "this pool is safe" or "your credit score is 740," there are three things you might want to verify:

1. **Integrity**: Did the model actually run, or did the operator just make up the result?
2. **Correctness**: Did it run on the real inputs (my actual on-chain history), not fabricated ones?
3. **Model Identity**: Was it the specific model version I was told about, or a different one?

Traditional approaches fail here:
- **Trusted execution environments (TEEs)** trust hardware manufacturers
- **Optimistic verification** assumes honesty and only checks if someone complains
- **Open-sourcing the model** doesn't prove it ran on specific inputs

### The ZK Solution

A zero-knowledge proof says: *"I ran model X on input Y and got output Z, and here is a mathematical proof that this is correct. You can verify this proof in milliseconds without re-running the model."*

More specifically, we use a **KZG polynomial commitment scheme** (via EZKL) that proves:
- The exact ONNX model (identified by hash) was used
- The exact input data was fed in
- The output was computed correctly through every neuron and activation
- All of this in a proof that's only ~3 KB

---

## 4. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER / FRONTEND                         │
│  Next.js 14 │ /dashboard │ /proofs │ /mvp                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS
┌──────────────────────────────▼──────────────────────────────────┐
│                     PYTHON BACKEND (FastAPI)                     │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  ML Models   │  │  LLM (Onyx)  │  │  EZKL Prover Service  │  │
│  │              │  │              │  │                       │  │
│  │ Credit MLP   │  │ gpt-4o-mini  │  │ gen_witness           │  │
│  │ Yield MLP    │  │ Narration    │  │ prove                 │  │
│  │ Anomaly MLP  │  │ Allocation   │  │ verify                │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                 │                       │              │
│         └─────────────────┼───────────────────────┘              │
│                           │                                      │
│  ┌────────────────────────▼─────────────────────────────────┐   │
│  │               Proof Registry (SQLite)                     │   │
│  │  Tracks: proof_hash, model, user, verified, tx_hash       │   │
│  └──────────────────────────┬────────────────────────────────┘   │
└─────────────────────────────┼────────────────────────────────────┘
                              │ Starknet RPC (v3 invoke)
┌─────────────────────────────▼────────────────────────────────────┐
│                    STARKNET SEPOLIA CONTRACTS                     │
│                                                                   │
│  ┌─────────────────────────┐  ┌────────────────────────────────┐ │
│  │   ZkmlVerifier          │  │  ValidationProofRegistry       │ │
│  │   (Garaga BN254)        │  │  (ERC-8004 aligned)            │ │
│  │                         │  │                                │ │
│  │  verify_risk_score ──►  │  │  register_proof                │ │
│  │  verify_anomaly    ──►  │  │  get_proof_by_hash             │ │
│  │  verify_combined   ──►  │  │  get_agent_proofs              │ │
│  │  verify_model_bridge    │  │  has_proof / is_proof_valid     │ │
│  └─────────────────────────┘  └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

The system has four layers:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 14, React | UI for proof explorer, dashboard, vault |
| **Backend** | Python FastAPI, PyTorch, ONNX, EZKL | ML inference, proof generation, LLM orchestration |
| **Proof Registry** | SQLite + Starknet RPC | Local tracking + on-chain submission |
| **Smart Contracts** | Cairo (Starknet) | On-chain verification via Garaga BN254 |

---

## 5. The ML Models — What Gets Proven

We have three production ML models. Each is a **Multi-Layer Perceptron (MLP)** — a type of neural network made of only `Linear` and `ReLU` layers. This constraint is critical because EZKL can only generate ZK proofs for operations it knows how to arithmetize (more on this in Section 6).

### 5.1 Creditworthiness Model

**Purpose**: Assigns a credit grade to a wallet address based on its on-chain history.

| Property | Value |
|----------|-------|
| Architecture | Linear(18→64) → ReLU → Linear(64→32) → ReLU → Linear(32→5) |
| Input | 18 features (on-chain behavior: balances, tx count, DeFi positions, etc.) |
| Output | 5 classes: AAA, AA, A, B, C |
| Training Data | Synthetic (demonstrates proof pipeline; real-world training planned) |
| ONNX Size | 14.6 KB |
| Proof Size | ~3 KB |
| Prove Time | ~2 seconds |

**How it's used**: When a user requests a credit assessment (`/api/v1/zkdefi/risk_profile/v2/{address}`), the model runs their on-chain features through the MLP, produces a grade, and generates an EZKL proof that the grade was computed correctly. That proof hash is returned to the frontend and stored in the proof registry.

### 5.2 Yield Forecast Model

**Purpose**: Predicts the yield trajectory of a DeFi liquidity pool.

| Property | Value |
|----------|-------|
| Architecture | Linear(12→32) → ReLU → Linear(32→16) → ReLU → Linear(16→4) |
| Input | 12 features (TVL, volume, APR metrics, utilization, tick concentration) |
| Output | 4 classes: declining, stable, growing, surging |
| Training Data | Synthetic (demonstrates proof pipeline; real-world training planned) |
| ONNX Size | 4.9 KB |
| Proof Size | ~3 KB |
| Prove Time | ~1.8 seconds |

**How it's used**: Before the system allocates liquidity to a pool, it runs the yield forecast. The proof guarantees the system actually analyzed the pool's metrics and didn't just pick a pool arbitrarily.

### 5.3 Anomaly Detector Model

**Purpose**: Classifies whether a DeFi pool is safe, suspicious, or dangerous.

| Property | Value |
|----------|-------|
| Architecture | Linear(8→24) → ReLU → Linear(24→12) → ReLU → Linear(12→3) |
| Input | 8 features (TVL stability, price impact, deployer reputation, withdrawal patterns) |
| Output | 3 classes: safe, warning, critical |
| Training Data | Synthetic (demonstrates proof pipeline; real-world training planned) |
| ONNX Size | 3.1 KB |
| Proof Size | ~3 KB |
| Prove Time | ~1.6 seconds |

**How it's used**: Before any capital is deployed to a pool, the anomaly detector scans it. If the classification is "critical," the system refuses to deploy. The proof is evidence that the safety check actually ran.

### Why MLPs and Not Transformers?

EZKL needs to convert every operation in a neural network into arithmetic constraints (polynomials over a finite field). Operations like `Linear` (matrix multiply + add) and `ReLU` (max(0, x)) are straightforward to express as polynomials.

Operations common in larger models — attention mechanisms, layer normalization, softmax, tree ensembles — are either unsupported or produce circuits so large that proving takes minutes or hours. By constraining ourselves to `Linear + ReLU` only, we achieve:

- Proof generation in < 2 seconds
- Proof size of ~3 KB
- Circuit size of 2^15 (32,768) rows — manageable for real-time operation

### 5.4 Training Data Status

All three models are currently trained on **synthetic data** — 200 samples per model, generated with `np.random.seed(42)` for reproducibility. Labels are assigned by heuristic scoring rules, not ground truth classifications.

This is intentional for the current phase. The purpose of the synthetic models is to **validate the ZK proof pipeline end-to-end**: confirm that EZKL can compile, prove, and verify real neural network inference, and that proofs flow correctly through the registry to on-chain contracts.

The models demonstrate the complete proof lifecycle. Real-world training on mainnet data (Starknet wallet histories, Ekubo pool metrics, historical exploit patterns) is the next milestone — see Section 15.

> **Note on proof size**: All three models produce ~3 KB proofs. The proof size is determined by the KZG polynomial commitment parameters and SRS configuration, not model complexity. All models share the same proof system parameters (logrows=15). Circom/Groth16 proofs for other circuits may differ.

---

## 6. From PyTorch to ZK Circuit — The EZKL Pipeline

This section explains the most complex part of the system: how a regular neural network becomes a zero-knowledge circuit.

### 6.1 The Pipeline Steps

```
 PyTorch Model (.pt)
       │
       ▼
 ① ONNX Export (opset 13)          ← torch.onnx.export()
       │
       ▼
 ② Generate Settings               ← ezkl.gen_settings()
       │                              Determines quantization strategy
       ▼
 ③ Calibrate Settings              ← ezkl.calibrate_settings()
       │                              Uses sample data to pick optimal scales
       ▼
 ④ Download SRS                    ← ezkl.get_srs()
       │                              KZG structured reference string
       ▼
 ⑤ Compile Circuit                 ← ezkl.compile_circuit()
       │                              ONNX → arithmetic circuit
       ▼
 ⑥ Setup (Key Generation)          ← ezkl.setup()
       │                              Generates proving key + verification key
       ▼
 ⑦ Ready for Proofs
       │
       ├──► gen_witness(input)      ← Runs inference in the circuit
       ├──► prove(witness)          ← Generates ZK proof
       └──► verify(proof)           ← Checks proof validity
```

### 6.2 Step by Step

#### Step 1: ONNX Export

We train the model in PyTorch, then export it to [ONNX](https://onnx.ai) (Open Neural Network Exchange) format. ONNX is a standardized representation of neural network computation graphs.

**Why opset 13?** EZKL v23 supports specific ONNX operator versions. Opset 13 is the sweet spot — modern enough for our operations, old enough for full EZKL support. We also use `dynamo=False` (legacy TorchScript exporter) for maximum compatibility.

```python
torch.onnx.export(
    model, dummy_input, "model.onnx",
    opset_version=13,
    input_names=["input"],
    output_names=["output"],
    dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
)
```

#### Step 2: Generate Settings

EZKL analyzes the ONNX graph and generates a `settings.json` that describes how to convert each floating-point operation into operations over a *finite field* (integers modulo a large prime). Key parameters:

- **`input_scale`** (13): Floating-point inputs are multiplied by 2^13 = 8,192 and rounded to integers. This determines precision — higher scales mean more accurate quantization but larger circuits.
- **`param_scale`** (13): Same treatment for model weights.
- **`logrows`** (15): The circuit will have 2^15 = 32,768 rows in the constraint system.
- **`bits`** (16): Range check lookups use 16-bit tables.

#### Step 3: Calibrate Settings

Given representative input samples, EZKL automatically tunes the scales to minimize quantization error while keeping the circuit small. Our models achieve numerical fidelity with mean error < 0.001.

#### Step 4: Structured Reference String (SRS)

The KZG commitment scheme requires a "trusted setup" — a set of elliptic curve points generated from a secret that nobody should know. In practice, the SRS is a public parameter shared across all circuits of the same size.

Our models all use `logrows=15`, which requires a 4.2 MB SRS file (`kzg.srs`). This is downloaded once and reused.

**What is KZG?** Kate-Zaverucha-Goldberg is a polynomial commitment scheme. The prover commits to a polynomial (representing the circuit computation) and the verifier can check that commitment without seeing the full polynomial. This is the foundation of the proof system.

#### Step 5: Compile Circuit

EZKL converts the ONNX graph into a **Halo2 arithmetic circuit**. Every neural network operation becomes a set of polynomial constraints:

- **Linear layers** become matrix-vector multiplications over the finite field
- **ReLU** becomes a lookup table operation (is the value positive or negative?)
- **Addition and multiplication** are native field operations

The output is a `network.compiled` binary (21–115 KB depending on model complexity).

#### Step 6: Key Generation

The compiled circuit is used to generate two keys:

- **Proving Key (pk.key)**: ~132 MB. Contains everything the prover needs to create proofs. This stays on the server.
- **Verification Key (vk.key)**: ~65 KB. Contains everything needed to verify proofs. This can be published and used by anyone (including smart contracts).

The proving key is large because it encodes the full circuit structure pre-computed for fast proving. The verification key is small because verification only needs to check a few pairing equations.

#### Step 7: Proving and Verification

**Proving** (the expensive part, ~1.5–2s):
1. The prover feeds input data through the compiled circuit to produce a **witness** — the complete execution trace (every intermediate value).
2. The prover commits to the witness using KZG commitments.
3. The prover generates opening proofs that the commitments satisfy the circuit constraints.
4. The output is a **~3 KB proof** containing the KZG commitments and opening evaluations.

**Verification** (the cheap part, ~0.4s locally, milliseconds on-chain):
1. The verifier checks that the commitments in the proof are consistent with the verification key.
2. This involves a small number of elliptic curve pairing checks.
3. No re-execution of the neural network is needed.

### 6.3 Artifacts on Disk

For each model, the EZKL pipeline produces these files:

```
backend/app/data/ezkl_models/<model_name>/
├── <model_name>.onnx        # The exported neural network (3–15 KB)
├── settings.json             # Quantization and circuit parameters
├── calibration.json          # Representative input samples
├── network.compiled          # The arithmetic circuit (21–115 KB)
├── pk.key                    # Proving key (~132 MB)
├── vk.key                    # Verification key (~65 KB)
├── kzg.srs                   # Structured reference string (4.2 MB)
├── training_metadata.json    # Accuracy, loss, training config
└── norm_params.json          # Input normalization parameters
```

---

## 7. Cairo Contracts — On-Chain Verification

### 7.1 What is Cairo?

Cairo is the programming language for Starknet smart contracts. Unlike Solidity (Ethereum), Cairo compiles to a provable VM — every computation on Starknet is itself proven with a STARK proof. This makes Starknet a natural home for proof verification because the verification computation is itself verified by the L1.

### 7.2 The ZkmlVerifier Contract

The `ZkmlVerifier` is the on-chain entry point for verifying ZKML proofs. It delegates the heavy cryptographic verification to a **Garaga verifier** — a precompiled contract optimized for BN254 elliptic curve pairing operations (the curve used by our KZG proofs).

```
┌────────────────────────────────────────────┐
│            ZkmlVerifier Contract            │
│                                             │
│  verify_risk_score_proof(calldata, hash)    │
│         │                                   │
│         ▼                                   │
│  ┌──────────────────────┐                   │
│  │  Garaga BN254        │  ← Pairing check  │
│  │  verify_groth16()    │     on-chain       │
│  └──────────┬───────────┘                   │
│             │                               │
│      ┌──────▼──────┐                        │
│      │   Store     │  ← ZkmlProofRecord     │
│      │   Result    │     (type, user,        │
│      └─────────────┘      hash, valid, ts)   │
│                                             │
│  Events: RiskScoreVerified                  │
│          AnomalyProofVerified               │
│          CombinedProofsVerified             │
│          ModelBridgeVerified                │
└────────────────────────────────────────────┘
```

**Verification functions:**

| Function | Purpose | Inputs |
|----------|---------|--------|
| `verify_risk_score_proof` | Verify a creditworthiness proof | Proof calldata + commitment hash |
| `verify_anomaly_proof` | Verify a pool safety proof | Proof calldata + pool ID + commitment hash |
| `verify_combined_proofs` | Verify both risk + anomaly together | Two proof calldatas + pool ID |
| `verify_model_bridge_proof` | Verify an EZKL→Groth16 bridge proof | Proof + model hash + output commitment |
| `verify_robustness_certificate` | Verify model hasn't been tampered with | Proof + model hash + certificate hash |
| `verify_timing_proof` | Verify execution timing commitment | Proof + timing hash |

Each function:
1. Calls Garaga's `verify_groth16_proof_bn254()` with the raw proof data
2. Stores the result in a `ZkmlProofRecord` (proof type, user address, validity, timestamp)
3. Emits an event for off-chain indexing

### 7.3 The ValidationProofRegistry Contract

The `ValidationProofRegistry` is a **catalog of all verified proofs**, aligned with the ERC-8004 standard for Validation Proofs. It enables:

- **Proof Discovery**: Find all proofs for a specific agent, proof type, or action type
- **Trust Attestation**: Other contracts can check `is_proof_valid(fact_hash)` before allowing operations
- **Agent Reputation**: Track how many valid proofs an agent has generated

**Deployed at**: `0x20ea9a32eae3fe6fe5137ca9f576383f8723913e1619f17120cf1aeb7e06305` (Starknet Sepolia)

```cairo
struct ProofRecord {
    agent_id: felt252,         // Which AI agent generated this proof
    fact_hash: felt252,        // Hash of the proof (truncated to felt252)
    proof_type: felt252,       // 'ezkl_kzg', 'groth16', etc.
    action_type: felt252,      // 'credit_check', 'yield_estimate', 'anomaly_scan'
    verifier_address: ContractAddress,
    verified_at: u64,          // Block timestamp
    submitter: ContractAddress,
    is_valid: bool,
}
```

### 7.4 Other On-Chain Contracts

| Contract | Address (Sepolia) | Purpose |
|----------|-------------------|---------|
| `ValidationProofRegistry` | `0x20ea9a32…` | Proof catalog (ERC-8004) |
| `BatchVerifier` | `0x285f944a…` | Submit multiple proofs in one tx |
| `CreditEligibilityVerifier` | `0x037de8d0…` | Gate lending/borrowing on credit proof |
| `ReputationRegistry` | `0x10d00b33…` | Track agent proof counts + reputation |

---

## 8. Onyx and the LLM Layer

### 8.1 What is Onyx?

Onyx is the name we give to our **LLM provider routing system**. It's not a model — it's a registry that manages which Large Language Model (LLM) the system uses for "thinking" tasks. Currently, Onyx routes to **OpenAI's GPT-4o-mini** as the default backend.

### 8.2 Why Do We Need an LLM at All?

The ML models (CreditMLP, YieldForecastMLP, AnomalyDetectorMLP) are specialized classifiers — they answer specific numerical questions. But DeFi agents need to make **strategic decisions** that combine multiple signals:

- "Should I rebalance this position?"
- "Which three pools should I split liquidity across?"
- "Explain to the user why their credit grade dropped"

These require **reasoning**, not just classification. That's where the LLM comes in.

### 8.3 The LLM Provider Registry

The system supports multiple LLM providers with automatic failover:

```
Priority Order:
  1. Onyx (OpenAI-compatible endpoint)     ← Default
  2. OpenAI GPT (direct API)               ← Fallback #1
  3. Clawbot (custom DeFi model)           ← Specialist
  4. Local LLM (Ollama/vLLM)              ← Self-hosted
  5. Deterministic Fallback                ← Always works, no AI
```

**Key principle**: The system **never fails** because the LLM is down. If all AI providers are unavailable, the deterministic fallback uses rule-based logic (e.g., equal-weight allocation, score-based credit grades) to keep the system running. This decision is transparently reported to the user via `llm_provider_used` and `llm_fallback_reason`.

### 8.4 Where the LLM is Used

| Use Case | What the LLM Does | What Gets Proven |
|----------|--------------------|------------------|
| **Portfolio Allocation** | Decides weighted distribution across pools | Nothing — LLM output is advisory |
| **Agent Orchestration** | Chooses which ZK skills to execute | The skills themselves generate proofs |
| **Narration / Explain** | Generates human-readable explanations | Nothing — UI text only |
| **Risk Assessment** | Interprets ML model outputs in context | The ML inference is proven via EZKL |

**Important**: The LLM itself is **not** proven with ZK. It's too large (billions of parameters) and uses operations (attention, layer norm, softmax) that can't be efficiently arithmetized. Instead, the LLM is an **orchestrator** that decides which ZK-proven operations to run. The proofs cover the critical decisions (credit grade, pool safety, yield forecast), and the LLM provides the glue logic and natural language.

### 8.5 Identity Binding

Each AI agent in the system has an **identity-bound LLM configuration**:

```
Agent NFT (on-chain) ──► bound_llm_provider: "onyx"
                     ──► bound_model: "gpt-4o-mini"
                     ──► bound_skills: ["risk_check", "yield_analysis"]
                     ──► identity_commitment: 0x1a2b3c...
```

When an agent runs, only its bound LLM provider can be used for reasoning, and only its bound skills can generate proofs. This prevents an agent from being silently swapped to a different AI model.

---

## 9. Agent Trust Architecture — Guardrails and Constraints

The LLM is powerful but untrusted. It can hallucinate, be prompt-injected, or simply make poor decisions. The system addresses this with **four layers of constraint enforcement** that bound what agents can actually do — regardless of what the LLM suggests.

### 9.1 Policy Engine

The policy engine operates in two modes:

| Mode | Behavior |
|------|----------|
| **Gate** | Hard block — risk score AND anomaly check must pass before any rebalance is allowed. Pool stress check (volatility > 500 bps) blocks execution unconditionally. |
| **Signal** | Advisory — risk and anomaly results are logged and surfaced to the user, but execution isn't blocked. Used for monitoring without intervention. |

In gate mode, proof calldata is cryptographically bound to the oracle snapshot hash — the system can prove that the risk assessment was based on a specific market state, not stale data.

### 9.2 Constraint Gate

Before any capital moves, six checks must pass:

1. **Identity verification** — user must have completed onboarding (no bypass in production)
2. **Session expiry** — sessions have a configurable `session_duration` limit
3. **Profile escalation block** — a user onboarded as `"balanced"` cannot request `"aggressive"` operations without re-onboarding
4. **Amount cap** — hard `max_position_usd` limit per operation
5. **ZKML risk score check** — the creditworthiness model must have produced a sufficiently high score for the requested operation
6. **Vault policy bounds** — the operation must fall within the vault's configured risk parameters

### 9.3 Deterministic Fallback as a Provable Guardrail

The deterministic fallback model is not just a backup for when the LLM is offline. It's a **conservative safety layer** that runs in parallel with more permissive thresholds:

| Parameter | ZK Circuit Threshold | Deterministic Fallback |
|-----------|---------------------|----------------------|
| Max risk score | 30 | **25** (stricter) |
| Max anomaly score | 50 | **40** (stricter) |
| Max action value | — | **20 ETH** (hard cap) |

Three possible outcomes: `execute` (proceed), `reject` (block), `defer_to_human` (require manual approval).

The key insight: **even if the LLM is compromised or hallucinating, the deterministic fallback must agree before funds move.** And because the fallback model is a simple MLP exportable to ONNX, it is itself provable via EZKL — the guardrail generates its own ZK proof.

### 9.4 Orchestrator-Level Controls

| Control | Enforcement |
|---------|------------|
| **Proof TTL** | Proofs older than 300 seconds (5 minutes) are rejected as stale |
| **Skill binding** | Agent can only execute skills listed in its `bound_skills` set; all others are blocked |
| **LLM binding** | Each agent is locked to a specific LLM provider via `bind_agent()`; silent provider swaps are impossible |

### 9.5 Trust Summary

```
LLM says: "Rebalance $50K into pool X"
                    │
  ┌─────────────────▼──────────────────┐
  │         Constraint Gate            │
  │  ✗ Amount exceeds max_position_usd │
  │         → BLOCKED                  │
  └────────────────────────────────────┘

LLM says: "Run yield_analysis on pool Y, then rebalance $5K"
                    │
  ┌─────────────────▼──────────────────┐
  │         Constraint Gate            │
  │  ✓ Amount within bounds            │
  │  ✓ User onboarded as balanced      │
  │  ✓ Session not expired             │
  └─────────────────┬──────────────────┘
                    │
  ┌─────────────────▼──────────────────┐
  │         Policy Engine (Gate)       │
  │  ✓ Risk score proof valid          │
  │  ✓ Anomaly scan: safe             │
  │  ✓ Pool volatility < 500 bps      │
  └─────────────────┬──────────────────┘
                    │
  ┌─────────────────▼──────────────────┐
  │     Deterministic Fallback         │
  │  ✓ Risk ≤ 25                       │
  │  ✓ Anomaly ≤ 40                    │
  │  ✓ Value ≤ 20 ETH                  │
  │  → EXECUTE (with ZK proof)         │
  └────────────────────────────────────┘
```

---

## 10. How It All Connects — The Full Pipeline

Here is what happens when a user clicks "Check My Credit" on the frontend:

```
 User clicks "Check Credit"
       │
 ① Frontend ──POST──► /api/v1/zkdefi/risk_profile/v2/{address}?generate_proof=true
       │
 ② Backend: CreditPredictor
       │
       ├── Fetch on-chain data for {address} (balances, tx history, DeFi positions)
       ├── Normalize 18 features to [0, 1] range
       ├── Run ONNX inference:  onnxruntime.InferenceSession("creditworthiness.onnx")
       │     Input:  [0.82, 0.45, 0.91, ...] (18 floats)
       │     Output: [2.1, 8.7, 0.3, -1.2, -5.4] (5 logits)
       │     Softmax → [0.01, 0.98, 0.005, 0.003, 0.001]
       │     Prediction: class 1 = "AA" at 98% confidence
       │
 ③ EZKL Proof Generation (if generate_proof=true)
       │
       ├── gen_witness(input=[0.82, 0.45, ...], compiled_circuit)
       │     Executes the full neural network inside the arithmetic circuit
       │     Produces a witness: every intermediate value as field elements
       │
       ├── prove(witness, proving_key, srs)
       │     Commits to the witness polynomials using KZG
       │     Generates opening proofs (pairing-based)
       │     Output: ~3 KB proof
       │
       ├── verify(proof, settings, verification_key, srs)
       │     Checks KZG commitments against verification key
       │     Returns: true ✓
       │
       └── proof_hash = SHA256(proof_bytes) = "0x19a9ed8a..."
       │
 ④ Store in Proof Registry
       │
       ├── SQLite: INSERT proof_hash, model="creditworthiness", user={address},
       │           verified=true, action="credit_check"
       │
 ⑤ Return to Frontend
       │
       └── { grade: "AA", confidence: 0.98, proof_hash: "0x19a9ed8a...",
             model_name: "creditworthiness_mlp", model_hash: "7b41f26e..." }
       │
 ⑥ (Optional) Submit On-Chain
       │
       ├── POST /api/v1/zkdefi/proofs/submit/{proof_hash}
       │
       ├── Backend: Call ValidationProofRegistry.register_proof(
       │     fact_hash, agent_id="zkdefi", proof_type="ezkl_kzg",
       │     action_type="credit_check", verifier_address)
       │
       └── Starknet TX confirmed: 0x50f7dbcc...
```

### What the LLM Does in This Flow

The LLM is not directly in the credit check flow. But when the **Agent Orchestrator** runs a broader goal like "optimize my portfolio":

```
 Agent Goal: "Optimize yield while staying safe"
       │
 ① LLM Reasoning Step
       │   Prompt: "You have these skills: risk_check, yield_analysis,
       │            anomaly_scan, rebalance. The user has $10K in pool X
       │            with declining yield. What should we do?"
       │
       │   LLM Response: "Run yield_analysis on pool X and pools Y, Z.
       │                   Run anomaly_scan on all three. If safe,
       │                   rebalance 40/30/30."
       │
 ② Skill Execution (each generates a ZK proof)
       │   ├── yield_analysis(pool_X) → "declining" + proof_hash_1
       │   ├── yield_analysis(pool_Y) → "growing"  + proof_hash_2
       │   ├── yield_analysis(pool_Z) → "stable"   + proof_hash_3
       │   ├── anomaly_scan(pool_Y)   → "safe"     + proof_hash_4
       │   └── anomaly_scan(pool_Z)   → "safe"     + proof_hash_5
       │
 ③ LLM Synthesis Step
       │   Prompt: "Results: pool X declining, Y growing+safe, Z stable+safe.
       │            Make a final allocation recommendation."
       │
       │   LLM Response: { "pool_Y": 0.50, "pool_Z": 0.30, "pool_X": 0.20 }
       │
 ④ Record Results
       │   All 5 proof hashes stored in registry
       │   Agent reputation updated on-chain
```

---

## 11. The Three Circuits in Detail

### 11.1 Creditworthiness Circuit

**What it proves**: "I ran a neural network with 18 on-chain behavioral features as input and got a specific 5-class credit grade."

**Input features** (18 floats, min-max normalized to [0, 1]):

| # | Feature | Description |
|---|---------|-------------|
| 1 | `eth_balance_log` | Log of ETH balance |
| 2 | `starknet_tx_count_log` | Log of total transaction count |
| 3 | `unique_contracts_interacted` | Number of unique contracts called |
| 4 | `defi_protocol_count` | Number of DeFi protocols used |
| 5 | `total_value_locked_log` | Log of TVL across all positions |
| 6 | `loan_to_value_ratio` | Current LTV if borrowing |
| 7 | `liquidation_count` | Number of past liquidations |
| 8 | `avg_position_duration_days` | How long positions are held |
| 9 | `transaction_frequency` | Transactions per week |
| 10 | `smart_contract_diversity` | Entropy of contract interactions |
| 11 | `gas_efficiency_score` | Average gas usage optimization |
| 12 | `flash_loan_usage` | Whether flash loans have been used |
| 13 | `governance_participation` | Voting activity |
| 14 | `bridge_activity` | Cross-chain bridge usage |
| 15 | `nft_holdings_count` | Number of NFTs held |
| 16 | `account_age_days` | Days since first transaction |
| 17 | `max_single_tx_value_log` | Largest single transaction |
| 18 | `staking_participation` | Whether the user stakes tokens |

**Output classes**: AAA (pristine), AA (excellent), A (good), B (fair), C (poor)

**Circuit stats**: 114 KB compiled, ~5,200 constraints, 32,768 rows

### 11.2 Yield Forecast Circuit

**What it proves**: "I analyzed 12 pool performance metrics and predicted the yield trajectory."

**Input features** (12 floats):

| # | Feature | Description |
|---|---------|-------------|
| 1 | `tvl_usd_log` | Log of total value locked in USD |
| 2 | `volume_24h_log` | Log of 24-hour trading volume |
| 3 | `fee_tier_bps` | Fee tier in basis points |
| 4 | `current_apr` | Current annualized percentage rate |
| 5 | `apr_7d_avg` | 7-day rolling average APR |
| 6 | `apr_30d_avg` | 30-day rolling average APR |
| 7 | `apr_trend_7d` | Slope of APR over 7 days |
| 8 | `apr_volatility_7d` | Standard deviation of APR over 7 days |
| 9 | `utilization_ratio` | Fraction of liquidity being used |
| 10 | `tick_concentration` | How concentrated liquidity is around current price |
| 11 | `num_positions` | Number of LP positions in the pool |
| 12 | `time_since_last_rebalance_hours` | Hours since last rebalance |

**Output classes**: Declining (yield dropping), Stable (steady), Growing (yield increasing), Surging (rapid growth)

**Circuit stats**: 36 KB compiled, ~2,800 constraints, 32,768 rows

### 11.3 Anomaly Detector Circuit

**What it proves**: "I scanned 8 risk signals for a pool and classified it as safe, warning, or critical."

**Input features** (8 floats):

| # | Feature | Description |
|---|---------|-------------|
| 1 | `tvl_stability` | How stable the TVL has been (0–1) |
| 2 | `liquidity_concentration` | How concentrated liquidity is (0–1) |
| 3 | `price_impact_bps` | Price impact of trades in basis points |
| 4 | `deployer_reputation` | Reputation score of the deployer (0–1) |
| 5 | `volume_pattern` | How normal the trading volume pattern is (0–1) |
| 6 | `fee_anomaly` | Abnormal fee behavior score (0–1) |
| 7 | `large_withdrawal_pct` | Recent large withdrawals as % of TVL |
| 8 | `smart_money_flow` | Net flow from known sophisticated wallets (-1 to 1) |

**Output classes**: Safe (normal operation), Warning (unusual signals), Critical (likely exploit/rug)

**Circuit stats**: 21 KB compiled, ~1,600 constraints, 32,768 rows

---

## 12. The Proof Registry — Verifiability Middleware

The proof registry is not just a storage table. It is the architectural layer that turns AI agents into **accountable entities**. The registry enables a new pattern: any smart contract can query whether an AI agent's claim is backed by verified computation, before allowing that agent to act on-chain. This makes the registry the trust bridge between off-chain AI and on-chain execution.

The critical example: in the lending pool contract, **you cannot borrow without a valid proof attestation**:

```cairo
// Inside _borrow_internal() — lending_pool.cairo
let vpr = IValidationProofRegistryDispatcher {
    contract_address: self.validation_registry.read(),
};
assert(vpr.has_proof(attestation_hash), 'no valid attestation');
```

The proof registry is a **prerequisite gate** for capital operations, not just a log.

Three consumption interfaces:

| Interface | Purpose | Used By |
|-----------|---------|--------|
| `has_proof(fact_hash)` | Boolean existence check | Lending pool borrow gate |
| `is_proof_valid(fact_hash)` | Existence + validity check | Credit eligibility verifier |
| `get_proof_by_hash(fact_hash)` | Full proof record retrieval | Audit, reputation scoring |

The registry also enables:
- **AI agents** to generate proofs and build verifiable track records
- **Smart contracts** to query proofs before authorizing capital movement
- **Users** to audit every decision their agent made, with cryptographic evidence
- **Cross-protocol reputation** via ERC-8004 proof discovery

This pattern — where AI decisions flow through a proof pipeline before reaching execution — is essentially a **computation oracle**. Unlike data oracles that attest to raw facts, computation oracles prove interpretation: "this pool scored safe," "this allocation is near-optimal," "this risk level is within bounds."

### 12.1 Local Registry (Backend)

Every proof generated is stored in a local SQLite database with full metadata:

```sql
CREATE TABLE proofs (
    id               INTEGER PRIMARY KEY,
    proof_hash       TEXT UNIQUE,      -- SHA-256 of proof bytes
    model_name       TEXT,             -- "creditworthiness" | "yield_forecast" | "anomaly_detector"
    user_address     TEXT,             -- Starknet address
    proof_type       TEXT,             -- "ezkl_kzg"
    action_type      TEXT,             -- "credit_check" | "yield_estimate" | "anomaly_scan"
    proof_size_bytes INTEGER,          -- ~3 KB (KZG proof)
    inference_output TEXT,             -- JSON array of probabilities
    verified_locally INTEGER,          -- 1 if verified before storing
    created_at       REAL,             -- Unix timestamp
    tx_hash          TEXT,             -- Starknet TX hash (if submitted)
    on_chain_proof_id INTEGER,         -- ID in the on-chain registry
    submitted_at     REAL              -- When submitted on-chain
);
```

### 12.2 On-Chain Registry

When a proof is submitted on-chain, it's recorded in the `ValidationProofRegistry` contract. This enables:

- **Other contracts** to check `is_proof_valid(fact_hash)` before allowing operations
- **Users** to verify their proofs exist on-chain via Voyager or any Starknet block explorer
- **Agents** to build reputation based on how many valid proofs they've generated

### 12.3 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/zkdefi/proofs/` | GET | List all proofs (filter by model/user) |
| `/api/v1/zkdefi/proofs/stats` | GET | Aggregate statistics |
| `/api/v1/zkdefi/proofs/models` | GET | List available models + EZKL readiness |
| `/api/v1/zkdefi/proofs/{hash}` | GET | Get a specific proof record |
| `/api/v1/zkdefi/proofs/verify/{hash}` | POST | Re-verify a proof locally |
| `/api/v1/zkdefi/proofs/submit/{hash}` | POST | Submit proof to Starknet |
| `/api/v1/zkdefi/proofs/yield-forecast` | POST | Run yield forecast + generate proof |
| `/api/v1/zkdefi/proofs/anomaly-detect` | POST | Run anomaly detection + generate proof |

---

## 13. MEV Resistance — Commit-Reveal Execution

One insight that almost nobody building ZKML + agents has connected yet: **provable AI + commit-reveal vault execution is a new primitive for MEV-resistant AI capital allocation.**

Traditional DeFi vaults broadcast their rebalance transactions openly. MEV bots see these pending transactions and sandwich them — buying before the vault's trade and selling after, extracting value from vault depositors. An AI agent that broadcasts its intent to rebalance is even more predictable than a timer-based strategy.

zkde.fi solves this with three mechanisms:

### 13.1 Vault Controller Commit-Reveal

The vault controller uses a two-phase execution model:

```
Phase 1: COMMIT
  Agent computes: proposal_hash = poseidon(salt, adapters, amounts)
  Agent submits:  commit_proposal(proposal_hash)
  Contract stores: hash + block number
                   (nothing about the actual trade is revealed)

Phase 2: EXECUTE (after cooldown)
  Agent submits:  execute_proposal(adapters, amounts, salt)
  Contract verifies: poseidon(salt, adapters, amounts) == stored hash
  Contract enforces: current_block >= commit_block + cooldown
  Contract executes: the actual capital movement
```

Between commit and execute, nobody knows what the agent intends to do. The proposal hash is opaque. MEV bots cannot sandwich what they cannot see.

Additional protections:
- **Cooldown enforcement** — prevents flash-commit-execute in the same block
- **Circuit breaker per adapter** — if an adapter (DEX connector) behaves anomalously, it's automatically disabled

### 13.2 Intent Commitment Contract

For operations beyond vault rebalancing, a dedicated intent commitment contract provides replay-safe, fork-safe execution:

| Property | Value |
|----------|-------|
| Validity window | 100 blocks (~200 seconds) |
| Chain ID verification | Prevents cross-chain replay attacks |
| Single-use semantics | Each commitment can only be consumed once |
| Lifecycle | `submit_commitment` → (wait) → `use_commitment` |

### 13.3 Timing Predictor with Pre-Commitment

The timing predictor model (LSTM-based) predicts the optimal block window for rebalancing. It creates a **Poseidon pre-commitment** before the target block:

```
commitment = poseidon(target_block, action_type, user_address, nonce)
```

The commitment must be published on-chain **before** the target block arrives. This prevents the agent from front-running its own users — it cannot see the future block state and retroactively claim it predicted the optimal timing.

### 13.4 Why This Combination Is Novel

Most MEV protection focuses on transaction ordering (Flashbots, MEV-Share, encrypted mempools). zkde.fi's approach is different:

1. **AI computes the optimal action** (yield forecast, anomaly check) → proof generated
2. **Commitment published** (opaque hash, no information leakage)
3. **Cooldown period** (time lock prevents same-block exploitation)
4. **Execution with proof** (contract verifies both the commitment match AND the proof attestation)

The result: an AI agent that is simultaneously:
- **Intelligent** (LLM + ML models choose the best action)
- **Verifiable** (every ML computation has a ZK proof)
- **MEV-resistant** (commit-reveal prevents front-running)
- **Bounded** (policy engine + constraint gate limit what actions are possible)

---

## 14. Security Model

### What is Guaranteed by the Proofs

| Property | Guaranteed? | How |
|----------|-------------|-----|
| Model ran correctly | ✅ Yes | KZG proof over arithmetic circuit |
| Exact inputs were used | ✅ Yes | Inputs are public in the proof's `instances` |
| Specific ONNX model was used | ✅ Yes | `model_hash` (SHA-256 of ONNX bytes) is in proof metadata |
| Output was not tampered with | ✅ Yes | Outputs are public inputs in the proof |
| Model weights haven't changed | ✅ Yes | Circuit is compiled from a specific ONNX; different weights = different circuit |
| Model is "good" or "fair" | ❌ No | A badly trained model produces valid proofs of bad predictions |
| Training data was representative | ❌ No | The proof covers inference, not training |
| LLM reasoning was correct | ❌ No | LLM decisions are advisory, not proven |

### Trust Assumptions

1. **EZKL is correct** — audited by Trail of Bits, open source
2. **KZG SRS is secure** — uses Ethereum's KZG ceremony (same as EIP-4844 blob transactions)
3. **Garaga verifier is correct** — Starknet BN254 pairing precompile
4. **The ONNX model is the one claimed** — verified by `model_hash` matching on-chain registry
5. **Input data is authentic** — **this is the biggest unsolved problem in ZKML systems**. The current trust chain is: Starknet state → backend data fetch → ML inference → proof. The operator could theoretically feed fake inputs. The proof guarantees the model ran correctly *on whatever inputs were provided*, but does not independently attest that those inputs came from on-chain state. The planned fix is Starknet storage proofs (or Herodotus-style cross-chain proofs) that cryptographically bind input data to on-chain state before it enters the circuit.

### Current Input Data Mitigations

While full storage proof integration is still ahead, the system already has partial mitigations:

| Mitigation | What It Does |
|------------|-------------|
| **Market snapshot hashing** | The mainnet oracle service creates a `MarketSnapshot` with a SHA-256 `snapshot_hash`. Proof calldata is bound to this hash — the proof is tied to a specific market state. |
| **Direct DEX API fetching** | Input data comes directly from JediSwap and Ekubo mainnet APIs, not from a third-party oracle. No Chainlink/Pragma dependency. |
| **Staleness threshold** | Market data older than 1 hour is rejected. The oracle service enforces `ORACLE_STALE_THRESHOLD_SEC`. |
| **VWAP fallback chain** | Ekubo adapter fetches VWAP prices from HTTP API, with fallback to on-chain `Core.get_pool_price` via Starknet RPC. |

The gap that remains: these mitigations reduce the attack surface but don't eliminate it. An operator controlling the backend could still substitute fake data before it reaches the ML model. Only cryptographic binding (storage proofs) closes this completely.

### LLM Orchestration Trust Model

The LLM layer (GPT-4o-mini) chooses which skills to invoke and with what parameters. This is bounded by the four-layer trust architecture described in Section 9:

- **Policy engine** hard-blocks operations that fail risk or anomaly checks (gate mode)
- **Constraint gate** enforces 6 deterministic checks (identity, session, escalation, amount cap, risk score, vault bounds)
- **Deterministic fallback** must independently agree before funds move (with provably stricter thresholds)
- **Orchestrator-level controls** enforce skill binding, LLM binding, and proof TTL

The LLM is free to reason and recommend — but every recommendation passes through these layers before capital moves. The trust model is: **the LLM is untrusted, but the system around it is verified.**

For reproducibility, the system logs `llm_provider_used` and `llm_provider_hash` with every decision, enabling post-hoc audit of which model made each choice.

---

## 15. Current Limitations and How We Can Improve

### 15.1 Current Limitations

| Limitation | Impact | Root Cause |
|-----------|--------|------------|
| Models are small MLPs only | Limited expressiveness | EZKL can't efficiently prove attention/normalization |
| LLM decisions aren't proven | Orchestration is trusted | LLMs are too large for ZK circuits |
| Proving key is 132 MB per model | Memory intensive on server | Halo2/KZG requires large structured data |
| Training uses synthetic data | Model accuracy on real data untested | Mainnet data pipeline not yet built |
| Input data authenticity not proven | Could theoretically feed fake inputs | No Starknet state proofs integrated yet |

### 15.2 Improvement Roadmap

#### Near-Term (Next 3 Months)

**1. Train on Real Mainnet Data**
Replace synthetic training data with real on-chain metrics. The creditworthiness model should train on actual Starknet wallet histories; yield forecast on real Ekubo pool APR timeseries; anomaly detector on historical rug/exploit patterns.

**2. Input Attestation via Storage Proofs**
Use Starknet storage proofs (or Herodotus-style cross-chain proofs) to prove that the input data fed to the model actually came from on-chain state. This closes the "fake input" vector.

**3. Expand to More Models**
Two model directories (`llm_fallback`, `timing_predictor`) have placeholder structure but no trained models. Training + EZKL setup for these would add:
- **LLM Fallback Detector**: Proves whether the system fell back from AI to deterministic mode
- **Timing Predictor**: Proves optimal rebalance timing predictions

**4. Batch Proving**
Use the `BatchVerifier` contract to submit multiple proofs in a single Starknet transaction, reducing gas costs by ~60%.

#### Medium-Term (3–6 Months)

**5. EZKL→Groth16 Bridge for Cheaper On-Chain Verification**
EZKL proofs use the KZG/Halo2 system, but Starknet's Garaga verifier is optimized for Groth16 (BN254). A bridge circuit that wraps EZKL proofs into Groth16 proofs would reduce on-chain verification cost significantly. The `verify_model_bridge_proof()` function in ZkmlVerifier already supports this.

**6. Larger Models via Recursive Proving**
Instead of one monolithic circuit, split a larger model (e.g., a small transformer) into segments, prove each segment, then recursively compose the segment proofs into a single proof. EZKL supports this but it's not yet integrated.

**7. Proof of Training**
Prove not just that inference was correct, but that the model was trained on specific data. This is extremely expensive but theoretically possible for small models.

#### Long-Term (6–12 Months)

**8. ZK-LLM (Partial)**
Prove specific LLM outputs for constrained prompts. For example, prove that the LLM produced a specific JSON allocation using a specific system prompt — not the full model, but the last few layers of a distilled decision head.

**9. Cross-Chain Proof Portability**
Submit proof verification results from Starknet to Ethereum L1 or other L2s, enabling cross-chain reputation.

**10. Decentralized Proving Network**
Move proving from a centralized server to a network of provers who compete to generate proofs, with economic incentives for correctness.

### 15.3 What Would Make the Biggest Impact Today

If we could only do one thing, it would be **input attestation via storage proofs** (#2). The proofs currently guarantee the computation was correct, but not that the inputs were authentic. Closing this gap turns the system from "provably correct if inputs are honest" to "provably correct, period."

### 15.4 The Bigger Picture: Computation Oracles

The system already operates without traditional oracle networks (no Chainlink, no Pragma). Price data comes directly from DEX APIs and on-chain pool state. The ML models process this data and generate provable assessments.

This points to a larger architectural shift:

| Traditional Oracle | Computation Oracle (zkde.fi) |
|-------------------|-----------------------------|
| Reports raw data: "ETH price is $3,200" | Reports interpreted signal: "This pool's yield is growing" + proof |
| Attests to facts | Proves computation over facts |
| Trust the oracle operator | Verify the cryptographic proof |
| One data point per query | Full ML inference with confidence distribution |
| Cannot express nuance | Can express multi-class risk assessments |

The traditional flow: **Oracle → price feed → contract**
The zkde.fi flow: **DEX state → ML model → ZK proof → contract**

This is strictly more powerful: instead of "the price is X," you get "the risk assessment is Y, and here's a proof that this computation was correct." Provable AI agents don't just replace oracle networks — they make oracles a subset of a broader capability.

---

## 16. Glossary

| Term | Definition |
|------|-----------|
| **EZKL** | Open-source toolkit (by @zkonduit, audited by Trail of Bits) that converts ONNX neural networks into ZK circuits and generates KZG proofs |
| **KZG** | Kate-Zaverucha-Goldberg, a polynomial commitment scheme using elliptic curve pairings |
| **Halo2** | A proof system (developed by Zcash/Electric Coin Co.) that EZKL uses internally for circuit constraint representation |
| **ONNX** | Open Neural Network Exchange — standardized format for representing neural networks |
| **Garaga** | A Starknet library/precompile for efficient BN254 elliptic curve pairing operations, enabling Groth16/KZG verification on-chain |
| **BN254** | An elliptic curve (also called alt-bn128) used for pairings in Ethereum and Starknet |
| **SRS** | Structured Reference String — public parameters for the KZG commitment scheme, generated via a trusted setup ceremony |
| **Proving Key (pk)** | Model-specific key that allows generation of proofs (large, stays on prover) |
| **Verification Key (vk)** | Model-specific key that allows verification of proofs (small, can be public) |
| **Witness** | The complete execution trace of a computation — every intermediate value in the circuit |
| **Arithmetization** | Converting computation (neural network operations) into polynomial constraints over a finite field |
| **felt252** | Starknet's native data type — an integer in the range [0, P) where P is a large prime |
| **Groth16** | A succinct non-interactive zero-knowledge proof system (used by Garaga verifier on-chain) |
| **STARK** | Scalable Transparent ARgument of Knowledge — the proof system Starknet itself uses (different from our model proofs) |
| **ERC-8004** | A standard for on-chain proof registries and validation catalogs |
| **Onyx** | Our LLM provider routing system — currently wraps OpenAI GPT-4o-mini with automatic failover |
| **MLP** | Multi-Layer Perceptron — a neural network with only Linear (matrix multiply) and ReLU (max(0,x)) layers |
| **Circuit** | The arithmetic representation of a computation as polynomial constraints — what the prover/verifier operate on |
| **logrows** | Circuit size parameter: 2^logrows = number of rows in the constraint table (ours: 2^15 = 32,768) |
| **input_scale** | Quantization parameter: floating-point values are multiplied by 2^scale and rounded to integers (ours: 2^13 = 8,192) |
| **Provable AI Agent** | An autonomous system whose critical decisions are backed by cryptographic proofs of the computations that produced them |
| **Computation Oracle** | A service that proves what data *means*, not just what the data *is* — ML inference with ZK proof, as opposed to traditional data feeds |
| **Commit-Reveal** | A two-phase execution pattern where an opaque commitment is published first, and the actual operation is revealed later — prevents front-running |
| **Policy Engine** | Backend service that gates agent actions based on configurable rules (risk thresholds, anomaly checks, pool stress tests) |
| **Constraint Gate** | Pre-execution check layer enforcing identity, session, amount, and risk bounds before any capital movement |
| **Obsqra** | The parent framework for verifiable AI agents; zkde.fi is the first application built on Obsqra infrastructure |

---

*Last updated: March 2026*
*Protocol: zkde.fi — Verifiable AI for DeFi on Starknet*
*Built on Obsqra — infrastructure for verifiable AI agents*
