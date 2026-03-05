# Contracts

This page lists core Starknet Sepolia contract references used by zkde.fi and related flows.

## The Problem This Solves

Integrators and operators need an explicit contract map for explorer verification, runbook triage, and environment validation.

## Why This Matters

Route-level errors often trace back to chain mismatch or incorrect contract references. A clear table reduces diagnosis time.

## Core Contract Map (Sepolia)

| Contract | Address |
|---|---|
| ProofGatedYieldAgent | `0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3` |
| SelectiveDisclosure | `0x00ab6791e84e2d88bf2200c9e1c2fb1caed2eecf5f9ae2989acf1ed3d00a0c77` |
| ConfidentialTransfer | `0x07fdc7c21ab074e7e1afe57edfcb818be183ab49f4bf31f9bf86dd052afefaa4` |
| ConstraintReceipt | `0x04c8756f9baf927aa6a85e9b725dd854215f82c65bd70076012f02fec8497954` |
| SessionKeyManager | `0x01c0edf8ff269921d3840ccb954bbe6790bb21a2c09abcfe83ea14c682931d68` |
| IntentCommitment | `0x062027ceceb088ac31aa14fe7e180994a025ccb446c2ed8394001e9275321f70` |
| ComplianceProfile | `0x05aa72977c1984b5c61aee55a185b9caed9e9e42b62f2891d71b4c4cc6b96d93` |
| ZkmlVerifier | `0x037f17cd0e17f2b41d1b68335e0bc715a4c89d03c6118e5f4e98b5c7872c798d` |
| GaragaVerifier | `0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37` |

## Contract Interaction Topology

### Proof-Gated Execution Flow

```mermaid
flowchart TD
  User[User] --> FE[Frontend]
  FE --> BE[Backend API]
  
  BE --> PG{Generate Proof}
  PG --> FR[ObsqraFactRegistry]
  FR --> VC[VaultController]
  
  VC --> Verify{Verify Proof}
  Verify -->|Valid| Execute[Execute Allocation]
  Verify -->|Invalid| Reject[Reject]
  
  Execute --> RR[ReceiptRegistry]
  RR --> Receipt[Create Receipt]
```

### Privacy Vault Flow

```mermaid
flowchart LR
  User --> FSP[FullyShieldedPool]
  FSP --> MT[MerkleTree]
  MT --> Commit[Store Commitment]
  
  User2[User Withdraw] --> HWP[HashedWithdrawPool]
  HWP --> MT2[Verify Merkle Proof]
  MT2 --> Release[Release Funds]
```

### DAO Governance Flow

```mermaid
flowchart TD
  Proposer --> Create[Create Proposal]
  Create --> DAO[DAOConstraintManager]
  
  Voter --> ZKP{Generate ZK Vote Proof}
  ZKP --> Vote[Cast Private Vote]
  Vote --> DAO
  
  DAO --> Tally[Tally Votes]
  Tally -->|Passed| Execute[Execute Proposal]
  Tally -->|Failed| Archive[Archive]
  
  Execute --> VC[Update VaultController]
```

## Problem It Solves For Integrators

Provides a single checklist when validating:

- chain/network alignment
- explorer visibility
- call target correctness in generated calldata

## Why It Matters Operationally

Misconfigured addresses can appear as policy or wallet bugs, but are often deployment/environment drift. Contract verification should be an early triage step.

## Source-Of-Truth Guidance

Use this page as an operator-facing quick reference. For release-critical automation, source addresses from deployment artifacts and environment configuration in CI/CD.

Next: [API overview](/api-overview) | [Deploying zkde.fi](/deploying-zkde-fi) | [Developers](/developers)
