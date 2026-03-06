# Local vs starknet.obsqra.fi Architecture

## TL;DR

**Two different engines:**

1. **zkML Risk Engine** = LOCAL (runs on zkde.fi backend)
2. **Stone Prover** = CALLS `starknet.obsqra.fi` (external API)

---

## What Runs Locally on zkde.fi

### 1. zkML Risk Score Model ✅ LOCAL

**File**: `/backend/app/services/zkml_risk_service.py`

**What it does**:
- Computes risk scores from portfolio features (Python)
- Generates Groth16 proofs via snarkjs (local circuit execution)
- Runs entirely in zkde.fi backend

**Proof type**: Groth16 (snarkjs + Garaga verifier)

**Purpose**: Privacy-preserving risk assessment
- Input: Portfolio features (balance, concentration, volatility, etc.)
- Output: Proof that risk_score ≤ threshold (without revealing actual score)

```python
# LOCAL computation
class RiskScoreModel:
    def compute_risk_score(portfolio_features, weights):
        weighted_sum = sum(feature * weight for feature, weight in zip(portfolio_features, weights))
        return normalize(weighted_sum)
```

### 2. zkML Anomaly Detection Model ✅ LOCAL

**File**: `/backend/app/services/zkml_anomaly_service.py`

**What it does**:
- Analyzes pool safety (Python)
- Generates Groth16 proofs via snarkjs (local circuit execution)
- Runs entirely in zkde.fi backend

**Proof type**: Groth16 (snarkjs + Garaga verifier)

**Purpose**: Privacy-preserving pool safety verification
- Input: Pool metrics (utilization, volatility, liquidity, etc.)
- Output: Proof that pool is safe (without revealing metrics)

### 3. Full Privacy Pool (Deposit/Withdraw) ✅ LOCAL

**File**: `/backend/app/services/full_privacy_proof_service.py`

**What it does**:
- Generates Groth16 proofs for private deposits/withdrawals
- Uses snarkjs + Circom circuits locally
- Merkle tree management (in-memory)

**Proof type**: Groth16 (snarkjs + Garaga verifier)

**Purpose**: Confidential transactions with commitments

---

## What Calls starknet.obsqra.fi (External)

### 1. Execution Proofs (STARK) 🌐 EXTERNAL API

**File**: `/backend/app/services/zkdefi_agent_service.py`

**What it does**:
- Calls `https://starknet.obsqra.fi/api/v1/proofs/generate`
- Requests STARK proof from Stone prover
- Proof verifies allocation satisfies user constraints

**Proof type**: STARK (Stone prover + Integrity FactRegistry)

**Purpose**: Proof-gated execution
- Input: Allocation decision (e.g., 49% Jediswap, 51% Ekubo)
- Output: fact_hash registered in Integrity FactRegistry
- Contract checks: `assert is_valid(fact_hash)` before executing

```python
# CALLS EXTERNAL API
async def deposit_with_constraints(user_address, protocol_id, amount, constraints):
    proof_result = await self._call_prover_api("proofs/generate", {
        "jediswap_metrics": {...},
        "ekubo_metrics": {...}
    })
    fact_hash = proof_result.get("fact_hash")  # From starknet.obsqra.fi
    return {"proof_hash": fact_hash}
```

### 2. Onboarding Identity Proofs (STARK) 🌐 EXTERNAL API

**File**: `/backend/app/api/routes/onboarding.py`

**What it does**:
- Calls `https://starknet.obsqra.fi/api/v1/proofs/generate`
- Requests STARK proof for user identity/constraints
- Takes 2-3 minutes (real Stone prover)

**Proof type**: STARK (Stone prover + Integrity FactRegistry)

**Purpose**: Identity commitment verification
- Input: User constraints (max_position, risk_tolerance, session_duration)
- Output: fact_hash for on-chain agent initialization

