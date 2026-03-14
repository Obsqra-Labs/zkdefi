# StarkForge Framing Design

**Date:** 2026-03-13  
**Status:** Design (approved)  
**Scope:** Reframe the public story around StarkForge as the base proving fabric / proof chain, preserve privacy as the product core, and position zkde.fi as the sandbox where Obsqra Labs ships trustless and verifiable systems.

---

## 1. Goals

- **Replace `zk OS` as the public lead** with a clearer infrastructure framing. `zk OS` can remain a background concept, but not the headline.
- **Establish a clean hierarchy:** `Obsqra Labs` = parent zk research lab; `StarkForge` = proving fabric / proof chain; `zkde.fi` = sandbox and flagship proving ground.
- **Keep privacy at the center:** StarkForge is not just a proof router. It exists to enable **private execution with portable, attestable outcomes**.
- **Make current work legible:** ModelBridge, Madara L3, verifier lanes, receipts/facts, and settlement recursion should feel like one coherent system, not disconnected experiments.
- **Support hybrid audiences:** judges, developers, partners, and future integrators should all understand the same story with different depth layers.

---

## 2. Core positioning

### Recommended headline

**StarkForge is a STARK-native proof chain and proving fabric for private execution, portable proofs, and cross-chain attestation.**

### Recommended supporting sentence

**It routes, verifies, and settles multiple proof lanes across apps and chains, so execution can stay private while outcomes remain attestable even when the underlying pipeline is fragmented or opaque.**

### Why this framing wins

- It leads with the deepest moat: **portable, attestable proofs**.
- It keeps **privacy** as a first-class property, not an app-level add-on.
- It makes **ModelBridge**, **Madara L3**, verifier modes, and multichain settlement feel central rather than incidental.
- It lets **zkde.fi** remain strategically important without forcing the whole company story to be “private DeFi app.”

### Language to deprioritize

- **`zk OS`**: keep as background architecture language, not public lead language.
- **`verification OS`**: acceptable as supporting language, but too abstract for the primary hook.
- **`DA layer`**: too narrow for current shipped value, though it may become relevant later if IPFS/libp2p are added.

---

## 3. Parent / infra / app hierarchy

The public hierarchy should always read:

- **Obsqra Labs** is the zk research lab behind the system.
- **StarkForge** is the proving fabric and proof chain.
- **zkde.fi** is the sandbox where Obsqra Labs tests and ships trustless, verifiable systems on top of StarkForge.

Recommended copy:

> **Obsqra Labs** is the zk research lab behind StarkForge and zkde.fi.  
> **StarkForge** is a STARK-native proof chain and proving fabric for private execution, portable proofs, and cross-chain attestation.  
> **zkde.fi** is the sandbox where those systems go live.

---

## 4. Privacy-first trust model

Privacy must remain the product truth. StarkForge is not merely a place where proofs get checked. It is the fabric that allows **private intent and private execution** to remain hidden while still producing verifiable outcomes.

The core claim:

**StarkForge enables private execution while still emitting portable, attestable proof outcomes.**

Public execution flow:

```text
private intent
→ proof lane
→ verifier
→ fact / receipt
→ settlement
→ composable app outcome
```

This is how the system answers the “pipeline goes dark / turns to spaghetti” problem: the system does not ask users to blindly trust hidden infrastructure. It emits attestable receipts and facts that survive across settlement layers.

---

## 5. Narrative architecture

The public story should be presented in four layers.

### 5.1 StarkForge

The base infrastructure layer:

- STARK-native proof chain
- proving fabric
- verifier routing
- settlement across L3 / L2 / L1

### 5.2 Proof lanes

The multiproof system inside the fabric:

- `ModelBridge`
- `ModelBridgeHeavy`
- `stark_integrity`
- `Noir HONK`
- `native_kzg`

These are different trust, cost, and portability envelopes rather than disconnected experiments.

### 5.3 Attestation + settlement

The accountability layer:

- proof receipts
- fact registration
- verifier outcomes
- settlement path across L3 → L2 → L1

### 5.4 Apps

The application layer:

- **zkde.fi / Capital OS** is the flagship sandbox
- future apps can include governance, agent systems, marketplaces, and other protocol surfaces

Resulting story:

```text
private execution
→ proof lane
→ verifier
→ fact / receipt
→ settlement
→ composable app outcome
```

---

## 6. Surface strategy

### StarkForge

**Role:** base infra brand

It should own:

- proof chain identity
- verifier lanes
- proof portability
- settlement path
- explorer / operational view
- integrator story

### zkde.fi

**Role:** flagship sandbox

It should show why StarkForge matters:

- private execution
- proof-gated capital
- receipts and trust context
- end-to-end verifiable user flows

### `/forge`

**Role:** live operational proof-chain surface

It should be **proof explorer first, chain browser second**. It should prominently surface:

- recent verified proofs
- recent facts
- verifier lanes and health
- settlement status
- explorer links

### `/test`

**Role:** dense evidence / research readout

It remains the more detailed, judge-facing proof evidence page with:

- live receipts
- lane-specific benchmarks
- bridge health
- strict-mode evidence
- tx and explorer references

Longer term it may become a subordinate evidence mode under StarkForge, but it can remain separate for now.

---

## 7. What the system is for

Primary public framing order:

1. **Multiproof interoperability / proving fabric**
2. **Apps and protocols**
3. **Agents / execution**

So StarkForge should be described first as infrastructure for **portable, attestable proofs**, and only then as something apps, protocols, and agents consume.

Short form:

> StarkForge is a STARK-native proving fabric for cross-chain proof interoperability.

Expanded form:

> StarkForge is a STARK-native proof chain and proving fabric for private execution, portable proofs, and cross-chain attestation across apps and protocols.

---

## 8. What stays out of scope

The following may become relevant later, but should not complicate the first-pass public framing:

- IPFS-backed artifact distribution
- libp2p transport / gossip
- broader DA framing
- `zk OS` language as the public lead

These belong in a later evolution of StarkForge, not in the initial reframe.

---

## 9. Success criteria

The reframe is working if a new person can answer these in under 30 seconds:

1. **What is StarkForge?**  
   A privacy-first proof chain / proving fabric

2. **What does it do?**  
   Routes, verifies, and settles portable proofs across apps and chains

3. **Why does it matter?**  
   It enables private execution with attestable outcomes

4. **What proves it’s real?**  
   Live verifier lanes, facts, receipts, and settlement surfaces on `/forge` and `/test`

5. **Where does zkde.fi fit?**  
   It is the sandbox and flagship app built on top of StarkForge

---

## 10. Messaging guardrails

### Do say

- STARK-native proof chain
- proving fabric
- private execution
- portable proofs
- cross-chain attestation
- verifier lanes
- receipts and facts
- sandbox / flagship proving ground

### Don’t lead with

- zk OS
- generic “AI reputation”
- Madara as if it is the whole story
- zkde.fi as if it is the full company / infrastructure story
- block explorer language without proof context

---

## 11. Final approved framing

**Obsqra Labs** is the zk research lab.  
**StarkForge** is the STARK-native proof chain and proving fabric.  
**zkde.fi** is the sandbox where Obsqra Labs tests and ships trustless, verifiable systems on top of StarkForge.

Privacy remains the product core. Portable, attestable proofs are the infrastructure unlock. zkde.fi demonstrates the system in practice.
