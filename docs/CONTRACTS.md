# zkde.fi Contract Addresses (Starknet Sepolia)

## Core Contracts

| Contract | Address | Status |
|----------|---------|--------|
| **ProofGatedYieldAgent** | `0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3` | Deployed |
| **SelectiveDisclosure** | `0x00ab6791e84e2d88bf2200c9e1c2fb1caed2eecf5f9ae2989acf1ed3d00a0c77` | Deployed |
| **ConfidentialTransfer** | `0x07fdc7c21ab074e7e1afe57edfcb818be183ab49f4bf31f9bf86dd052afefaa4` | Deployed |
| **GaragaVerifier** | `0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37` | Deployed |

## zkDE Standard Contracts (GATE-1)

| Contract | Address | Status |
|----------|---------|--------|
| **ConstraintReceipt** | `0x04c8756f9baf927aa6a85e9b725dd854215f82c65bd70076012f02fec8497954` | Deployed |
| **SessionKeyManager** | `0x01c0edf8ff269921d3840ccb954bbe6790bb21a2c09abcfe83ea14c682931d68` | Deployed |
| **IntentCommitment** | `0x062027ceceb088ac31aa14fe7e180994a025ccb446c2ed8394001e9275321f70` | Deployed |
| **ComplianceProfile** | `0x05aa72977c1984b5c61aee55a185b9caed9e9e42b62f2891d71b4c4cc6b96d93` | Deployed |
| **ZkmlVerifier** | `0x037f17cd0e17f2b41d1b68335e0bc715a4c89d03c6118e5f4e98b5c7872c798d` | Deployed |

## ERC-8004 Aligned Contracts (Agent Trust Framework)

These contracts implement a Starknet-native version of the ERC-8004 agent trust standard:

| Contract | Address | Status | Purpose |
|----------|---------|--------|---------|
| **AgentIdentity** | `0x06b2ed4153d620f5558086de5afff8a5bb0de76720deb26c8a037cb347aff80a` | Deployed | SRC-721 agent identity NFTs |
| **ValidationProofRegistry** | `0x02e2b175026aa2f9cf804d84a92076fcf9c29149bb009305f26d4be74ae03492` | Deployed | Proof attestation registry |
| **ReputationRegistry** | `0x0428700cc719df6ef6104123f6a326dde0f4f42f7e41f941473338bc31f9ccff` | Deployed | On-chain reputation scoring |
| **ModelRegistry** | `0x06ab2595007be01ffb7e51bd28339f870be36402eed9034b109fd479e7469adc` | Deployed | zkML model catalog |
| **AgentComposer** | `0x0639eda1b05238d21183cbf2dab7bfca793978d534d608d992577dcdccb0a84d` | Deployed | Multi-model agent composition |

### ERC-8004 vs zkde.fi Comparison

| Component | ERC-8004 (EVM) | zkde.fi (Starknet) | Advantage |
|-----------|----------------|-------------------|-----------|
| Identity | ERC-721 | SRC-721 + Commitment | Sybil-resistant via ZK |
| Reputation | Plain scores | ZK-proven scores | Privacy-preserving |
| Validation | Attestations | Proof-gated execution | Actually enforced |

## Infrastructure Contracts

| Contract | Address | Notes |
|----------|---------|-------|
| **Integrity Fact Registry** | `0x4ce7851f00b6c3289674841fd7a1b96b6fd41ed1edc248faccd672c26371b8c` | Herodotus/Obsqra Labs |
| **STRK Token** | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | Native STRK on Sepolia |

## Contract Functions

### ProofGatedYieldAgent

The main agent contract that manages deposits, withdrawals, and proof verification.

```cairo
// Set user constraints
fn set_constraints(max_position: u256, max_daily_yield_bps: u256, min_withdraw_delay_seconds: u64)

// Deposit with proof verification
fn deposit_with_proof(protocol_id: u8, amount: u256, proof_hash: felt252)

// Withdraw with proof verification  
fn withdraw_with_proof(protocol_id: u8, amount: u256, proof_hash: felt252) -> u256

// Execute with combined proofs (zkML + execution)
fn execute_with_proofs(
    protocol_id: u8,
    amount: u256,
    zkml_proof_hash: felt252,
    execution_proof_hash: felt252,
    intent_commitment: felt252,
    action_type: felt252
)

// Execute with session key
fn execute_with_session(session_id: felt252, protocol_id: u8, amount: u256, action_calldata: Span<felt252>)
```

### SessionKeyManager

Manages delegated session keys for autonomous agent execution.

```cairo
// Grant a session key
fn grant_session(
    session_key: ContractAddress,
    max_position: u256,
    allowed_protocols: Span<u8>,
    expires_at: u64
) -> felt252

// Revoke a session key
fn revoke_session(session_id: felt252)

// Validate session for execution
fn validate_session(session_id: felt252, protocol_id: u8, amount: u256) -> bool

// Get session info
fn get_session(session_id: felt252) -> SessionData
```

### IntentCommitment

Manages replay-safe intent commitments for agent actions.

