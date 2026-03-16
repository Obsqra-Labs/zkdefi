# zkSyslog Explorer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the current Forge surface into `zkSyslog`, the first StarkForge explorer layer: a search-first proof-aware explorer with a default feed of latest proof-backed receipts/events, shared detail pages, verification timelines, and constrained relationship views.

**Architecture:** Keep the initial implementation centered in `/opt/obsqra.starknet/backend/app/api/routes/forge.py` and `/opt/obsqra.starknet/backend/tests/test_forge_dashboard.py` so the current production surface can evolve in place before a later route migration to `/zksyslog`. Build the explorer in layers: search-first homepage shell, unified resolver, shared detail layout, proof-native object pages, then constrained relationships backed by indexer and `zkRAG` sources. Style the surface closer to `starknet.obsqra.fi` and future `starkforge.xyz`, while preserving honest `on-chain`, `rpc`, `runtime`, and `indexed` labeling everywhere.

**Tech Stack:** FastAPI HTML + JSON responses, existing Madara RPC-backed explorer routes, current proof job database records, model registry service, integrity/registry verification services, settlement bridge state, indexer routes, and `zkRAG`-backed indexed references.

---

### Task 1: Reframe the current Forge route into the zkSyslog shell

**Files:**
- Modify: `/opt/obsqra.starknet/backend/app/api/routes/forge.py`
- Test: `/opt/obsqra.starknet/backend/tests/test_forge_dashboard.py`
- Reference: `/opt/obsqra.starknet/zkdefi/docs/plans/2026-03-13-forge-dashboard-consolidation-design.md`

**Step 1: Write the failing test**

Add a test asserting the rendered homepage:
- no longer leads with Forge dashboard language
- includes `StarkForge` and `zkSyslog`
- contains a primary search bar and receipt/event feed framing

**Step 2: Run test to verify it fails**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k zksyslog_shell -v`

Expected: FAIL because the page still renders the old Forge-first shell.

**Step 3: Write minimal implementation**

Update the route HTML and top-level labels in `/opt/obsqra.starknet/backend/app/api/routes/forge.py` so the surface is framed as:
- `StarkForge / zkSyslog`
- search-first
- proof-backed receipts/events first

Keep existing runtime/data helpers intact for now; only reshape the shell and naming.

**Step 4: Run test to verify it passes**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k zksyslog_shell -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add /opt/obsqra.starknet/backend/app/api/routes/forge.py /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py
git commit -m "feat(zksyslog): reframe forge shell as StarkForge explorer"
```

---

### Task 2: Replace the homepage with a search-first explorer layout

**Files:**
- Modify: `/opt/obsqra.starknet/backend/app/api/routes/forge.py`
- Test: `/opt/obsqra.starknet/backend/tests/test_forge_dashboard.py`

**Step 1: Write the failing test**

Add a test asserting the homepage contains:
- a prominent search bar
- scope chips for `All`, `Receipts`, `Txs`, `Facts`, `Proof Jobs`, `Contracts`, `Models`, `Entities`
- a default feed section for latest proof-backed receipts/events

**Step 2: Run test to verify it fails**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k search_first_homepage -v`

Expected: FAIL because the page still opens as a dashboard with tabs/cards.

**Step 3: Write minimal implementation**

Refactor the homepage HTML/CSS/inline JS so the top of the page becomes:
- sticky or dominant search header
- resolver scope chips
- latest proof-backed receipts/events list
- compact secondary modules for recent blocks and status

Do not add new data sources yet beyond existing live composition already available in the route.

**Step 4: Run test to verify it passes**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k search_first_homepage -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add /opt/obsqra.starknet/backend/app/api/routes/forge.py /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py
git commit -m "feat(zksyslog): make homepage search-first with receipt feed"
```

---

### Task 3: Add a unified resolver API for chain and proof objects

**Files:**
- Modify: `/opt/obsqra.starknet/backend/app/api/routes/forge.py`
- Test: `/opt/obsqra.starknet/backend/tests/test_forge_dashboard.py`
- Reference: existing routes and services already used from the same file and backend services

**Step 1: Write the failing test**

