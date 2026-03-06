# Entering Our First Hackathon: zkde.fi and the Path to Trustless Autonomous Agents

**TL;DR:** We're entering Starknet Re{define} Hackathon (Privacy track) with zkde.fi—a privacy-preserving autonomous agent for DeFi. We reverse-engineered Stone prover for local proving, built on Starknet's Integrity fact registry, and are open-sourcing the stack to validate that proof-gated agents are ready for production.

---

## The Journey to Starknet

In November 2025, we shipped obsqra.fi on EVM. The thesis was simple but ambitious: can we prove an AI made the right decision, on-chain?

We built a DeFi sandbox where allocation decisions were verifiable. A risk model analyzed protocols, proposed an allocation, generated a proof, and execution happened only after on-chain verification. It worked. Users could trust the AI without trusting the operator.

But as we iterated, a bigger question emerged: **how do you build truly trustless autonomous agents?**

An AI agent that manages DeFi positions needs to:
- Prove it followed your constraints (max position, allowed protocols, risk tolerance)
- Act autonomously (monitor, decide, execute) without constant user interaction
- Protect your privacy (no broadcasting strategy, no revealing positions)
- Be verifiable (every action cryptographically proven before execution)

That's not just a technical challenge—it's a **privacy + verifiability + autonomy** problem. And solving it required deeper zk primitives than we had on EVM.

---

## Why Starknet?

The more we researched zk proving pathways, the more Starknet kept coming up.

**The integrity web.** Cryptographic proofs as the basis for verifiability, not just scaling. The idea that you can prove computation happened correctly without re-executing it—that's the foundation for trustless agents.

**Native account abstraction.** Every account is a smart contract. Session keys, delegated execution, and programmable permissions are first-class features. That's exactly what agents need: users delegate once via session keys, agents execute within constraints.

**A growing ecosystem.** Teams like Herodotus (Integrity verifier), Garaga (Groth16 on Starknet), MIST (private transfers), and dozens of protocols building the privacy and verification layers we needed.

So we moved our research to Starknet. And we started digging into how proofs actually get verified on-chain.

---

## The Stone Unlock

Here's what we discovered: **StarkWare's Stone prover + Herodotus Integrity gives you a pathway to product-level zkSTARK proving.**

Stone is the prover that powered Starknet for years (recently replaced by S-two for mainnet, but Stone is still the most mature open-source STARK prover). Integrity is Herodotus's Cairo-native verifier that maintains a fact registry on Starknet L2—think of it as SHARP for Starknet.

The problem? Stone was built for managed cloud deployments. Most teams either:
1. Wait for proving APIs to launch (slow iteration)
2. Use centralized proving services (trust assumptions)
3. Build their own prover from scratch (months of work)

We wanted to iterate at **product speed**. Generate proofs locally. Verify on-chain via Integrity. Ship features daily.

So we reverse-engineered Stone to run locally and write directly to Integrity's fact registry.

Now we have:
- **Local proving pipeline:** Cairo program → Stone prover → proof.json → Integrity contract
- **On-chain verification:** Contracts check `is_valid(proof_hash)` on Integrity before execution
- **Production-ready:** No waiting for APIs, no centralized services, full control

This is the unlock for verifiable agentic applications.

---

## Why Agents Need Privacy

AI agents are the perfect use case for proof-gated execution. But they also need privacy—and that's actually **three distinct problems**:

### 1. Intent-hiding execution
You don't want to broadcast what the agent *will* do. That's front-running, MEV, and competitive advantage leakage. The agent's decision should stay hidden until execution.

**Solution:** Proof-gated execution. Agent generates proof (allocation satisfies constraints), submits it for verification, then executes. Intent stays hidden; execution is verifiable.

### 2. Confidential transactions
You don't want everyone to see the agent's position sizes. That's privacy for balances and transfer amounts.

**Solution:** Garaga (Groth16 verifier on Starknet) for confidential transfers on Sepolia. MIST.cash for production on mainnet. Commitment-based schemes where only commitments go on-chain.

### 3. Selective disclosure
You want to prove compliance (e.g., "agent stayed within max position" or "eligible for audit") without revealing the agent's full strategy or history.

**Solution:** Selective disclosure proofs. Prove a statement about the data without revealing the data itself. Register proof on-chain for auditors/regulators.

These three pillars—intent-hiding, confidential transactions, selective disclosure—are what privacy-preserving agents need. And they're all possible on Starknet today.

---

## Introducing zkde.fi

We're entering Starknet Re{define} Hackathon—Privacy track—with **zkde.fi**.

