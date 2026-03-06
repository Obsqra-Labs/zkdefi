# Production Deployment Checklist for zkde.fi

## Critical: Remove Mock Proofs

### Backend Environment

**REQUIRED for production:**

```bash
# backend/.env - DO NOT SET THIS IN PRODUCTION
# ALLOW_SIMULATED_PROOFS=false  # default when unset

# Or explicitly set to false
ALLOW_SIMULATED_PROOFS=false
```

### Verify Production is NOT Using Mocks

Test the deployed backend:

```bash
# This should return 503 if circuits aren't built (which is correct for production without circuits)
curl https://zkde.fi/api/v1/zkdefi/private_deposit \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"user_address":"0x123","amount":1000000000000000000}'

# Expected response when ALLOW_SIMULATED_PROOFS=false and no circuits:
# Status: 503
# Body: {"detail":"Private deposit proof requires Groth16 circuit...","error_type":"simulated_proof_unavailable"}

# If you get back proof_calldata, circuits are working OR mocks are enabled (BAD if unintended)
```

## Production Options

### Option A: Deploy with Circuits (Full ZK)

**Requirements:**

1. Build all circuits:
   ```bash
   cd circuits
   npm install
   npx circom PrivateDeposit.circom --r1cs --wasm --sym -o build/
   npx circom PrivateWithdraw.circom --r1cs --wasm --sym -o build/
   npx circom RiskScore.circom --r1cs --wasm --sym -o build/
   npx circom AnomalyDetector.circom --r1cs --wasm --sym -o build/
   
   # Generate zkeys (requires powers of tau ceremony)
   npx snarkjs groth16 setup build/PrivateDeposit.r1cs pot12_final.ptau build/PrivateDeposit_final.zkey
   # ... repeat for each circuit
   ```

2. Deploy backend with circuits available at `circuits/build/`

3. Verify snarkjs is available: `npx snarkjs --version`

**Result:** All proof endpoints return REAL Groth16 proofs. Fully trustless.

### Option B: Deploy without Circuits (UI Demo Only)

If circuits aren't built and production has `ALLOW_SIMULATED_PROOFS=false`:

- Private deposit/withdraw: Returns 503
- Shielded pool: Returns 503
- zkML proofs: Returns 503
- UI still works for non-proof features (display, wallet connect, etc.)

**Use case:** Demo the UI without full ZK backend

### Option C: Staging with Simulated Proofs (NOT for main production)

Only for staging/testing environments:

```bash
# staging backend/.env
ALLOW_SIMULATED_PROOFS=true
```

**Warning:** Proofs are FAKE. Signatures are real, but proof data is cryptographic hashes, not Groth16.

## Current Production Status

As of deployment, check `zkde.fi` backend environment:

```bash
# SSH to production server
cat backend/.env | grep ALLOW_SIMULATED_PROOFS

# If not set or set to false: GOOD (production mode)
# If set to true: BAD (mocks enabled)
```

## Frontend Deployment

Frontend has no mock data after fixes. All mocks removed except:

- OnboardingWizard deposit (marked as demo mode, skips transaction)

## Verification Steps

1. **Check backend env:** `ALLOW_SIMULATED_PROOFS` should NOT be set or set to `false`
2. **Test proof endpoint:** Should return 503 if circuits unavailable (correct)
3. **Test wallet signature:** Private deposits should trigger wallet popup (real signature)
4. **Check transaction:** Submitted transactions should appear on Starkscan with real data

## User-Facing Behavior

### With Circuits (Production Full ZK)

- User clicks "Private Deposit"
- Backend generates real Groth16 proof (~750ms)
- Frontend prompts wallet signature
- Transaction submitted with REAL proof
- Verifiable on-chain

### Without Circuits (Production Demo Mode)

- User clicks "Private Deposit"
- Backend returns 503 error
- Frontend shows: "Proof generation unavailable. Set ALLOW_SIMULATED_PROOFS=true for local dev only."
- No transaction submitted
- User understands ZK proofs are not available

This prevents silently using fake proofs in production.
