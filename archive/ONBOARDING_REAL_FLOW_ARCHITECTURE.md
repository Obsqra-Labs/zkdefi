# Real Onboarding Flow Architecture

## Current Problem

Onboarding wizard is a "demo" with simulated proofs. It doesn't create a real on-chain identity or start a real agent.

## What It Should Actually Do

### Goal
Create a privacy-preserving on-chain identity that:
1. Commits user's constraints (max position, risk tolerance, session duration)
2. Commits user's claims (compliance, tenure, etc.)
3. Generates STARK proof → registers fact in FactRegistry
4. Risk disclosure signature is the FINAL authorization to submit on-chain
5. Creates autonomous agent with this identity

### Privacy Model

**On-Chain**: Only a fact hash (commitment to constraints + claims)
**Off-Chain**: User knows their actual constraints and claims
**Proof**: STARK proves constraints are satisfied without revealing them

## Proper Flow

### Step 1: Connect Wallet
- Standard wallet connection
- No changes needed

### Step 2: Configure Constraints
- User sets:
  - `max_position`: Maximum ETH per position
  - `risk_tolerance`: 30 (Conservative) | 50 (Neutral) | 70 (Aggressive)
  - `session_duration`: How long agent runs (hours)
- **Store locally, don't submit yet**

### Step 3: Select Claims (Optional)
- User selects reputation claims:
  - Compliance (not sanctioned)
  - Tenure (account age > 30 days)
  - Balance (holds > X ETH)
- **Store locally, don't submit yet**

### Step 4: Generate Authorization Proof
**This is the KEY step - generates REAL STARK proof**

Input:
```typescript
{
  user_address: "0x...",
  constraints: {
    max_position: "5000000000000000000", // 5 ETH in wei
    risk_tolerance: 50,
    session_duration: 24
  },
  claims: ["compliance", "tenure"],
  timestamp: 1738704000
}
```

Process:
1. Hash all inputs → `identity_commitment`
2. Generate Cairo program that proves:
   - User controls `user_address`
   - Constraints are within acceptable ranges
   - Claims are valid (optional)
3. Generate STARK proof via Stone prover
4. Submit proof to FactRegistry (obsqra.fi API or local Stone)
5. Receive `fact_hash` back

Output:
```typescript
{
  fact_hash: "0xabc123...",
  identity_commitment: "0xdef456...",
  proof_registered: true
}
```

**This takes ~2-3 minutes** (real STARK proof generation)

### Step 5: Review & Sign Risk Disclosure
**This is the FINAL authorization step**

User reviews:
- Their configured constraints
- Their selected claims
- The fact hash that will be submitted

Then signs TypedData:
```typescript
{
  statement: "I authorize zkde.fi to create an autonomous agent with the following identity",
  fact_hash: "0xabc123...",
  identity_commitment: "0xdef456...",
  timestamp: 1738704000
}
```

This signature is the user's explicit consent to:
- Submit their privacy-preserving identity on-chain
- Start the autonomous agent
- Delegate execution authority

### Step 6: Submit On-Chain
**Create the agent contract with the fact hash**

```cairo
// ProofGatedAgent contract
fn initialize_agent(
    ref self: ContractState,
    fact_hash: felt252,
    identity_commitment: felt252,
    signature: (felt252, felt252)
) {
    // Verify fact exists in FactRegistry
    assert!(fact_registry.has_fact(fact_hash), "Proof not verified");
    
    // Verify signature
    assert!(verify_signature(...), "Invalid signature");
    
    // Store agent identity
    self.agents.write(caller, identity_commitment);
    self.agent_facts.write(caller, fact_hash);
    
    // Agent is now live
}
```

### Step 7: Complete
Agent is live with privacy-preserving identity:
- **On-chain**: Only fact hash + identity commitment (no constraints visible)
- **Off-chain**: User has full details
- **Provable**: Can generate proofs that satisfy constraints without revealing them

## API Endpoints Needed

### 1. Generate Authorization Proof
**POST /api/v1/zkdefi/onboarding/generate_authorization**

Request:
```json
{
  "user_address": "0x...",
  "constraints": {
    "max_position": "5000000000000000000",
    "risk_tolerance": 50,
    "session_duration": 24
  },
  "claims": ["compliance", "tenure"]
}
```

Response:
```json
{
  "fact_hash": "0xabc123...",
  "identity_commitment": "0xdef456...",
  "proof_registered": true,
  "fact_registry_tx": "0xtxhash..."
}
```

This endpoint:
1. Generates Cairo program with user's data
2. Runs Stone prover to generate STARK proof
3. Submits to FactRegistry (Integrity on Starknet)
4. Returns fact hash

### 2. Submit Agent
**POST /api/v1/zkdefi/onboarding/submit_agent**

Request:
```json
{
  "user_address": "0x...",
  "fact_hash": "0xabc123...",
  "identity_commitment": "0xdef456...",
  "risk_signature": {
    "r": "0x...",
    "s": "0x..."
  }
}
```

Response:
```json
{
  "agent_initialized": true,
  "tx_hash": "0xtxhash...",
  "agent_address": "0xagent..."
}
```

This endpoint:
1. Verifies fact exists in FactRegistry
2. Calls ProofGatedAgent.initialize_agent
3. Returns transaction hash

## Privacy Guarantees

| Data | On-Chain | Off-Chain | Provable |
|------|----------|-----------|----------|
| User address | ✅ Public | ✅ Known | ✅ Yes |
| Constraints | ❌ Hidden | ✅ Known | ✅ Yes (via STARK) |
| Claims | ❌ Hidden | ✅ Known | ✅ Yes (via STARK) |
| Identity commitment | ✅ Public hash | ✅ Known preimage | ✅ Yes |
| Fact hash | ✅ Public | ✅ Known | ✅ Yes |

When agent executes an action:
1. Generate proof that action satisfies constraints
2. Reference fact hash (on-chain verification)
3. Action executes without revealing constraints

## Implementation Priority

1. **Backend**: Implement `/onboarding/generate_authorization` endpoint
2. **Frontend**: Update OnboardingWizard flow (steps 4-6)
3. **Contracts**: Ensure ProofGatedAgent accepts fact hash
4. **Testing**: End-to-end flow with real STARK proofs

## Key Differences from Current

| Current | Real |
|---------|------|
| 1.5s simulated proof | 2-3min STARK proof |
| Risk disclosure at step 2 | Risk disclosure at step 5 (FINAL) |
| No on-chain registration | Fact registered in FactRegistry |
| No agent created | Real agent initialized |
| Demo mode | Production mode |

---

**Next**: Implement this architecture step by step
