# Poseidon Hash Alignment Migration Guide

## Overview

This document describes the migration from mixed Poseidon implementations to a unified BN254 Poseidon hashing system with u256 split storage in Cairo contracts.

## Problem Statement

### Before Migration
- **Backend Merkle Tree**: Used Starknet-native Poseidon (`poseidon_py`) operating over `STARK_PRIME`
- **Circom Circuits**: Expected BN254 Poseidon (`circomlib`) operating over `BN128_PRIME`
- **Contracts**: Used `felt252` for commitments and nullifiers

### Issues
1. Hash values from backend didn't match circuit expectations
2. BN254 Poseidon outputs (~254 bits) exceeded felt252's safe range (~251 bits)
3. Withdrawal proofs failed with "Assert Failed" during witness generation

## Solution: BN254 Poseidon + u256 Split Storage

### Architecture Changes

```
┌──────────────────────────────────────────────────────────────────┐
│                    UNIFIED BN254 POSEIDON                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Frontend (JS)                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ BigInt commitment → (low: u128, high: u128)                 │  │
│  │ Split: low = value % 2^128, high = value / 2^128           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              ↓                                   │
│  Backend (Python)                                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ circomlib_poseidon.py → Node.js subprocess → circomlibjs   │  │
│  │ Merkle tree built with BN128 Poseidon hashes               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              ↓                                   │
│  Circom Circuits                                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ include "circomlib/circuits/poseidon.circom"                │  │
│  │ Native BN254 Poseidon(2) for commitment and nullifier       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              ↓                                   │
│  Cairo Contracts                                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Storage: Map<(u128, u128), bool>                            │  │
│  │ Interface: fn deposit_u256(low: u128, high: u128, ...)      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## File Changes

### Backend

#### `backend/app/services/circomlib_poseidon.py` (NEW)
Wrapper calling Node.js `circomlibjs` for BN254 Poseidon hashing:
```python
BN128_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617
STARK_PRIME = 2**251 + 17 * 2**192 + 1

def poseidon_hash(*inputs: int) -> int:
    # Executes: node -e 'const { buildPoseidon } = require("circomlibjs"); ...'
    ...
```

#### `backend/app/services/merkle_tree_service.py`
- Replaced `poseidon_py` imports with `circomlib_poseidon`
- Updated `FELT_PRIME = BN128_PRIME`
- All hash functions now use BN254 Poseidon

#### `backend/app/services/full_privacy_proof_service.py`
- Uses `circomlib_poseidon` for commitment and nullifier generation
- Returns `amount` as string to prevent JS precision loss

### Circuits

#### `circuits/PrivateDeposit.circom`
```circom
include "node_modules/circomlib/circuits/poseidon.circom";

component hasher = Poseidon(2);
hasher.inputs[0] <== amount;
hasher.inputs[1] <== nonce;
commitment <== hasher.out;
```

#### `circuits/PrivateWithdraw.circom`
- Commitment: `Poseidon(2)(balance, nonce)`
- Nullifier: `Poseidon(2)(commitment_public, user_secret)`

### Contracts

#### `contracts/src/merkle_tree.cairo`
```cairo
fn insert(ref self: ContractState, leaf_low: u128, leaf_high: u128);
fn get_root(self: @ContractState) -> (u128, u128);
fn verify_proof(
    self: @ContractState,
    leaf_low: u128, leaf_high: u128,
    root_low: u128, root_high: u128,
    proof: Span<felt252>,
    path_indices: Span<u8>
) -> bool;
```

#### `contracts/src/fully_shielded_pool.cairo`
```cairo
fn deposit_u256(
    ref self: ContractState,
    commitment_low: u128,
    commitment_high: u128,
    amount: u256
);

fn withdraw_u256(
    ref self: ContractState,
    nullifier_low: u128,
    nullifier_high: u128,
    root_low: u128,
    root_high: u128,
    recipient: ContractAddress,
    amount: u256,
    pool_type: u8,
    zk_proof: Span<felt252>
);
```

#### `contracts/src/confidential_transfer.cairo`
```cairo
fn private_deposit_u256(
    ref self: ContractState,
    commitment_low: u128,
    commitment_high: u128,
    amount_public: u256,
    proof_calldata: Span<felt252>
);

fn private_withdraw_u256(
    ref self: ContractState,
    nullifier_low: u128,
    nullifier_high: u128,
    commitment_low: u128,
    commitment_high: u128,
    amount_public: u256,
    proof_calldata: Span<felt252>,
    recipient: ContractAddress
);
```

### Frontend

#### `frontend/src/components/zkdefi/FullPrivacyPoolPanel.tsx`
```typescript
// Split BigInt to u128 pair
const commitmentBigInt = BigInt(commitmentData.commitment);
const commitmentLow = commitmentBigInt % (2n ** 128n);
const commitmentHigh = commitmentBigInt / (2n ** 128n);

