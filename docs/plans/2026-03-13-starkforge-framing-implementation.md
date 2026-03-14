# StarkForge Framing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reframe public docs and marketing surfaces so Obsqra Labs is the parent zk research lab, StarkForge is the STARK-native proof chain / proving fabric, and zkde.fi is the sandbox for trustless and verifiable systems built on top of it.

**Architecture:** This is a messaging + information-architecture pass, not a protocol rewrite. The implementation updates (1) top-level repo/docs copy, (2) landing-page and marketing component copy, and (3) navigation labels linking to Forge and `/test`, while keeping privacy-first execution and current proof-lane evidence central. The underlying proving stack, routes, and receipts do not change in this phase.

**Tech Stack:** Markdown docs, Next.js App Router, React marketing components, existing Forge dashboard at `https://starknet.obsqra.fi/forge`, existing showcase readout at `https://zkde.fi/test`.

---

### Task 1: Update top-level repo framing in `README.md`

**Files:**
- Modify: `README.md`
- Reference: `docs/plans/2026-03-13-starkforge-framing-design.md`

**Step 1: Write the failing content check**

Check that `README.md` still leads with `zkde.fi` as the top-level product and does not mention `StarkForge`.

Run: `python3 - <<'PY'
from pathlib import Path
text = Path('README.md').read_text()
assert 'StarkForge' in text, 'README does not yet introduce StarkForge framing'
PY`

Expected: FAIL with `README does not yet introduce StarkForge framing`.

**Step 2: Update the README copy**

Edit `README.md` so the opening sections say:
- `Obsqra Labs` is the parent zk research lab
- `StarkForge` is the STARK-native proof chain and proving fabric
- `zkde.fi` is the sandbox / flagship environment built on StarkForge
- privacy-first execution, portable proofs, and cross-chain attestation are all named explicitly

Also update the architecture / “What it is” language so zkde.fi is no longer presented as the whole company story.

**Step 3: Run the content check again**

Run: `python3 - <<'PY'
from pathlib import Path
text = Path('README.md').read_text()
assert 'StarkForge' in text
assert 'Obsqra Labs' in text
assert 'sandbox' in text or 'proving ground' in text
PY`

Expected: PASS.

**Step 4: Verify no trust-model regressions in wording**

Manually confirm the README still clearly states:
- privacy is core
- proof lanes / verifiers exist
- `/test` remains the evidence surface

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: reframe README around StarkForge and Obsqra Labs"
```

---

### Task 2: Replace `zk OS` entry-point docs with StarkForge framing

**Files:**
- Modify: `docs/README.md`
- Modify or supersede: `docs/ZK_OS_REFrame.md`
- Create or modify: `docs/STARKFORGE_FRAMING.md` (recommended new canonical doc)
- Reference: `docs/plans/2026-03-13-starkforge-framing-design.md`

**Step 1: Write the failing content check**

Run: `python3 - <<'PY'
from pathlib import Path
text = Path('docs/README.md').read_text()
assert 'StarkForge' in text, 'Docs index still lacks StarkForge as start-here framing'
PY`

Expected: FAIL.

**Step 2: Create the canonical framing doc**

Create `docs/STARKFORGE_FRAMING.md` with:
- Obsqra Labs = parent zk research lab
- StarkForge = proof chain / proving fabric
- zkde.fi = sandbox
- privacy-first trust model
- proof-lane / verifier / fact / receipt / settlement flow
- `/forge` = proof explorer first, chain browser second
- `/test` = dense evidence surface

**Step 3: Update docs index**

Update `docs/README.md` so the “Start here” section leads with StarkForge framing rather than `zk OS`.

**Step 4: Deprecate or rewrite the zk OS doc**

Either:
- rewrite `docs/ZK_OS_REFrame.md` into a historical/background concept doc, or
- replace its opening copy with a note that StarkForge is now the public framing and `zk OS` is background architecture language only.

**Step 5: Run the content check again**

Run: `python3 - <<'PY'
from pathlib import Path
idx = Path('docs/README.md').read_text()
assert 'StarkForge' in idx
assert 'zk OS reframe' not in idx.lower() or 'background' in Path('docs/ZK_OS_REFrame.md').read_text().lower()
PY`

Expected: PASS.

**Step 6: Commit**

```bash
git add docs/README.md docs/ZK_OS_REFrame.md docs/STARKFORGE_FRAMING.md
git commit -m "docs: add StarkForge framing and demote zk OS language"
```

---

### Task 3: Reframe the landing page hero and roadmap around StarkForge

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/components/marketing/CapitalOSSection.tsx`
- Reference: `docs/plans/2026-03-13-starkforge-framing-design.md`

**Step 1: Write the failing copy check**

Run: `python3 - <<'PY'
from pathlib import Path
text = Path('frontend/src/app/page.tsx').read_text()
assert 'StarkForge' in text, 'Landing page still lacks StarkForge framing'
PY`

Expected: FAIL.

**Step 2: Update `page.tsx` hero and framing sections**

Revise the hero / problem / roadmap copy so it communicates:
- StarkForge as the base proving fabric
- private execution as the product truth
- zkde.fi as the sandbox and flagship proving ground
- proof lanes and cross-chain attestation as the unlock

Preserve `trust = Σ(receipts)` if it still fits cleanly, but subordinate it to the larger StarkForge story.

**Step 3: Update `CapitalOSSection.tsx` copy**

Reframe `Capital OS` from “the system” into “the sandbox / live demo” built on top of StarkForge.
Examples:
- heading/subheading copy
- “Capital OS” label treatment
- any place where the section implies it is the top-level platform rather than a proving ground

**Step 4: Run app sanity checks**

Run: `npm run lint` in `frontend/`

Expected: PASS.

