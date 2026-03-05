# Smart Contracts

Privacy-preserving Cairo contracts for zkDeFi Capital OS on Starknet.

## Core Contracts

### VaultController
- Proof-gated execution with STARK verification
- Commit-reveal pattern for MEV resistance
- Circuit breakers and emergency controls
- On-chain receipt creation

### ObsqraFactRegistry
- ERC-8004 compatible fact registry
- Stores STARK proof hashes with security bits
- Multi-verifier support

### ReceiptRegistry
- Immutable audit trail for vault operations
- Every action creates on-chain receipt
- User-indexed queries

### SessionKeyManager
- Delegated execution with proof requirements
- Protocol-level permissions
- Expiry and revocation

### FullyShieldedPool
- Privacy-preserving deposits (Poseidon commitments)
- Zero-knowledge withdrawals
- Nullifier tracking for double-spend prevention

## Build

```bash
scarb build
```

## Test

```bash
scarb test
```

## Deploy

See deployment guide in /docs/deploying-zkde-fi.md

**Last Updated:** March 5, 2026