**What it is:** A privacy-preserving autonomous agent for DeFi on Starknet.

**How it works:**
1. **Delegate to the agent:** You grant a session key (Starknet AA) with constraints (max position, allowed protocols, expiry)
2. **Agent monitors and decides:** Agent watches risk/APY, runs allocation logic (AI risk engine), decides when to rebalance
3. **Agent generates proof:** Allocation decision satisfies your constraints → Stone prover → Integrity fact registry
4. **Agent executes:** Via session key + proof_hash. On-chain validation: session valid? ✓ Proof valid? ✓ → Execute
5. **Privacy preserved:** Agent's intent was hidden until execution. Positions can be confidential (Garaga). Compliance via selective disclosure.

**The stack:**
- **Session keys (Starknet AA):** Delegation with programmable constraints
- **Proof-gating (Stone → Integrity):** Every action requires on-chain proof verification
- **Privacy primitives (Garaga, selective disclosure):** Confidential positions, compliance without revealing strategy
- **Three pillars:** Intent-hiding execution, confidential transactions, selective disclosure

---

## This Is a Validation Moment

We're not entering this hackathon to win a trophy (though that'd be nice). We're entering to **validate three things**:

### 1. The obsqra.fi stack works beyond our own product
We built this for ourselves. Does it work for others? Can judges see that this approach—local Stone proving, Integrity verification, proof-gated execution—is production-ready?

### 2. Open source validates the approach
We're open-sourcing zkde.fi—the contracts, the frontend, the backend that calls our proving API. Not the prover itself (that's our edge), but the application layer that shows what's possible when you have production-ready proving. If this approach works, more teams will want to build on it.

### 3. Proof-gated agents are the unlock for trustless automation
Agents need autonomy (session keys), verifiability (proofs), and privacy (hidden intents, confidential positions, selective disclosure). Starknet has all three primitives. zkde.fi proves they work together.

---

## Why Share This Now?

We're trying to prove that **proof-gated autonomous agents are the way forward** for Starknet. The proving infrastructure we built is our competitive advantage, but zkde.fi demonstrates what becomes possible when you have it.

If we're right:
- More teams should be building verifiable agents
- More protocols should integrate proof-gating
- More users should demand verifiable autonomy

The only way to validate that is to build a real application and let the ecosystem see what's possible.

---

## What's Next

**zkde.fi launches soon on Sepolia.** Live at zkde.fi.

**Open source.** Contracts, frontend, backend (that calls our proving API)—all public on GitHub. The proving pipeline itself stays proprietary (that's our competitive advantage), but zkde.fi shows what's possible with it.

**Built in public.** We'll share what we learn about building verifiable agents, integrating with Starknet's AA and privacy primitives, and where we think this is heading.

**For builders:** If you're working on agents, privacy infrastructure, or verifiable compute on Starknet—let's connect. We think proof-gated agents are the unlock for trustless automation. If you're building in this space, we should be collaborating.

**For judges:** We hope zkde.fi demonstrates that:
- Privacy + autonomy + verifiability can coexist (three pillars: intent-hiding, confidential, selective disclosure)
- Proof-gated execution is production-ready on Starknet (Stone + Integrity works today)
- Starknet's primitives (AA, Integrity, Garaga/MIST) unlock a class of applications that weren't possible before

---

## Our Ask

If you're interested in:
- **Autonomous agents** (proof-gated, session-keyed, verifiable)
- **Privacy infrastructure** (confidential transactions, selective disclosure)
- **Verifiable compute** (local STARK proving, on-chain verification)
- **Building on Starknet** (Integrity, AA, privacy primitives)

Let's connect. We're sharing our journey, open-sourcing the approach, and hopefully proving that trustless autonomous agents aren't just possible—they're ready.

---

**Links:**
- 🔗 zkde.fi (launching soon on Sepolia)
- 📚 Docs & code: github.com/obsqra-labs/zkdefi (coming soon)
- 🏗️ Built by Obsqra Labs: obsqra.fi
- 🐦 Follow: @obsqra_labs

**Hackathon:** Starknet Re{define} | Privacy track | January 2026

---

*This is our first hackathon. We're building in public. Let's prove that proof-gated agents are the future of trustless automation.*

---

## Appendix: Technical Deep-Dives (Coming Soon)

We'll be sharing technical deep-dives on:
1. **Session keys + proof-gating** as a novel primitive for agents
2. **Three pillars of privacy** for autonomous agents
3. **Building on Starknet's AA** for autonomous agents
4. **Integration patterns** for verifiable applications
5. **Production architecture** for verifiable agentic applications

Follow @obsqra_labs for updates.
