# zkde.fi/docs Full Resource — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make zkde.fi/docs the single product-quality docs resource with user guides, API overview, troubleshooting, deploy page, and fixes; no emphasis on local run; SDK/CLI on roadmap.

**Architecture:** All changes are in docs-site (VitePress) and internal docs. New pages under docs-site/docs/; sidebar/nav in config.mts. No theme or styling changes. Verify each change with docs build and sync.

**Tech Stack:** VitePress, Markdown, mermaid. Backend API paths from backend/app/main.py and router modules.

**Design reference:** docs/plans/2026-02-24-zkde-docs-full-resource-design.md

---

## Task 1: Fix developers page — port 3001 and canonical docs URL

**Files:**
- Modify: `docs-site/docs/developers.md`

**Step 1: Update Local Development section**

- Change "Visit `http://localhost:3000`" to "Visit `http://localhost:3001`" (frontend runs on port 3001).
- At the top of the page, after "For developers", add a short line: "Documentation lives at **zkde.fi/docs** (this site when viewing on zkde.fi)."

**Step 2: Add Self-hosting / contributors and SDK/CLI note**

- Replace or shorten "Local Development" to a subsection "Self-hosting / contributors" with: "For contributors: clone the repo, install dependencies (frontend, backend, contracts), set env (see [ENV.md](https://github.com/obsqra-labs/zkdefi/blob/main/docs/ENV.md)). Run backend on :8003 and frontend on :3001. SDK and CLI for integration are on the roadmap; most users use the live app at zkde.fi."

**Step 3: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes without error.

**Step 4: Commit**

```bash
git add docs-site/docs/developers.md
git commit -m "docs: fix developers page port 3001, canonical zkde.fi/docs, self-hosting note"
```

---

## Task 2: Add "Documentation: zkde.fi/docs" to intro and FAQ

**Files:**
- Modify: `docs-site/docs/intro.md`
- Modify: `docs-site/docs/faq.md`

**Step 1: Intro**

In `docs-site/docs/intro.md`, in "Key Features" or after the first paragraph, add one line: "Full documentation: **zkde.fi/docs**."

**Step 2: FAQ**

In `docs-site/docs/faq.md`, add a short FAQ entry: "Where is the documentation?" → "At **zkde.fi/docs**. You're reading it when you're on the docs site at zkde.fi/docs."

**Step 3: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes.

**Step 4: Commit**

```bash
git add docs-site/docs/intro.md docs-site/docs/faq.md
git commit -m "docs: add canonical docs URL to intro and FAQ"
```

---

## Task 3: Update internal DOCS_DEPLOYMENT for canonical zkde.fi/docs

**Files:**
- Modify: `docs/DOCS_DEPLOYMENT.md`

**Step 1: Set canonical URL**

- State at the top: "Canonical docs URL: **zkde.fi/docs**. Nginx serves `frontend/public/docs/` at that path."
- Note that docs.zkde.fi is optional (subdomain); document only if re-enabled.
- Keep Fallback section but rename to "zkde.fi/docs (canonical)" and keep sync/build instructions.

**Step 2: Commit**

```bash
git add docs/DOCS_DEPLOYMENT.md
git commit -m "docs: DOCS_DEPLOYMENT canonical URL zkde.fi/docs"
```

---

## Task 4: Add Quick start (live app) page

**Files:**
- Create: `docs-site/docs/quick-start.md`
- Modify: `docs-site/docs/.vitepress/config.mts`

**Step 1: Create quick-start.md**

