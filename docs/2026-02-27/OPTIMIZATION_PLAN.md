# zkde.fi Optimization Plan — Feb 27, 2026

## Audit Summary

Full deep-dive audit across backend (28 findings), frontend (13 findings), contracts/circuits (8 findings).

## Execution Batches

### Batch 1: Security Fixes
- [x] 1A. Restrict CORS origins in `main.py`
- [x] 1B. Add wallet-signature auth middleware
- [x] 1C. Apply auth to destructive/write endpoints

### Batch 2: Data Integrity
- [x] 2A. Fix market surface token decimal normalization
- [x] 2B. Add oracle auto-refresh + staleness flags
- [x] 2C. Fix strategy recommendation matching (address-based)
- [x] 2D. Fix `.env.local` port mismatch

### Batch 3: Wire Real Proofs
- [x] 3A. Wire `circuit_scanner` into zkML gate
- [x] 3B. Add `data_quality` flags to all mock/fallback responses
- [x] 3C. Fix bare `except:` clauses in 4 services

### Batch 4: Persist In-Memory State
- [x] 4A. Persist autonomous agent state to JSON
- [x] 4B. Persist reputation/staking data to JSON (JsonStore → backend/data/)
- [x] 4C. Persist session key grants to JSON

### Batch 5: Frontend API Layer
- [x] 5A. Extract unified `apiClient.ts` (apiFetch + migrated 6 data-loading files)
- [x] 5B. Wire BrainVisualizer to `/scan` endpoint
- [x] 5C. Build limit order create form
- [x] 5D. Add staking exit-action UI

### Batch 6: UI/UX Improvements
- [x] 6A. Consolidate loading/error states (Spinner.tsx + ErrorAlert.tsx)
- [x] 6B. Add global pending-tx tracker (usePendingTx.ts)
- [x] 6C. Fix activity feed reconciliation
- [x] 6D. Reduce aggressive polling intervals (useVisibilityPolling, 14 files migrated)
- [x] 6E. Fix localStorage polling → event listener (storageSync.ts + StorageEvent)

### Batch 7: Verify + Document
- [x] Full `next build` pass — 0 errors, all 11 pages generated
- [x] Backend endpoint smoke tests — reputation, staking, market-surface OK
- [x] Update documentation

---

## Detailed Fix Log

Each batch has its own section file in this folder:
- `BATCH_1_SECURITY.md`
- `BATCH_2_DATA_INTEGRITY.md`
- `BATCH_3_REAL_PROOFS.md`
- `BATCH_4_STATE_PERSISTENCE.md`
- `BATCH_5_FRONTEND_API.md`
- `BATCH_6_UI_UX.md`
- `BATCH_7_VERIFICATION.md`

---

## Addendum (Mar 1, 2026): Standalone Market-Maker Simulator for Sepolia

### Gaps identified in integration concept
- Missing standalone control plane for synthetic market activity (admin/public split)
- No explicit black-swan simulation hooks (depeg/liquidity-drain events)
- No transparent public board for simulated activity
- No dedicated frontend entry point exposing simulation state to users
- No isolated repo boundary for sepolia-only simulation development

### Implemented baseline
- Added standalone module at `market-maker-sim/`
- Added FastAPI control surface with live simulation engine and websocket stream
- Added admin dashboard (`/dashboard/admin`) for peg updates, bot toggles, manual trades, and scenario triggers
- Added public dashboard (`/dashboard/public`) for transparent observer view
- Added Cairo stubs for synthetic token + controller patterns in `market-maker-sim/contracts/src/`
- Added frontend integration page at `frontend/src/app/mvp/simulator/page.tsx`
- Added MVP nav link to simulator route from `frontend/src/app/mvp/page.tsx`

### Scope boundaries
- This is simulation-only for alpha behavior testing and agent training signals.
- Permissioned/volume-based user access to admin controls is deferred (later scope).
- Real Ekubo pool creation and on-chain mint/burn execution remain integration milestones after this baseline.
