# Mega-prompt: Re-architect zkde.fi/agent Into a Unified AI–Vault–DEX Control Surface

**Audience:** Builder agent (Claude Code, Cursor, Ollama, or any engineering agent with repo access).  
**Use:** Feed this as a **directive**. Execute against the implementation plan in `docs/plans/2026-03-02-agent-profile-rearchitecture-implementation.md`.  
**Hardened version (session keys + privacy-first):** Use `docs/plans/2026-03-02-refined-builder-directive.md` for the strict, paste-ready builder directive.

---

## Design and mockup mandate

**We are not handing you pixel-perfect mockups.** This document and the implementation plan are the product concept. **You own the design.** Your job is to make this product real: information architecture, layout, hierarchy, and interaction model. If something in the plan is ambiguous, decide in a way that matches the product truth (vault-centric, proof-gated, reputation-aware). Prefer clarity and a single capital flow over preserving every existing tab. Use the audit and the plan as the spec; produce a cohesive, usable UI that feels like a Bloomberg Terminal for autonomous capital—not a Starknet DEX with extra tabs. No placeholder data or fake proofs; use real APIs and demo mode for paper flows.

---

## Role and task

You are a senior product architect and Starknet full-stack engineer.

Your task is to **refactor zkde.fi/agent and /profile into a unified AI-driven DeFi operating system**, optimized for:

- Autonomous execution  
- Vault-first capital flows  
- ZK proof gating  
- Identity-driven reputation  
- Privacy-track hackathon positioning  

**Do NOT patch the current UI. Reimagine it.**

---

## 1. Core product truth

zkde.fi is **NOT**:

- Just a DEX UI  
- Just an AI trading bot  
- Just a zkML demo  

zkde.fi **IS**:

> A Vault-Centric, Proof-Gated, Reputation-Aware Autonomous Capital Engine  

Everything must orbit this.

---

## 2. Current problem (summary)

The system is fragmented: Swap, LP, Limit, Stake, Automate, Intelligence, Analytics are siloed tabs with no unified flow. AI models exist but do not meaningfully drive execution. Vault is missing as the root layer. Ledger is missing. Identity is hidden. Reputation is underused. Privacy is underpowered. The ZK gate is educational, not operational. This must change.

---

## 3. New architecture: four surfaces

Reorganize the UI into **4 core surfaces** (max 4 top-level nav items).

### 1. VAULT (capital source of truth)

Root layer.

- **Responsibilities:** Wallet → Vault deposit; Vault → strategy allocation; Vault → privacy pools; vault ledger; session keys; risk limits; AI execution history.  
- **UX:** Show Wallet Balance vs Vault Balance; deposit + withdraw flow; Vault NAV chart; allocation breakdown (LP / Limit / Private / Idle); **ledger feed** (Deposit, AI allocation, Rebalance, Pool rotation, Harvest, ZK proof verified). Each ledger item: **what happened**, **why it happened** (AI decision), **proof status**. The vault is the capital brainstem; everything flows from here.

### 2. TRADE (unified DEX surface)

Unify Swap, LP, Limit, Stake into **one** trade hub.

- Same token selector across modes; persistent amount field; AI suggestions inline.  
- When user selects e.g. ETH/STRK: show Swap | LP | Limit | Stake in one context (tabs or sections). No separate pages.  
- AI suggestions: suggested LP range, suggested limit price, suggested staking %. Add **"Apply AI suggestion"** button.

### 3. BRAIN (AI control center)

Replaces "Automate" + "Intelligence".

- **Strategy templates:** Conservative Yield, Balanced Growth, Aggressive LP, Privacy Allocator.  
- **Custom agent builder:** Expose models (Risk Score, Correlation Risk, Volatility Guard, TWAP, Diversification, Credit Weighting). Each model: what it does, inputs, output signal, how it gates execution. No mystery toggles.  
- **Execution modes:** Manual | Assist | Autonomous. Wired to session keys, max capital, max drawdown, allowed pools.  
- **ZK gate visibility:** Pipeline: AI Decision → zkML circuit → Proof generated → On-chain verify → Execute. Show this pipeline visually; the ZK gate must feel alive, not academic.

### 4. IDENTITY (reputation + privacy + credit)

Profile becomes the identity dashboard.

