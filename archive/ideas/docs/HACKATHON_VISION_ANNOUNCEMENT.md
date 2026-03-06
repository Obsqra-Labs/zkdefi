# Why We're Entering the Privacy Track with an AI Agent for DeFi

**TL;DR:** We're entering Starknet Re{define} Hackathon (Privacy track) with zkde.fi—a privacy-preserving autonomous agent for DeFi. AI agents are the future of on-chain execution, but they need privacy to work. We're building this to prove it's possible today.

---

## The Thesis: AI Agents Are Coming to DeFi

In November we shipped obsqra.fi—proof that AI decisions can be verified on-chain. It worked: users could trust the allocation without trusting the operator.

But we realized something bigger: **the next evolution isn't just verifiable AI, it's autonomous agents.**

DeFi users want to:
- Set parameters once, let agents optimize over time
- Stay within their risk tolerance without constant monitoring
- Trust execution without surrendering control

That's an **autonomy problem**. But more importantly, it's a **privacy problem**.

---

## Why AI Agents Need Privacy

Think about what an AI agent does in DeFi:

**It watches.** Market conditions, protocol yields, risk metrics—constantly.

**It decides.** When to rebalance, which protocols to enter, how to optimize allocation.

**It executes.** Deposits, withdrawals, rebalances—autonomously.

Now ask: **what happens if all of that is public?**

### Problem 1: Intent Leakage
If the agent broadcasts its decision before execution, you get:
- Front-running
- MEV extraction  
- Competitive disadvantage (everyone sees your strategy)

**The agent's intent needs to stay hidden until execution.**

### Problem 2: Position Exposure
If everyone can see the agent's positions and sizes, you get:
- Privacy loss for users
- Targeted attacks on large positions
- Strategy revelation through position tracking

**The agent's holdings need confidentiality.**

### Problem 3: Compliance Without Exposure
If you need to prove compliance (audits, regulations, protocol requirements), you don't want to reveal:
- Full position history
- Agent strategy
- Trading patterns

**You need selective disclosure: prove the statement, hide the details.**

---

## This Isn't One Privacy Problem—It's Three

Most privacy solutions tackle one dimension:

- **Confidential transactions** hide amounts (good for transfers)
- **Dark pools** hide intent (good for trading)
- **Selective disclosure** proves compliance (good for audits)

But AI agents need **all three at once**.

- Hidden **intent** (what the agent will do next)
- Hidden **positions** (what the agent holds)
- Selective **disclosure** (prove compliance without revealing strategy)

This is why we're entering the **Privacy track**: AI agents force you to solve privacy comprehensively, not just in pieces.

---

## Why DeFi Is the Perfect Testing Ground

DeFi is where AI agents will live or die on privacy:

**High-value targets.** Large positions attract MEV, front-running, attacks. Privacy isn't optional—it's survival.

**Autonomous execution.** Agents need to act without constant user approval. That means delegation (session keys, AA) and verification (proofs before execution).

**Verifiable outcomes.** Unlike TradFi AI (black boxes), DeFi users demand cryptographic proof that the agent followed rules. Privacy + verifiability together.

**Open composability.** Agents interact with multiple protocols. Privacy needs to work across the stack, not just inside one app.

If you can build a privacy-preserving AI agent for DeFi on Starknet, you've solved the hard problem. Everything else gets easier.

---

## Why Starknet?

We spent weeks researching zk proving pathways for trustless agents. Starknet kept being the answer:

**Native account abstraction.** Every account is a smart contract. Session keys, delegated execution, programmable permissions—first-class features. That's what agents need.

**Integrity as a primitive.** Cryptographic proofs aren't just for scaling—they're the basis for verifiability. Agents generate proofs, contracts verify them, execution happens only if valid.

**Privacy primitives shipping now.** Garaga for confidential transactions. MIST for private transfers. Selective disclosure patterns emerging. The building blocks exist.

**An ecosystem betting on this future.** Herodotus, Pragma, Ekubo, JediSwap, and dozens of teams building the infrastructure for verifiable, privacy-preserving applications.

Starknet isn't just *able* to support privacy-preserving agents—it's *designed* for them.

---

## What We're Building: zkde.fi

**zkde.fi** is a privacy-preserving autonomous agent for DeFi on Starknet.

**What it does:**
- You delegate to the agent via session keys (set constraints: max position, allowed protocols, risk params)
- Agent monitors protocols, decides when to optimize, generates proof that decision satisfies your constraints
- Agent executes autonomously—but only if proof verifies on-chain
- Your intent stays hidden, positions can be confidential, compliance is selective disclosure

**The three pillars:**
1. **Intent-hiding execution** — Agent decisions stay hidden until execution (proof-gated, no broadcast)
2. **Confidential transactions** — Position sizes stay private (Garaga on Sepolia, MIST path for mainnet)
3. **Selective disclosure** — Prove compliance without revealing strategy (generate proof of statement, register on-chain)

**Why it matters:**
- Proves AI agents can be autonomous, verifiable, AND private on Starknet today
- Shows Starknet's primitives (AA, Integrity, privacy layers) unlock a new class of applications
- Validates that privacy isn't a feature—it's a requirement for trustless agents

---

## Why We're Doing This

Three reasons:

### 1. Validation
We built obsqra.fi to prove AI decisions can be verified on-chain. Does the approach work for autonomous agents? Can privacy and verifiability coexist? Can users trust an agent they don't control?

zkde.fi is the test.

### 2. Ecosystem
If privacy-preserving agents are the future, more teams need to be building them. We want to show it's possible today with Starknet's primitives. Not in six months when more infrastructure ships—now.

### 3. The Market
AI agents are coming to crypto whether we're ready or not. Without privacy, they'll leak intent, expose positions, and fail at scale. Someone needs to prove privacy + autonomy + verifiability can work together.

We think Starknet is where that happens first.

---

## What Success Looks Like

**For judges:** We hope zkde.fi demonstrates that privacy isn't a single feature—it's three interlocking problems (intent, position, disclosure) that agents force you to solve comprehensively.

**For builders:** We hope this shows Starknet's primitives are ready for production. AA for delegation. Integrity for verification. Privacy layers for confidentiality. The pieces exist; applications can ship.

**For users:** We hope this proves autonomous agents can be trustless. You delegate, you set constraints, you verify execution—but you never surrender control.

---

## When It Launches

zkde.fi goes live soon on Starknet Sepolia. Countdown at zkde.fi.

We're entering Starknet Re{define} Hackathon, Privacy track, because AI agents force you to solve privacy comprehensively—and we think Starknet is ready for that.

---

**Our ask:** If you're thinking about autonomous agents, privacy infrastructure, or verifiable compute—let's connect. We think this is where Starknet wins.

🔗 zkde.fi (launching soon)  
🏗️ Built by Obsqra Labs  
🐦 @obsqra_labs

---

*This is our first hackathon. We're building to validate that privacy + autonomy + verifiability can coexist on Starknet. Let's prove it.*