// Pass to contract
calldata: [
  commitmentLow.toString(),
  commitmentHigh.toString(),
  amountLow.toString(),
  amountHigh.toString()
]
```

## Deployed Contracts (Starknet Sepolia)

| Contract | Address |
|----------|---------|
| MerkleTree | `0x0344fc61c03c93a174f23175e2b12300c8088f6973a35ef442c31e3126d2e88c` |
| FullyShieldedPool | `0x02317de13ddabbb2350273efbb7fdb04c42313458a786b4ad21cc7aecc13f9ea` |
| ConfidentialTransfer | `0x0100e1adbb92bb61bf3338a1da17a1bc31022321df2370f4f24a9120fb0e28b3` |

## Garaga Verifiers (Feb 5, 2026)

| Verifier | Address | For Circuit |
|----------|---------|-------------|
| private_deposit | `0x034994599b29514e053e9f55eb7c4b988ae63078a0ac0c5466d38f997759e99d` | PrivateDeposit.circom |
| private_withdraw | `0x06f7439af5e4ed0b7838922068eca38353406184f7806bd11cb4bb363961ef16` | PrivateWithdraw.circom |
| full_privacy_withdraw | `0x07890b8387a71e1df9a37793e995cc5ac4bb055fa67c292ff296bdb0705352a1` | FullPrivacyWithdraw.circom |

## Breaking Changes

### 1. Old Commitments Invalid
All commitments created before this migration are **invalid**. The Merkle tree has been reset.

**User Action**: Clear localStorage and create new commitments.

### 2. Contract Interface Changes
Old methods (`deposit`, `withdraw`, `private_deposit`, `private_withdraw`) still exist for backwards compatibility but internally convert to u256.

**New Preferred Methods**: `*_u256` variants for explicit u256 handling.

### 3. Frontend localStorage
Old commitment data uses incompatible hash format.

**User Action**: Clear browser localStorage for zkde.fi domain.

## Migration Steps for Developers

1. **Update Backend Dependencies**
   ```bash
   cd backend
   npm install circomlibjs  # Node.js dependency for poseidon
   ```

2. **Recompile Circuits**
   ```bash
   cd circuits
   circom PrivateDeposit.circom --r1cs --wasm --sym -o build/
   circom PrivateWithdraw.circom --r1cs --wasm --sym -o build/
   # Run trusted setup...
   ```

3. **Deploy New Contracts**
   ```bash
   cd contracts
   python deploy_u256_contracts.py
   ```

4. **Update Frontend Environment**
   ```bash
   # Update .env.local with new contract addresses
   NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS=0x...
   NEXT_PUBLIC_MERKLE_TREE_ADDRESS=0x...
   NEXT_PUBLIC_SHIELDED_POOL_ADDRESS=0x...
   ```

5. **Rebuild and Deploy Frontend**
   ```bash
   cd frontend
   npm run build
   pm2 restart zkdefi-frontend
   ```

## Verification

### Backend Hash Test
```bash
curl -X POST http://localhost:8003/api/v1/zkdefi/full_privacy/generate_commitment \
  -H "Content-Type: application/json" \
  -d '{"user_secret": "0x1234", "amount": "1000000000000000000", "pool_type": 1}'
```

Expected: Commitment is a valid BN254 field element (< BN128_PRIME).

### Circuit Witness Test
```bash
curl -X POST http://localhost:8003/api/v1/zkdefi/full_privacy/withdraw/generate_proof \
  -H "Content-Type: application/json" \
  -d '{...}'
```

Expected: Returns `proof`, `public_signals`, `nullifier` without "Assert Failed" errors.

## Troubleshooting

### "Commitment not found in merkle tree"
- Clear browser localStorage
- Generate new commitment
- Ensure backend Merkle tree was reset after deployment

### "felt overflow" during transaction
- Ensure frontend splits u256 values correctly
- Check that contract addresses are updated

### "Assert Failed" in witness generation
- Verify circomlib is installed: `npm ls circomlibjs`
- Verify circuits were recompiled with new Poseidon includes

## References

- [Circomlib Poseidon](https://github.com/iden3/circomlibjs)
- [BN254 Curve](https://hackmd.io/@jpw/bn254)
- [Cairo u256](https://book.cairo-lang.org/ch02-02-02-integer-types.html)
