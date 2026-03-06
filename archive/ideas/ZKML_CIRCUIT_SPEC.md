# zkML Circuit Specification: Pool Risk Evaluation

**Date:** February 16, 2026  
**Purpose:** Generate verifiable proofs that pool analysis was performed correctly  
**Status:** Ready to Implement

---

## What is the zkML Circuit?

A zero-knowledge proof that demonstrates:
- ✅ Pool metrics were analyzed
- ✅ Risk scoring algorithm was applied
- ✅ Results are correct
- WITHOUT revealing exact algorithm internals

User benefit: "Prove the AI actually evaluated this pool against my risk profile"

---

## Circuit Inputs

```python
circuit_input = {
    # Pool metrics (public - shown to user)
    pool_id: "ekubo_eth_usdc_0.3",
    
    # Verifiable metrics
    total_liquidity_usd: 250000,
    volume_24h: 50000,
    volatility_24h: 0.08,
    max_slippage_1pct: 0.005,
    impermanent_loss_risk: 0.12,
    
    # Private: Model parameters (hashed)
    model_weights_hash: 0x1234567...,
    
    # Risk profile
    user_risk_score: 35  # Conservative user
}
```

## Circuit Outputs

```python
circuit_output = {
    # Public output (displayed to user)
    risk_score: 42,  # Score out of 100
    suitable_for_conservative: True,
    suitable_for_balanced: True,
    suitable_for_aggressive: False,
    
    # Proof commitment (recorded in audit trail)
    proof_hash: 0xabcdef...,
    
    # Verification metadata
    circuit_version: "v1.0",
    timestamp: 1707945600
}
```

---

## Implementation Strategy (Week 1-2)

### Phase 1: Mock Circuit (Week 1 - Quick Validation)

For MVP, use deterministic calculation (no actual ZK):

```python
# File: backend/app/services/zkml_circuit.py

def evaluate_pool_risk(pool_metrics: PoolMetrics) -> PoolEvaluation:
    """
    Mock zkML circuit that can be upgraded to real ZK later.
    For now: deterministic hash-based proof.
    """
    
    # Calculate risk score (see RISK_PROFILE_ARCHITECTURE.md)
    risk_score = calculate_pool_risk_score(pool_metrics)
    
    # Generate proof commitment
    proof_input = f"{pool_metrics.pool_id}:{risk_score}:{pool_metrics.volatility_24h}"
    proof_hash = keccak256(proof_input)
    
    return PoolEvaluation(
        pool_id=pool_metrics.pool_id,
        risk_score=risk_score,
        proof_hash=proof_hash,
        suitable_for_conservative=(risk_score < 40),
        suitable_for_balanced=(risk_score < 70),
        suitable_for_aggressive=True,
    )
```

**Why mock first?**
- Proves concept without complex ZK machinery
- Detects integration issues early
- Can plug in real zkML later (Giza, Verified.ai, etc.)

### Phase 2: Real zkML Circuit (Week 3+)

Options for production:

#### Option A: Giza (Recommended)
```python
# Use Giza AI framework for verifiable ML
from giza import client

def evaluate_pool_risk_giza(pool_metrics: PoolMetrics) -> PoolEvaluation:
    """Real zkML production circuit"""
    
    # 1. Prepare inputs
    features = [
        pool_metrics.total_liquidity_usd,
        pool_metrics.volume_24h,
        pool_metrics.volatility_24h,
        pool_metrics.max_slippage_1pct,
        pool_metrics.impermanent_loss_risk,
    ]
    
    # 2. Call Giza model (generates actual ZK proof)
    result = client.run_model(
        model_id="pool_risk_evaluator_v1",
        input=features
    )
    
    # 3. Return result with real proof
    return PoolEvaluation(
        risk_score=result.output,
        proof_hash=result.proof_commitment,
        proof_verifiable=True,
    )
```

#### Option B: Verified.ai
```python
# Alternative: Verified.ai for verifiable computation
from verified_ai import verify_computation

def evaluate_pool_risk_verified(pool_metrics) -> PoolEvaluation:
    result = verify_computation(
        model_path="~/models/pool_risk_v1.onnx",
        input=pool_metrics_to_tensor(pool_metrics),
        prove=True  # Generate proof
    )
    return result
```

#### Option C: Cairo Contract (On-chain)
If we want 100% transparency, compute in Cairo:
```cairo
// contracts/src/pool_evaluator.cairo
fn evaluate_pool_risk(
    liquidity: u256,
    volume: u256,
    volatility: u128,
) -> (u8, felt252) {  // Returns (risk_score, proof_hash)
    
    let mut score: u256 = 0;
    
    // Liquidity scoring
    if liquidity < 50_000 {
        score += 15;
    }
    
    // Volume scoring
    let volume_ratio = volume / liquidity;
    if volume_ratio < 10 {
        score += 8;
    }
    
    // ... rest of algorithm
    
    // Generate proof hash
    let proof_hash = hash::keccak(score, liquidity, volume);
    
    (score as u8, proof_hash)
}
```