Add API tests for a new resolver endpoint that can distinguish and group:
- block numbers
- tx hashes
- contract addresses
- fact hashes
- proof job ids
- model hashes / versions
- indexed entities / events

**Step 2: Run test to verify it fails**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k resolver -v`

Expected: FAIL because no unified resolver endpoint exists yet.

**Step 3: Write minimal implementation**

Add a resolver endpoint and helper functions in `/opt/obsqra.starknet/backend/app/api/routes/forge.py` that:
- route exact identifiers directly
- return grouped results for ambiguous text
- label every result with its source type

Use only existing live sources. Do not invent placeholder entity matches.

**Step 4: Run test to verify it passes**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k resolver -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add /opt/obsqra.starknet/backend/app/api/routes/forge.py /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py
git commit -m "feat(zksyslog): add unified explorer resolver"
```

---

### Task 4: Build shared detail pages for chain-native objects

**Files:**
- Modify: `/opt/obsqra.starknet/backend/app/api/routes/forge.py`
- Test: `/opt/obsqra.starknet/backend/tests/test_forge_dashboard.py`

**Step 1: Write the failing test**

Add tests asserting block, tx, and contract detail views render the shared 3-pane explorer structure:
- `Summary`
- `Verification Timeline`
- `Relationships`

**Step 2: Run test to verify it fails**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k detail_layout -v`

Expected: FAIL because current detail views are bespoke and do not expose the shared pane model.

**Step 3: Write minimal implementation**

Refactor the detail-page renderer(s) in `/opt/obsqra.starknet/backend/app/api/routes/forge.py` to use shared layout helpers for:
- summary data
- placeholder-but-honest verification timeline stages where chain-native objects have partial lineage
- constrained relationships lists

Missing stages must render as `pending`, `not present`, or `not configured`, never as implied settlement.

**Step 4: Run test to verify it passes**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k detail_layout -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add /opt/obsqra.starknet/backend/app/api/routes/forge.py /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py
git commit -m "feat(zksyslog): add shared explorer detail layout"
```

---

### Task 5: Add proof job, fact, and model detail pages with verification timelines

**Files:**
- Modify: `/opt/obsqra.starknet/backend/app/api/routes/forge.py`
- Test: `/opt/obsqra.starknet/backend/tests/test_forge_dashboard.py`
- Reference: `/opt/obsqra.starknet/backend/app/models.py`
- Reference: `/opt/obsqra.starknet/backend/app/services/model_registry_service.py`
- Reference: `/opt/obsqra.starknet/backend/app/services/integrity_service.py`

**Step 1: Write the failing test**

Add tests asserting proof job, fact, and model detail pages expose:
- raw summary data
- verification timeline stages
- explicit source labels (`on-chain`, `rpc`, `runtime`, `indexed`)

**Step 2: Run test to verify it fails**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k proof_native_details -v`

Expected: FAIL because these pages do not exist in the shared explorer model yet.

**Step 3: Write minimal implementation**

Implement detail handlers/helpers in `/opt/obsqra.starknet/backend/app/api/routes/forge.py` for:
- proof jobs
- facts
- models

Use live data only:
- proof jobs from DB
- fact verification from existing registry/integrity services
- models from model registry service

Timeline stages must remain honest where data is missing.

**Step 4: Run test to verify it passes**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k proof_native_details -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add /opt/obsqra.starknet/backend/app/api/routes/forge.py /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py
git commit -m "feat(zksyslog): add proof job fact and model explorer pages"
```

---

### Task 6: Add constrained relationships using indexer and zkRAG-backed references

**Files:**
- Modify: `/opt/obsqra.starknet/backend/app/api/routes/forge.py`
- Test: `/opt/obsqra.starknet/backend/tests/test_forge_dashboard.py`
- Reference: `/opt/obsqra.starknet/backend/app/api/routes/index.py`
- Reference: `/opt/obsqra.starknet/backend/app/api/routes/zkrag.py`

**Step 1: Write the failing test**

Add tests asserting the `Relationships` pane can show linked objects such as:
- proof jobs
- facts
- txs
- blocks
- contracts
- models
- indexed entities/events

