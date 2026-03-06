# Mock/Simulated Proofs Removed from Production

## Summary

Found and gated ALL mock proof generation behind `ALLOW_SIMULATED_PROOFS` flag. Production (zkde.fi) must run with this flag unset/false.

## Issues Found

### 1. Backend: Fake Groth16 proofs using sha256 hashes

**Location:** `backend/app/services/zkdefi_agent_service.py`

- `generate_shielded_deposit_proof` (line 620+) - used sha256 hashes instead of real Groth16
- `generate_shielded_withdraw_proof` (line 689+) - used sha256 hashes instead of real Groth16
- `generate_private_withdraw_proof` fallback (line 457+) - returned mock proof when Groth16 failed

**Issue:** These methods said "Fast proof generation (Groth16 is too slow for dev)" and used cryptographic hashes to generate fake proof calldata. The frontend called `account.execute` with these fake proofs, wallet signed (this is REAL), but the proof data was FAKE.

**Fix:** Added `ALLOW_SIMULATED_PROOFS` check at the start of each method. When false (production), raises `SimulatedProofError` instead of returning fake proofs.

### 2. Frontend: OnboardingWizard mock deposit

**Location:** `frontend/src/components/zkdefi/OnboardingWizard.tsx` line 142

- `handleDeposit` just called `toastSuccess("Agent funded")` without any transaction

**Fix:** Added comment that this is demo mode. Onboarding wizard is for demo; real deposits happen in PrivateTransferPanel/ShieldedPoolPanel.

## What's NOT Mocked

The following are REAL and always work:

1. **Wallet signatures** - `account.execute` calls trigger real wallet signatures
2. **On-chain transactions** - all `account.execute` calls submit real transactions
3. **Contract interactions** - approve, deposit, withdraw all happen on-chain

The ONLY thing that was mocked: the PROOF DATA being passed to the contracts.

## Production Deployment

To ensure production runs with real proofs only:

1. **Do NOT set** `ALLOW_SIMULATED_PROOFS` in production env
2. Ensure circuits are built: `PrivateDeposit.circom`, `PrivateWithdraw.circom`, `RiskScore.circom`, `AnomalyDetector.circom`
3. If circuits aren't available, API endpoints will return 503 with clear error message

## Local Development

For local dev without circuits:

```bash
# backend/.env
ALLOW_SIMULATED_PROOFS=true
```

This allows the backend to return simulated proofs for testing UI flows without building circuits.

## Services Gated

All services now check `ALLOW_SIMULATED_PROOFS` before returning simulated data:

1. `full_privacy_proof_service.py` - Full privacy proofs (snarkjs fallback)
2. `zkml_risk_service.py` - Risk score proofs (circuits_ready check)
3. `zkml_anomaly_service.py` - Anomaly detection proofs (circuits_ready check)
4. `compliance_service.py` - All 4 compliance proof methods
5. `proof_pipeline.py` - Execution proofs (obsqra.fi calls)
6. `zkdefi_agent_service.py` - Shielded and private deposit/withdraw proofs

## API Behavior

When `ALLOW_SIMULATED_PROOFS=false` (production) and circuits/prover unavailable:

- Endpoints return `503 Service Unavailable`
- Response body: `{"detail": "Clear error message", "error_type": "simulated_proof_unavailable"}`
- Frontend shows error toast, user knows proofs are not available

This ensures production NEVER silently uses fake proofs.
