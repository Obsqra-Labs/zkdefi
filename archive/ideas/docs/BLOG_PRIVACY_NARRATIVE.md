# The Privacy Problem DeFi Pretends Doesn't Exist

*And how we're solving it with zero-knowledge proofs on Starknet*

---

## The Uncomfortable Truth

Every time you interact with DeFi, you're broadcasting a postcard. Not a sealed letter—a postcard. Your deposit amount, your strategy, your rebalancing patterns, your total portfolio value: all visible to anyone watching the chain.

This isn't a bug. It's the default state of transparent blockchains. And it creates real problems:

- **MEV bots front-run your trades** because they see your intent before execution
- **Competitors analyze your strategy** by watching your on-chain behavior  
- **Malicious actors can target you** based on visible portfolio size
- **You can't prove compliance** without revealing everything

The DeFi industry has largely ignored this. "Transparency is a feature," they say. But transparency for verification shouldn't mean transparency for exploitation.

---

## What If Your Agent Could Act Invisibly?

Imagine an autonomous DeFi agent that:

1. **Executes trades without revealing intent** until the moment of execution
2. **Moves funds with hidden amounts** visible only as cryptographic commitments
3. **Proves it follows your rules** without revealing what those rules are
4. **Demonstrates compliance** without exposing your entire financial history

This is what we built with **zkde.fi**.

---

## The Architecture of Privacy

### Layer 1: Proof-Gated Execution

Nothing happens on zkde.fi without a valid zero-knowledge proof. This isn't optional—it's enforced at the contract level.

```
User sets constraints → Agent generates proof → Contract verifies proof → Execution proceeds
```

If the proof is invalid? The transaction reverts. There's no "trust me" fallback, no admin override. The math either checks out or it doesn't.

We use **Groth16 proofs** generated via snarkjs, verified on-chain through **Garaga**—a native SNARK verifier for Starknet. Proof generation takes ~750ms. Verification is instant.

### Layer 2: Confidential Transactions

Traditional DeFi deposits look like this on-chain:
```
Alice deposits 10,000 USDC to Protocol X
```

Our confidential deposits look like this:
```
Commitment 0x7a3f... deposited with valid proof
```

The amount is hidden inside a Pedersen commitment. Only the commitment holder knows the value. The protocol can verify the math works (no double-spending, no negative amounts) without ever seeing the number.

This uses the same cryptography that powers Zcash and Tornado Cash, but deployed natively on Starknet via Garaga's BN254 curve operations.

### Layer 3: Selective Disclosure

Here's where it gets interesting. Privacy isn't about hiding everything forever—it's about controlling what you reveal, when, and to whom.

With zkde.fi, you can generate proofs that say:
- "My portfolio is worth more than $100k" (without revealing the exact amount)
- "My risk score is below threshold X" (without revealing the score)
- "I've been operating for 6+ months with no liquidations" (without revealing trade history)

This is **selective disclosure**. Compliance officers get what they need. Auditors get what they need. Your competitors get nothing.

---

## The zkML Layer: Private Intelligence

An autonomous agent needs to make decisions. Those decisions need to be verifiable. But the decision logic itself? That can stay private.

We integrated two verifiable ML models:

**1. Risk Score Model**
- Evaluates protocol safety based on utilization, volatility, liquidity, audit scores
- Generates a Groth16 proof that the score meets threshold
- The actual score never appears on-chain—only the binary "safe/unsafe" is verified

**2. Anomaly Detection (Rug-Radar)**
- Monitors pool behavior for suspicious patterns
- Flags potential exploits before they happen
- Proves "no anomalies detected" without revealing the detection methodology

Both models run off-chain, generate proofs, and those proofs are verified on-chain via Garaga. The agent can't act unless both models give the green light—and that green light is cryptographically verified, not trusted.

---

## Session Keys: Delegation Without Exposure

Starknet's native account abstraction enables something powerful: session keys.

Instead of signing every transaction manually, you grant a session key limited authority:
- Maximum position size: 1 ETH
- Allowed protocols: [JediSwap, Ekubo]
- Duration: 24 hours

The session key can execute within these bounds without further approval. If it tries to exceed them? The transaction fails. This isn't a soft limit—it's enforced by the contract.

The privacy benefit: your main account never directly interacts with protocols during automated operations. The session key acts as a proxy, adding a layer of separation between your identity and your activity.

---

## The zkDE Framework

We formalized this architecture as **zkDE (Zero-Knowledge Delegated Execution)**. You delegate (session keys, agents); execution is proof-gated and can be ZK. Most accurate for “agent + proof-gate.” Strong Starknet fit (AA, session keys).

The **GATE-1** standard implements zkDE: it defines proof formats, session key structures, intent commitments, and verification flows so agents that execute on your behalf maintain privacy. GATE-1 specifies:
- How agents publish intent commitments (hash of action, not action itself)
- How constraints are represented on-chain (receipts, not raw parameters)
- How proofs are verified (dual-path: Garaga for privacy, Integrity for execution)
- How session keys interact with proof verification

The goal: any project can build zkDE-compatible agents (via GATE-1) that interoperate with privacy guarantees.

---

## What This Means in Practice

**For users:**
Your DeFi activity becomes private by default. You deposit, the world sees a commitment. You rebalance, the world sees a proof was valid. Your strategy, your amounts, your decision logic—all hidden.

**For protocols:**
You can integrate privacy-preserving deposits without rebuilding your entire stack. Accept proof-gated transactions alongside regular ones. Let users choose their privacy level.

**For compliance:**
Selective disclosure proofs give regulators what they need without compromising user privacy. "Prove you're not a sanctioned entity" doesn't require revealing your net worth.

**For the ecosystem:**
A framework (zkDE) and standard (GATE-1) that any autonomous agent can implement. Privacy becomes composable, not siloed.

---

## The Technical Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Proof Generation | snarkjs + Circom | Generate Groth16 proofs off-chain |
| On-Chain Verification | Garaga | Native BN254 SNARK verification |
| Execution Proofs | Stone + Integrity | STARK proofs for computation integrity |
| Smart Contracts | Cairo | Starknet-native, provable execution |
| Account Abstraction | Native Starknet | Session keys, multi-sig, custom validation |

Proof generation: ~750ms  
On-chain verification: Instant  
Circuit sizes: 2-3k constraints (small, fast)

---

## What We're Not

We're not a mixer. We're not trying to hide the *existence* of transactions—just their contents.

We're not abandoning transparency. Proofs are public. Verification is public. The *validity* of every action is transparent. The *details* are private.

We're not claiming perfect privacy. If you deposit $1M and withdraw $1M an hour later, correlation attacks exist. What we offer is meaningful privacy for meaningful use cases: strategy protection, competitive advantage, regulatory compliance without overexposure.

---

## The Path Forward

zkde.fi is live on Starknet Sepolia. The contracts are deployed. The proofs are real—~750ms Groth16 generation, verified through Garaga on-chain.

This is what privacy-preserving DeFi looks like. Not as a theoretical paper. Not as a testnet toy. As working infrastructure.

No proof, no execution. No exceptions.

---

*Built by Obsqra Labs. Open source at [github.com/obsqra-labs/zkdefi](https://github.com/obsqra-labs/zkdefi). Live at [zkde.fi](https://zkde.fi).*
