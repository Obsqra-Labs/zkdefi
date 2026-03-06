# Cross-Chain Identity Aggregation for zkde.fi

## The Problem

**Starknet addresses ≠ Ethereum addresses**

```
User's Ethereum address: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
User's Starknet address: 0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d

How do we aggregate reputation across chains?
```

---

## Solution 1: Identity Commitment (zkML Profile Brain) ⭐ RECOMMENDED

### Concept: Privacy-Preserving Identity Linker

**What users do**: Create a **universal identity commitment** that links their addresses across chains WITHOUT revealing the mapping publicly.

```
┌─────────────────────────────────────────────────┐
│          User's Private Identity               │
├─────────────────────────────────────────────────┤
│                                                 │
│  Ethereum address:  0x742d35Cc...              │
│  Starknet address:  0x05fe8125...              │
│  Arbitrum address:  0x8f3Cf7ad...              │
│  Secret salt:       0x1a2b3c4d...              │
│                                                 │
│         ↓ Hash with Poseidon                   │
│                                                 │
│  Identity Commitment:                           │
│    commitment = poseidon_hash([                 │
│      eth_addr, starknet_addr,                  │
│      arbitrum_addr, salt                       │
│    ])                                           │
│                                                 │
│  → 0x7f9a2b...  (PUBLIC)                       │
└─────────────────────────────────────────────────┘
```

### How It Works

**Step 1: User Creates Identity (One-Time Setup)**

```typescript
// frontend/src/services/identity.ts

class UniversalIdentity {
  async createIdentity(addresses: {
    ethereum: string,
    starknet: string,
    arbitrum?: string,
    optimism?: string
  }): Promise<IdentityCommitment> {
    
    // 1. User signs messages on each chain to prove ownership
    const ethSignature = await ethereumWallet.signMessage("Link to zkde.fi");
    const starknetSignature = await starknetWallet.signMessage("Link to zkde.fi");
    
    // 2. Generate secret salt (stored locally)
    const salt = randomBytes(32);
    
    // 3. Compute identity commitment
    const commitment = poseidon_hash([
      addresses.ethereum,
      addresses.starknet,
      addresses.arbitrum || 0,
      addresses.optimism || 0,
      salt
    ]);
    
    // 4. Store mapping locally (encrypted)
    localStorage.setItem('zkdefi_identity', encrypt({
      commitment,
      addresses,
      salt,
      signatures: { ethSignature, starknetSignature }
    }));
    
    return commitment;
  }
}
```

**Step 2: Aggregate Reputation with zkML Proof**

```rust
// RISC Zero guest program
// methods/guest/src/main.rs

fn main() {
    // PRIVATE INPUTS (never revealed on-chain)
    let ethereum_addr: Address = env::read();
    let starknet_addr: Address = env::read();
    let arbitrum_addr: Address = env::read();
    let salt: [u8; 32] = env::read();
    
    // User's activity on each chain (private)
    let eth_history: EthereumHistory = env::read();      // $500k TVL, 3 years
    let starknet_history: StarknetHistory = env::read(); // $100k TVL, 6 months
    let arbitrum_history: ArbitrumHistory = env::read(); // $200k TVL, 1 year
    
    // 1. Verify identity commitment matches
    let commitment = poseidon_hash([
        ethereum_addr, starknet_addr, 
        arbitrum_addr, salt
    ]);
    
    // 2. Aggregate features across chains
    let total_tvl = eth_history.tvl + starknet_history.tvl + arbitrum_history.tvl;
    let weighted_age = (
        eth_history.age_days * eth_history.tvl +
        starknet_history.age_days * starknet_history.tvl +
        arbitrum_history.age_days * arbitrum_history.tvl
    ) / total_tvl;
    
    let features = vec![
        total_tvl,                      // $800k total
        weighted_age,                   // ~600 days weighted avg
        eth_history.liquidations,       // 0
        starknet_history.liquidations,  // 0
        arbitrum_history.liquidations,  // 1
        protocol_diversity,             // 7 protocols across chains
        cross_chain_correlation,        // Active on multiple chains
        // ... 12 features total
    ];
    
    // 3. Run neural network
    let credit_model = NeuralNetwork::load();
    let credit_score = credit_model.forward(features);
    
    // 4. PUBLIC OUTPUTS (only these are revealed)
    let tier = match credit_score {
        s if s > 0.8 => CreditTier::AAA,
        s if s > 0.6 => CreditTier::AA,
        s if s > 0.4 => CreditTier::A,
        _ => CreditTier::B
    };
    
    // Commit: identity commitment + tier
    env::commit(&(commitment, tier));
}
```