```cairo
// Create an intent commitment
fn create_commitment(intent_hash: felt252, expires_at: u64) -> felt252

// Execute and consume an intent
fn execute_commitment(commitment_id: felt252) -> bool

// Check if commitment is valid
fn is_valid_commitment(commitment_id: felt252) -> bool
```

### ConstraintReceipt

On-chain receipts for auditable agent actions.

```cairo
// Create a new receipt
fn create_receipt(constraints_hash: felt252, proof_hash: felt252, action_type: felt252, protocol_id: u8, amount: u256) -> felt252

// Get receipt by ID
fn get_receipt(receipt_id: felt252) -> Receipt

// Get total receipts
fn get_total_receipts() -> u64
```

### ComplianceProfile

Productized selective disclosure for regulatory compliance.

```cairo
// Create a compliance profile
fn create_profile(disclosure_type: felt252, jurisdiction_hash: felt252, expires_at: u64) -> felt252

// Verify profile validity
fn verify_profile(profile_id: felt252) -> bool

// Get profile data
fn get_profile(profile_id: felt252) -> ComplianceProfileData
```

### ZkmlVerifier

Verifies zkML proofs (risk score, anomaly detection) via Garaga.

```cairo
// Verify a zkML proof
fn verify_zkml_proof(proof_type: u8, proof_calldata: Span<felt252>) -> bool

// Get Garaga verifier address
fn get_garaga_verifier() -> ContractAddress
```

### SelectiveDisclosure

Prove statements about your positions without revealing details.

```cairo
// Create a disclosure (prove yield > threshold without revealing actual yield)
fn create_disclosure(proof_hash: felt252, statement_hash: felt252, threshold: u256)

// Verify a disclosure
fn verify_disclosure(disclosure_id: felt252) -> bool
```

### ConfidentialTransfer

Transfer tokens with hidden amounts using Garaga (Groth16) proofs.

```cairo
// Deposit (create commitment)
fn deposit(amount: u256, commitment: felt252)

// Transfer (prove balance without revealing)
fn transfer(proof_calldata: Span<felt252>, new_sender_commitment: felt252, new_receiver_commitment: felt252)

// Withdraw (reveal and exit)
fn withdraw(proof_calldata: Span<felt252>, amount: u256, nullifier: felt252)
```

### AgentIdentity (SRC-721)

Agent identity NFTs with commitment linkage.

```cairo
// Mint a new agent identity
fn mint_agent(owner: ContractAddress, identity_commitment: felt252) -> u256

// Link an identity commitment to an agent
fn link_identity(token_id: u256, identity_commitment: felt252)

// Update reputation tier
fn update_reputation(token_id: u256, new_tier: u8)

// Get agents by owner
fn get_agents_by_owner(owner: ContractAddress) -> Array<u256>

// Get agent metadata
fn get_agent_metadata(token_id: u256) -> AgentMetadata
```

### ValidationProofRegistry

Registry for validated proof attestations.

```cairo
// Register a validated proof
fn register_proof(agent_id: u256, proof_type: felt252, action_type: felt252, proof_hash: felt252)

// Invalidate a proof
fn invalidate_proof(proof_id: u256)

// Get proofs for agent
fn get_proofs_by_agent(agent_id: u256) -> Array<ProofRecord>

// Check if proof is valid
fn is_proof_valid(proof_id: u256) -> bool
```

### ReputationRegistry

On-chain reputation scoring with discoverable leaderboards.

```cairo
// Get reputation score (0-1000)
fn get_reputation_score(user: ContractAddress) -> u32

// Get top users
fn get_top_users(limit: u32) -> Array<(ContractAddress, u32)>

// Get user rank
fn get_user_rank(user: ContractAddress) -> u32

// Get users by tier
fn get_users_by_tier(tier: felt252) -> Array<ContractAddress>

// Get total registered users
fn get_total_users() -> u32
```

## Verification

View all contracts on Starkscan:

| Contract | Starkscan Link |
|----------|----------------|
| ProofGatedYieldAgent | [View](https://sepolia.starkscan.co/contract/0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3) |
| AgentIdentity | [View](https://sepolia.starkscan.co/contract/0x06b2ed4153d620f5558086de5afff8a5bb0de76720deb26c8a037cb347aff80a) |
| ValidationProofRegistry | [View](https://sepolia.starkscan.co/contract/0x02e2b175026aa2f9cf804d84a92076fcf9c29149bb009305f26d4be74ae03492) |
| ReputationRegistry | [View](https://sepolia.starkscan.co/contract/0x0428700cc719df6ef6104123f6a326dde0f4f42f7e41f941473338bc31f9ccff) |
| ModelRegistry | [View](https://sepolia.starkscan.co/contract/0x06ab2595007be01ffb7e51bd28339f870be36402eed9034b109fd479e7469adc) |
| AgentComposer | [View](https://sepolia.starkscan.co/contract/0x0639eda1b05238d21183cbf2dab7bfca793978d534d608d992577dcdccb0a84d) |
