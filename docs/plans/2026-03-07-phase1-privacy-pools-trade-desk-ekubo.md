# Phase 1 Implementation Plan: Privacy Pools, Trade Desk, Ekubo LP

> **For Claude:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close Phase 1 gaps: Privacy Pools in Deploy (three buckets), Deploy default = Trade Desk with tests, Ekubo LP positions visible (backend mount + frontend list).

**Architecture:** Mount ekubo router under `/api/v1/zkdefi`. DeployOverlay already has Trade Desk default and Privacy Pools tab; add apiUrl in PrivacyPoolsPanel; add `frontend/src/lib/api/ekubo.ts` and EkuboPositionsList in Deploy.

**Tech Stack:** FastAPI, Next.js 14, React, TypeScript. Reference: `docs/plans/2026-03-07-gap-analysis-plans-vs-builds.md`.

---

## Part A: Ekubo

### A1: Mount ekubo in main.py
- **Modify:** `backend/app/main.py`
- After `dex_router = _optional_router("app.api.routes.dex")` add: `ekubo_router = _optional_router("app.api.routes.ekubo")`
- After `if dex_router:` block add: `if ekubo_router: app.include_router(ekubo_router, prefix="/api/v1/zkdefi", tags=["ekubo"])`
- Verify: `cd backend && python -c "from app.main import app; print([r.path for r in app.routes if hasattr(r,'path') and 'ekubo' in (r.path or '')])"`
- Commit: feat(backend): mount ekubo router under /api/v1/zkdefi

### A2: Frontend ekubo client
- **Create:** `frontend/src/lib/api/ekubo.ts`
- Export types: EkuboPosition (position_id, pool_key?, etc.), EkuboPositionsResponse (positions, count)
- Export getEkuboPositions(owner): fetch apiUrl("/api/v1/zkdefi/ekubo")+"/positions?owner="+encodeURIComponent(owner), return res.json(), throw if !res.ok
- Commit: feat(frontend): add ekubo API client getEkuboPositions

### A3: Ekubo positions list in Deploy
- **Create:** `frontend/src/components/zkdefi/EkuboPositionsList.tsx` — props ownerAddress; useEffect getEkuboPositions; show loading/error/empty/list (position_id, pool_key)
- **Modify:** `frontend/src/components/zkdefi/mission-control/DeployOverlay.tsx` — import EkuboPositionsList; under TradeDesk add section "Ekubo LP positions" + EkuboPositionsList ownerAddress={address}
- Commit: feat(frontend): show Ekubo LP positions in Deploy overlay

---

## Part B: Privacy Pools

### B1: apiUrl in PrivacyPoolsPanel
- **Modify:** `frontend/src/components/zkdefi/mission-control/PrivacyPoolsPanel.tsx`
- Import apiUrl; replace fetch("/api/v1/dao/...") with fetch(apiUrl("/api/v1/dao/..."))
- Commit: fix(frontend): use apiUrl for Privacy Pools dao requests

### B2: Dao pools accept three ids
- **Modify:** `backend/app/api/routes/dao_governance.py`
- Ensure /pools/{pool}/stats and /pools/{pool}/positions/{address} accept CONSERVATIVE_POOL, MODERATE_POOL, AGGRESSIVE_POOL (or add comment)
- curl GET /api/v1/dao/pools/CONSERVATIVE_POOL/stats → 200
- Commit: chore(backend): dao pools accept three bucket ids

---

## Part C: Deploy tests

### C1: Acceptance tests
- **Modify:** `frontend/src/components/zkdefi/mission-control/__tests__/DeployOverlay.test.tsx`
- Test: default shows Trade Desk (getByTestId("trade-desk"))
- Test: Privacy Pools tab present (getByRole("button", { name: /Privacy Pools/i }))
- Run tests; commit: test(frontend): Deploy default Trade Desk and Privacy Pools tab

---

## Part D: Verification

### D1: Manual + doc
- Start backend; curl ekubo/positions and dao/pools/CONSERVATIVE_POOL/stats → 200
- Start frontend; Deploy shows Trade Desk, Privacy Pools tab, Ekubo positions section
- In gap-analysis doc §9 add: Phase 1 plan = this file; acceptance as above
- Commit: docs: link Phase 1 plan in gap analysis

---

**Acceptance:** Deploy default Trade Desk; Privacy Pools tab with three buckets; Ekubo LP positions list from GET /api/v1/zkdefi/ekubo/positions.

---

## Execution

Plan complete and saved to `docs/plans/2026-03-07-phase1-privacy-pools-trade-desk-ekubo.md`. Two execution options:

**1. Subagent-Driven (this session)** — Dispatch a fresh subagent per task (or per Part), review between tasks, fast iteration. **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development.

**2. Parallel Session (separate)** — Open a new session in the same worktree; run the plan task-by-task there. **REQUIRED SUB-SKILL:** In that session use superpowers:executing-plans.

Which approach?
