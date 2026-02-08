# Proof System Architecture

## Overview

zkde.fi uses a **hybrid proof system** to maximize privacy while maintaining verifiable execution:

- **Garaga (Groth16/SNARK)** — for zkML proofs and confidential transfers (privacy layer)
- **Integrity (STARK)** — for execution proofs and constraint verification (execution layer)

This architecture ensures:
1. Privacy for ML model outputs (actual scores hidden)
2. Privacy for transaction amounts (confidential transfers)
3. Verifiable execution (constraints proven on-chain)
4. Replay-safety (intent commitments)

## Proof Stack Breakdown

| Proof Type | System | Prover | Verifier | Purpose |
|------------|--------|--------|----------|---------|
| zkML Risk Score | SNARK | snarkjs | Garaga (on-chain) | Hide actual risk score |
| zkML Anomaly Detection | SNARK | snarkjs | Garaga (on-chain) | Hide detection details |
| Constraint Satisfaction | STARK | Stone | Integrity | Verify constraints |
| Slippage Bounds | STARK | Stone | Integrity | Verify slippage |
| Confidential Transfers | SNARK | snarkjs | Garaga (on-chain) | Hide amounts |

## Why Hybrid?

### SNARK (Garaga) for Privacy

1. **Smaller proofs** — Groth16 proofs are compact (~200 bytes)
2. **Hidden outputs** — Model outputs stay private
3. **Fast verification** — Constant-time on-chain verification
4. **Consistent** — Same system for zkML and confidential transfers

### STARK (Integrity) for Execution

1. **Native Starknet** — STARKs are the foundation of Starknet
2. **Receipts/Facts** — Fits the "trust = Σ(receipts)" pattern
3. **No trusted setup** — STARKs don't require ceremonies
4. **Existing infrastructure** — Stone prover already integrated

## zkML Proof Flow

### Risk Score Model

```
Input (private):
  - portfolio_features: [balance, allocation, volatility, ...]
  - risk_params: [max_var, min_sharpe, ...]

Model Inference (private):
  - risk_score = f(portfolio_features, risk_params)
  - Example: risk_score = 0.25

Proof Generation:
  - Prove: risk_score <= threshold (e.g., 0.3)
  - Without revealing: actual risk_score (0.25)

Output:
  - proof_calldata (Groth16, Garaga-compatible)
  - verification_result: boolean
```

**What's Hidden:**
- Actual risk score
- Portfolio features
- Model inputs
- Calculation details

**What's Public:**
- Proof hash
- Threshold compliance (boolean)
- Verification result

### Anomaly Detection Model

```
Input (private):
  - pool_state: [tvl, volume, price_impact, ...]
  - liquidity_data: [depth, concentration, ...]
  - deployer_history: [age, contracts, reputation, ...]

Model Inference (private):
  - anomaly_flag = g(pool_state, liquidity_data, deployer_history)
  - Example: anomaly_flag = 0 (safe)

Proof Generation:
  - Prove: anomaly_flag == 0
  - Without revealing: analysis details

Output:
  - proof_calldata (Groth16, Garaga-compatible)
  - verification_result: boolean
```

**What's Hidden:**
- Pool analysis details
- Detection logic
- Model features
- Anomaly score

**What's Public:**
- Proof hash
- Safety status (boolean)
- Verification result

## Execution Proof Flow

### Constraint Satisfaction

```
Input:
  - user_constraints: {max_position, allowed_protocols, risk_limit}
  - proposed_action: {protocol_id, amount, action_type}

Proof Generation (Stone prover):
  - Prove: proposed_action satisfies user_constraints
  - Submit to Integrity fact registry

Output:
  - proof_hash (fact in Integrity)
  - verification: is_valid(proof_hash) == true
```

### Slippage Bounds

```
Input:
  - expected_price: price at decision time
  - execution_price: actual execution price
  - max_slippage: user-defined tolerance

Proof Generation (Stone prover):
  - Prove: |execution_price - expected_price| <= max_slippage
  - Submit to Integrity fact registry

Output:
  - proof_hash (fact in Integrity)
  - verification: is_valid(proof_hash) == true
```

## Combined Verification Flow

For a rebalancing execution, the agent generates multiple proofs:

```
1. zkML Proofs (Garaga):
   - risk_score_proof: prove(risk_score <= threshold)
   - anomaly_proof: prove(anomaly_flag == 0)

2. Execution Proofs (Integrity):
   - constraint_proof: prove(constraints_satisfied)
   - slippage_proof: prove(slippage_within_bounds)

3. Combined Verification (on-chain):
   - Verify Garaga proofs
   - Verify Integrity proofs
   - Execute only if ALL pass
```

