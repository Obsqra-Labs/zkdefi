# Landing Page + EZKL Rebrand — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the landing page to lead with privacy and verifiable execution (EZKL bridge secondary), rebrand away from product catalog to static Surfaces/Capabilities, remove interactive demos/sandbox, and add a stats section fed from backend (/test showcase data).

**Architecture:** (1) Landing page: new sections (What it unlocks, Surfaces list), remove Product Categories grid and Explore Products CTA, add stats strip that fetches from a new backend JSON endpoint. (2) Backend: one GET endpoint that returns a small stats payload from `latest.json` or defaults. (3) Header: rename Products → Surfaces, replace mega-menu with static dropdown linking to Docs/app. (4) Products page → static Surfaces page; slug pages redirect or become static only.

**Tech Stack:** Next.js (App Router), React, existing `SiteHeader`, `catalog.ts` (trimmed for static use), FastAPI backend.

**Design doc:** `docs/plans/2026-03-11-landing-ezkl-rebrand-design.md`

---

## Phase 0 — Backend: landing stats endpoint

### Task 0.1: Add GET landing-stats endpoint

**Files:**
- Create or modify: `backend/app/api/routes/landing.py` (or add to an existing public routes module)
- Modify: `backend/app/main.py` (include router if new file)
- Test: optional `backend/tests/test_landing_stats.py`

**Steps:**

1. Create `backend/app/api/routes/landing.py` with a single GET endpoint, e.g. `GET /api/v1/zkdefi/landing-stats`, that:
   - Reads `repo_root / "artifacts" / "hackathon_showcase" / "latest.json"` if it exists.
   - Parses JSON and extracts a small subset of stats (e.g. total proofs passed, fact_count, circuits_ready, or top-level counts from the showcase structure). If file missing or parse fails, return a default payload, e.g. `{"proofs_verified": 0, "facts_settled": 0, "circuits_ready": 0}`.
   - Returns JSON, e.g. `{"proofs_verified": N, "facts_settled": N, "circuits_ready": N}` (adjust keys to match what `latest.json` actually has — see `scripts/hackathon_backend_showcase.py` for the JSON shape).
   - No auth required (public landing page).

2. Register the router in `main.py` under the existing API prefix so the frontend can call e.g. `GET /api/v1/zkdefi/landing-stats`.

3. (Optional) Add a minimal test that GET returns 200 and a dict with expected keys.

**Commit:** `feat(backend): add GET landing-stats endpoint from showcase latest.json`

---

## Phase 1 — Landing page content and structure

### Task 1.1: Landing hero and CTAs — remove Explore Products, keep Launch App + Docs

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Steps:**

1. Remove the "Explore Products" link from the hero CTAs. Keep "Launch App" as primary and "Docs" (and optionally "Surfaces" as secondary link to `/products` or `/surfaces`).
2. Ensure no "Explore Products" copy remains in the hero section.

**Commit:** `chore(landing): remove Explore Products CTA from hero`

---

### Task 1.2: Replace Product Categories with Surfaces block and add What it unlocks

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Steps:**

1. Remove the "Product Categories" section (grid of categories with links to `/products#category`).
2. Add section **"What it unlocks for privacy"**: 3–4 short blocks (e.g. Private execution, Compliance, Delegation; copy from design doc). Static content only.
3. Add section **"Surfaces"** (or "Capabilities"): a single list of 4–6 items (e.g. Private Vault, DeFi execution, Lending & trust, Mission control). Each: title + one-line description. No per-item links to product slug pages; optional single "Docs" or "See in app" link for the section. Data can be hardcoded or derived from a trimmed list from `catalog.ts` (title + summary only).

**Commit:** `feat(landing): add What it unlocks and Surfaces sections, remove Product Categories grid`

---

### Task 1.3: How it works — add one line about EZKL bridge (secondary)

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Steps:**

1. In the existing "How it works" 3-step section, add one supporting line (e.g. below the steps or in the intro): “We use an EZKL→Groth16 proof bridge so zkML verifies on Starknet via Garaga.” Keep it short and secondary.

**Commit:** `chore(landing): add secondary EZKL bridge line to How it works`

---

### Task 1.4: Landing stats section — fetch from backend and display

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify or ensure: `frontend/src/lib/api/client.ts` (apiUrl for backend)

**Steps:**

