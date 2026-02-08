# Where zkDE / GATE Fits in the Starknet Ecosystem

*Deep research: ecosystem map, gaps, and where we slide in.*

---

## 1. Starknet Ecosystem Map (2025–2026)

### DeFi

| Layer | Who | What | Notes |
|-------|-----|------|--------|
| **AMM** | Ekubo | Concentrated liquidity, permissionless extensions, gas-optimized | Core Uniswap architect; extensions = DCA, order types, launchpads, **privacy solutions**, oracles, strategies |
| **Aggregator** | CairoSwap | Multi-DEX routing (Jediswap, 10kSwap, MySwap, Ekubo), limit orders, liquidity protocol | Main aggregation layer |
| **Lending** | zkLend | Money market | **Wound down Feb 2025** after exploit; lending gap on Starknet |
| **Bridges** | Starkgate, RhinoFi, Threshold tBTC | ETH/ERC-20, stablecoin liquidity, BTC | Infrastructure |

**Takeaway:** AMM + aggregator strong; **lending gap**. Ekubo explicitly lists **privacy solutions** as an extension use case. No dominant privacy DeFi frontend or compliant privacy stable.

---

### Privacy

| Who | What | Notes |
|-----|------|--------|
| **StarkCash** | Mixer, confidential transactions on Starknet | Privacy-focused |
| **StarkSwirl** | Token mixer for Starknet | Privacy-preserving |
| **Garaga** (Feltroid/StarkWare) | SNARK verifier SDK on Starknet (Groth16, Noir, Honk) | Used for ZK verification; we use it for confidential transfers |
| **Re{define} Privacy Track** | Hackathon track (Feb 2026) | Explicit asks: **private DeFi & commerce**, sealed-bid auctions, dark pools, **confidential transactions**, **privacy-first DeFi frontends**, shielded wallets, ZK verification |

**Takeaway:** Mixers exist; **no dominant compliant privacy** (KYC at edges, private in between) or **privacy-first DeFi frontend**. Re{define} is literally asking for what we built: private DeFi, confidential transactions, privacy-first DeFi frontends.

---

### Account Abstraction & Session Keys

| Who | What | Notes |
|-----|------|--------|
| **Argent** | StarknetKit, x-sessions, session keys docs & API | Primary session-key provider; dApps integrate via StarknetKit |
| **LayerAkira** | session_keys (AA session keys) | Open-source session key impl |
| **Starknet** | Native AA | Gasless, passkeys, paymasters; session keys are first-class |

**Takeaway:** Session keys are **standard UX**; Argent is the main integration point. We use session keys + **proof** (GATE). We’re a flagship dApp for “session keys + proof-gated execution” — good for Argent narrative and our distribution.

---

### Agents & zkML

| Who | What | Notes |
|-----|------|--------|
| **Giza** | Orion (Cairo zkML), provable ML, agents | Deploy ML via ONNX; provable inference; **Giza agents** = autonomous + provable |
| **AgentStark** (keep-starknet-strange) | Giza agents on Starknet with native AA | Provable ML agents execute on Starknet |
| **Trading agents** | e.g. 0xalphadevs starknet-eth-trading-agent | Autonomous trading on Starknet |

**Takeaway:** **Provable AI agents** exist (Giza, AgentStark). They don’t own a **standard** for proof-gated execution, session keys, intent commitments, constraint receipts. We define **GATE** — “how agents execute” — and become the standard. **Giza = model layer; we = execution / standard layer.** Complementary.

---

### Proof Verification

| Who | What | Notes |
|-----|------|--------|
| **SHARP / Integrity** | STARK prover, fact registry on L1 | We use it for execution proofs; fact registry = `is_valid(proof_hash)` |
| **Garaga** | Groth16 (and Honk) verifier on Starknet | We use for zkML + confidential transfers; StarkWare/Noir push |
| **StarkEx** | Conditional transfers, fact registry | Same pattern: condition → fact registered → execute |

