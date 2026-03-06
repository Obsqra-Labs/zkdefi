# Withdrawal Issue: "Scalars and Points Length Mismatch"

## Current Status

✅ **Deposit:** WORKING - Proof verification passes, transactions succeed  
❌ **Withdrawal:** FAILING - "scalars and points length mismatch" from Garaga  
✅ **Backend:** Restarted and running on port 8003  

---

## The Error

```
Error in Garaga verifier:
"scalars and points length mismatch"
```

**Location:** During `verify_groth16_proof_bn254()` call in withdrawal transaction

---

## Root Cause

The **deposit** and **withdrawal** circuits have different structures:

### Deposit Circuit (Working)
```circom
template PrivateDeposit() {
    signal input amount;
    signal input nonce;
    signal input balance;
    // No public inputs
}
component main = PrivateDeposit();
```
**Public inputs:** None (all inputs are private)

### Withdrawal Circuit (Failing)
```circom
template PrivateWithdraw() {
    signal input amount;
    signal input nonce;
    signal input balance;
    signal input user_secret;
    signal input commitment_public;  // PUBLIC INPUT
}
component main {public [commitment_public]} = PrivateWithdraw();
```
**Public inputs:** `commitment_public` (revealed on-chain)

---

## Why This Causes "Length Mismatch"

Groth16 proofs with **public inputs** have a different structure than those without:

1. **Without public inputs (deposit):**
   - Proof elements: `[π_A, π_B, π_C]` + MSM hints
   - Public signals array: `[]` (empty)

2. **With public inputs (withdrawal):**
   - Proof elements: `[π_A, π_B, π_C]` + MSM hints
   - Public signals array: `[commitment_public, nullifier, commitment, amount_public]`
   - **The public signals affect the verification equation!**

The Garaga verifier expects the proof to include the public inputs in a specific way, and the current formatting doesn't handle this correctly.

---

## The Problem in Detail

When `garaga calldata` formats the withdrawal proof, it needs to:
1. Include the public input (`commitment_public`) in the verification
2. Adjust the MSM (multi-scalar multiplication) hints accordingly
3. Ensure scalar/point array lengths match

**Current behavior:** The formatter treats withdrawal like deposit (no public inputs), causing a length mismatch in Garaga's verification.

---

## What Needs to Happen

### Option 1: Fix Circuit Design (Simplest)
**Make withdrawal circuit have NO public inputs**, like deposit:

```circom
template PrivateWithdraw() {
    signal input amount;
    signal input nonce;
    signal input balance;
    signal input user_secret;
    signal input commitment;  // Make this PRIVATE too
    
    signal output nullifier;
    signal output commitment_out;  // Output instead
    signal output amount_public;
}
component main = PrivateWithdraw();  // No public inputs
```

**Pros:**
- Consistent with deposit circuit
- Same proof format (no special handling needed)
- Works with current Garaga formatter

**Cons:**
- Need to recompile circuit
- Need to regenerate trusted setup
- ~15-20 minutes of work

### Option 2: Fix Garaga Formatting (Complex)
Update `garaga_formatter.py` to detect and handle public inputs:

```python
def format_proof_for_garaga(proof_json, public_json, vk_path):
    # Check if proof has public inputs
    has_public_inputs = len(public_json) > 0
    
    if has_public_inputs:
        # Use different garaga CLI flags
        # --public-inputs flag needed
        # Different MSM hint calculation
        pass
```

**Pros:**
- Handles general case
- More "correct" approach

**Cons:**
- Complex to implement
- Need to understand Garaga's public input handling
- More testing required

### Option 3: Use Deposit-Style Proof for Withdrawal (Hack)
Pass commitment as a **private input** and output it:

```circom
signal input commitment;  // Private
signal output commitment_out;
commitment_out <== commitment;
```

**Pros:**
- Quick fix
- No proof format changes

**Cons:**
- Less secure (commitment should be public)
- Not standard practice

---

## Recommended Solution

**Option 1: Redesign withdrawal circuit** to have no public inputs.

This is the cleanest solution because:
1. ✅ Consistent with deposit (same proof format)
2. ✅ Works with existing Garaga formatter
3. ✅ Well-tested pattern (deposit already works)
4. ✅ Only 15-20 minutes to implement

**Steps:**
1. Update `PrivateWithdraw.circom` (remove public inputs)
2. Recompile: `circom PrivateWithdraw.circom --r1cs --wasm --sym`
3. Regenerate keys: `snarkjs groth16 setup` → `ptau` → `zkey`
4. Export verification key
5. Test withdrawal proof generation
6. Try withdrawal transaction again

---

## Current Workaround

**Use deposit-style pattern for testing:**
- Store commitment in localStorage (already done)
- Pass commitment as private input
- Output it as public output
- Contract receives it as calldata

This lets you test the withdrawal flow while we fix the circuit.

---

## Files Involved

- `circuits/PrivateWithdraw.circom` - Circuit definition
- `circuits/build/PrivateWithdraw_final.zkey` - Proving key
- `circuits/build/PrivateWithdraw_verification_key.json` - Verification key
- `backend/app/services/groth16_prover.py` - Proof generation
- `backend/app/services/garaga_formatter.py` - Garaga formatting

---

## Timeline

**Quick fix (Option 1):** ~20 minutes
- Modify circuit: 2 min
- Compile: 1 min
- Setup trusted setup: 5 min
- Generate keys: 10 min
- Test: 2 min

**Complex fix (Option 2):** ~2-3 hours
- Research Garaga public inputs: 1 hour
- Implement formatting: 1 hour
- Test and debug: 1 hour

---

## Summary

**What works:** Private deposits with zero-knowledge proof verification ✅

**What doesn't:** Private withdrawals due to public input handling mismatch ❌

**Why:** Withdrawal circuit has public inputs, deposit doesn't. Garaga formatter doesn't handle this case.

**Solution:** Redesign withdrawal circuit to match deposit pattern (no public inputs).

---

## Testing Once Fixed

1. Make a deposit (already working)
2. Check commitment appears in localStorage
3. Try withdrawal
4. Should succeed with no "scalars and points length mismatch" error

---

**Next:** Choose which option to implement. Option 1 is fastest and cleanest.