Content: Short page "Quick start (live app)". Steps: 1) Get a Starknet wallet (ArgentX, Braavos). 2) Get Sepolia testnet ETH/STRK if needed. 3) Go to zkde.fi and click Connect. 4) After connect, open Agent or Profile. 5) On Agent, you can deploy to Ekubo (see [Deploy to Ekubo](/agent-dashboard#deploy-to-ekubo-flow)) or explore pools. Link to [Agent dashboard](/agent-dashboard) and [Profile](/profile-and-identity). No code; live app only.

**Step 2: Add to sidebar**

In `docs-site/docs/.vitepress/config.mts`, under "Getting Started", add after "Concepts": `{ text: 'Quick start (live app)', link: '/quick-start' }`.

**Step 3: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes; quick-start appears in sidebar.

**Step 4: Commit**

```bash
git add docs-site/docs/quick-start.md docs-site/docs/.vitepress/config.mts
git commit -m "docs: add Quick start (live app) page"
```

---

## Task 5: Add User guide — First-time setup (live app) page

**Files:**
- Create: `docs-site/docs/guide-first-time-setup.md`
- Modify: `docs-site/docs/.vitepress/config.mts`

**Step 1: Create guide-first-time-setup.md**

Content: "First-time setup (live app)". Wallet choice (ArgentX, Braavos), Sepolia testnet, how to get testnet ETH/STRK (faucet or swap), connecting at zkde.fi, what you see after connect (landing vs Agent/Profile). Link to Quick start and Agent dashboard. Short, step-oriented.

**Step 2: Add User guides section to sidebar**

In config.mts, add a new sidebar group "User guides" (after "How the app works") with items: First-time setup (live app), Deploy to Ekubo (link to agent-dashboard#deploy or separate page), Profile and reputation (link to profile-and-identity and reputation-system), Compliance (link to compliance-and-disclosure). For this task, add only the "First-time setup" item linking to `/guide-first-time-setup`.

**Step 3: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes; new page and sidebar entry work.

**Step 4: Commit**

```bash
git add docs-site/docs/guide-first-time-setup.md docs-site/docs/.vitepress/config.mts
git commit -m "docs: add User guide First-time setup (live app)"
```

---

## Task 6: Add User guide — Deploy to Ekubo end-to-end page

**Files:**
- Create: `docs-site/docs/guide-deploy-to-ekubo.md`
- Modify: `docs-site/docs/.vitepress/config.mts`

**Step 1: Create guide-deploy-to-ekubo.md**

Content: "Deploy to Ekubo (end-to-end)". Steps: 1) Open zkde.fi/agent, connect wallet. 2) Find "Deploy to Ekubo" card (Dashboard tab). 3) Enter amount; backend recommends allocation (e.g. ETH/USDC, STRK/USDC). 4) Review positions; click Sign & execute. 5) Sign approve + swap in wallet. 6) Receipt and deployment ID; positions show "pending" until confirmed. Note: Ekubo Sepolia only; if "Ekubo API unavailable" see Troubleshooting. Link to [Agent dashboard](/agent-dashboard) and [Troubleshooting](/troubleshooting) (add in later task).

**Step 2: Add to User guides in sidebar**

In config.mts, under "User guides", add: `{ text: 'Deploy to Ekubo', link: '/guide-deploy-to-ekubo' }`.

**Step 3: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes. (Troubleshooting link will 404 until Task 8; acceptable or use anchor only for now.)

**Step 4: Commit**

```bash
git add docs-site/docs/guide-deploy-to-ekubo.md docs-site/docs/.vitepress/config.mts
git commit -m "docs: add User guide Deploy to Ekubo end-to-end"
```

---

## Task 7: Add User guide — Profile and reputation and Compliance links

**Files:**
- Modify: `docs-site/docs/.vitepress/config.mts`

**Step 1: Add sidebar items under User guides**

Add: `{ text: 'Profile and reputation', link: '/profile-and-identity' }`, `{ text: 'Compliance and disclosure', link: '/compliance-and-disclosure' }`. These are links to existing pages; no new files.

**Step 2: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes.

**Step 3: Commit**

```bash
git add docs-site/docs/.vitepress/config.mts
git commit -m "docs: add Profile and Compliance to User guides sidebar"
```

---

## Task 8: Add API overview page

**Files:**
- Create: `docs-site/docs/api-overview.md`
- Modify: `docs-site/docs/.vitepress/config.mts`

**Step 1: Create api-overview.md**

Content: "API overview". Base URL: `https://zkde.fi`. Health: `GET /health`. zkdefi base: `https://zkde.fi/api/v1/zkdefi`. Table of route groups (from main.py and routers):

