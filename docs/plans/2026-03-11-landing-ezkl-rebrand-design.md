# Landing Page + EZKL Rebrand — Design

**Date:** 2026-03-11  
**Status:** Design (pre-implementation)  
**Scope:** Fix landing page (privacy-first lead, EZKL bridge secondary), rebrand away from product catalog, make Surfaces static and informational.

---

## 1. Goals

- **Landing lead:** Privacy and verifiable execution remain the main story (hero + first sections). EZKL bridge is **secondary** — supporting “how” / infrastructure, not the headline.
- **Rebrand:** Move away from “product catalog.” Surfaces (or Capabilities) are a static, informational list — no interactive demos, no API sandbox, no “Run standalone demo.”
- **Header:** Replace Products mega-menu with a simple Surfaces/Capabilities dropdown (static links to Docs or app, no product slug pages with sandboxes).

---

## 2. Primary vs Secondary Messaging

| Primary (lead) | Secondary (supporting) |
|----------------|-------------------------|
| Private DeFi. Verifiable execution. | EZKL → Groth16 bridge (how zkML verifies on-chain) |
| What it unlocks for privacy (private execution, compliance, delegation) | “Under the hood” / infra: we use Garaga + bridge so proofs verify on Starknet |
| Launch App as main CTA | Optional “Technical details” or Docs link that mentions the bridge |

---

## 3. Landing Page (`/`)

- **Hero:** Keep or sharpen “Private DeFi. Verifiable execution.” Subline: zkML coprocessor, verify before execution, session keys, no proof no execution. **No** “Explore Products” CTA; primary CTA is **Launch App** (+ Docs if desired).
- **Section 1 — What it unlocks for privacy:** 3–4 short blocks: (1) Private execution — proofs on-chain, not raw data. (2) Compliance — attest model + bounds without leaking strategy. (3) Delegation — session keys + proof gate. (4) Optional: zkDE/GATE or integrity in one line.
- **Section 2 — How it works:** Keep the existing 3-step flow (Set constraints → Inference + proof → Verified execution). Optionally add one line: “We bridge zkML proofs to Starknet via Garaga so the chain verifies without running inference on-chain.” (Bridge as secondary.)
- **Section 3 — Surfaces (replaces Product Categories):** Single “Surfaces” or “Capabilities” block. Static list of 4–6 items (e.g. Private Vault, DeFi execution, Lending & trust, Mission control). Each: title + one-line description only. No counts, no “View category,” no links to interactive product pages. Optional: one “Docs” or “See in app” link for the list.
- **Footer:** Keep current strip; optionally add “EZKL → Garaga bridge” as a small badge (secondary).
- **Stats from /test:** Add a small “Live stats” or “Network stats” section that fetches stats from the backend (e.g. derived from the hackathon showcase `/test` report or a dedicated JSON stats endpoint). Display 3–5 key numbers (e.g. proofs verified, facts settled, circuits ready) — read-only, no interactivity. Backend can expose `GET /api/v1/zkdefi/landing-stats` that returns a subset of stats from `artifacts/hackathon_showcase/latest.json` if present, or sensible defaults.
- **Remove:** “Explore Products” CTA; full “Product Categories” grid with links to `/products#category`.

---

## 4. Header (SiteHeader)

- Rename **“Products”** to **“Surfaces”** or **“Capabilities.”**
- Replace the mega-menu (categories × products, status chips, links to `/products/[slug]`) with a **static dropdown**: same 4–6 surface names + one-line descriptions; links go only to **Docs** or **app** (e.g. `/agent`), **not** to product slug pages with demos.
- No StatusChip, no “Run standalone demo” in the header.

---

## 5. Products → Surfaces Page

- **Route:** Keep `/products` or rename to `/surfaces` (implementation choice).
- **Title:** “Surfaces” or “Capabilities” (replacing “Product Catalog” / “Category-first product surface”).
- **Content:** One page, one list. Each surface: **title**, **one short paragraph**. Optional “Docs” and/or “Open in app” link per row. **Remove:** “Run standalone demo,” “View product” (to slug), all standaloneActions / API sandbox UI. Status chips optional (can keep one “Live” for the stack or remove).
- **Data:** Reuse catalog only for title + summary/description; strip interactive fields (standaloneActions; advancedLink → single “Open in app” if desired). No interactive components that call APIs or run demos.

---

## 6. Product Slug Pages (`/products/[slug]`)

- **Option A (recommended):** Redirect to `/surfaces` (or `/products`) or to a relevant Doc. No standalone product pages with sandboxes.
- **Option B:** Keep as static pages: title + summary + description only; remove “Run standalone demo” and API sandbox entirely; at most “Docs” + “Open in app.”

---

## 7. EZKL Bridge (Secondary)

- **Where:** One line in “How it works” or a short “Under the hood” bullet: e.g. “We use an EZKL→Groth16 proof bridge so zkML verifies on Starknet via Garaga — private, verifiable execution without exposing models or data.”
- **Optional:** Footer badge “EZKL → Garaga bridge”; or a “Technical details” / “Docs” link that points to the EZKL bridge spec or a short explainer. Not the hero, not the first section.

---

## 8. What We Don’t Do

- No interactive product catalog.
- No “Explore Products” as primary CTA.
- No API sandbox or “Run standalone demo” on the marketing site.
- No category counts or “View category” drill-down from the landing.
- Bridge is **secondary** — not the main headline or first section.

---

## 9. Success Criteria

- Landing leads with privacy and verifiable execution; EZKL bridge appears as supporting copy only.
- Rebrand complete: “Product catalog” → “Surfaces” (or “Capabilities”); all product-style content is static and informational.
- Header and Surfaces page have no interactive demos or sandbox; links go to Docs or app only.
- Slug pages removed or made static (no sandbox).

---

**Next step:** Implementation plan via writing-plans skill.
