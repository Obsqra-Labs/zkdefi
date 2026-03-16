# zkSyslog Explorer Design

**Date:** 2026-03-14  
**Status:** Design (approved)  
**Scope:** Reframe the current Forge surface into `zkSyslog`, the first public explorer layer inside `StarkForge`, with a search-first information architecture, proof-backed receipt/event feed, and a clear migration path away from `/forge`.

---

## 1. Goals

- **Establish the product hierarchy clearly:** `StarkForge` is the parent product, and `zkSyslog` is the first public explorer surface inside it.
- **Replace the current dashboard feel** with a **search-first proof-aware explorer**.
- **Default to latest proof-backed receipts/events** rather than generic health cards or roadmap sections.
- **Treat evidence items as the core object**, not just blocks, txs, or fact hashes.
- **Show the full verification/data pipeline** where available:
  - source event or action
  - proof job
  - proof artifact
  - fact registration
  - L3 inclusion
  - L2 verification
  - L1 verification
- **Prepare the stack hierarchy** for the later `zkSyslog -> zkRAG -> zkGraph` evolution without trying to ship the full graph product now.
- **Align the visual language** more closely with the rest of `starknet.obsqra.fi`, while moving toward the future `starkforge.xyz` product identity.

---

## 2. Product framing

### 2.1 Parent product

`StarkForge` is the parent product.

It should own:

- proof chain identity
- proving and verifier lanes
- settlement infrastructure
- explorer surfaces
- future indexed retrieval and graph layers

### 2.2 First public surface

`zkSyslog` is the first public surface.

It is not just a renamed block explorer. It is:

- a searchable evidence log
- a proof-aware explorer
- a verifiable system journal
- the first visible layer of the StarkForge data stack

### 2.3 Naming and route strategy

The target public route should be:

- `/zksyslog`

The current `/forge` route should be treated as legacy migration baggage and eventually redirect or alias into the new surface.

`/explorer` may exist later as a generic convenience route, but it should not be the primary public identity for this product layer.

### 2.4 Stack hierarchy

The intended hierarchy is:

```text
StarkForge
-> zkSyslog
-> zkRAG
-> zkGraph
```

In this hierarchy:

- `zkSyslog` is the searchable evidence and receipt layer
- `zkRAG` is indexed retrieval and query over that evidence
- `zkGraph` is deeper relationship navigation and graph reasoning

---

## 3. Core object model

The explorer should be organized around an **evidence item**.

This is the primary object, because fact hashes, model versions, receipts, contracts, and settlement artifacts are all related but not interchangeable.

Canonical evidence-item flow:

```text
event or action
-> proof job
-> proof artifact
-> fact
-> L3 tx
-> L2 verification
-> L1 verification
-> indexed references
```

This model allows the explorer to:

- feel familiar to people who expect explorer behavior
- surface proof lineage as the real differentiator
- keep blocks, txs, contracts, facts, models, and entities all addressable without making any one of them the whole system story

---

## 4. Homepage information architecture

### 4.1 Primary interaction

The homepage should be **search-first**.

Above the fold, the page should prioritize:

- a prominent global search bar
- scope chips:
  - `All`
  - `Receipts`
  - `Txs`
  - `Facts`
  - `Proof Jobs`
  - `Contracts`
  - `Models`
  - `Entities`

### 4.2 Default feed

The default feed should be:

- **latest proof-backed receipts/events across the whole system**

This is the right default because it makes `zkSyslog` feel like an active system journal rather than an empty shell waiting for a search query.

### 4.3 Secondary modules

Below the primary feed, the page can include compact supporting modules:

- recent blocks
- recent settlement milestones
- compact system status strip
- links into later product layers such as `zkRAG` and `zkGraph`

These modules should remain secondary to search and the evidence feed.

### 4.4 What should not dominate

The following should not dominate the homepage:

- roadmap sections
- large subsystem health cards
- long operational dashboards
- generic chain status summaries with little evidence context

---

## 5. Search model

`zkSyslog` should behave as a **unified resolver** across chain objects and proof/evidence objects.

It should resolve:

- block numbers
- tx hashes
- contract addresses
- fact hashes
- proof job ids
- model hashes
- model versions
- indexed entities or event terms from the indexer / `zkRAG` layer

Resolver behavior:

- exact identifiers resolve directly to a detail page
- ambiguous text resolves to grouped results
- grouped results should be organized by type:
  - `Blocks`
  - `Transactions`
  - `Contracts`
  - `Facts`
  - `Proof Jobs`
  - `Models`
  - `Entities / Events`

This keeps the UX familiar to explorer users while still allowing proof- and evidence-specific object types.

**Implementation (forge.py):** Search scope chips populate: *Receipts* and *Txs* from receipt service; *Proof Jobs* from proof pipeline cache; *Models* from `data/ezkl_models`; *Facts* from unique `fact_hash` values in receipts. Pagination (limit/offset) and "Load more" apply to receipt results; other buckets are sliced by the same offset/limit for consistency.

---

## 6. Detail page model

Every resolved object should open into a shared 3-pane explorer layout.

### 6.1 Summary

This is the familiar explorer pane.

It should show:

- object type
- canonical id
- status badges
- timestamps
- chain location
- object-specific raw fields
- linked artifacts

Examples:

- `tx`: calldata, receipt, block inclusion, events
- `fact`: registry state, verifier status, linked proof jobs
- `proof job`: source, proof type, outputs, tx links, settlement markers
- `model`: model hash, version, registry status, linked evidence