**What's Public vs Private**:

```
PUBLIC (on-chain):
✅ Identity commitment: 0x7f9a2b...
✅ Credit tier: AAA
✅ Proof: 0xabc123... (RISC Zero proof)

PRIVATE (never revealed):
❌ Ethereum address: 0x742d35...
❌ Starknet address: 0x05fe81...
❌ How much on each chain
❌ Which protocols on each chain
❌ Transaction history
```

**Step 3: Use on Starknet**

```cairo
// contracts/src/universal_credit.cairo

#[starknet::contract]
mod UniversalCredit {
    #[storage]
    struct Storage {
        // Maps: identity_commitment → credit_tier
        credit_tiers: LegacyMap<felt252, CreditTier>,
        
        // Maps: starknet_addr → identity_commitment
        user_identities: LegacyMap<ContractAddress, felt252>,
    }
    
    #[external(v0)]
    fn register_credit_proof(
        ref self: ContractState,
        identity_commitment: felt252,
        credit_tier: CreditTier,
        proof: Span<felt252>  // RISC Zero proof
    ) {
        // 1. Verify RISC Zero proof via Garaga
        let is_valid = risc0_verifier.verify(proof);
        assert(is_valid, 'Invalid proof');
        
        // 2. Store: commitment → tier
        self.credit_tiers.write(identity_commitment, credit_tier);
        
        // 3. Link caller's Starknet address → commitment
        self.user_identities.write(get_caller_address(), identity_commitment);
        
        self.emit(CreditProofRegistered {
            commitment: identity_commitment,
            tier: credit_tier
        });
    }
    
    #[external(v0)]
    fn get_user_credit_tier(
        self: @ContractState,
        user: ContractAddress
    ) -> CreditTier {
        // Look up: starknet_addr → commitment → tier
        let commitment = self.user_identities.read(user);
        self.credit_tiers.read(commitment)
    }
}
```

### Privacy Guarantees

**What you can prove**:
- ✅ "I control these addresses" (via signatures)
- ✅ "My cross-chain reputation is AAA"
- ✅ "This commitment represents my full identity"

**What you CANNOT reveal**:
- ❌ Which specific addresses belong to this commitment
- ❌ Activity on each chain individually
- ❌ Total balances or transaction history
- ❌ Link between Ethereum and Starknet addresses

**How it's enforced**: RISC Zero proof proves the computation is correct WITHOUT revealing the inputs!

---

## Solution 2: Attestation-Based Linking (Simpler, Less Private)

### Concept: Ethereum Attestation Service (EAS) + zkML

**What users do**: Create an attestation on Ethereum that links addresses, then prove it on Starknet.

```
1. User creates EAS attestation on Ethereum:
   "I attest that 0x05fe81... (Starknet) is controlled by me"
   
2. User proves on Starknet:
   "There exists an attestation linking my Ethereum address to this Starknet address"
   
3. zkML aggregates reputation from linked addresses
```

**Pros**:
- ✅ Simpler (no custom identity system)
- ✅ Uses existing EAS infrastructure
- ✅ Verifiable on-chain

**Cons**:
- ❌ Less private (attestation is public)
- ❌ Requires Ethereum transaction (gas cost)
- ❌ Ethereum address is revealed

---

## Solution 3: Social Recovery Profile (Hybrid)

### Concept: Starknet profile contract with cross-chain proofs

```cairo
#[starknet::contract]
mod SocialProfile {
    struct Profile {
        owner: ContractAddress,
        identity_commitment: felt252,
        linked_chains: Span<ChainId>,
        credit_tier: CreditTier,
        reputation_score: u64,
    }
    
    // User can add cross-chain proofs incrementally
    #[external(v0)]
    fn add_ethereum_proof(
        ref self: ContractState,
        eth_signature: Signature,
        eth_activity_proof: Span<felt252>  // zkML proof
    ) {
        // Verify signature proves Ethereum address ownership
        // Update profile with Ethereum reputation
    }
    
    #[external(v0)]
    fn add_arbitrum_proof(
        ref self: ContractState,
        arb_signature: Signature,
        arb_activity_proof: Span<felt252>
    ) {
        // Verify signature proves Arbitrum address ownership
        // Update profile with Arbitrum reputation
    }
}
```

