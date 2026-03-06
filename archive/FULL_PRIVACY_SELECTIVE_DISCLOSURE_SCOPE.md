# Full Privacy + Selective Disclosure Scope

## Current State vs Target State

### Current (Tornado-style)
```
On-chain storage:
  commitment_balance[commitment] = 0.01 ETH  ← VISIBLE
  commitment_pool[commitment] = Neutral      ← VISIBLE
  
Hidden:
  - Who owns the commitment                  ← PRIVATE ✓
```

### Target (Full Privacy + Selective Disclosure)
```
On-chain storage:
  commitments[] = [C1, C2, C3, ...]          ← Just a list of commitments
  merkle_root = hash(all commitments)        ← For efficient membership proofs
  
Hidden:
  - Who owns each commitment                 ← PRIVATE ✓
  - Balance of each commitment               ← PRIVATE ✓
  - Pool type of each commitment             ← PRIVATE ✓
  
Selective Disclosure (via ZK proofs):
  - "I own a commitment with balance > X"
  - "My position is in pool Y"
  - "My total deposits > $10k" (whale status)
  - "I'm compliant" (not on blocklist)
```

---

## Architecture

### 1. Commitment Structure (Enhanced)

```
commitment = hash(
  user_address,     // Hidden
  amount,           // Hidden  
  pool_type,        // Hidden
  nonce,            // Hidden (randomness)
  blinding_factor   // Extra randomness for hiding
)
```

All data hidden. Only commitment visible on-chain.

### 2. On-Chain Storage (Minimal)

```cairo
struct Storage {
    // Merkle tree of all commitments
    commitment_merkle_root: felt252,
    
    // Flat list for merkle tree construction
    commitments: Map<u64, felt252>,  // index → commitment
    commitment_count: u64,
    
    // Nullifiers (prevent double-spend)
    nullifiers: Map<felt252, bool>,
    
    // NO balance storage
    // NO pool_type storage
    // NO owner storage
}
```

### 3. Deposit Flow (Full Privacy)

```
User:
  1. Generate secret = random()
  2. Generate nonce = random()
  3. Compute commitment = hash(address, amount, pool, nonce, secret)
  4. Store locally: {commitment, amount, pool, nonce, secret}
  5. Send deposit(commitment, amount) to contract

Contract:
  1. Receive tokens (amount visible in ERC20 transfer)
  2. Add commitment to merkle tree
  3. Emit event: CommitmentAdded(commitment, tree_index)
  4. NO balance/pool storage - just the commitment

On-chain observer sees:
  - "0.01 ETH deposited"
  - "Commitment 0xabc... added"
  - CANNOT link commitment to amount (many people deposit 0.01 ETH)
```

### 4. Withdrawal Flow (Full Privacy)

```
User:
  1. Generate nullifier = hash(commitment, secret)
  2. Generate ZK proof:
     - "I know preimage of commitment C in merkle tree"
     - "Nullifier N corresponds to C"
     - "Amount is X" (private input)
  3. Send withdraw(nullifier, amount, recipient, proof)

Contract:
  1. Verify nullifier not used
  2. Verify ZK proof (merkle membership + nullifier derivation)
  3. Transfer amount to recipient
  4. Mark nullifier used
  5. Emit: Withdrawal(nullifier) -- NO amount, NO recipient

On-chain observer sees:
  - "Nullifier 0xdef... used"
  - "Some amount sent to some address"
  - CANNOT link withdrawal to deposit
```

---

## Selective Disclosure

### What It Enables

The user can generate ZK proofs about their position WITHOUT revealing the full data:

| Disclosure Type | What User Proves | What Stays Hidden |
|----------------|------------------|-------------------|
| **Balance Range** | "My balance > 1 ETH" | Exact amount |
| **Pool Membership** | "I'm in Conservative pool" | Balance, commitment |
| **Whale Status** | "Total deposits > $100k" | Individual amounts |
| **Compliance** | "Not on OFAC list" | Identity |
| **Tenure** | "Position age > 90 days" | Entry date, balance |
| **P/L Band** | "My P/L is positive" | Exact P/L |

### Implementation

```
Proof Request:
  verifier_question: "Is your balance > 1 ETH?"
  
User generates:
  witness = {commitment, amount=5ETH, pool, nonce, secret}
  public_inputs = {merkle_root, verifier_question}
  
Proof output:
  "Yes, balance > 1 ETH" + ZK proof
  
Verifier learns:
  ✓ User has a valid commitment in the tree
  ✓ Balance > 1 ETH
  ✗ Actual balance (hidden)
  ✗ Which commitment (hidden)
  ✗ Pool type (hidden)
```

---

## Reputation Integration

Selective disclosure powers the reputation tiers:

### Tier 0 (Strict) - No History
- No disclosures yet
- Full proof required for every action
- Relayer: Not available

