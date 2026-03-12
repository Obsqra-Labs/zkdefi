# zk OS reframe — Obsqra stack + zkdefi

**Context:** [Obsqra Starknet](https://github.com/obsqra-labs) source in `/opt/obsqra.starknet` (prover cloud, fact registry, dual proof processor, Madara L3 configs) + **zkdefi** (this repo: Capital OS, vaults, agents, proofs, receipts). Together they form a **zk OS** — an operating layer for verifiable AI and capital. **Capital is one flavor;** the core is three primitives and a toolchain.

---

## 1. What we’re building: a zk OS

A **zk OS** is an operating layer where:

- **Data** is attested (proven index, not just DB).
- **Intelligence** is queryable with provenance (graph over that data).
- **Actions** are logged with proofs (verifiable receipt stream).

Applications (DeFi, governance, agents, marketplaces) sit on top. **zkDeFi / Capital OS is one such application** — private vaults, pools, rebalancer, trade desk, reputation. Other flavors could be: governance OS, agent marketplace OS, prediction OS. Same three pillars, different surfaces.

---

## 2. The three pillars (zk AI OS)

Everything in the data pipeline stems from these three:

| Pillar | Role | What it is in our stack |
|--------|------|--------------------------|
| **zkRAG** | Proven index / attested data | Obsqra’s proven index: on-chain and attested data sources that feed context. zkdefi’s `ZkGraphClient` queries the obsqra zkRAG API (`OBSQRA_PROVER_API_URL`). Block ranges, fact hashes, source counts — **retrieval with proof**. |
| **zkGraph** | Attested intelligence / query layer | Query layer over zkRAG: market context, historical patterns, agent reports. zkdefi exposes `/api/v1/zkdefi/zkgraph/*` (agent/query, health, context, patterns). Enriches proof bundles with `zkrag_provenance` (fact_hash, block_range, source_count). **Graph over attested data**. |
| **zkSyslog** | Provable receipt layer | Verifiable action log. Every proof-gated action → one receipt (actor, action, proof, result, timestamp). Implemented as `ReceiptService` + `/api/v1/zkdefi/receipts/*` and mission-control stream/timeline. **Trust = Σ(receipts)**. This is the “receipts as primitive” layer. |

So:

- **zkRAG** = what we can prove we read.
- **zkGraph** = what we can prove we inferred / queried.
- **zkSyslog** = what we can prove we did.

---

## 3. Data pipeline: how the three connect

```text
[Data sources / chain / index]
        ↓
   zkRAG (proven index)
        ↓
   zkGraph (query + provenance)
        ↓
   Agent / strategy / execution
        ↓
   zkSyslog (receipt per action)
        ↓
   Reputation / stream / timeline
```

- **zkRAG** feeds attested context into zkGraph and into circuits (e.g. risk, allocation).
- **zkGraph** answers “what’s the attested state / pattern?” and attaches provenance to proof bundles.
- Execution (vault rebalance, trade, vote, zkML gate) produces a **receipt** → **zkSyslog**.
- **zkSyslog** is the single source of verifiable behavior history; reputation and stream/timeline are views over it.

Everything else (vaults, pools, ledger, trade desk, governance) **consumes** these three. No “data pipeline” that bypasses them for trust-critical path.

---

## 4. Toolchain: model registry + L3

Sitting beside the three pillars:

- **Model registry** — What models/processors exist; agent builder and orchestrator use `GET /api/v1/agents/models/list`, `ModelRegistryService`, on-chain `ModelRegistry` when deployed. Defines *what* can be run (risk_scoring, anomaly_detection, credit_scoring, etc.).
- **L3 (Madara)** — Where proofs settle. obsqra sequencer config, proof chain presets; zkdefi routes proof submission to L3 when enabled (ModelBridge, ModelBridgeHeavy, Noir HONK, etc.). Fast, cheap settlement; same fact-registry interface as L2.

So: **model registry** = catalog of provable logic; **L3** = settlement layer for that logic. Both are toolchain for the zk OS, not the OS itself.

---

## 5. Where zkDeFi fits

zkDeFi (this repo’s app surface) is **one flavor** of the zk OS:

```text
zk OS (Obsqra stack + zkdefi backend)
├── zkRAG (obsqra proven index)
├── zkGraph (query + provenance)
├── zkSyslog (receipts)
├── Model registry + L3 (toolchain)
└── Applications
    └── zkDeFi (Capital OS)  ← vaults, pools, ledger, swaps, lending, LP, staking,
                               risk passport, governance, trade desk, agent dashboard
```

Other flavors could consume the same pillars: e.g. a governance-only app (zkGraph for proposals + attestation, zkSyslog for votes), or an agent marketplace (zkSyslog for strategy performance, zkGraph for context).

---

## 6. Repositioning “receipts as primitive”

The “receipts as primitive” strategy is the **zkSyslog** pillar:

- **zkSyslog** = provable receipt layer = verifiable action history.
- “Obsqra receipts” / “zkReceipt Engine” = **zkSyslog as product surface**: `record_action`, `verify_receipt`, `get_reputation`.
- zkDeFi is the **first consumer** of zkSyslog (every vault rebalance, trade, proof gate, zkGraph agent query that we record goes into the same receipt store).

So the narrative stays: **lead with verifiable action receipts (zkSyslog); zkDeFi is the flagship app.** The reframe adds: zkSyslog is one of **three** pillars; the other two (zkRAG, zkGraph) are why our “receipts” are proof-backed, not just logs.

---

## 7. One-line pitch (zk OS)

- **“Obsqra’s zk OS: zkRAG (proven index), zkGraph (attested intelligence), zkSyslog (provable receipts). Capital is one flavor.”**

Or:

- **“We build the zk AI OS: attested data (zkRAG), attested queries (zkGraph), and verifiable action history (zkSyslog). zkDeFi is our first app.”**

---

## 8. Codebase mapping (brief)

| Concept | obsqra.starknet (parent) | zkdefi (this repo) |
|---------|---------------------------|---------------------|
| zkRAG | Proven index API (obsqra.fi / prover API) | `ZkGraphClient` → obsqra zkRAG API |
| zkGraph | (Query/provenance logic can live on obsqra or zkdefi) | `backend/app/api/routes/zkgraph.py`, `zkgraph_client.py`, models in `app/models/zkgraph.py` |
| zkSyslog | — | `ReceiptService`, `backend/app/api/routes/receipts.py`, `mc/stream`, `mc/receipts/*` |
| Model registry | — | `ModelRegistryService`, `GET /api/v1/agents/models/list`, contracts `ModelRegistry` |
| L3 | Madara configs, obsqra sequencer, proof chain | Proof routing to L3, ModelBridge/L3 verify receipts, showcase script |

---

## 9. What to do next

1. **Docs and README** — Describe the stack as “zk OS: zkRAG, zkGraph, zkSyslog; model registry + L3; zkDeFi = first app.” Add a one-line pitch and a small diagram (pillars → pipeline → app).
2. **Naming** — Use **zkSyslog** in docs and API for the receipt layer where it helps (e.g. “zkSyslog” in architecture, “receipts” or “Obsqra Receipts” for developer-facing API).
3. **Receipts strategy** — Keep [RECEIPTS_AS_PRIMITIVE_STRATEGY.md](RECEIPTS_AS_PRIMITIVE_STRATEGY.md); add a short section that identifies the receipt primitive with **zkSyslog** and states that the data pipeline stems from zkRAG → zkGraph → zkSyslog.
4. **Data pipeline** — In any “data flow” or “architecture” doc, show: sources → zkRAG → zkGraph → execution → zkSyslog → reputation/stream. No trust-critical path that bypasses the three pillars.

This reframe keeps “receipts as primitive” and “trust = Σ(receipts)” intact, and places them inside a larger story: we’re building a **zk OS**; **zkSyslog** is the provable receipt layer; **zkRAG** and **zkGraph** are the attested data and intelligence layers; **capital is one flavor**.