If there is no standalone lint script, run: `npm run build`

Expected: PASS.

**Step 5: Manual browser verification**

Check the landing page and confirm a new visitor can infer:
- what StarkForge is
- why privacy matters
- how zkde.fi fits

**Step 6: Commit**

```bash
git add frontend/src/app/page.tsx frontend/src/components/marketing/CapitalOSSection.tsx
git commit -m "feat(marketing): reframe landing page around StarkForge"
```

---

### Task 4: Update navigation and Forge affordances

**Files:**
- Modify: `frontend/src/components/marketing/SiteHeader.tsx`
- Modify: `frontend/src/components/marketing/TrustDemo.tsx`
- Optional modify: any landing CTA copy in `frontend/src/app/page.tsx`

**Step 1: Write the failing check**

Run: `python3 - <<'PY'
from pathlib import Path
text = Path('frontend/src/components/marketing/SiteHeader.tsx').read_text()
assert 'StarkForge' in text, 'Header still labels Forge as generic Proof Chain'
PY`

Expected: FAIL.

**Step 2: Update header link copy**

Change the external Forge nav item from generic `Proof Chain` to `StarkForge` or `StarkForge / Forge` depending on available space.

**Step 3: Update TrustDemo attestation copy**

Where `TrustDemo.tsx` references `Madara L3`, `L3 Explorer`, or settlement flow, make sure the copy reinforces that this is part of StarkForge’s proof / settlement fabric and not just a random external explorer.

**Step 4: Re-run frontend sanity checks**

Run: `npm run lint` in `frontend/`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/components/marketing/SiteHeader.tsx frontend/src/components/marketing/TrustDemo.tsx
git commit -m "feat(marketing): label Forge as StarkForge in nav and demo copy"
```

---

### Task 5: Align `/forge` and `/test` narrative in docs

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/RECURSIVE_MULTICHAIN_PROVING_CORE.md`
- Modify: `scripts/README.md`
- Optional create: `docs/STARKFORGE_FORGE_SURFACE.md`

**Step 1: Write the failing docs check**

Run: `python3 - <<'PY'
from pathlib import Path
text = Path('docs/RECURSIVE_MULTICHAIN_PROVING_CORE.md').read_text()
assert '/forge' in text or 'StarkForge' in text, 'Recursive proving doc does not connect proof core to Forge surface'
PY`

Expected: FAIL or weak result.

**Step 2: Add the surface split explicitly**

Document that:
- `starknet.obsqra.fi/forge` is the live operational proof-chain surface
- `zkde.fi/test` is the dense evidence / research readout
- both are part of the same StarkForge evidence model, just with different levels of detail

**Step 3: Add a Forge-focused doc if needed**

If the concept is too large for inline edits, create `docs/STARKFORGE_FORGE_SURFACE.md` that defines:
- proof explorer first, chain browser second
- recent verified proofs / facts / settlement / lanes as primary widgets
- chain health as supporting context

**Step 4: Re-run docs sanity check**

Run: `python3 - <<'PY'
from pathlib import Path
for p in ['docs/README.md','docs/RECURSIVE_MULTICHAIN_PROVING_CORE.md','scripts/README.md']:
    assert Path(p).exists()
print('ok')
PY`

Expected: `ok`.

**Step 5: Commit**

```bash
git add docs/README.md docs/RECURSIVE_MULTICHAIN_PROVING_CORE.md scripts/README.md docs/STARKFORGE_FORGE_SURFACE.md
git commit -m "docs: align Forge and test under StarkForge evidence model"
```

---

### Task 6: Final verification pass

**Files:**
- Review: `README.md`
- Review: `docs/README.md`
- Review: `docs/STARKFORGE_FRAMING.md`
- Review: `frontend/src/app/page.tsx`
- Review: `frontend/src/components/marketing/SiteHeader.tsx`
- Review: `frontend/src/components/marketing/CapitalOSSection.tsx`
- Review: `frontend/src/components/marketing/TrustDemo.tsx`

**Step 1: Run repo-level spot checks**

Run:
- `python3 - <<'PY'
from pathlib import Path
checks = {
  'README.md': 'StarkForge',
  'docs/README.md': 'StarkForge',
  'frontend/src/app/page.tsx': 'StarkForge',
}
for path, needle in checks.items():
    text = Path(path).read_text()
    assert needle in text, f"{needle} missing from {path}"
print('ok')
PY`

Expected: `ok`.

**Step 2: Run frontend verification**

Run in `frontend/`:
- `npm run lint`
- or `npm run build` if lint is unavailable

Expected: PASS.

**Step 3: Manual smoke test**

Open the landing page and verify that a first-time reader can answer:
- What is StarkForge?
- What does it do?
- Why does privacy matter here?
- How does zkde.fi fit?
- Where do I inspect proof-chain evidence (`/forge`, `/test`)?

**Step 4: Final commit**

```bash
git add README.md docs/README.md docs/STARKFORGE_FRAMING.md docs/ZK_OS_REFrame.md docs/RECURSIVE_MULTICHAIN_PROVING_CORE.md scripts/README.md frontend/src/app/page.tsx frontend/src/components/marketing/SiteHeader.tsx frontend/src/components/marketing/CapitalOSSection.tsx frontend/src/components/marketing/TrustDemo.tsx
git commit -m "docs(marketing): ship StarkForge public framing across docs and landing"
```

---

## Notes / guardrails

- Do **not** add IPFS or libp2p framing in this pass except as explicit future scope.
- Do **not** remove privacy-first language. StarkForge is infra, but privacy is still the product truth.
- Do **not** let Forge become a generic block explorer in copy. Proof explorer first, chain browser second.
- Keep `zk OS` language only where it helps internal architecture discussion; do not keep it as the public entry point.
