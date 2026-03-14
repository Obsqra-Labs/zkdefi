# Forge Dashboard Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn `/forge` into the primary consolidated dashboard for existing proving-path, model-registry, prover, receipt/fact, and L3→L2→L1 settlement evidence, while keeping all changes localized to Forge.

**Architecture:** Keep the existing Forge route as the single implementation surface and evolve it from a monolithic status page into a tabbed dashboard. Reuse current Forge chain/RPC data and adapt existing `/test`-style evidence into tab-specific payloads and HTML sections, without changing unrelated app or docs surfaces.

**Tech Stack:** FastAPI route HTML + JSON responses in `backend/app/api/routes/forge.py`, existing Madara RPC helpers, existing Forge APIs, existing showcase/evidence artifacts consumed as read-only inputs when needed.

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
