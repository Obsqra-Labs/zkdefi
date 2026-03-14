# Forge Dashboard Consolidation Design

**Date:** 2026-03-13  
**Status:** Design (approved)  
**Scope:** Localize changes strictly to the Forge dashboard so it becomes the primary consolidated dashboard for existing proving-path, model-registry, prover, receipt/fact, and L3→L2→L1 settlement evidence already tracked elsewhere.

---

## 1. Goals

- **Make `/forge` the primary consolidated dashboard** for the proof chain instead of a narrow chain-status page.
- **Keep all changes local to Forge**: no landing-page copy changes, no README/docs reframe work, no changes to unrelated app surfaces.
- **Promote existing evidence already tracked in `/test`** into Forge as a clearer operational dashboard.
- **Preserve current proof-path information** but expand it into a richer proof-lanes view.
- **Surface the actual infrastructure stack** that matters operationally:
  - model registry
  - Stone / prover health
  - proof lanes
  - receipts / facts
  - settlement across `L3 -> L2 -> L1`

---

## 2. Recommended approach

### Chosen approach: tabbed Forge dashboard

Forge should move from a single long status page to a **tabbed dashboard**.

This is the best fit because:

- it lets Forge become the **primary dashboard** without turning into one giant scroll wall
- it separates chain health from proof evidence cleanly
- it leaves `/test` free to remain the dense benchmark / research readout
- it scales cleanly as new lanes or supporting systems are added later

### Scope boundary

The implementation should stay inside:

- `backend/app/api/routes/forge.py`

This includes:

- Forge HTML
- Forge JSON/API payloads if needed
- Forge tab structure and rendering logic

It does **not** include:

- landing page
- marketing copy outside Forge
- docs-wide reframing
- new protocol features
- adding IPFS/libp2p

---

## 3. Information architecture

Forge should be organized into the following tabs.

### 3.1 Overview

This remains the default tab.

It should show:

- block height
- uptime
- fee model
- latest block hash
- chain id
- compact rollup of:
  - proof-lane health
  - prover / registry health
  - settlement health

The purpose is to answer: **is the system live, and where should I look next?**

### 3.2 Proof Lanes

This tab replaces the current “Three Proving Paths” as the main proof surface.

It should include the currently relevant lanes already tracked operationally:

- `Groth16 / Garaga`
- `STARK / Integrity`
- `Noir HONK`
- `Native KZG`
- `Hash-only fallback`

For each lane, show:

- current status
- verifier mode
- latest receipt / tx / fact hash when available
- speed / gas / trust posture
- whether the lane is currently usable

This tab should make it obvious that the system is **multi-lane**, not just “3 proving paths.”

### 3.3 Registry + Provers

This tab consolidates infrastructure state.

It should show:

- model registry status
- active models / circuits / processors
- Stone prover health
- other proving backend / bridge service health where already tracked
- whether proving infrastructure is live, degraded, stale, or unavailable

This is where the backend/subsystem coordination story belongs, but expressed as infrastructure state rather than marketing copy.

### 3.4 Receipts + Facts

This tab becomes the accountability layer.

It should show:

- latest verified facts
- latest receipts
- source app or lane where available
- proof type
- verifier result
- explorer links

This is the place where the user sees what the system has actually verified and emitted.

### 3.5 Settlement

This tab shows progression across chains.

It should show:

- L3 verified state
- L2 mirrored / settled state
- L1 bridge state where relevant
- recent end-to-end settlement outcomes

The point is to make `L3 -> L2 -> L1` an explicit, inspectable pipeline rather than a line of copy hidden in another page.

### 3.6 Explorer / Reference

This tab keeps utility functions but lowers their priority.

It should contain:

- recent blocks
- RPC info
- API links
- wallet connect instructions
- faucet / reference details

This is supporting context, not the core product story.

---

## 4. Data model rule

**Forge should not invent a second truth source.**

Forge should read from the same evidence sources already trusted for `/test` and the existing Forge APIs, then reorganize them into a clearer dashboard.

That means:

- existing Forge chain health / block / explorer data stays
- `/test`-style evidence gets promoted into tab payloads where possible:
  - model registry state
  - Stone / prover health
  - proof-lane receipts
  - verified facts
  - settlement state

Preferred implementation pattern:

- **reuse existing JSON/evidence generation**
- **add adapter/summary endpoints only if needed**
- **avoid duplicating proof logic inside Forge**

---

## 5. Error handling

Each tab should fail independently.

If one subsystem is down:

- `Overview` still renders chain basics
- `Proof Lanes` can show partial lane state
- `Registry + Provers` can show degraded / unavailable
- `Receipts + Facts` can show stale/latest-known data
- `Settlement` can show unknown / pending

Allowed state labels:

- `live`
- `degraded`
- `stale`
- `unavailable`
- `fallback_only`

The entire dashboard should **not** fail because one proof lane is flaky.

---

## 6. Testing / validation

This redesign is successful if:

1. Forge becomes the **primary consolidated dashboard**.
2. A visitor can quickly find:
   - proof-lane health
   - latest receipts / facts
   - settlement status
   - registry / prover state
3. `/test` is no longer carrying the entire narrative alone.
4. Forge still works when one subsystem is unavailable.

Manual validation questions:

- Can a user find current proof-lane status in one click?
- Can a user inspect recent facts / receipts from Forge itself?
- Can a user understand where a proof is in the `L3 -> L2 -> L1` pipeline?
- Can a user see whether the model registry / prover stack is healthy without going to `/test`?

---

## 7. Guardrails

- Do **not** add new protocol features in this pass.
- Do **not** change repo-wide docs or copy outside Forge.
- Do **not** turn Forge into a prettier generic block explorer.
- Do **not** duplicate all `/test` detail blindly; preserve `/test` as the denser evidence surface.
- Do **not** introduce IPFS/libp2p framing yet.

---

## 8. Final approved direction

Forge becomes a **tabbed, proof-first operational dashboard** built from existing evidence already present in Forge and `/test`.

Priority order:

1. Overview
2. Proof Lanes
3. Registry + Provers
4. Receipts + Facts
5. Settlement
6. Explorer / Reference

This keeps the implementation localized to Forge while making it the primary dashboard for the proving system.
