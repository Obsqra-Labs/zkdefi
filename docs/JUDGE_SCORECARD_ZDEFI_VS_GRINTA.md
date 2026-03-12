# Judge scorecard: zkde.fi (Obsqra) vs Grinta Protocol

**Comparison date:** 2026-03-11  
**Reference:** [Grinta-Prototipe-UI](https://github.com/Grinta-Protocol/Grinta-Prototipe-UI) · **zkde.fi:** this repo (Starknet Re{define} Hackathon, Privacy track).

---

## 1. Project summary

| | **zkde.fi (Obsqra Labs)** | **Grinta Protocol** |
|---|---------------------------|---------------------|
| **Tagline** | Private DeFi execution, portable reputation, proof-gated capital on Starknet | First agentic BTCFi protocol on Starknet |
| **Live** | [zkde.fi](https://zkde.fi) · [zkde.fi/test](https://zkde.fi/test) (judge evidence) | [grinta-prototype-ui.vercel.app](https://grinta-prototype-ui.vercel.app) |
| **Track** | **Privacy** (explicit) | General DeFi / BTCFi |
| **Core thesis** | Protect identity and intent; prove enough to coordinate capital. Privacy is operational, not cosmetic. | Passive BTC = dead capital; agentic vaults + PID stability + flash-mint + i18n for Global South. |

---

## 2. Criteria and scores (1–10)

### 2.1 Innovation / Novelty

| Criterion | zkde.fi | Grinta | Notes |
|-----------|---------|--------|------|
| **Novel primitives** | 9 | 7 | zkde: zkML→Groth16 bridge (ModelBridge/EZKL), proof-gated “no proof no execution”, Risk Passport, 25-circuit registry. Grinta: PID-controlled stable asset, agentic vaults, flash-mint native. |
| **Combination / crossover** | 9 | 7 | zkde: privacy + verifiable AI + session-key delegation + L3/Madara path. Grinta: BTCFi + 4Claw agents + Ekubo + i18n. |
| **Track fit (Privacy)** | 10 | 4 | zkde is Privacy-track native (commitments, nullifiers, shielded pools, private governance). Grinta is capital-efficiency/UX, not privacy-focused. |

**Innovation subtotal:** **zkde.fi 9.3** · **Grinta 6.0**

---

### 2.2 Technical depth / Execution

| Criterion | zkde.fi | Grinta | Notes |
|-----------|---------|--------|------|
| **Proof / ZK stack** | 9 | 3 | zkde: Garaga (Groth16), Integrity (STARK), EZKL bridge, 25+ circuits, ObsqraFactRegistry, L1→L2 EZKL path. Grinta: no ZK/proof layer in README; Cairo SafeEngine, PID. |
| **Smart contracts** | 8 | 8 | zkde: ObsqraFactRegistry, verifiers, full-privacy pools, L1EzklBridgeReceiver. Grinta: SafeEngine, SafeManager, PID controller (Cairo). |
| **Backend / APIs** | 9 | 5 | zkde: FastAPI, many routers (vault, reputation, zkML, rebalancer, trade-desk, ledger, governance). Grinta: agentic layer (4Claw); backend surface not detailed in README. |
| **Agent / automation** | 8 | 9 | zkde: rebalancer, session keys, oracle gating, Mission Control, policy engine. Grinta: “Yield Grinta” agent, arbitrage, health monitoring — central to pitch. |
| **Integrations** | 8 | 7 | zkde: Ekubo, Garaga, Integrity, obsqra.fi, Madara L3 path. Grinta: Ekubo, MOLTX, 4Claw. |

**Technical depth subtotal:** **zkde.fi 8.4** · **Grinta 6.4**

---

### 2.3 Product breadth / Completeness

| Criterion | zkde.fi | Grinta | Notes |
|-----------|---------|--------|------|
| **Surface area** | 9 | 6 | zkde: vault, pools, ledger, swaps, lending, LP, staking, Risk Passport, governance, Trade Desk, profile, adapters. Grinta: vault flow, GRIT mint, PID, agent; single focused flow. |
| **E2E flows** | 8 | 7 | zkde: deposit/withdraw, proof generation, receipts, stream, judge /test report. Grinta: multi-step vault (OpenSafe + Deposit), agent execution. |
| **Judge-facing evidence** | 9 | 5 | zkde: /test page, latest.json/latest.html, terminal showcase script, Voyager/Starkscan links. Grinta: README + live demo; no dedicated judge report. |
| **Polish / UX** | 7 | 8 | zkde: Next.js, Tailwind, many surfaces; dense. Grinta: Framer Motion, “Glitch/Brutalist” design, i18n (EN/ES/PT) — more focused and localized. |

**Completeness subtotal:** **zkde.fi 8.3** · **Grinta 6.5**

---

### 2.4 Documentation / Repo clarity

| Criterion | zkde.fi | Grinta | Notes |
|-----------|---------|--------|------|
| **README** | 9 | 8 | zkde: live proof readout, product list, architecture diagrams, quick start, tech stack table. Grinta: elevator pitch, problem/solution, architecture diagram, tech stack, roadmap, i18n. |
| **Architecture docs** | 9 | 6 | zkde: ARCHITECTURE.md, PRODUCT_AND_MVP.md, CONCEPTS.md, ROADMAP.md, REPUTATION_PROOF_API, L3/Madara specs. Grinta: single README with one mermaid diagram. |
| **Onboarding** | 8 | 7 | zkde: docs index, circuit inventory, API references. Grinta: clear README; less deep technical docs. |

**Documentation subtotal:** **zkde.fi 8.7** · **Grinta 7.0**

---

### 2.5 Impact / Roadmap / Extensibility

| Criterion | zkde.fi | Grinta | Notes |
|-----------|---------|--------|------|
| **Roadmap** | 8 | 7 | zkde: L3/Madara, Noir HONK, L1→L2 E2E, Capital OS polish; ProofMode table. Grinta: mainnet, CCIP, agent market, gGRIT governance. |
| **Extensibility** | 9 | 7 | zkde: adapters, multiple proof paths, policy engine, composable circuits. Grinta: 3rd-party agents (4Claw SDK) planned. |
| **Deployment** | 8 | 6 | zkde: Sepolia live, verifiers deployed, showcase script. Grinta: Vercel demo; mainnet “audited” SafeEngine planned. |

**Impact subtotal:** **zkde.fi 8.3** · **Grinta 6.7**

---

## 3. Weighted overall (Privacy track)

Assume **Privacy track** weights: Innovation 25%, Technical depth 30%, Completeness 20%, Documentation 15%, Impact 10%.

| Project | Inno | Tech | Complete | Docs | Impact | **Weighted total** |
|---------|------|------|----------|------|--------|--------------------|
| **zkde.fi** | 9.3 | 8.4 | 8.3 | 8.7 | 8.3 | **8.65** |
| **Grinta** | 6.0 | 6.4 | 6.5 | 7.0 | 6.7 | **6.48** |

If **track-agnostic** (equal weights): **zkde.fi 8.60** · **Grinta 6.52**.

---

## 4. Head-to-head summary

| Dimension | Winner | Why |
|------------|--------|-----|
| **Privacy / ZK** | **zkde.fi** | Full privacy stack (pools, commitments, nullifiers, zkML bridge, 25 circuits); Grinta has no ZK/privacy narrative. |
| **Agent / automation** | **Grinta** | Agent is the hero; “Yield Grinta” + arbitrage is clearer and more focused than zkde’s rebalancer/oracle. |
| **Stability / monetary** | **Grinta** | PID-controlled GRIT, peg stability, flash-mint — defined monetary design. zkde is capital/execution, not a stablecoin. |
| **Breadth** | **zkde.fi** | Many product surfaces, APIs, and proof paths; Grinta is a focused vault + agent flow. |
| **Judge readiness** | **zkde.fi** | /test report, artifacts, scripted showcase; Grinta has README + live UI only. |
| **UX / i18n** | **Grinta** | Framer Motion, i18n (EN/ES/PT), single clear flow; zkde is heavier and more technical. |
| **Docs** | **zkde.fi** | Multiple deep docs; Grinta one strong README. |

---

## 5. Verdict (Privacy track)

- **zkde.fi** is the stronger **Privacy-track** submission: privacy-first design, verifiable execution, zkML bridge, broad surface, and judge-facing evidence. Scores higher on innovation (for privacy), technical depth, completeness, and documentation.
- **Grinta** is the stronger **agentic BTCFi / UX** submission: clear story, PID + GRIT, i18n, and a focused demo. It would score better on a “DeFi / UX / inclusion” track than on Privacy.

**Ranking (Privacy track):** 1. **zkde.fi** · 2. Grinta  

**Ranking (general / agentic DeFi):** Grinta and zkde.fi would be closer; Grinta’s agent focus and UX would narrow the gap.

---

## 6. Sources

- **Grinta:** [Grinta-Prototipe-UI](https://github.com/Grinta-Protocol/Grinta-Prototipe-UI) (README, structure, live demo link).
- **zkde.fi:** This repo — README.md, docs/ARCHITECTURE.md, docs/PRODUCT_AND_MVP.md, docs/CONCEPTS.md, docs/ROADMAP.md, artifacts/hackathon_showcase/latest.json.
