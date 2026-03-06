# VK Mismatch Fix - Complete Status

## ✅ FIXED: Root Cause Identified and Resolved

### The Problem
**Error:** `"Wrong Glv&FakeGLV result"` from Garaga verifier

**Root Cause:** 
- ConfidentialTransfer contract uses ONE Garaga verifier for BOTH deposit & withdrawal
- But PrivateDeposit and PrivateWithdraw have DIFFERENT verification keys!
- Deposit VK hash: `5c6c9f4a1b15d51a`
- Withdrawal VK hash: `77b70a9516d35eec` 
- When withdrawal proof (with VK #2) hits verifier configured for VK #1 → curve operations fail

---

## ✅ What Was Fixed

### 1. Contract Updated (/opt/obsqra.starknet/zkdefi/contracts/src/confidential_transfer.cairo)
Changed from ONE verifier to TWO:

```cairo
// Storage - BEFORE
garaga_verifier: ContractAddress

// Storage - AFTER
garaga_verifier_deposit: ContractAddress
garaga_verifier_withdraw: ContractAddress
```

**Functions updated:**
- `private_deposit()` → uses `garaga_verifier_deposit.read()`
- `private_withdraw()` → uses `garaga_verifier_withdraw.read()`
- Added getters for both verifier addresses

### 2. Withdrawal Verifier Generated
- Path: `/opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_withdraw/`
- Generated with `PrivateWithdraw_verification_key.json`
- Built successfully ✅
- Class hash: `0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2`

### 3. ConfidentialTransfer Rebuilt
- Compiled successfully ✅
- Class hash: `0x015c6889ee864f9630b01b7a51040d556cb412358548914ca9c830f27893ccd9`
- Constructor now takes 4 parameters:
  1. `garaga_verifier_deposit` (ContractAddress)
  2. `garaga_verifier_withdraw` (ContractAddress)
  3. `token` (ContractAddress)
  4. `admin` (ContractAddress)

---

## ⚠️ BLOCKED: Deployment

### Current Blocker
**RPC version incompatibility** preventing declaration via sncast/starkli:
```
Error: RPC node uses incompatible version 0.7.1. Expected version: 0.10.0
```

### What Needs Deployment

#### Step 1: Deploy Withdrawal Verifier
```bash
# Need to declare and deploy this contract:
# Class hash: 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2
# Artifacts: zkdefi/circuits/contracts/src/garaga_verifier_withdraw/target/dev/
```

#### Step 2: Deploy Updated ConfidentialTransfer
```bash
# Constructor args (example):
DEPOSIT_VERIFIER=0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37  # existing
WITHDRAWAL_VERIFIER=<from step 1>
TOKEN=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
ADMIN=0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
```

---

## 🔧 Solutions to Unblock

### Option 1: Fix RPC
Try alternative Sepolia RPC endpoints:
- Infura: `https://starknet-sepolia.infura.io/v3/YOUR_API_KEY`
- Nethermind: `https://free-rpc.nethermind.io/sepolia-juno/v0_7`
- Update `snfoundry.toml` with working RPC

### Option 2: Manual Declaration (Voyager/Starkscan)
1. Go to https://sepolia.starkscan.co/declare-contract
2. Upload `garaga_verifier_withdraw_Groth16VerifierBN254.contract_class.json`
3. Upload `garaga_verifier_withdraw_Groth16VerifierBN254.compiled_contract_class.json`
4. Sign with wallet
5. Get deployed address

### Option 3: Use Argent X / Braavos Wallet UI
1. Open wallet connected to Sepolia
2. Use "Deploy Contract" feature
3. Upload artifacts
4. Deploy directly

---

## 📋 Complete Deployment Checklist

- [x] Fix ConfidentialTransfer contract for two verifiers
- [x] Generate withdrawal verifier with correct VK
- [x] Build withdrawal verifier
- [x] Rebuild ConfidentialTransfer
- [ ] **Declare withdrawal verifier on Sepolia**
- [ ] **Deploy withdrawal verifier on Sepolia**
- [ ] **Declare updated ConfidentialTransfer on Sepolia**
- [ ] **Deploy updated ConfidentialTransfer on Sepolia**
- [ ] Update `backend/.env` with new CONFIDENTIAL_TRANSFER_ADDRESS
- [ ] Update `frontend/.env.local` with new address
- [ ] Restart backend
- [ ] Restart frontend
- [ ] Test deposit → Should work ✅
- [ ] Test withdrawal → Should work ✅ (after verifier deployed)

---

## 🎯 Expected Results After Deployment

### Deposits
- Generate proof with `PrivateDeposit.circom` (2 public outputs)
- Backend formats with Garaga
- Contract calls `garaga_verifier_deposit` (existing: 0x06d0cb7a...)
- **Status:** Will work immediately ✅

### Withdrawals
- Generate proof with `PrivateWithdraw.circom` (2 public outputs)
- Backend formats with Garaga
- Contract calls `garaga_verifier_withdraw` (NEW verifier)
- **Status:** Will work after withdrawal verifier deployed ✅

---

## 📂 Files Modified

| File | Status | Changes |
|------|--------|---------|
| `contracts/src/confidential_transfer.cairo` | ✅ Done | Two verifiers instead of one |
| `circuits/PrivateWithdraw.circom` | ✅ Done | Removed public input, 2 outputs |
| `circuits/build/PrivateWithdraw_*.{zkey,json,wasm}` | ✅ Done | Regenerated artifacts |
| `circuits/contracts/src/garaga_verifier_withdraw/` | ✅ Done | Generated & built |
| `contracts/target/dev/zkdefi_contracts_ConfidentialTransfer.*` | ✅ Done | Rebuilt |

---

## 🚀 Quick Deploy Commands (When RPC Fixed)

```bash
cd /opt/obsqra.starknet/zkdefi/contracts

# 1. Declare withdrawal verifier
sncast -p sepolia -a deployer declare \
  --contract-name garaga_verifier_withdraw_Groth16VerifierBN254

# 2. Deploy withdrawal verifier
sncast -p sepolia -a deployer deploy \
  --class-hash 0x0186d51625a1ba00addb902c69be2eced4ac7f5f7faeea6e802fcc7487bf49b2

# Note the withdrawal verifier address, then:

# 3. Declare ConfidentialTransfer
sncast -p sepolia -a deployer declare \
  --contract-name ConfidentialTransfer

# 4. Deploy ConfidentialTransfer
sncast -p sepolia -a deployer deploy \
  --class-hash 0x015c6889ee864f9630b01b7a51040d556cb412358548914ca9c830f27893ccd9 \
  --constructor-calldata \
    0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37 \
    <WITHDRAWAL_VERIFIER_ADDRESS> \
    0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d \
    0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d

# 5. Update environment variables
echo "CONFIDENTIAL_TRANSFER_ADDRESS=<new_address>" >> backend/.env
echo "NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS=<new_address>" >> frontend/.env.local

# 6. Restart services
pkill -f "uvicorn.*8003"
pkill -f "next.*3001"
cd backend && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8003 &
cd frontend && npm run start &
```

---

## 📊 Summary

| Component | Status | Next Action |
|-----------|--------|-------------|
| Root cause analysis | ✅ Complete | - |
| Contract fix | ✅ Complete | - |
| Withdrawal verifier generation | ✅ Complete | Deploy to Sepolia |
| ConfidentialTransfer rebuild | ✅ Complete | Deploy to Sepolia |
| Deployment | ⚠️ Blocked | Fix RPC or use manual method |
| Testing | ⏳ Pending | After deployment |

---

**Date:** February 3, 2026, 05:45 UTC  
**Status:** Technical fix complete, awaiting deployment  
**Blocker:** RPC version incompatibility  
**Resolution:** Use alternative RPC or manual deployment method