| Group | Prefix/Path | Purpose |
|-------|-------------|---------|
| Health | GET /health | Liveness |
| Contracts | GET /api/v1/zkdefi/contracts | Contract addresses |
| Reputation | /api/v1/zkdefi/reputation/* | Tiers, user, staking |
| Risk Passport | /api/v1/zkdefi/risk_passport/* | User/pool passport |
| Compliance | /api/v1/zkdefi/compliance/profiles/{address} | Compliance profiles |
| Orchestration | /api/v1/zkdefi/orchestration/deploy, receipt | Deploy to Ekubo, receipt |
| Full Privacy | /api/v1/zkdefi/full_privacy/* | Deposit/withdraw, merkle |
| zkML | /api/v1/zkdefi/zkml/* | risk_score, anomaly, combined |
| Rebalancer | /api/v1/zkdefi/rebalancer/* | Propose, check, execute |
| Session keys | /api/v1/zkdefi/session_keys/* | Grant, revoke, list |
| Relayer | /api/v1/zkdefi/relayer/* | Request, execute |
| Onboarding | /api/v1/zkdefi/onboarding/* | Status, submit |
| Linked addresses | /api/v1/zkdefi/linked_addresses/* | GET/PUT |
| DEX / Ekubo | /api/v1/zkdefi/dex/*, /ekubo/* | Quotes, swap, positions |

Example curls:
```bash
curl https://zkde.fi/health
curl https://zkde.fi/api/v1/zkdefi/contracts
curl https://zkde.fi/api/v1/zkdefi/reputation/tiers
```
Note: "Full API reference (OpenAPI) and SDK/CLI docs are planned."

**Step 2: Add API to sidebar and nav**

In config.mts, under Resources (or new "API" group), add: `{ text: 'API overview', link: '/api-overview' }`. Optionally add nav item "API" linking to /api-overview.

**Step 3: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes.

**Step 4: Commit**

```bash
git add docs-site/docs/api-overview.md docs-site/docs/.vitepress/config.mts
git commit -m "docs: add API overview page"
```

---

## Task 9: Add Troubleshooting page

**Files:**
- Create: `docs-site/docs/troubleshooting.md`
- Modify: `docs-site/docs/.vitepress/config.mts`

**Step 1: Create troubleshooting.md**

Content: "Troubleshooting". Sections:
- **ChunkLoadError / CSS not loading:** After a deploy, the app may cache old chunks. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R) or clear site data for zkde.fi. If 404 on chunks, ensure a full frontend rebuild and deploy.
- **404 on /docs:** Ensure you use zkde.fi/docs or zkde.fi/docs/. If nginx serves docs, ensure location /docs/ is configured (see Deploying zkde.fi).
- **Transaction errors:** u256_sub Overflow — usually amount or balance mismatch (e.g. decimals); check amounts. NOT_INITIALIZED — pool or contract not initialized on Sepolia; ensure you're on Sepolia and the pool is active. "Requested contract address ... is not deployed" — the contract isn’t deployed at that address on the network you’re using.
- **Ekubo API unavailable / EKUBO_CHAIN_ID not set:** Backend cannot reach Ekubo for positions; check backend env (e.g. Ekubo RPC/API). Positions may show "pending" until API is available.
- **Where to get help:** GitHub Issues, Twitter @obsqralabs. Link to [Developers](/developers) and [API overview](/api-overview).

**Step 2: Add to sidebar**

In config.mts, under Resources, add: `{ text: 'Troubleshooting', link: '/troubleshooting' }`.

**Step 3: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes.

**Step 4: Commit**

```bash
git add docs-site/docs/troubleshooting.md docs-site/docs/.vitepress/config.mts
git commit -m "docs: add Troubleshooting page"
```

---

## Task 10: Add Deploying zkde.fi page (operators)

**Files:**
- Create: `docs-site/docs/deploying-zkde-fi.md`
- Modify: `docs-site/docs/.vitepress/config.mts`

**Step 1: Create deploying-zkde-fi.md**

Content: "Deploying zkde.fi". High level only; no secrets.
- **How the app is served:** Frontend (Next.js) on port 3001; backend (FastAPI) on port 8003. Nginx (or reverse proxy) routes / to frontend, /api/ to backend, /docs/ to static docs.
- **Serving docs at zkde.fi/docs:** Build the docs-site (`cd docs-site && npm run build`); copy output to frontend public docs (`./scripts/sync-docs.sh` from repo root). Nginx serves `frontend/public/docs/` at location /docs/ (alias). See docs/DOCS_DEPLOYMENT.md and scripts/sync-docs.sh for details.
- **Environment and secrets:** Not covered here; see ENV.md and ops runbooks in the repo.

**Step 2: Add to sidebar**

In config.mts, under Resources, add: `{ text: 'Deploying zkde.fi', link: '/deploying-zkde-fi' }`.

**Step 3: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes.

**Step 4: Commit**

```bash
git add docs-site/docs/deploying-zkde-fi.md docs-site/docs/.vitepress/config.mts
git commit -m "docs: add Deploying zkde.fi page for operators"
```

---

## Task 11: Optional — Architecture summary page

**Files:**
- Create: `docs-site/docs/architecture-summary.md`
- Modify: `docs-site/docs/.vitepress/config.mts`

**Step 1: Create architecture-summary.md**

Content: One-page summary of docs/ARCHITECTURE.md and docs/AGENT_FLOW.md: hybrid proof system (Garaga + Integrity), high-level flow (User → Frontend → Backend → Proofs → Starknet), main components (frontend :3001, backend :8003, contracts Sepolia). Use one mermaid diagram (flowchart). End with "Full detail: [ARCHITECTURE.md](https://github.com/obsqra-labs/zkdefi/blob/main/docs/ARCHITECTURE.md), [AGENT_FLOW.md](https://github.com/obsqra-labs/zkdefi/blob/main/docs/AGENT_FLOW.md) in the repo."

**Step 2: Add to sidebar**

In config.mts, under Architecture, add as first item: `{ text: 'Summary', link: '/architecture-summary' }`.

**Step 3: Verify**

Run: `cd docs-site && npm run build`
Expected: Build completes.

**Step 4: Commit**

```bash
git add docs-site/docs/architecture-summary.md docs-site/docs/.vitepress/config.mts
git commit -m "docs: add Architecture summary page"
```

---

## Task 12: Final sync and verification

**Files:**
- None (script run only)

**Step 1: Run sync script**

Run: `./scripts/sync-docs.sh` from repo root.
Expected: docs-site builds; output copied to frontend/public/docs.

**Step 2: Verify site**

Open (or curl) https://zkde.fi/docs/ and click: Quick start, First-time setup, Deploy to Ekubo, API overview, Troubleshooting, Deploying zkde.fi. Confirm no 404s and sidebar matches config.

**Step 3: Commit if any generated asset changed**

If you only ran the script and didn’t change source, no commit. If you had to fix a link or path, commit that fix.

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Fix developers.md (port 3001, canonical docs, self-hosting + SDK/CLI note) |
| 2 | Intro + FAQ: add "Documentation: zkde.fi/docs" |
| 3 | DOCS_DEPLOYMENT: canonical zkde.fi/docs |
| 4 | Quick start (live app) page + sidebar |
| 5 | User guide First-time setup page + User guides section |
| 6 | User guide Deploy to Ekubo page |
| 7 | User guides: Profile and Compliance links |
| 8 | API overview page + sidebar |
| 9 | Troubleshooting page + sidebar |
| 10 | Deploying zkde.fi page + sidebar |
| 11 | Optional: Architecture summary page |
| 12 | Run sync-docs.sh and verify /docs |

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-02-24-zkde-docs-full-resource-implementation.md`.

**Two execution options:**

1. **Subagent-driven (this session)** — I implement task-by-task in this session, with a quick check between tasks (build, then commit).
2. **Parallel session (separate)** — You open a new session, paste this plan, and use **superpowers:executing-plans** to run through the tasks with checkpoints.

Which approach do you want?