**Step 2: Run test to verify it fails**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k relationships -v`

Expected: FAIL because the current explorer does not yet render constrained graph relationships.

**Step 3: Write minimal implementation**

In `/opt/obsqra.starknet/backend/app/api/routes/forge.py`, add helper logic that:
- fetches only a constrained set of useful references
- renders relationship lists first
- uses a small, honest graph-like representation only if the linked data exists

Do not attempt a full graph product in this phase.

**Step 4: Run test to verify it passes**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k relationships -v`

Expected: PASS.

**Step 5: Commit**

```bash
git add /opt/obsqra.starknet/backend/app/api/routes/forge.py /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py
git commit -m "feat(zksyslog): add constrained evidence relationships"
```

---

### Task 7: Add legacy route migration and final validation

**Files:**
- Modify: `/opt/obsqra.starknet/backend/app/api/routes/forge.py`
- Test: `/opt/obsqra.starknet/backend/tests/test_forge_dashboard.py`
- Reference: `/opt/obsqra.starknet/zkdefi/docs/plans/2026-03-13-forge-dashboard-consolidation-design.md`

**Step 1: Write the failing test**

Add tests verifying:
- the explorer can be reached via the new `zkSyslog` route once introduced
- legacy `/forge` still resolves safely during migration
- public labels prefer `zkSyslog` over `Forge`

**Step 2: Run test to verify it fails**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -k route_migration -v`

Expected: FAIL because the legacy-first route model is still in place.

**Step 3: Write minimal implementation**

Add or alias the new route(s) inside `/opt/obsqra.starknet/backend/app/api/routes/forge.py`, keeping legacy compatibility during rollout.

Also do the final style cleanup so the page feels aligned with `starknet.obsqra.fi`:
- cleaner header
- fewer dashboard-style cards
- stronger explorer lists/tables
- subtler badge palette

**Step 4: Run the focused tests**

Run: `pytest /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py -v`

Expected: PASS.

**Step 5: Run syntax and lint validation**

Run: `python3 -m py_compile /opt/obsqra.starknet/backend/app/api/routes/forge.py /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py`

Expected: PASS.

Run: use editor diagnostics or project linting for the touched files.

Expected: no new errors introduced.

**Step 6: Commit**

```bash
git add /opt/obsqra.starknet/backend/app/api/routes/forge.py /opt/obsqra.starknet/backend/tests/test_forge_dashboard.py
git commit -m "feat(zksyslog): migrate forge explorer toward StarkForge naming"
```

---

## Deprecated legacy plan

The remainder of this file contains the earlier Forge dashboard consolidation plan and is superseded by the `zkSyslog` explorer direction above. Do not execute the legacy sections below for new work.

---

### Task 1: Audit current Forge route and define the tab schema

**Files:**
- Modify: `backend/app/api/routes/forge.py`
- Reference: `docs/plans/2026-03-13-forge-dashboard-consolidation-design.md`

**Step 1: Write the failing inventory note**

Read `backend/app/api/routes/forge.py` and confirm it currently renders:
- chain overview
- three proving paths
- roadmap
- wallet/faucet/reference blocks

Expected: there is no tab schema and no dedicated sections for registry/provers, receipts/facts, or settlement.

**Step 2: Add a tab schema constant**

Add a small in-file structure for tabs, e.g.:
- `overview`
- `proof_lanes`
- `registry_provers`
- `receipts_facts`
- `settlement`
- `explorer_reference`

The schema should drive both the nav labels and the rendered sections.

**Step 3: Keep the existing route shape stable**

Do not change the mount point or top-level route names. `/forge`, `/forge/api`, `/forge/contracts`, `/forge/health`, etc. should remain valid.

**Step 4: Run a syntax check**

Run: `python3 -m py_compile /opt/obsqra.starknet/backend/app/api/routes/forge.py`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/api/routes/forge.py
git commit -m "feat(forge): add tab schema for consolidated dashboard"
```

---

### Task 2: Restructure the Forge HTML into tabs

**Files:**
- Modify: `backend/app/api/routes/forge.py`

**Step 1: Write the failing UX check**

Inspect the current rendered HTML function and confirm the page is one long document with no tab controls.

Expected: FAIL against the desired IA.

**Step 2: Add tab navigation to the Forge HTML**

