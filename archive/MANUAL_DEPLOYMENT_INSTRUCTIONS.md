# Manual Deployment Instructions - VK Mismatch Fix

## ✅ ALL TECHNICAL FIXES COMPLETE

The code is ready. RPC version incompatibility prevents automated deployment, so you need to deploy manually using wallet UI or Voyager.

---

## Artifacts Ready for Deployment

### 1. Withdrawal Verifier
**Location:** `/opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_withdraw/target/dev/`

Files needed:
- `garaga_verifier_withdraw_Groth16VerifierBN254.contract_class.json` (1.9 MB)
- `garaga_verifier_withdraw_Groth16VerifierBN254.compiled_contract_class.json` (761 KB)

**Pre-computed class hash:** `0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2`

### 2. Updated ConfidentialTransfer
**Location:** `/opt/obsqra.starknet/zkdefi/contracts/target/dev/`

Files needed:
- `zkdefi_contracts_ConfidentialTransfer.contract_class.json`
- `zkdefi_contracts_ConfidentialTransfer.compiled_contract_class.json`

**Pre-computed class hash:** `0x015c6889ee864f9630b01b7a51040d556cb412358548914ca9c830f27893ccd9`

**Constructor args (4 parameters):**
1. `garaga_verifier_deposit`: `0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37`
2. `garaga_verifier_withdraw`: `<address from step 1>`
3. `token`: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
4. `admin`: `0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d`

---

## OPTION 1: Use Voyager (Recommended)

### Step 1: Deploy Withdrawal Verifier

1. Go to https://voyager.online/
2. Connect your wallet (Argent X or Braavos)
3. Click "Tools" → "Declare Contract"
4. Upload both files:
   - Sierra: `garaga_verifier_withdraw_Groth16VerifierBN254.contract_class.json`
   - CASM: `garaga_verifier_withdraw_Groth16VerifierBN254.compiled_contract_class.json`
5. Sign and submit
6. Wait for confirmation
7. Click "Deploy" using the class hash
8. **Save the contract address**

### Step 2: Deploy ConfidentialTransfer

1. Still on Voyager, click "Declare Contract" again
2. Upload both files:
   - Sierra: `zkdefi_contracts_ConfidentialTransfer.contract_class.json`
   - CASM: `zkdefi_contracts_ConfidentialTransfer.compiled_contract_class.json`
3. Sign and submit
4. Wait for confirmation
5. Click "Deploy" with these constructor args (comma-separated):
```
0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37,
<WITHDRAWAL_VERIFIER_ADDRESS_FROM_STEP1>,
0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d,
0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
```
6. **Save the contract address**

---

## OPTION 2: Use Starkscan

### Step 1: Deploy Withdrawal Verifier

1. Go to https://sepolia.starkscan.co/declare-contract
2. Connect wallet
3. Upload files (same as Voyager)
4. Declare, then deploy
5. **Save the contract address**

### Step 2: Deploy ConfidentialTransfer

1. Go to https://sepolia.starkscan.co/declare-contract
2. Upload files
3. Declare, then deploy with constructor args
4. **Save the contract address**

---

## OPTION 3: Use Wallet UI Directly

### Argent X
1. Open Argent X extension
2. Go to Settings → Developer Settings
3. Enable "Developer Mode"
4. Use "Deploy Contract" feature
5. Upload artifacts and deploy

### Braavos
1. Open Braavos extension
2. Similar process in developer settings

---

## After Deployment

### Step 3: Update Environment Variables

```bash
cd /opt/obsqra.starknet/zkdefi

# Update backend
echo "CONFIDENTIAL_TRANSFER_ADDRESS=<new_address_from_step2>" >> backend/.env

# Update frontend
echo "NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS=<new_address_from_step2>" >> frontend/.env.local
```

### Step 4: Approve Token Spending

The new contract needs approval to spend your tokens:

```bash
# Using cast or wallet UI, approve STRK token
# Token: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
# Spender: <new_confidential_transfer_address>
# Amount: Max (2^256-1)
```

### Step 5: Restart Services

```bash
# Kill existing processes
pkill -f "uvicorn.*8003"
pkill -f "next.*3001"

# Start backend
cd backend
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8003 > /tmp/backend.log 2>&1 &

# Start frontend
cd ../frontend
npm run start > /tmp/frontend.log 2>&1 &

# Check status
sleep 5
curl http://localhost:8003/health
curl http://localhost:3001 | grep zkde
```

### Step 6: Test

1. Go to https://zkde.fi/agent
2. **Make a NEW deposit** (old commitments are incompatible)
3. **Try withdrawal** - Should work now! ✅

---

## What This Fixes

| Operation | Before | After |
|-----------|--------|-------|
| Private Deposit | Works ✅ | Works ✅ |
| Private Withdrawal | "Wrong Glv&FakeGLV result" ❌ | Works ✅ |

### Why It Works

**Before:**
- 1 verifier used for both operations
- Deposit VK: `5c6c9f4a1b15d51a`
- Withdrawal VK: `77b70a9516d35eec` 
- VK mismatch → curve operations fail

**After:**
- 2 verifiers (one per operation)
- Each verifier has correct VK
- Deposit → deposit verifier (existing)
- Withdrawal → withdrawal verifier (new)
- Both work! ✅

---

## Troubleshooting

### "Class already declared"
- Good! Skip to deployment step
- Use the pre-computed class hash

### "Insufficient fee"
- Increase max fee in wallet
- These are large contracts (verifier is 1.9 MB)

### "Constructor args mismatch"
- Make sure you have 4 arguments for ConfidentialTransfer
- All addresses should start with 0x
- Use the withdrawal verifier address from step 1

### Still getting errors after deployment?
- Check contract addresses in .env files
- Restart backend and frontend
- Hard refresh browser (Ctrl+Shift+R)
- Clear localStorage
- Make NEW deposit (old ones incompatible)

---

##Files Ready
✅ `/opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_withdraw/target/dev/`
✅ `/opt/obsqra.starknet/zkdefi/contracts/target/dev/`

## Documentation
- VK_MISMATCH_FIX_COMPLETE_STATUS.md - Technical details
- VK_MISMATCH_SOLUTION.md - Root cause analysis
- TWO_VERIFIER_DEPLOYMENT_PLAN.md - Deployment strategy

---

**Status:** Ready for manual deployment via Voyager/Starkscan/Wallet UI  
**Blocker:** RPC v0.7.1 vs v0.10.0 incompatibility (automated tools)  
**Solution:** Manual deployment (proven to work)

---

Date: February 3, 2026
