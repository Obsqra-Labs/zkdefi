# Adversarial Demos: Privacy Protection in Action

This document demonstrates how zkde.fi's privacy features protect against common attack vectors.

## Overview

zkde.fi is designed to be resilient against:
1. **MEV attacks** — Front-running, sandwich attacks
2. **Replay attacks** — Reusing old transactions
3. **Malicious agent actions** — High-risk or unauthorized actions

Each attack is prevented by a specific privacy/verification primitive.

---

## Demo 1: MEV Attack Prevention

### Attack Scenario
An attacker monitors the mempool for agent rebalancing transactions and attempts to front-run.

### How zkde.fi Prevents It

**Intent is hidden until execution:**
```
1. Agent decides to rebalance (private)
2. Agent generates zkML proofs (private)
3. Agent generates execution proofs (private)
4. Agent submits transaction with proofs (public, but instant)
5. Contract verifies proofs and executes atomically
```

**What the attacker sees:**
- Transaction with proof calldata (opaque)
- No advance warning of agent's intent
- Cannot predict rebalancing before submission

**Why it works:**
- Proof generation happens off-chain (private)
- Intent stays hidden until submission
- Atomic execution prevents front-running

### Demo Steps

1. **Setup:** Deploy contracts, fund agent account
2. **Agent prepares:** Generate risk proof, anomaly proof, execution proof
3. **Attacker monitors:** Watch for pending transactions
4. **Agent submits:** Single transaction with all proofs
5. **Outcome:** Attacker has no time to front-run

### Code Example

```python
# Agent generates proofs privately
risk_proof = await risk_service.generate_risk_proof(
    user_address=user,
    portfolio_features=features,
    threshold=30
)

anomaly_proof = await anomaly_service.analyze_pool_safety(
    pool_id=pool,
    user_address=user
)

# Single atomic submission
tx = await contract.execute_with_proofs(
    zkml_proof_calldata=risk_proof["proof_calldata"],
    execution_proof_hash=execution_proof,
    action_calldata=rebalance_calldata
)
```

---

## Demo 2: Replay Attack Prevention

### Attack Scenario
An attacker captures a valid transaction and attempts to replay it to execute the same action multiple times.

### How zkde.fi Prevents It

**Intent commitments are single-use:**
```
commitment = hash(intent_data, nonce, chain_id, block_number)
```

**On-chain validation:**
1. Check commitment not already used
2. Check chain_id matches current chain
3. Check block_number within valid window
4. Mark commitment as used after execution

### Demo Steps

1. **Setup:** Create intent commitment
2. **Execute:** Use commitment in valid transaction
3. **Attack:** Attempt to replay same transaction
4. **Outcome:** Transaction fails with "Intent already used"

### Contract Flow

```cairo
fn use_commitment(
    ref self: ContractState,
    commitment: felt252,
    action_hash: felt252
) -> bool {
    let record = self.intents.read(commitment);
    
    // Check not already used
    if record.used {
        return false;  // Replay blocked!
    }
    
    // Mark as used
    record.used = true;
    record.action_hash = action_hash;
    self.intents.write(commitment, record);
    
    true
}
```

### Test Scenario

```python
# First execution - succeeds
result1 = await contract.execute_with_commitment(
    commitment=commitment_hash,
    proof_hash=proof_hash,
    action_calldata=action
)
assert result1.success == True

# Replay attempt - fails
result2 = await contract.execute_with_commitment(
    commitment=commitment_hash,  # Same commitment
    proof_hash=proof_hash,
    action_calldata=action
)
assert result2.success == False
assert "already used" in result2.error
```

---

## Demo 3: Fork Safety

### Attack Scenario
An attacker creates a chain fork and attempts to use a commitment from the main chain on the forked chain.

### How zkde.fi Prevents It

**Chain ID binding:**
```
commitment = hash(intent_data, nonce, CHAIN_ID, block_number)
```

**Validation:**
```cairo
if chain_id != expected_chain_id {
    return false;  // Fork attack blocked!
}
```

### Why It Works

- Commitment includes specific chain_id
- Contract stores expected chain_id
- Mismatch = rejection
- Commitment from chain A invalid on chain B

---

## Demo 4: Malicious Agent Prevention

### Attack Scenario
A compromised agent attempts to:
1. Execute a high-risk action
2. Interact with a dangerous pool
3. Exceed position limits