Implement tab buttons/links for:
- Overview
- Proof Lanes
- Registry + Provers
- Receipts + Facts
- Settlement
- Explorer / Reference

Tabs can be implemented client-side with lightweight inline JS and CSS classes; avoid introducing a frontend framework here.

**Step 3: Move current sections into the new IA**

Re-home existing content as follows:
- chain metrics -> `Overview`
- current proving paths -> `Proof Lanes`
- wallet/faucet/RPC reference -> `Explorer / Reference`
- roadmap -> lower on `Overview` or under `Explorer / Reference`

**Step 4: Make `Overview` the default active tab**

The page should open on `Overview`, but with clear access to the proof-centric tabs.

**Step 5: Run a syntax check**

Run: `python3 -m py_compile /opt/obsqra.starknet/backend/app/api/routes/forge.py`
Expected: PASS.

**Step 6: Commit**

```bash
git add backend/app/api/routes/forge.py
git commit -m "feat(forge): convert dashboard layout to tabbed IA"
```

---

### Task 3: Expand “Three Proving Paths” into a richer Proof Lanes tab

**Files:**
- Modify: `backend/app/api/routes/forge.py`
- Reference: `artifacts/hackathon_showcase/latest.json` (read-only source for shaping data if needed)

**Step 1: Write the failing content check**

Verify the current Forge page only presents:
- Groth16 via Garaga
- STARK via Integrity
- Hash-only fallback

Expected: missing HONK, native KZG, latest receipt evidence, and lane-specific live status.

**Step 2: Introduce a lane data adapter**

Create an in-file helper that normalizes current + available existing evidence into lane cards/rows with fields like:
- lane name
- verifier mode
- trust posture
- speed/gas summary
- latest tx / receipt / fact hash
- availability state (`live`, `degraded`, `stale`, `fallback_only`)

**Step 3: Add the newer lanes where evidence already exists**

Include:
- `Noir HONK`
- `Native KZG`
- current lanes already present

If exact evidence is unavailable, render them honestly as `unavailable` or `stale`; do not invent data.

**Step 4: Render the Proof Lanes tab**

The tab should make it easy to compare:
- lane type
- verifier
- status
- last evidence
- trust / portability posture

**Step 5: Run a syntax check**

Run: `python3 -m py_compile /opt/obsqra.starknet/backend/app/api/routes/forge.py`
Expected: PASS.

**Step 6: Commit**

```bash
git add backend/app/api/routes/forge.py
git commit -m "feat(forge): upgrade proving paths into proof lanes dashboard"
```

---

### Task 4: Add Registry + Provers tab

**Files:**
- Modify: `backend/app/api/routes/forge.py`
- Reference: existing model-registry and prover status sources already tracked by `/test`

**Step 1: Write the failing feature check**

Confirm Forge currently lacks dedicated sections for:
- model registry
- Stone prover health
- proving backend / bridge health

Expected: FAIL.

**Step 2: Add a data adapter for registry/prover state**

Pull in only already-existing evidence/summaries needed to show:
- model registry presence / status
- Stone prover status
- proving backend / bridge availability
- optional counts such as active models, circuits, or processors if already available

Do not build new protocol state here; only adapt existing tracked data.

**Step 3: Render the Registry + Provers tab**

Show simple cards or rows with:
- name
- status
- last updated / checked
- short note

**Step 4: Ensure independent failure handling**

If one data source fails, show `unavailable` or `stale` in that row while the rest of the tab still renders.

**Step 5: Run a syntax check**

Run: `python3 -m py_compile /opt/obsqra.starknet/backend/app/api/routes/forge.py`
Expected: PASS.

**Step 6: Commit**

```bash
git add backend/app/api/routes/forge.py
git commit -m "feat(forge): add registry and prover status tab"
```

---

### Task 5: Add Receipts + Facts tab

**Files:**
- Modify: `backend/app/api/routes/forge.py`
- Reference: existing receipt/fact evidence already surfaced in `/test` and current backend state

**Step 1: Write the failing feature check**

Confirm Forge currently lacks a dedicated latest-receipts / latest-facts view.

Expected: FAIL.

**Step 2: Add a receipt/fact summary adapter**