```python
# CALLS EXTERNAL API
async def generate_authorization(req):
    async with httpx.AsyncClient(timeout=300.0) as client:
        response = await client.post(
            f"{OBSQRA_PROVER_API_URL}/proofs/generate",
            json=proof_payload
        )
        proof_result = response.json()
    
    fact_hash = proof_result.get("fact_hash")  # From starknet.obsqra.fi
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        zkde.fi                              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Frontend (Next.js)                                 │  │
│  │  - User configures constraints                      │  │
│  │  - Agent dashboard                                   │  │
│  └─────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Backend (FastAPI)                                  │  │
│  │                                                      │  │
│  │  ┌──────────────────┐  ┌──────────────────┐       │  │
│  │  │ zkML Risk Score  │  │ zkML Anomaly     │       │  │
│  │  │ (LOCAL)          │  │ (LOCAL)          │       │  │
│  │  │ • Python model   │  │ • Python model   │       │  │
│  │  │ • snarkjs proof  │  │ • snarkjs proof  │       │  │
│  │  │ • Groth16        │  │ • Groth16        │       │  │
│  │  └──────────────────┘  └──────────────────┘       │  │
│  │                                                      │  │
│  │  ┌──────────────────┐  ┌──────────────────┐       │  │
│  │  │ Full Privacy     │  │ Execution Proofs │       │  │
│  │  │ (LOCAL)          │  │ (CALLS EXTERNAL) │──┐    │  │
│  │  │ • snarkjs proof  │  │ • HTTP POST to   │  │    │  │
│  │  │ • Groth16        │  │   starknet.obsqra│  │    │  │
│  │  │ • Merkle tree    │  │ • STARK proof    │  │    │  │
│  │  └──────────────────┘  └──────────────────┘  │    │  │
│  └──────────────────────────────────────────────│────┘  │
└─────────────────────────────────────────────────│────────┘
                                                   │
                                                   │ HTTPS
                                                   ▼
                          ┌─────────────────────────────────┐
                          │   starknet.obsqra.fi           │
                          │                                 │
                          │  ┌──────────────────────────┐  │
                          │  │  Stone Prover API        │  │
                          │  │  • Receives requests     │  │
                          │  │  • Generates STARK proof │  │
                          │  │  • Submits to Integrity  │  │
                          │  │  • Returns fact_hash     │  │
                          │  └──────────────────────────┘  │
                          └─────────────────────────────────┘
                                         │
                                         │ On-chain tx
                                         ▼
                          ┌─────────────────────────────────┐
                          │   Starknet Sepolia             │
                          │                                 │
                          │  • Integrity FactRegistry      │
                          │  • Garaga Verifier             │
                          │  • ProofGatedYieldAgent        │
                          └─────────────────────────────────┘
```

---

## Why This Architecture?

### zkML Models (LOCAL)

**Reason**: Privacy + latency
- User's portfolio data never leaves zkde.fi
- Sub-second proof generation
- No external dependency for privacy proofs

### Execution Proofs (EXTERNAL)

**Reason**: Infrastructure + reuse
- Stone prover infrastructure at starknet.obsqra.fi
- Submits proofs to Integrity FactRegistry
- Reuses existing production prover
- Takes 2-3 minutes per proof (STARK generation is expensive)

---

## Summary Table

| Component | Location | Proof Type | Purpose | Duration |
|-----------|----------|------------|---------|----------|
| zkML Risk Score | **LOCAL** (zkde.fi) | Groth16 | Privacy-preserving risk assessment | ~1s |
| zkML Anomaly Detection | **LOCAL** (zkde.fi) | Groth16 | Privacy-preserving pool safety | ~1s |
| Full Privacy Pool | **LOCAL** (zkde.fi) | Groth16 | Confidential deposits/withdrawals | ~2s |
| Execution Proofs | **EXTERNAL** (starknet.obsqra.fi) | STARK | Proof-gated allocation verification | 2-3 min |
| Onboarding Identity | **EXTERNAL** (starknet.obsqra.fi) | STARK | Identity commitment verification | 2-3 min |

---

## Key Distinction

### "Risk Engine" Can Mean Two Things:

1. **zkML Risk Score Model** = LOCAL Python code that computes risk scores
2. **Stone Prover for Execution** = EXTERNAL API that proves allocations are safe

Both verify risk/safety, but:
- **zkML model** proves "my risk score is low" (privacy-preserving, Groth16)
- **Stone prover** proves "this allocation satisfies my constraints" (execution-gating, STARK)

---

## Answer to Your Question

> "are we calling starknet.obsqra.fi's risk engine or our local one on zkde.fi?"

**Both!**

- **zkML risk models** run **locally** on zkde.fi (Groth16 privacy proofs)
- **Execution constraint proofs** call **starknet.obsqra.fi** Stone prover (STARK execution proofs)

They work together:
1. LOCAL: zkML models decide if an action is safe
2. EXTERNAL: Stone prover proves the action satisfies your constraints
3. Contract verifies both proofs before execution

**zkde.fi is open source. starknet.obsqra.fi is infrastructure (like Herodotus).**
