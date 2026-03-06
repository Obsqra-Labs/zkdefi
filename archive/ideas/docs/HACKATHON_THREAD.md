# Hackathon Announcement Thread

**Platform:** Twitter/X
**Purpose:** Announce zkde.fi entry into Starknet Re{define} Hackathon (Privacy track)
**Tone:** Technical, strategic, open about journey

---

## Thread

**1/ 🧵 We're entering our first hackathon.**

In November we shipped obsqra.fi on EVM—a DeFi sandbox proving AI made the right allocation decision, on-chain. It worked, but we knew the next step required something deeper.

**2/ The question became: how do you build truly trustless agentic applications?**

AI agents need to prove they followed your constraints without revealing their strategy. That's a privacy + verifiability problem. We started researching zk proving pathways that could make this production-ready.

**3/ Starknet kept coming up.**

The integrity web, native AA, and a growing ecosystem of builders tackling hard problems. So we moved our research there and started digging into how proofs actually get verified on-chain.

**4/ Here's what we discovered: StarkWare's Stone prover + Herodotus Integrity gives you a pathway to product-level zkSTARK proving.**

But Stone was built for managed cloud deployments. We reverse-engineered it to run locally and write directly to Integrity's fact registry.

**5/ Why does this matter?**

Most teams wait for proving APIs or managed services. We wanted to iterate at product speed—generate proofs locally, verify on-chain, ship features. That's the unlock for verifiable agentic apps.

**6/ AI agents are the perfect use case for proof-gated execution.**

An agent makes decisions on your behalf (allocation, rebalancing, execution). You set constraints. Agent generates proof it stayed within bounds. No proof? No execution. Verifiable autonomy.

**7/ But agents also need *privacy*.**

You don't want to broadcast the agent's strategy (front-running, MEV). You want confidential positions. You want to prove compliance without revealing full history. That's three distinct privacy problems.

**8/ So we're entering @Starknet Re{define} Hackathon—Privacy track—with zkde.fi.**

A privacy-preserving autonomous agent for DeFi. Three pillars:
• Intent-hiding execution (proof-gated)
• Confidential transactions (Garaga on Sepolia, MIST on mainnet)
• Selective disclosure (prove compliance, hide strategy)

**9/ This is our validation moment.**

Can we prove the obsqra.fi stack works beyond our own product? Can we open-source the approach and get others building with it? Can we show judges that proof-gated agents are the unlock for trustless automation?

**10/ zkde.fi launches soon on Sepolia.**

Open source. Session keys (Starknet AA) for delegation. Proof-gating (Stone → Integrity) for verification. Privacy primitives (Garaga, selective disclosure) for confidentiality.

Live at zkde.fi. Built in public.

**11/ Why share this now?**

We're trying to validate that proof-gated agents are *the* way forward for Starknet. The proving infrastructure is our competitive advantage, but zkde.fi shows what becomes possible when you have it.

**12/ Our ask: if you're building agents, privacy infra, or verifiable compute on Starknet—let's connect.**

We're demonstrating what's possible with production-ready proving infrastructure and hopefully proving that proof-gated agents aren't just possible—they're ready.

🔗 zkde.fi (live soon)
📚 Docs: github.com/obsqra-labs/zkdefi
🏗️ Built by @obsqra_labs

---

## Alternate Shorter Version (6-tweet thread)

**1/ 🧵 We're entering our first hackathon: @Starknet Re{define}, Privacy track.**

In Nov we built obsqra.fi (EVM) to prove AI decisions on-chain. It worked, but the next unlock—trustless autonomous agents—required deeper zk primitives. So we moved to Starknet.

**2/ We reverse-engineered Stone prover to run locally + write to Integrity's fact registry.**

Why? Most teams wait for managed APIs. We wanted product-speed iteration: generate proofs locally, verify on-chain, ship. That's the unlock for verifiable agentic apps.

**3/ AI agents are perfect for proof-gated execution:**

Agent acts on your behalf → you set constraints → agent proves it followed rules → no proof, no execution. But agents also need privacy: hidden intents, confidential positions, selective disclosure for compliance.

**4/ So we built zkde.fi—privacy-preserving autonomous agent for DeFi.**

Three pillars: intent-hiding execution, confidential transactions (Garaga/MIST), selective disclosure. Session keys (AA) for delegation, proof-gating (Stone→Integrity) for verification.

**5/ This is our validation moment:**

Can we prove the obsqra.fi stack works beyond our own product? Can we open-source it and get others building? Can we show that proof-gated agents are ready for production?

**6/ zkde.fi launches soon on Sepolia. Open source.**

If you're building agents, privacy infra, or verifiable compute on Starknet—let's connect. We're sharing what we learn and proving this is the way forward.

🔗 zkde.fi
📚 github.com/obsqra-labs/zkdefi

---

## Key Messaging Points

**Journey:**
- Started on EVM (obsqra.fi) with verifiable AI for DeFi
- Research led us to Starknet for trustless agentic applications
- Reverse-engineered Stone prover for local, production-speed proving

**Technical unlock:**
- Stone + Integrity = product-level zkSTARK proving
- Local proving = faster iteration vs waiting for APIs
- Proof-gated execution = verifiable autonomy

**Why agents need privacy:**
- Hidden intents (no front-running/MEV)
- Confidential positions (amount-hiding)
- Selective disclosure (prove compliance, hide strategy)

**zkde.fi positioning:**
- Validation of obsqra.fi stack
- Open source for ecosystem
- Privacy track = natural fit (three pillars)

**Call to action:**
- Connect with builders in space
- Open source approach
- Prove this is the way forward

---

## Timing

Post **after hackathon officially starts** (in ~3 hours based on earlier conversation).

Optional follow-up tweets:
- Launch announcement when zkde.fi goes live
- Technical deep-dives on Stone reverse engineering
- Demo video when ready
- Judge-facing content linking to FOR_JUDGES.md

---

## Hashtags (use sparingly)

#Starknet #zkSTARKs #Privacy #AIAgents #BuildInPublic

---

## Media Assets (if available)

- Screenshot of zkde.fi landing page
- Diagram from AGENT_FLOW.md (session keys + proof-gating)
- Architecture diagram showing Stone → Integrity flow
- Countdown timer showing "Alpha Live"