Normalize existing evidence into rows that can include:
- timestamp
- proof type / lane
- verifier result
- receipt hash or tx hash
- fact hash
- status
- explorer link

Use only existing evidence. If source app is available, include it; otherwise omit rather than invent.

**Step 3: Render the Receipts + Facts tab**

Keep it compact and operational:
- latest verified facts first
- latest receipts second, or a merged timeline if the data shape supports it cleanly

**Step 4: Ensure partial-render behavior**

If receipts exist but facts do not, still render receipts. If only stale data exists, label it honestly.

**Step 5: Run a syntax check**

Run: `python3 -m py_compile /opt/obsqra.starknet/backend/app/api/routes/forge.py`
Expected: PASS.

**Step 6: Commit**

```bash
git add backend/app/api/routes/forge.py
git commit -m "feat(forge): add receipts and facts tab"
```

---

### Task 6: Add Settlement tab for L3 → L2 → L1

**Files:**
- Modify: `backend/app/api/routes/forge.py`
- Reference: existing settlement evidence already tracked in `/test` and current backend/bridge status sources

**Step 1: Write the failing feature check**

Confirm Forge currently mentions settlement in copy/roadmap but does not present it as its own inspectable pipeline.

Expected: FAIL.

**Step 2: Add a settlement summary adapter**

Map existing evidence into a three-stage view:
- L3 verified
- L2 mirrored / settled
- L1 bridge state where relevant

Each stage should have:
- status
- last tx / evidence when available
- short explanatory note

**Step 3: Render the Settlement tab**

Use a simple horizontal or vertical pipeline view.

The goal is to make `L3 -> L2 -> L1` explicit and inspectable.

**Step 4: Handle absent bridge evidence honestly**

If L1 bridge data is not available for a given lane, label it `not_applicable` or `unavailable`, not success.

**Step 5: Run a syntax check**

Run: `python3 -m py_compile /opt/obsqra.starknet/backend/app/api/routes/forge.py`
Expected: PASS.

**Step 6: Commit**

```bash
git add backend/app/api/routes/forge.py
git commit -m "feat(forge): add settlement pipeline tab"
```

---

### Task 7: Keep Explorer / Reference useful but secondary

**Files:**
- Modify: `backend/app/api/routes/forge.py`

**Step 1: Review current utility sections**

Inventory current blocks for:
- wallet connect
- faucet
- RPC quick reference
- JSON API / blocks API links
- explorer links

**Step 2: Move utility-only sections into `Explorer / Reference`**

Keep them accessible, but do not let them dominate the page above proof evidence.

**Step 3: Preserve existing endpoints and links**

Do not break:
- `/forge/api`
- `/forge/blocks`
- `/forge/explorer`
- `/forge/metrics`
- `/forge/ws`

**Step 4: Run a syntax check**

Run: `python3 -m py_compile /opt/obsqra.starknet/backend/app/api/routes/forge.py`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/api/routes/forge.py
git commit -m "refactor(forge): move utility panels into reference tab"
```

---

### Task 8: Final verification

**Files:**
- Review: `backend/app/api/routes/forge.py`

**Step 1: Run syntax verification**

Run: `python3 -m py_compile /opt/obsqra.starknet/backend/app/api/routes/forge.py`
Expected: PASS.

**Step 2: Run the backend locally or in the target environment and open Forge**

Verify that `/forge` now shows tabs:
- Overview
- Proof Lanes
- Registry + Provers
- Receipts + Facts
- Settlement
- Explorer / Reference

**Step 3: Manual smoke test**

Check these questions directly in Forge:
- Can I find current proof-lane status in one click?
- Can I see recent receipts / facts without leaving Forge?
- Can I inspect L3 → L2 → L1 settlement state?
- Can I see model-registry and Stone-prover status?
- Does the page still work if one subsystem is unavailable?

**Step 4: Final commit**

```bash
git add backend/app/api/routes/forge.py
git commit -m "feat(forge): ship consolidated tabbed proof dashboard"
```

---

## Notes / guardrails

- Keep all changes **localized to Forge**.
- Reuse existing evidence; do not introduce a second source of truth.
- Be honest about degraded / stale / unavailable states.
- Do not broaden the scope into landing pages, README copy, or repo-wide framing work in this pass.
