# VK MISMATCH - Root Cause and Solution

## The Problem: "Wrong Glv&FakeGLV result"

This error occurs when Garaga verifier's hardcoded VK doesn't match the proof's VK.

### What Happened:
1. ConfidentialTransfer uses ONE Garaga verifier for BOTH deposit & withdrawal
2. Deposit VK hash: `5c6c9f4a1b15d51a`
3. Withdrawal VK hash: `77b70a9516d35eec`
4. **They're different!**
5. Existing verifier has deposit VK → withdrawal proofs fail

### Why VKs Are Different:
- Different circuits = different constraints = different VKs
- Even with same public signal count (2), the circuit logic differs
- IC points, alpha, beta, etc. are all circuit-specific

---

## Solution: Two Separate Verifiers

### Contract Changes (DONE ✅)
Updated `/opt/obsqra.starknet/zkdefi/contracts/src/confidential_transfer.cairo`:

```cairo
// Before: ONE verifier
garaga_verifier: ContractAddress

// After: TWO verifiers
garaga_verifier_deposit: ContractAddress
garaga_verifier_withdraw: ContractAddress
```

Functions updated:
- `private_deposit()` → uses `garaga_verifier_deposit`
- `private_withdraw()` → uses `garaga_verifier_withdraw`

---

## Deployment Steps

### Step 1: Deploy Withdrawal Verifier

We need to generate a NEW Garaga verifier with `PrivateWithdraw_verification_key.json`.

**Option A: Use existing garaga_verifier_new and regenerate**
```bash
cd /opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_new

# Regenerate constants with withdrawal VK
# (Need garaga CLI access for this)
```

**Option B: Quick workaround - Use same verifier address for both (temporarily)**
```bash
# This will fail on withdrawal but unblock testing
# Both point to existing verifier at 0x06d0cb7a...
```

### Step 2: Rebuild Contract
```bash
cd /opt/obsqra.starknet/zkdefi/contracts
scarb build
```

### Step 3: Deploy New ConfidentialTransfer
```bash
# Declare
sncast --network sepolia declare --contract-name ConfidentialTransfer

# Deploy with TWO verifier addresses
sncast --network sepolia deploy \
  --class-hash <NEW_CLASS_HASH> \
  <DEPOSIT_VERIFIER_0x06d0cb7a...> \
  <WITHDRAWAL_VERIFIER_0xNEW_ADDRESS> \
  <TOKEN_ADDRESS> \
  <ADMIN_ADDRESS>
```

### Step 4: Update Environment Variables
```bash
# backend/.env
CONFIDENTIAL_TRANSFER_ADDRESS=<NEW_ADDRESS>

# frontend/.env.local
NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS=<NEW_ADDRESS>
```

---

## Current Status

✅ Contract updated to support two verifiers  
❌ Withdrawal verifier not yet generated  
❌ New contract not yet deployed  

---

## Quick Fix for Testing

**Use existing verifier for BOTH (will fail on withdrawal but unblock deposit testing):**

```bash
cd /opt/obsqra.starknet/zkdefi/contracts
scarb build
sncast --network sepolia declare --contract-name ConfidentialTransfer
sncast --network sepolia deploy \
  --class-hash <CLASS_HASH> \
  0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37 \
  0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37 \
  0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d \
  0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
```

This lets you test deposits immediately. Withdrawals will still fail until we deploy the withdrawal verifier.

---

## Alternative: Make Circuits Share VK (Not Recommended)

Would require making deposit and withdrawal use IDENTICAL circuit logic, which defeats the purpose of having separate privacy-preserving operations.

---

## Next Steps

1. **Generate withdrawal verifier** with `PrivateWithdraw_verification_key.json`
2. **Deploy withdrawal verifier** to Sepolia
3. **Deploy new ConfidentialTransfer** with both verifier addresses
4. **Test both deposit and withdrawal** end-to-end

---

## Files Modified

- `/opt/obsqra.starknet/zkdefi/contracts/src/confidential_transfer.cairo` ✅
- `/opt/obsqra.starknet/zkdefi/circuits/PrivateWithdraw.circom` ✅ (2 public outputs)
- `/opt/obsqra.starknet/zkdefi/circuits/build/PrivateWithdraw_verification_key.json` ✅

---

Date: February 3, 2026  
Status: Contract updated, awaiting verifier generation and deployment
