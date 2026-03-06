# Introducing zkDE and GATE

*The engine and the standard for proof-gated autonomous execution on Starknet*

---

## The Problem

Autonomous agents in DeFi are powerful. They rebalance, allocate, execute. But today they run on a promise: *trust that the agent did what it said*. There's no cryptographic proof that a decision was correct before execution. There's no standard for how agents should behave when they're acting on your behalf.

We wanted two things: an **engine** where execution is verifiable and deterministic, and a **standard** for how agents operate inside it. No mental gymnastics—just clear roles. So we named them.

---

## zkDE: Zero-Knowledge Deterministic Engine

**zkDE** is the infrastructure. The engine.

- **Zero-knowledge** — Proofs verify without revealing. Your constraints, your risk tolerance, your intent stay private until you choose to disclose.
- **Deterministic** — Same inputs, same outcome. No "maybe it did, maybe it didn't." The proof either verifies or it doesn't.
- **Engine** — The thing that runs it. The layer where proof-gated execution lives: proofs are generated, verified on-chain, and execution is allowed or denied.

zkDE doesn't care *what* runs on it. It cares that whatever runs is proof-gated and verifiable. It's the platform.

---

## GATE: Governed Autonomous Trustless Execution

**GATE** is the standard for what runs on that engine. How agents execute.

- **Governed** — Rules, constraints, limits. Not the wild west. You set max position, risk tolerance, allowed protocols; the agent operates within those bounds.
- **Autonomous** — The agent acts on its own. You delegate once (e.g. via session keys); it executes when conditions are met.
- **Trustless** — No "trust me." Every action is gated by proof. The contract checks the proof; if it's invalid, nothing runs.
- **Execution** — The actual on-chain action. The thing that only happens after the gate opens.

The name is literal: execution is *gated*. No proof, no execution. That's the core primitive.

---

## How They Work Together

**zkDE is the where. GATE is the what.**

- zkDE = the engine (proof layer, verification, deterministic execution environment).
- GATE = the agent standard (interfaces, proof formats, session keys, intent commitments, verification flows).

You build on zkDE. You implement GATE. One line: *Built on zkDE; implements GATE.*

Agents that follow GATE run inside the zkDE engine. They submit proofs; the engine verifies; the gate opens or stays closed. Users get autonomous execution without blind trust.

---

## Why It Matters

**Trustless AI** isn't a slogan. It's a property: the system doesn't ask you to believe the agent did the right thing. It proves it, then executes. That's a new class of application—agents that are accountable by construction.

zkDE and GATE give that class a name and a shape. The engine (zkDE) is the infrastructure. The standard (GATE) is how agents plug in. Clear roles, no overloaded acronyms, no metaphor that doesn't match the mechanism.

---

## zkde.fi: First GATE-Compatible App

[zkde.fi](https://zkde.fi) is the first app built on zkDE that implements GATE. Proof-gated autonomous agent for private DeFi on Starknet: you set constraints, the agent allocates, every action is verified on-chain. No proof, no execution.

We're open-sourcing the stack and the standard so others can build agents that are governed, autonomous, and trustless—on an engine that makes verification deterministic and private.

---

*zkDE and GATE by [Obsqra Labs](https://obsqra.xyz). Built on Starknet.*