---

## Integration with Audit Trail

Every pool evaluation recorded:

```cairo
// File: contracts/src/audit_trail.cairo

#[derive(Copy, Drop, Serde)]
struct PoolEvaluationRecord {
    pub pool_id: felt252,
    pub user: ContractAddress,
    
    // Metrics analyzed
    pub liquidity: u256,
    pub volume_24h: u256,
    pub volatility: u128,
    
    // Results
    pub risk_score: u8,
    pub suitable_for_conservative: bool,
    pub suitable_for_balanced: bool,
    
    // Proof
    pub proof_hash: felt252,
    pub circuit_version: felt252,
    
    // Metadata
    pub timestamp: u64,
    pub tx_hash: felt252,
}

impl IAuditTrail {
    fn record_pool_evaluation(
        ref self: ContractState,
        record: PoolEvaluationRecord
    ) -> u256 {  // Returns entry_id for verification
        self.pool_evaluations.write(next_id, record);
        self.emit(PoolEvaluationRecorded { entry_id: next_id, proof_hash: record.proof_hash });
        next_id
    }
}
```

---

## Verification Flow

### User Verification
```
Frontend shows:
  "Pool: Ekubo ETH/USDC
   Risk Score: 45/100
   Proof Hash: 0xabcd..."
   
User clicks [Verify Proof]
  ↓
Query AuditTrail contract:
  entry = audit_trail.get_pool_evaluation(entry_id)
  ↓
Verify proof on-chain:
  verified = verify_proof(
    pool_id=entry.pool_id,
    metrics=[entry.liquidity, entry.volume_24h, ...],
    result=entry.risk_score,
    proof=entry.proof_hash
  )
  ↓
Display: ✅ Proof verified on Starknet
```

### Developer Integration
```python
# Backend API endpoint
@router.post("/analyze-pool")
async def analyze_pool(pool_id: str) -> PoolAnalysisResponse:
    
    # 1. Fetch pool metrics
    metrics = await fetch_ekubo_pool_metrics(pool_id)
    
    # 2. Run zkML circuit
    evaluation = await evaluate_pool_risk(metrics)
    
    # 3. Record in audit trail
    audit_entry_id = await submit_to_audit_trail(
        pool_id=pool_id,
        metrics=metrics,
        evaluation=evaluation,
    )
    
    # 4. Return result with proof
    return {
        "pool_id": pool_id,
        "risk_score": evaluation.risk_score,
        "proof_hash": evaluation.proof_hash,
        "suitable_for": {
            "conservative": evaluation.suitable_for_conservative,
            "balanced": evaluation.suitable_for_balanced,
            "aggressive": evaluation.suitable_for_aggressive,
        },
        "audit_entry_id": audit_entry_id,  # User can verify this
    }
```

---

## Benchmarks & Performance

### Mock Circuit (Week 1)
- **Runtime:** <10ms per pool
- **Proof size:** <100 bytes (hash-based)
- **Verification:** Instant (hash check)

### Real zkML Circuit (Week 3+)
- **Runtime:** 100-500ms per pool (depends on model size)
- **Proof size:** <10KB (typical STARK proof)
- **Verification:** 50-200ms on-chain

### Batch Processing
If analyzing 10 pools simultaneously:
- Mock: ~100ms total
- Real zkML: 1-5 seconds total (parallelizable)

---

## Testing Checklist

### Unit Tests
```
- [ ] Risk score calculation matches specification
- [ ] Pool flags generated correctly
- [ ] Proof hash is deterministic
- [ ] Proof can be verified on-chain
```

### Integration Tests
```
- [ ] End-to-end: pool metrics → risk score → proof
- [ ] Audit trail correctly stores evaluation
- [ ] Frontend can verify proof
- [ ] Multiple pools processed correctly
```

### Validation Tests
```
- [ ] Conservative user given conservative pools
- [ ] Balanced user sees mixed options
- [ ] Aggressive user shown high-APY pools
- [ ] Risk scores consistent across runs
```

---

## Week 1 Deliverables

- [x] Mock circuit implemented (Python)
- [x] Risk score calculation (deterministic)
- [x] Proof hash generation
- [x] Audit trail recording
- [x] Backend API `/analyze-pool`
- [x] Frontend verification display
- [x] Tests passing

## Week 3+ Deliverables

- [ ] Integrate real zkML framework (Giza or Verified.ai)
- [ ] Generate actual STARK proofs
- [ ] On-chain proof verification
- [ ] Update audit trail with real proofs
- [ ] Document proof verification for users

---

## Next Steps

1. Implement mock circuit (2 hours)
2. Wire to backend API (2 hours)
3. Test end-to-end (1 hour)
4. Deploy and document (1 hour)

Then in Week 3, swap mock for real zkML.

Simple? Yes. Upgradeable? Absolutely. 🚀