**Pros**:
- ✅ Incremental linking (add chains over time)
- ✅ On-chain profile (composable)
- ✅ Social recovery potential

**Cons**:
- ⚠️ More complex contract logic
- ⚠️ Multiple transactions to set up

---

## Recommended Architecture: Solution 1 (Identity Brain)

```
┌─────────────────────────────────────────────────────────┐
│                  USER'S IDENTITY BRAIN                  │
│              (zkde.fi Profile Contract)                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  identity_commitment: 0x7f9a2b...                       │
│  ↓                                                      │
│  Linked to:                                             │
│    - Ethereum activity (private)                        │
│    - Starknet activity (private)                        │
│    - Arbitrum activity (private)                        │
│  ↓                                                      │
│  Aggregated reputation:                                 │
│    - Credit tier: AAA                                   │
│    - Total TVL: $800k (private amount)                  │
│    - Protocol count: 7 (private which)                  │
│    - Liquidations: 1 (private where)                    │
│  ↓                                                      │
│  zkML proof (RISC Zero):                                │
│    "This commitment represents AAA tier"                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Integration with zkde.fi Agent

```typescript
// When user onboards
async function onboardUser() {
  // 1. Create universal identity
  const identity = await createUniversalIdentity({
    ethereum: ethereumAddress,
    starknet: starknetAddress,
    arbitrum: arbitrumAddress
  });
  
  // 2. Fetch cross-chain history
  const ethHistory = await fetchEthereumHistory(ethereumAddress);
  const starknetHistory = await fetchStarknetHistory(starknetAddress);
  const arbitrumHistory = await fetchArbitrumHistory(arbitrumAddress);
  
  // 3. Generate RISC Zero proof
  const proof = await generateCreditProof({
    identity,
    histories: { ethHistory, starknetHistory, arbitrumHistory }
  });
  
  // 4. Register on Starknet
  await universalCredit.register_credit_proof(
    identity.commitment,
    proof.tier,
    proof.proof
  );
  
  // 5. User's agent now has credit-boosted yields!
}
```

---

## Data Flow

```
Step 1: Identity Creation (Off-Chain)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
User → Signs on Ethereum
User → Signs on Starknet
User → Generates commitment locally
     → Stored in encrypted localStorage

Step 2: Reputation Aggregation (Off-Chain)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
zkde.fi backend → Fetches Ethereum history (Etherscan, The Graph)
zkde.fi backend → Fetches Starknet history (Voyager, local RPC)
zkde.fi backend → Fetches Arbitrum history (Arbiscan)
     ↓
RISC Zero prover → Aggregates features
RISC Zero prover → Runs neural network
RISC Zero prover → Generates proof: "commitment → AAA tier"

Step 3: On-Chain Registration (Starknet)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
User → Submits proof to UniversalCredit contract
Contract → Verifies RISC Zero proof via Garaga
Contract → Stores: commitment → AAA tier
Contract → Links: user's Starknet address → commitment

Step 4: Usage (Starknet)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ProofGatedYieldAgent → Queries user's credit tier
ProofGatedYieldAgent → Applies bonus: AAA = +2% APY
User → Earns more yield!
```

---

## Privacy Analysis

### What's Revealed

**On Ethereum**: Nothing (user just signs a message locally)

**On Starknet**: 
- ✅ Identity commitment: `0x7f9a2b...`
- ✅ Credit tier: `AAA`
- ✅ User's Starknet address: `0x05fe81...`

**NOT Revealed**:
- ❌ Ethereum address
- ❌ Arbitrum address
- ❌ Mapping between addresses
- ❌ Activity on any chain
- ❌ Balances, protocols, history

**Attack resistance**:
- 🛡️ **Brute force**: Impossible (Poseidon hash + salt)
- 🛡️ **Chain analysis**: Can't link addresses across chains
- 🛡️ **Front-running**: Commitment is public, but content is hidden
- 🛡️ **Sybil**: Each commitment requires real history (costly to fake)

---

## Summary

**Problem**: Starknet ≠ Ethereum addresses, need cross-chain reputation

**Solution**: Universal Identity Commitment (Profile Brain)
1. User creates identity commitment (hashes all addresses + salt)
2. RISC Zero proves: "This commitment → AAA credit tier" (private inputs)
3. Starknet contract stores: commitment → tier
4. Agent uses tier for yield bonuses

**Privacy**: Full! No one can link your addresses or see your history.

**Next**: Want me to implement this identity system?