### How zkde.fi Prevents It

**zkML gating:**
```
1. Risk score model evaluates portfolio
2. Anomaly detector analyzes pool
3. BOTH must pass for execution
```

**Scenario 1: High-Risk Action**
```
Agent proposes: Invest 100% in volatile pool
Risk model: risk_score = 85 (threshold: 30)
Result: REJECTED - "Risk score too high"
```

**Scenario 2: Dangerous Pool**
```
Agent proposes: Interact with new, unverified pool
Anomaly model: anomaly_flag = 1 (rug risk detected)
Result: REJECTED - "Pool anomaly detected"
```

**Scenario 3: Position Limit Violation**
```
Agent proposes: Deposit 100,000 (max_position: 10,000)
Session key: max_position exceeded
Result: REJECTED - "Exceeds max position"
```

### Demo Steps

1. **Setup:** Configure session key with strict limits
2. **Attempt 1:** High-risk action → Risk proof fails
3. **Attempt 2:** Unsafe pool → Anomaly proof fails
4. **Attempt 3:** Over limit → Session validation fails
5. **Valid action:** Within all constraints → Succeeds

### Code Example

```python
# Check zkML gates
result = await rebalancer.check_zkml_gates(
    proposal_id=proposal.proposal_id,
    portfolio_features=features,
    pool_id=pool_id
)

if not result["can_proceed"]:
    if not result["risk_passed"]:
        print("Blocked: Risk score too high")
    if not result["anomaly_passed"]:
        print("Blocked: Pool anomaly detected")
    return  # Execution prevented

# Only proceeds if BOTH pass
await rebalancer.execute_rebalance(proposal_id, session_id)
```

---

## Demo 5: Session Key Exhaustion

### Attack Scenario
An attacker gains access to a session key and attempts to drain the account.

### How zkde.fi Prevents It

**Session key constraints:**
- Max position per action
- Allowed protocols only
- Time-limited expiry
- Proof requirement

**Example:**
```
Session: max_position=1000, allowed_protocols=[ekubo], expiry=24h

Attacker attempts: Transfer 100,000 to unknown protocol
Validation fails: 
  - Amount > max_position
  - Protocol not allowed
  - No valid proof
```

### Defense Layers

1. **Max position:** Limits damage per action
2. **Protocol whitelist:** Only approved protocols
3. **Expiry:** Session automatically becomes invalid
4. **Proof requirement:** Still needs valid proofs for execution

---

## Privacy Protection Summary

| Attack | Prevention | Primitive |
|--------|------------|-----------|
| MEV/Front-running | Intent hidden until execution | Proof-gating |
| Replay | Single-use commitments | Intent commitments |
| Fork attacks | Chain ID binding | Intent commitments |
| High-risk actions | Risk score proof fails | zkML (Garaga) |
| Unsafe pools | Anomaly proof fails | zkML (Garaga) |
| Session abuse | Constraints + proof requirement | Session keys |

---

## Running the Demos

### Prerequisites
- Deployed contracts on Sepolia
- Backend running
- Frontend accessible

### Command-Line Demo

```bash
# 1. Generate MEV attack scenario
curl -X POST "$API_BASE/api/v1/zkdefi/rebalancer/propose" \
  -H "Content-Type: application/json" \
  -d '{"user_address": "0x...", "from_protocol": 0, "to_protocol": 1, "amount": 1000}'

# 2. Check zkML gates (simulate malicious action)
curl -X POST "$API_BASE/api/v1/zkdefi/rebalancer/check" \
  -H "Content-Type: application/json" \
  -d '{"proposal_id": "...", "portfolio_features": [100,90,90,90,90,90,90,90]}'
# Expected: can_proceed: false (high risk)

# 3. Check with safe portfolio
curl -X POST "$API_BASE/api/v1/zkdefi/rebalancer/check" \
  -H "Content-Type: application/json" \
  -d '{"proposal_id": "...", "portfolio_features": [50,30,20,20,50,30,10,20]}'
# Expected: can_proceed: true
```

---

## Conclusion

zkde.fi's privacy-first architecture provides defense-in-depth:

1. **Proof-gating** hides intent until execution (MEV protection)
2. **Intent commitments** prevent replays and fork attacks
3. **zkML models** gate malicious actions
4. **Session keys** limit exposure if compromised

Every feature reinforces privacy while maintaining verifiability.
