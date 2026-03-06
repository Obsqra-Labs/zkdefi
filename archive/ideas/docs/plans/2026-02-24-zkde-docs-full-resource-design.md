# zkde.fi/docs full resource — design

**Date:** 2026-02-24  
**Status:** Approved direction (Approach C, no emphasis on local run; SDK/CLI on roadmap)

---

## 1. Objective

Make **zkde.fi/docs** the single, authoritative, product-quality documentation resource: user guides, API reference, troubleshooting, and operator/deploy info. Primary audience uses the **live app** at zkde.fi; we do not push "run locally" as a main path. SDK/CLI are planned later; docs should support that future without over-investing in local setup now.

---

## 2. Scope (Approach C, adjusted)

- **User guides** — First-time setup (wallet, Sepolia, connect), Deploy to Ekubo (recommend → execute → receipt), Profile and reputation, Compliance and disclosure. Short, step-oriented, optional screenshots/placeholders.
- **API section** — Overview of route groups (reputation, risk_passport, compliance, orchestration/deploy, full_privacy, zkml, etc.) with method, path, one-line description; 2–3 example `curl` calls; "Full API reference / OpenAPI later."
- **Troubleshooting** — Common issues: ChunkLoadError / cache, 404 on /docs, transaction errors (e.g. u256_sub overflow, NOT_INITIALIZED), "Ekubo API unavailable." "Where to get help" (GitHub, Twitter).
- **Operators / deploy** — One "Deploying zkde.fi" page: how the app is served (frontend :3001, backend :8003, nginx / and /api/ and /docs/), serving docs at zkde.fi/docs (sync script, nginx alias). No secrets; env/sensitive ops stay in repo-only docs with a pointer.
- **Local run** — Not a primary path. Either:
  - Omit a full "Setup and run locally" page, or
  - One short "Self-hosting / contributors" subsection under Developers: "For contributors: clone, install, env (see ENV.md in repo), run backend :8003 and frontend :3001. SDK/CLI for integration are on the roadmap."
- **Fixes** — Developers page: correct port (3001), state canonical docs URL (zkde.fi/docs). FAQ/intro: one line "Documentation: zkde.fi/docs." Internal DOCS_DEPLOYMENT: canonical URL is zkde.fi/docs; docs.zkde.fi optional.

---

## 3. Structure and nav (no theme change)

- **Getting Started** — Existing (intro, why, concepts). Optional: add one "Quick start (live app)" that points to connect wallet and first action on zkde.fi.
- **Privacy Features** — Existing (overview, zkML, session keys, rebalancing).
- **How the app works** — Existing (app overview, agent dashboard, profile, reputation, risk passport, compliance). Expand in place with clearer "user guide" flow where needed (e.g. Deploy to Ekubo steps).
- **User guides (new section or under How the app works)** — First-time setup (live app), Deploy to Ekubo end-to-end, Profile and reputation, Compliance (or link from existing compliance page).
- **Architecture** — Existing (flow, contracts, innovation). Optional: one page summarizing ARCHITECTURE.md/AGENT_FLOW.md with mermaid; "Full detail: GitHub docs/."
- **API** — New "API overview" page (route groups, example curls). Under Resources or its own nav item.
- **Resources** — Existing (developers, FAQ). Add Troubleshooting page; optionally "Deploying zkde.fi" here or under a small "Ops" group. Developers: fix port, canonical docs URL; minimal "Self-hosting / contributors" + SDK/CLI roadmap note.
- **Standards** — Existing (AEGIS).

No new theme or styling; only new sidebar/nav entries and content.

---

## 4. Out of scope for this iteration

- Full OpenAPI spec or in-docs API playground.
- SDK/CLI documentation (later roadmap).
- Translated docs.
- Encouraging or documenting "run a full local stack" as a primary path.

---

## 5. Maintenance

- **Canonical docs:** zkde.fi/docs only; app links and doc copy point here.
- **Rule:** When adding a major API surface or deploy change, add or update the API overview and/or Deploy page.
- Internal docs (docs/*.md) remain source of detail; public docs summarize and link to repo where useful.

---

## 6. Next step

Invoke **writing-plans** to produce an implementation plan (task list, files to touch, verification). Implementation follows plan approval.