1. Add a "Live stats" or "Network stats" section (e.g. between Surfaces and footer, or above footer). Use the backend base URL (e.g. `NEXT_PUBLIC_API_URL` or same origin) to call `GET /api/v1/zkdefi/landing-stats`.
2. On load, fetch the stats; display 3–5 key numbers (e.g. proofs verified, facts settled, circuits ready) in a simple row or grid. Handle loading and error states (e.g. show “—” or hide section if fetch fails).
3. No interactivity — read-only display.

**Commit:** `feat(landing): add stats section from /landing-stats`

---

## Phase 2 — Header: Products → Surfaces, static dropdown

### Task 2.1: Rename Products to Surfaces and simplify dropdown

**Files:**
- Modify: `frontend/src/components/marketing/SiteHeader.tsx`

**Steps:**

1. Change the nav label from "Products" to "Surfaces" (or "Capabilities").
2. Replace the current mega-menu (categories × products with status chips and links to `/products/[slug]`) with a **static dropdown**: same 4–6 surface names + one-line descriptions. Links go only to **Docs** (e.g. `/docs/...`) or **app** (e.g. `/agent`). Remove StatusChip and any "Run standalone demo" from the dropdown.
3. Reuse the same list as on the landing Surfaces section for consistency (title + one line); links can be to a single Docs page or to `/agent` with optional query.

**Commit:** `feat(header): rename Products to Surfaces, static dropdown linking to Docs/app`

---

## Phase 3 — Products page → static Surfaces page

### Task 3.1: Convert products page to static Surfaces list

**Files:**
- Modify: `frontend/src/app/products/page.tsx`

**Steps:**

1. Change page title and intro from "Product Catalog" / "Category-first product surface" to "Surfaces" (or "Capabilities") with a short static description.
2. Replace the current category-based grid and product cards with a **single list**: each surface has title + one short paragraph (summary or description from catalog). Remove "Run standalone demo," "View product" (to slug), and all standaloneActions / API sandbox UI. Remove or simplify category tabs; optionally keep one flat list of 4–6 surfaces. Optional per-row link: "Docs" or "Open in app" only.
3. Data: derive from existing `PRODUCTS` or `PRODUCT_CATEGORIES` in `catalog.ts` but only use `title`, `summary` (or `description`); do not pass `standaloneActions` or render any interactive demo component. Status chips optional (remove or show one “Live” for the stack).

**Commit:** `feat(products): static Surfaces list, remove demos and sandbox`

---

### Task 3.2: Product slug pages — redirect or static only

**Files:**
- Modify: `frontend/src/app/products/[slug]/page.tsx`
- Optional: modify `frontend/src/components/marketing/ProductPageFrame.tsx` if it contains sandbox UI

**Steps:**

1. **Option A (recommended):** Redirect `/products/[slug]` to `/products` (or `/surfaces` if you rename the route). In `[slug]/page.tsx`, use `redirect('/products')` (or `redirect('/surfaces')`) so no standalone product pages with demos are reachable.
2. **Option B:** Keep slug pages but remove all "Run standalone demo" and API sandbox content; render only title + summary + description and at most "Docs" + "Open in app" links.

**Commit:** `chore(products): redirect slug pages to Surfaces or make static-only`

---

## Phase 4 — Footer and optional EZKL badge

### Task 4.1: Optional footer badge for EZKL bridge

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Steps:**

1. In the footer strip, optionally add a small badge or line: “EZKL → Garaga bridge” (or “zkML on Starknet”) as secondary. Keep existing items (Starknet, Open Source, Integrity + Garaga, zkDE + GATE). No obligation to add if the design doc says “optional.”

**Commit:** `chore(landing): add optional EZKL bridge badge in footer`

---

## Testing and verification

- **Manual:** Load `/` — hero has Launch App + Docs only; no Explore Products. Sections: What it unlocks, Surfaces, How it works (with bridge line), Stats (numbers from backend), footer.
- **Manual:** Header “Surfaces” opens dropdown with static links to Docs/app only; no product slug links, no demos.
- **Manual:** `/products` shows static list only; no “Run standalone demo” or sandbox. `/products/[any-slug]` redirects to `/products` (or static content if Option B).
- **Backend:** GET `/api/v1/zkdefi/landing-stats` returns 200 and JSON with expected keys; if `latest.json` missing, defaults are returned.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-03-11-landing-ezkl-rebrand-implementation.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task (or per phase), review between tasks, fast iteration.
2. **Parallel Session (separate)** — You open a new session and use the executing-plans skill for batch execution with checkpoints.

Which approach do you want?