**Takeaway:** **Fact-registry gating** is known (StarkEx conditional transfers). Few **Starknet L2 DeFi** protocols today gate execution on arbitrary Integrity facts. We’re a production use case for **proof-gated execution + Garaga** in DeFi.

---

### Grants & Roadmap

| Program | Focus | Fit |
|---------|--------|-----|
| **Seed Grants** | Up to $25K STRK, MVP/PoC | Early-stage fit |
| **Growth Grants** | $25K–$1M STRK; Innovation, Ecosystem Integration, Next Billion, Bitcoin Builder | **Innovation** (GATE, proof-gated, zkML); **Ecosystem Integration** (Ekubo, Argent, Garaga) |
| **Ecosystem 2025** | 193 projects; gaming largest; DeFi core; performance + AA + dev journey | We’re DeFi + privacy + agents; fits “innovation” and “ecosystem integration” |

**Takeaway:** We fit **Growth Grants** (Innovation + Ecosystem Integration). Narrative: GATE standard, proof-gated execution, Garaga DeFi flagship, Argent session-key flagship.

---

## 2. Gaps We Fill

| Gap | Ecosystem state | Our fit |
|-----|------------------|---------|
| **Proof-gated execution standard** | No shared “GATE-like” standard for agents; fact registry used in StarkEx, not in L2 DeFi agent flows | We define GATE; any agent can adopt “no proof, no execution” + session keys + intent commitments |
| **Privacy-first DeFi frontend** | Mixers (StarkCash, StarkSwirl); no dominant private DeFi app or compliant privacy | zkde.fi = privacy-first DeFi frontend with confidential transfers; compliant privacy narrative (KYC at edges) |
| **Compliant privacy** | Re{define} wants private DeFi; no dominant “compliant mixer” or privacy stable on Starknet | We have selective disclosure, compliance profiles; natural step = compliant privacy stable or KYC-at-edges product |
| **Agent execution standard** | Giza/AgentStark = provable agents; no standard for *how* they execute (constraints, proofs, receipts) | GATE = standard; we’re the execution/governance layer; they’re the model layer |
| **Garaga in DeFi** | Garaga used for Noir/verification; few production DeFi apps using it for confidential transfers | We’re a **Garaga DeFi flagship**: confidential deposits/withdrawals, zkML verification |
| **Lending** | zkLend wound down; lending gap | We’re not lending; a future lending protocol could use our proof layer (Integrity + Garaga) and GATE for proof-gated or private lending |

---

## 3. Where We Slide In Perfectly

### A. Re{define} Privacy Track (immediate)

- **Ask:** Private DeFi & commerce, confidential transactions, **privacy-first DeFi frontends**, sealed-bid, dark pools, ZK verification.
- **Us:** Privacy-first DeFi frontend, confidential transfers (Garaga), proof-gated execution, selective disclosure. **Direct fit.** We’re not a generic mixer; we’re “private DeFi + proof-gated agent,” which is exactly in scope.

### B. GATE as the Agent Standard (medium-term)

- **Ecosystem:** Giza/AgentStark do provable agents; no shared standard for proof-gated execution, session keys, intent commitments, constraint receipts.
- **Us:** GATE specifies interfaces, proof formats, session key shape, intent commitments, verification flows. **Slide in:** Propose GATE as the Starknet standard for “how agents execute.” Ekubo extensions, future lending, trading bots, gaming agents can all “implement GATE” and plug into the same fact registry and patterns.

### C. Ekubo Extensions (integration)

- **Ekubo:** Permissionless extensions; use cases include **privacy solutions**, trading strategies, oracles, DCA, order types.
- **Us:** Build an **Ekubo extension**: e.g. proof-gated liquidity provision or proof-gated swaps (execute only if constraint proof valid). We don’t replace Ekubo; we add a **proof-gated layer** on top. We plug into the main AMM liquidity layer; they get a privacy/proof-gated use case.

