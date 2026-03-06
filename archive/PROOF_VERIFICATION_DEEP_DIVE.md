# 🔬 Deep Dive: "Invalid Proof" Root Cause Analysis

## Current Status: Still "Invalid Proof" Error

**Error Message:**
```
Error in contract (address: 0x07fdc7c21ab074e7e1afe57edfcb818be183ab49f4bf31f9bf86dd052afefaa4):
0x496e76616c69642070726f6f66 ('Invalid proof').
```

## What We've Confirmed ✅

1. **VK Is Correct**: The deployed Garaga verifier's VK constants are IDENTICAL to the circuit's VK
2. **Format Is Correct**: Using `--format starkli` produces proper space-separated decimal format
3. **No Overflow**: All 1949 proof values are < Starknet prime (0x800000...001)
4. **Circuit Compiles**: Test witness generation works, proof generation works
5. **Public Signals Match**: Test proof produces correct commitment = amount * 0x10000 + nonce

## Test Proof Verification

```bash
# Generated test proof with known inputs:
Input: amount=1000000000000000000, balance=10000000000000000000, nonce=123
Output: commitment=65536000000000000000123, amount=1000000000000000000
Proof: 1949 values, all < prime
```

✅ Circuit logic is correct
✅ Witness generation is correct
✅ Public signals are correct

## The Mystery 🤔

If everything above is correct, why does the Garaga verifier reject the proof?

### Possible Causes

#### 1. **Garaga CLI Bug or Version Mismatch**
- We're using `garaga==1.0.1`
- The deployed verifier might have been generated with a different version
- The MSM hints might be incorrect for this specific verifier deployment

**How to test:**
```bash
# Check if there's a garaga test vector we can use
docker run --rm python:3.10-slim bash -c "
  pip install garaga==1.0.1 && \
  python -c 'import garaga; print(garaga.__version__)'
"
```

#### 2. **Circuit/VK Mismatch Despite Identical Constants**
- The VK file might be from a different circuit compilation
- Even with identical constants, the constraint system might differ
- The R1CS might have changed between compilations

**How to verify:**
```bash
# Compare R1CS file hash with what was used to generate deployed verifier
sha256sum circuits/build/PrivateDeposit.r1cs
```

#### 3. **Proof Points Not On Curve**
- The proof points (pi_a, pi_b, pi_c) might not be valid curve points
- This would happen if snarkjs output is malformed

**How to check:**
- Manually verify proof points are on BN254 curve
- Check if `garaga calldata` validates points before formatting

#### 4. **Public Inputs Encoding**
- Garaga might expect public inputs in a specific format
- The order or encoding of public signals might be wrong

**Current format:** `[commitment, amount_public]`  
**Garaga expects:** ???

#### 5. **The Deployed Verifier Is Wrong**
- Despite VK constants matching, the deployed verifier contract itself might have bugs
- The contract at `0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37` might not be a proper Garaga verifier

**How to verify:**
- Check class hash: `0x4e7a5bbcefcb9e1d7fb2229375df104003f270bd09ec7c44aceb1bce3b39061`
- Compare with official Garaga class hash
- Check if this is a custom/modified version

## Immediate Next Steps 🎯

### 1. Verify Deployed Verifier Contract

```bash
# Check the contract class
starkli class-at \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7 \
  0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37
```

### 2. Try Known-Good Test Vector

Find a garaga example proof that definitely works and try it:
```bash
# From garaga docs/examples
curl https://raw.githubusercontent.com/keep-starknet-strange/garaga/main/tests/fixtures/groth16_example_bn254.json
```

### 3. Check Garaga Version Compatibility

```python
# In garaga repo
git log --grep="bn254" --grep="groth16" --oneline | head -20
# Check if there were breaking changes between v1.0.0 and v1.0.1
```

### 4. Deploy Fresh Verifier

Despite VK match, the safest approach:
```bash
cd circuits/contracts/src/garaga_verifier_new
# Use a working RPC or wait for RPC fix
# Deploy the freshly generated verifier
# Update .env with new address
# Test again
```

### 5. Contact Garaga Team

- Open issue on garaga GitHub
- Provide: VK, test proof, error message
- Ask if there's a known issue with v1.0.1

## Technical Details

### Circuit Structure
- **Inputs**: amount (private), balance (private), nonce (private)
- **Outputs**: commitment (public), amount_public (public)  
- **Constraint**: `commitment <== amount * 0x10000 + nonce`
- **nPublic**: 2
- **VK IC length**: 3 (correct: nPublic + 1)

### Proof Format (Starkli)
```
Line 1: 1949 (length)
Lines 2-1950: space-separated decimal values
  - MSM hints
  - Pairing check hints
  - Proof points (pi_a, pi_b, pi_c)
  - Public inputs
```

### Backend Flow
```
User Request → Backend API → groth16_prover.py
  ↓
Generate witness (snarkjs)
  ↓
Generate proof (snarkjs groth16 prove)
  ↓
Format with Garaga CLI (Docker)
  ↓
Return to frontend
  ↓
Frontend → Confidential Transfer Contract
  ↓
Contract → Garaga Verifier
  ↓
Verifier returns: ❌ Invalid proof
```

## Recommendation

**The safest path forward is to deploy a fresh Garaga verifier** even though the VK matches. There may be subtle differences in:
- Contract implementation details
- Hint generation algorithms
- Curve arithmetic implementations

Once we have a verifier that we KNOW was generated from our exact VK file using the latest garaga version, we can be 100% confident it should work.

---

**Next Action:** Wait for RPC fix or try alternative deployment method to get the new verifier on-chain.