- **Reputation score:** Breakdown (address age, strategy success rate, risk discipline, liquidation history, vault tenure). Transparent formula.  
- **Strategy reputation:** Per strategy: APY track record, risk rating, community trust score.  
- **Agent reputation:** Per deployed agent: performance %, proof compliance %, execution reliability.  
- **Selective disclosure:** User toggles: reveal KYC level, risk tier, capital size band, or remain private. Use ZK selective disclosure framing.

---

## 4. Privacy and capital flow

- **Privacy:** Vault must support public pools, private pools, mixed routing. AI allocates by risk profile (conservative → public LP; balanced → mixed; privacy-max → shielded pools). Privacy pool is a vault allocation option, not a dead tab.  
- **Capital flow:** Connect wallet → optional demo mode → Deposit into Vault → Choose Manual Trade | AI Assist | Autonomous → AI suggests allocations → User approves → Session key granted → Brain executes → ZK gate verifies → Ledger logs it. One loop, not seven disconnected tabs.

---

## 5. Data unification

Analytics is an internal data feed. Brain consumes it; Vault reflects it; Trade suggests from it. User sees one cohesive system. Do not leave Intelligence, Analytics, and Automate as isolated dashboards.

---

## 6. UI rules

- Maximum **4** top-level nav items.  
- No nested tab hell.  
- Every AI control must show consequence.  
- Every proof must show verification status.  
- Every strategy must show risk.  
- If a feature does not affect capital allocation, remove it or hide under advanced.

---

## 7. Hackathon demo mode

Demo mode must:

- Preload vault with demo balance (e.g. via existing demo-credit or equivalent).  
- Simulate AI rebalances and ledger entries where appropriate.  
- Simulate or show ZK proof success in the pipeline.  
- Show ledger entries.  
- **Do not show empty dashboards.** Demo must feel alive.

---

## 8. Deliverables (from implementation plan)

1. Component tree redesign (Vault, Trade, Brain, Identity).  
2. Updated routing structure (max 4 top-level; 3 surfaces on agent).  
3. Unified state management (VaultStore).  
4. AI decision pipeline visual (ZK gate) in Brain.  
5. Ledger system (VaultLedger with what/why/proof).  
6. Identity dashboard schema (reputation breakdown, selective disclosure).  
7. ZK proof state tracking (pipeline + ledger).  
8. Backend: expose ledger transfers (e.g. `GET /api/v1/zkdefi/ledger/transfers`) and proof/verification status in execute/rebalance responses where missing.

Do **not** patch visually; rebuild logically.

---

## 9. Final product vision

When complete, zkde.fi should feel like:

- A **Bloomberg Terminal for Autonomous Capital**  
- With a **Vault** as the core  
- An **AI brain** that explains itself  
- A **ZK gate** that proves itself  
- An **Identity** layer that earns trust  
- A **privacy engine** that matters  

It should **not** feel like a Starknet DEX with extra tabs.

---

## 10. Direct instruction to the builder

You have the concept and the implementation plan. There are no separate design mockups. **You are responsible for the layout, hierarchy, and interaction design.** Make choices that reinforce vault-first flow, clear cause-and-effect for AI and proofs, and a single capital loop. Use the existing backend APIs and add only what the plan specifies (e.g. ledger transfers endpoint). Do not use placeholder data or fake proofs; use demo mode and real endpoints. Implement the four surfaces, VaultStore, and ledger feed so the product is consistent, deterministic, and bad-ass.

---

## Paste-ready: prompt back to your agent

Copy the following when you need to hand off to your builder agent and stress design ownership:

```
I'm not giving you mockups. This is the concept and the implementation plan. I'm depending on you to lead design and make this a reality. Decide layout, hierarchy, and interactions so zkde.fi feels like a Bloomberg Terminal for autonomous capital—vault-first, proof-gated, reputation-aware. No placeholder data; use real APIs and demo mode. Execute against docs/plans/2026-03-02-agent-profile-rearchitecture-implementation.md and the mega-prompt in docs/plans/2026-03-02-agent-profile-megaprompt-builder.md. For the strict directive (session keys + privacy-first), use docs/plans/2026-03-02-refined-builder-directive.md. Rebuild the agent and profile experience; don't patch.
```
