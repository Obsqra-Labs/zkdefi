# Implementation Plan: Phase 1 + Ekubo LP + Dark Ledger

**Date:** 2026-03-07  
**Ref:** Gap analysis 2026-03-07-gap-analysis-plans-vs-builds.md

**Execution order:** 2 → 3 → 4 → 5 → 6 (backend first, then frontend client, then LP UI, then Dark Ledger, then Phase 1 verification).

## 1. Overview

- **A. Ekubo backend:** Mount ekubo router so GET /api/v1/zkdefi/ekubo/positions?owner=... is live.
- **B. Ekubo frontend:** Fetch and display Ekubo positions in Deploy/Vault LP (client + UI).
- **C. Dark Ledger:** CapitalLedger left rail shows note_count, sweep_available_usd, l3_block from ledger/notes.
- **D. Phase 1:** Confirm Deploy = Trade Desk + Privacy Pools; fix any missing dao routes for Privacy Pools.

## 2. Task 1: Mount Ekubo router

**File:** backend/app/main.py

- In the block where routers are loaded (around line 98), add: `ekubo_router = _optional_router("app.api.routes.ekubo")`.
- In the block where dex_router is included (around line 147-148), add:
  `if ekubo_router: app.include_router(ekubo_router, prefix="/api/v1/zkdefi", tags=["ekubo"])`.

The ekubo module already has `router = APIRouter(prefix="/ekubo", ...)` and defines GET /positions, POST /swap/quote, POST /lp/preview, POST /lp/add/build, POST /lp/remove/build, etc. Mounting under /api/v1/zkdefi makes them available at /api/v1/zkdefi/ekubo/positions?owner=...

**Verify:** curl "http://localhost:8003/api/v1/zkdefi/ekubo/positions?owner=0x123" returns 200 or 422.

## 3. Task 2: Frontend Ekubo API client

**New file:** frontend/src/lib/api/ekubo.ts

- getEkuboPositions(owner: string): GET /api/v1/zkdefi/ekubo/positions?owner=... via apiUrl from @/lib/api/client. Return type { owner, positions, count }. Define EkuboPosition from backend shape (position_id, pool_key, liquidity, token0, token1, fee_tier). Optional later: previewLp, buildLpAddTx, buildLpRemoveTx.

**Verify:** No 404; response has positions array.

## 4. Task 3: Show Ekubo positions in LP surface

Choose one: Trade Desk LP section, DeployOverlay LP panel, or LiquidityTab (replace stub). In that component: call getEkuboPositions(address); render list with loading/empty; optional wire Add/Remove to ekubo lp/add/build and lp/remove/build.

**Verify:** User sees Ekubo positions list in chosen surface.

## 5. Task 4: Wire Dark Ledger in CapitalLedger

**File:** frontend/src/components/zkdefi/mission-control/CapitalLedger.tsx

Current state: load() sets darkLedger to zeroes with comment "endpoint not yet implemented" (lines ~107-113). Backend already exposes GET /api/v1/zkdefi/ledger/notes/{address} returning { count, sweep_available_usd, l3_block, notes, source }.

- In load(), add: const notesData = await apiFetch(\`/api/v1/zkdefi/ledger/notes/${address}\`).catch(() => null). If notesData, setDarkLedger({ note_count: notesData.count, sweep_available_usd: notesData.sweep_available_usd ?? 0, l3_block: notesData.l3_block ?? 0 }). Else keep zeroes (or existing state). Remove the hardcoded setDarkLedger({ note_count: 0, ... }) and the "not yet implemented" comment.

**Verify:** Left rail Dark Ledger shows API values when backend returns data; zeroes on error or empty.

## 6. Task 5: Phase 1 verification

Deploy already has Trade Desk default and Privacy Pools tab. Ensure GET /api/v1/dao/pools/{poolId}/stats and .../positions/{address} exist (or fix frontend paths). Deposit/Withdraw wired or Coming soon.

**Verify:** Deploy opens Trade Desk; Privacy Pools tab loads without 404s.

## 7. File checklist

- Edit: backend/app/main.py (ekubo_router)
- Add: frontend/src/lib/api/ekubo.ts
- Edit: LP UI component (LiquidityTab or LPPanel or Trade Desk)
- Edit: frontend/src/components/zkdefi/mission-control/CapitalLedger.tsx
- Verify: dao routes for Privacy Pools

## 8. Acceptance

- Ekubo GET positions 200; one UI shows positions list.
- CapitalLedger shows Dark Ledger from ledger/notes.
- Deploy = Trade Desk + Privacy Pools; no 404s for panel.