### Tier 1 (Standard) - Some Trust
- Disclosed: "I've completed N successful withdrawals"
- Disclosed: "I'm compliant (not on blocklist)"
- Relayer: Available with 1hr delay

### Tier 2 (Express) - High Trust  
- Disclosed: "Tenure > 90 days"
- Disclosed: "Total volume > $X"
- Disclosed: "Zero failed transactions"
- Relayer: Instant
- Batch proofs instead of per-tx

---

## Contract Changes Required

### Current ShieldedPool → New FullyShieldedPool

```cairo
#[starknet::interface]
pub trait IFullyShieldedPool<TContractState> {
    // Deposit: Only commitment added to tree, no balance/pool stored
    fn deposit(
        ref self: TContractState,
        commitment: felt252,
        // amount NOT stored - just needed for token transfer
    );
    
    // Withdraw: ZK proof verifies everything
    fn withdraw(
        ref self: TContractState,
        nullifier: felt252,
        recipient: ContractAddress,
        amount: u256,  // Claimed amount - verified by proof
        merkle_proof: Span<felt252>,
        zk_proof: Span<felt252>  // Proves: membership + nullifier + amount
    );
    
    // Selective disclosure verification
    fn verify_disclosure(
        self: @TContractState,
        disclosure_type: felt252,  // e.g., "balance_gt_1eth"
        proof: Span<felt252>
    ) -> bool;
    
    // Merkle tree views
    fn get_merkle_root(self: @TContractState) -> felt252;
    fn get_commitment_count(self: @TContractState) -> u64;
}
```

### Merkle Tree for Membership Proofs

```cairo
// Incremental merkle tree (like Tornado Cash)
struct Storage {
    // Tree levels
    tree_levels: Map<(u8, u64), felt252>,  // (level, index) → hash
    current_root: felt252,
    next_index: u64,
    
    // Constants
    tree_depth: u8,  // e.g., 20 levels = 1M commitments
}
```

---

## ZK Circuits Needed

### 1. Withdraw Circuit (Groth16)
```
Public inputs:
  - merkle_root
  - nullifier
  - recipient (hashed)
  - amount

Private inputs:
  - commitment
  - merkle_path
  - user_address
  - pool_type
  - nonce
  - secret

Constraints:
  - commitment = hash(user_address, amount, pool_type, nonce, secret)
  - nullifier = hash(commitment, secret)
  - merkle_verify(commitment, merkle_path, merkle_root) = true
```

### 2. Selective Disclosure Circuits

**Balance Range:**
```
Public: merkle_root, threshold
Private: commitment, amount, ...
Proves: amount > threshold
```

**Pool Membership:**
```
Public: merkle_root, pool_type
Private: commitment, actual_pool, ...
Proves: actual_pool == pool_type
```

**Compliance:**
```
Public: merkle_root, blocklist_root
Private: commitment, user_address, ...
Proves: user_address NOT in blocklist
```

---

## Implementation Plan

### Phase 1: Full Privacy Pool
1. Create `FullyShieldedPool` contract with merkle tree
2. Remove all balance/pool storage
3. Implement deposit (commitment only)
4. Implement withdraw with merkle proof

### Phase 2: ZK Circuits
1. Create withdraw circuit (Groth16)
2. Integrate with Garaga verifier
3. Test full deposit → withdraw flow

### Phase 3: Selective Disclosure
1. Create disclosure circuits (balance_range, pool_membership, compliance)
2. Add `verify_disclosure` to contract
3. Integrate with reputation system

### Phase 4: Reputation Integration
1. Disclosed proofs → reputation points
2. Tier upgrades based on disclosures
3. Relayer access gated by tier

---

## Trade-offs

| Aspect | Current (Tornado-style) | Full Privacy |
|--------|------------------------|--------------|
| **Complexity** | Simple | Complex (merkle tree, ZK circuits) |
| **Gas Cost** | Lower | Higher (proof verification) |
| **Privacy** | Owner hidden | Everything hidden |
| **Selective Disclosure** | Not possible | Fully supported |
| **Liquidity Query** | Easy (sum balances) | Hard (need aggregate proofs) |
| **Rebalancing** | Easy (read pool) | Complex (proof of pool) |

---

## Recommendation

**For MVP/Demo**: Current model is sufficient (owner hidden, balance/pool visible)

**For Production**: Full privacy model with selective disclosure

The full privacy model requires:
- Merkle tree implementation (well-known, can port from Tornado)
- Groth16 circuits for withdraw + disclosure (need circuit development)
- Integration with Garaga for on-chain verification

Timeline estimate: 2-3 weeks additional development for full privacy.

---

## Next Steps

1. **Confirm scope**: Do you want full privacy now or later?
2. **If now**: Start with merkle tree contract + basic withdraw circuit
3. **If later**: Document as roadmap, keep current model for demo