### 6.2 Verification Timeline

This is the main Obsqra differentiator.

The pane should show:

```text
source event or action
-> proof job
-> proof artifact
-> fact
-> L3 inclusion
-> L2 verification
-> L1 verification
```

Rules:

- missing stages must be shown honestly as `pending`, `not present`, `unknown`, or `not configured`
- the UI must never imply deeper settlement than actually exists
- each stage must include a source label:
  - `on-chain`
  - `rpc`
  - `runtime`
  - `indexed`

### 6.3 Relationships

This is the constrained `zkGraph` slice.

It should not attempt to be the full graph product in this phase.

Initial linked node types:

- proof jobs
- facts
- txs
- blocks
- contracts
- model versions
- settlement artifacts
- indexed events/entities

Relationship verbs should be simple and legible:

- `produced`
- `registered`
- `verified`

---

## 7. Independence from showcase

The zkSyslog explorer **must not depend** on the hackathon_backend_showcase script or its generated HTML. The explorer is a standalone product surface that:

- Reads only from backend services and APIs (receipt service, proof service, system metrics, RPC, etc.).
- Implements search, detail, feed, and status in its own routes and templates.
- Uses the same data paths and evidence types the showcase illustrates (receipts, proof stats, lanes, contracts, benchmarks, etc.) but fetches them directly in forge routes.

The showcase script and its HTML are **reference examples** of which data an explorer needs to do its job comprehensively and holistically. The explorer implements those paths itself; it does not call the showcase or serve its output.
- `settled`
- `references`
- `indexed_from`

Display mode should be:

- list-first
- graph-second

That keeps the explorer useful even before a richer graph UI exists.

---

## 7. Data source mapping

`zkSyslog` should compose from existing live systems and should not create a second truth source.

### 7.1 Search/data resolution

- `Blocks`, `Txs`, `Contracts`: existing RPC-backed explorer routes
- `Proof Jobs`: `proof_jobs` database and current proof pipeline records
- `Facts`: integrity / registry verification plus linked proof records
- `Models`: model registry service and model history
- `Entities / Events`: indexer and `zkRAG`-backed indexed data
- `Settlement`: L3/L2/L1 markers from settlement bridge state and proof-job settlement fields

### 7.2 Source labels

Every major surface should make source provenance explicit:

- `on-chain`: contract-verified or registry-verified state
- `rpc`: directly queried chain state
- `runtime`: prover, orchestrator, worker, or backend runtime state
- `indexed`: indexer- or `zkRAG`-derived references

### 7.3 Truth model guardrails

- never invent settlement depth
- never collapse runtime health into on-chain truth
- never hide missing stages
- never use placeholder or synthetic receipts/proofs/facts

---

## 8. Visual system

The visual direction should move closer to `starknet.obsqra.fi` and toward the future `starkforge.xyz` identity.

Desired feel:

- dark
- restrained
- explorer-like
- more editorial and structured
- less control-room dashboard

### 8.1 Style rules

- strong search header
- explorer-style lists and tables
- sharper typography hierarchy
- stronger monospace treatment for ids and hashes
- subtle accent usage, not colorful metric walls
- compact verification badges such as:
  - `L3 verified`
  - `L2 mirrored`
  - `L1 confirmed`
  - `runtime only`

### 8.2 Layout rules

- fewer oversized cards
- more result lists and detail panes
- two-column detail pages on desktop where helpful
- tabs that feel like explorer navigation rather than dashboard pills
- supporting infra status should live in side rails or compact strips, not dominate the screen

---

## 9. Rollout phases

### Phase 1: zkSyslog shell

- reframe the current Forge surface as `zkSyslog`
- add search-first homepage shell
- add latest proof-backed receipts/events feed
- keep recent blocks and compact status as secondary modules

### Phase 2: Unified resolver

- add grouped result resolution across chain and proof objects
- add shared detail layout for blocks, txs, and contracts
- ensure the route naming/migration story for `/zksyslog` and legacy `/forge`

### Phase 3: Proof-native detail pages

- add proof job detail pages
- add fact detail pages
- add model detail pages
- add verification timeline across all key object types

### Phase 4: Constrained graph layer

- add relationships tab backed by indexer / `zkRAG`
- expose entity/event exploration
- keep graph scope constrained to useful evidence relationships

### Phase 5: StarkForge product shell

- absorb relevant service surfaces now split across `starknet.obsqra.fi`
- align more fully to `starkforge.xyz`
- treat `zkSyslog` as the first module in the broader StarkForge shell

---

## 10. Success criteria

This redesign is successful if:

1. A new visitor immediately understands that `zkSyslog` is a searchable evidence explorer inside `StarkForge`.
2. The default feed feels alive because it shows recent proof-backed receipts/events.
3. Search can resolve both chain-native objects and proof-native objects.
4. Detail pages explain not just what happened on-chain, but what was proven and how it settled.
5. The explorer feels stylistically aligned with the wider StarkForge product direction.
6. The product hierarchy is legible:
   - `StarkForge`
   - `zkSyslog`
   - later `zkRAG`
   - later `zkGraph`

---

## 11. Out of scope for this phase

The following are out of scope for the first-pass explorer redesign:

- full `zkGraph` product semantics
- generalized graph reasoning UI
- rewriting the entire backend architecture
- inventing new protocol state to fill empty views
- placeholder data, proofs, facts, or events

The first phase should stay focused on making `zkSyslog` real, legible, and useful.