### D. CairoSwap / Aggregator (integration)

- **CairoSwap:** Aggregates DEXes for best execution.
- **Us:** Be one **route**: “private swap” or “proof-gated swap” that goes through our contracts (confidential transfer + proof check). We become the **private execution path** in the aggregator.

### E. Argent Session Keys (partnership / narrative)

- **Argent:** Main session-key provider; wants dApps that showcase “session keys + limits.”
- **Us:** We use session keys **plus** proof (no proof, no execution). We’re a **flagship dApp** for “session keys + proof-gated execution.” Partnership or integration story: “Argent session keys + zkde.fi GATE.”

### F. Garaga (flagship narrative)

- **Garaga:** Pushed by StarkWare/Starknet for Noir, ZK verification.
- **Us:** Production use of Garaga for **confidential transfers** and zkML in DeFi. **Slide in:** Position as “Garaga DeFi flagship” — real app, real flows, real proofs.

### G. Trustless AI (narrative)

- **Ecosystem:** “Trustless AI” is a stated direction; Giza = provable ML.
- **Us:** **zkML-gated execution** + GATE = “trustless AI execution.” We don’t train models; we **gate execution** on proven ML outputs. Giza = model layer; we = execution/standard layer. **Slide in:** “Trustless AI needs a execution standard; that’s GATE.”

### H. Compliant Privacy / Privacy Stable (product)

- **Ecosystem:** Mixers exist; no dominant compliant privacy or privacy stable on Starknet.
- **Us:** Selective disclosure, compliance profiles, confidential transfer infra. **Slide in:** Compliant privacy stable (KYC at mint/redeem, private in between) or “compliant mixer” narrative. Fits grants (Innovation) and Re{define} (private DeFi).

### I. Grants (Growth: Innovation + Ecosystem Integration)

- **Innovation:** GATE, proof-gated execution, zkML-gated execution, hybrid proofs.
- **Ecosystem Integration:** Ekubo extension, Argent session keys, Garaga, fact registry.
- **Slide in:** One application that ticks both; clear narrative and integration points.

---

## 4. Summary: Best Slots

| Slot | Why it fits | Action |
|------|-------------|--------|
| **Re{define} Privacy Track** | We literally built what they asked for: private DeFi frontend, confidential transactions, ZK verification | Submit; emphasize privacy-first DeFi + proof-gated agent |
| **GATE as agent standard** | No one else defines “how agents execute” with proof + session keys + intent; we do | Publish GATE-1; offer it as Starknet standard; get one other agent/protocol to adopt |
| **Ekubo extension** | They list privacy and strategies; we add proof-gated layer on top of their liquidity | Design + build proof-gated extension (e.g. proof-gated swap or LP) |
| **Argent + Garaga flagship** | Session keys (Argent) + Garaga DeFi (us) = two strong partnership narratives | Reach out for “flagship dApp” / integration story |
| **Compliant privacy / privacy stable** | Gap on Starknet; we have the infra and narrative | Roadmap: compliant privacy stable or KYC-at-edges product |

---

## 5. One-Pager for Ecosystem

**zkDE** = Zero-Knowledge Deterministic Engine (the proof/verification layer).  
**GATE** = Governed Autonomous Trustless Execution (the standard for how agents execute).

We built the **first GATE-compatible app**: zkde.fi — a **privacy-first DeFi frontend** with confidential transfers (Garaga), proof-gated execution (Integrity), session keys (Argent), and zkML-gated decisions. We fill gaps: **no proof-gated execution standard**, **no dominant privacy-first DeFi frontend**, **no compliant privacy story** on Starknet. We slide in as: **Re{define} Privacy Track** (direct fit), **GATE as agent standard** (we define it), **Ekubo extension** (proof-gated layer on top), **Argent + Garaga flagship** (session keys + Garaga DeFi), and **compliant privacy / privacy stable** (next product wedge).