### Contract Implementation

```cairo
fn execute_with_proofs(
    receipt_commitment: felt252,
    intent_hash: felt252,
    zkml_proof_calldata: Span<felt252>,  // Garaga proof
    execution_proof_hash: felt252,        // Integrity proof
    action_calldata: Span<felt252>
) {
    // Step 1: Verify zkML proofs (Garaga)
    let garaga = IGaragaVerifierDispatcher { contract_address: garaga_verifier };
    assert(
        garaga.verify_groth16_proof_bn254(zkml_proof_calldata),
        'Invalid zkML proof'
    );
    
    // Step 2: Verify execution proofs (Integrity)
    let integrity = IFactRegistryDispatcher { contract_address: fact_registry };
    assert(
        integrity.is_valid(execution_proof_hash),
        'Invalid execution proof'
    );
    
    // Step 3: Verify intent commitment (replay-safety)
    assert(
        !self.used_commitments.read(intent_hash),
        'Intent already used'
    );
    self.used_commitments.write(intent_hash, true);
    
    // Step 4: Execute action
    self._execute_action(action_calldata);
    
    // Step 5: Emit receipt
    self.emit(ConstraintReceipt {
        user: get_caller_address(),
        receipt_commitment,
        proof_hash: execution_proof_hash,
        timestamp: get_block_timestamp()
    });
}
```

## Privacy Guarantees

### What Stays Private

1. **zkML Model Outputs**
   - Actual risk scores
   - Anomaly detection details
   - Model inputs and features

2. **Transaction Amounts**
   - Deposit/withdrawal amounts
   - Position sizes
   - Balance information

3. **Strategy Details**
   - Allocation decisions
   - Rebalancing triggers
   - Trading patterns

### What's Verifiable

1. **Constraint Compliance**
   - Max position respected
   - Allowed protocols only
   - Risk limits honored

2. **Safety Checks**
   - Risk score within bounds
   - No anomalies detected
   - Slippage acceptable

3. **Execution Integrity**
   - Proofs verified on-chain
   - Receipts auditable
   - Intent commitments used

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER                                      │
│  Set constraints → Grant session key → Monitor agent             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT SERVICE                                 │
│  Monitor positions → Run zkML models → Generate proofs          │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│   zkML PROOFS (SNARK)   │     │ EXECUTION PROOFS (STARK)│
│                         │     │                         │
│  Risk Score Circuit     │     │  Constraint Proof       │
│  ├─ snarkjs prover      │     │  ├─ Stone prover        │
│  └─ Garaga verifier     │     │  └─ Integrity registry  │
│                         │     │                         │
│  Anomaly Circuit        │     │  Slippage Proof         │
│  ├─ snarkjs prover      │     │  ├─ Stone prover        │
│  └─ Garaga verifier     │     │  └─ Integrity registry  │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  COMBINED VERIFICATION                           │
│  Verify Garaga proofs → Verify Integrity proofs → Execute       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ON-CHAIN EXECUTION                            │
│  ProofGatedYieldAgent → DeFi Protocols (Ekubo, JediSwap)        │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Files

### Circuits (Circom)
- `circuits/RiskScore.circom` — Risk score model
- `circuits/AnomalyDetector.circom` — Anomaly detection model
- `circuits/PrivateDeposit.circom` — Confidential deposit
- `circuits/PrivateWithdraw.circom` — Confidential withdrawal

### Backend Services
- `backend/app/services/zkml_risk_service.py` — Risk model prover
- `backend/app/services/zkml_anomaly_service.py` — Anomaly model prover
- `backend/app/services/proof_pipeline.py` — Unified proof pipeline

### Contracts (Cairo)
- `contracts/src/zkml_verifier.cairo` — Garaga-based zkML verifier
- `contracts/src/proof_gated_yield_agent.cairo` — Main agent contract
- `contracts/src/session_key_manager.cairo` — Session key management
- `contracts/src/intent_commitment.cairo` — Replay-safe commitments

## Security Considerations

1. **Trusted Setup** — Groth16 requires a trusted setup ceremony. We use existing powers of tau and circuit-specific zkeys.

2. **Proof Freshness** — Intent commitments include block_number to prevent stale proofs.

3. **Replay Protection** — Commitments are marked as used after execution.

4. **Fork Safety** — chain_id included in commitments to prevent cross-chain replays.

5. **Model Integrity** — Model weights are committed in the circuit; changing the model requires new zkey.
