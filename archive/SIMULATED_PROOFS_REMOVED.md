# All Simulated Proofs Removed

## Summary

All simulated/mock proof functionality has been **completely removed** from the zkde.fi codebase. The system now **only generates real proofs** or fails with clear error messages.

## Changes Made

### 1. Configuration (`backend/app/config.py`)
- ❌ Removed `ALLOW_SIMULATED_PROOFS` environment variable
- ❌ Removed `SimulatedProofError` exception class
- ✅ No more gating logic for simulated proofs

### 2. Proof Pipeline (`backend/app/services/proof_pipeline.py`)
- ❌ Removed simulated execution proof fallback
- ✅ Now raises `RuntimeError` if Stone prover integration is not available
- ✅ Clear error message: "Execution proof generation not yet implemented"

### 3. Full Privacy Service (`backend/app/services/full_privacy_proof_service.py`)
- ❌ Removed `_generate_mock_proof()` method entirely
- ❌ Removed all fallback logic in `_generate_groth16_proof()`
- ✅ Now requires actual circuit files (`.wasm`, `.zkey`)
- ✅ Raises `RuntimeError` with build instructions if circuits missing
- ✅ Raises `RuntimeError` if `snarkjs` proof generation fails

### 4. zkML Risk Service (`backend/app/services/zkml_risk_service.py`)
- ❌ Removed `_generate_simulated_proof()` method
- ❌ Removed simulated proof fallback logic
- ✅ Raises `RuntimeError` if circuits not built
- ✅ Clear error: "Run: cd circuits && npm run build:riskscore"

### 5. zkML Anomaly Service (`backend/app/services/zkml_anomaly_service.py`)
- ❌ Removed `_generate_simulated_proof()` method
- ❌ Removed simulated proof fallback logic
- ✅ Raises `RuntimeError` if circuits not built
- ✅ Clear error: "Run: cd circuits && npm run build:anomalydetector"

### 6. Compliance Service (`backend/app/services/compliance_service.py`)
- ❌ Removed all simulated proof generation
- ✅ Raises `RuntimeError` for unimplemented features
- ✅ Clear messaging about required integrations

### 7. Main App (`backend/app/main.py`)
- ❌ Removed commented-out `SimulatedProofError` exception handler
- ✅ Clean startup with no proof simulation logic

## Current Behavior

### Full Privacy Pool (Working)
- ✅ **Real snarkjs proofs** for deposit/withdraw
- ✅ Actual merkle tree proof verification
- ✅ **No simulation** - if circuits aren't built, it fails

### zkML Proofs (Not Yet Built)
- ⚠️ Raises `RuntimeError` if circuits not compiled
- ⚠️ Provides clear instructions for building circuits
- ✅ **No fallback to simulated data**

### Execution Proofs (Not Yet Integrated)
- ⚠️ Raises `RuntimeError` - requires Stone prover integration
- ✅ **No fallback to simulated data**

## Error Messages

All services now provide **clear, actionable error messages**:

```
RuntimeError: Full privacy proof requires built circuits (FullPrivacyWithdraw.wasm, FullPrivacyWithdraw_final.zkey). 
Run: cd circuits && npm run build:fullprivacywithdraw
```

```
RuntimeError: Risk score proof requires built circuits (RiskScore.wasm, RiskScore_final.zkey). 
Run: cd circuits && npm run build:riskscore
```

```
RuntimeError: Execution proof generation not yet implemented. 
Requires integration with obsqra.fi Stone prover.
```

## Testing

### Verified Working
- ✅ Full Privacy Pool deposit (real Groth16 proof via snarkjs)
- ✅ Full Privacy Pool withdrawal (real Groth16 proof via snarkjs)
- ✅ Backend merkle tree sync
- ✅ Frontend auto-clears old commitments

### Expected Failures (By Design)
- ⚠️ zkML risk score proof (circuits not built yet)
- ⚠️ zkML anomaly detection proof (circuits not built yet)
- ⚠️ Execution proofs (Stone prover not integrated yet)

## Production Readiness

✅ **No simulated proofs can ever be generated**
✅ **Clear error messages** for missing components
✅ **Full Privacy Pool works with real proofs**
✅ **No environment variable bypasses**
✅ **Fail-fast behavior** - errors surface immediately

## Next Steps

To enable additional proof types:

1. **zkML Proofs**: Build risk/anomaly circuits
   ```bash
   cd circuits
   npm run build:riskscore
   npm run build:anomalydetector
   ```

2. **Execution Proofs**: Integrate Stone prover
   - Connect to obsqra.fi Stone prover API
   - Implement STARK proof generation
   - No simulated fallback - real proofs only

---

**Status**: ✅ Complete - All simulated proof logic removed
**Date**: Feb 4, 2026
**Tested**: Full Privacy Pool working with real proofs on zkde.fi
