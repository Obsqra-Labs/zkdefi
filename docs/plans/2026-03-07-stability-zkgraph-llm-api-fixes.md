# Stability: zkgraph, LLM Access, and API Error Fixes

**Date:** 2026-03-07  
**Context:** User-reported zkgraph crashes, 422/500/502 API errors, React #31 crash, and request to give the system access to LLM providers.

---

## 1. Summary of issues and fixes

| Issue | Root cause | Fix |
|-------|------------|-----|
| **POST /api/v1/zkdefi/skills/screen/opportunity → 422** | Request body not parsed as JSON when `Content-Type: application/json` was missing. | `apiFetch` now sets `Content-Type: application/json` for POST/PUT/PATCH when `body` is a string; retry uses `mergedInit`. |
| **POST /api/v1/strategies/recommend → 422** | Backend only accepted `risk_profile` in `["conservative","balanced","aggressive"]`; UI sometimes sends `"moderate"`. | `StrategyRecommendationRequest` validator maps `"moderate"` → `"balanced"` and accepts it. |
| **React error #31 (object with keys source, type, queue_size, total_batches, pending, completed, failed)** | A stream or API-derived value was rendered as a React child (object). | `StreamCard` uses `toDisplayString()` for `title`, `subtitle`, `source`, `venue`, and numeric `composite_score` so objects are never rendered as children. |
| **502 on many GETs** | Backend or upstream (zkgraph, reputation, rebalancer, etc.) unreachable or failing. | See §2 (env and LLM/zkgraph access). |
| **zkgraph “crashes”** | zkgraph router is optional; external zkRAG at `OBSQRA_PROVER_API_URL` may be down or `ZKGRAPH_ENABLED` not set. | See §2. |
| **LLM provider access** | `LLMEngine` and agent flows need `OPENAI_API_KEY`; optional `LOCAL_LLM_URL` / `LOCAL_LLM_KEY` for local LLM. | See §2. |

---

## 2. zkgraph and LLM provider access

### 2.1 zkgraph (zkRAG)

- **Backend:** `ZkGraphClient` in `backend/app/services/zkgraph_client.py` is optional. Router is loaded via `_optional_router("app.api.routes.zkgraph")` and mounted at `/api/v1/zkdefi/zkgraph`.
- **Env:**
  - `ZKGRAPH_ENABLED=true` — must be set for zkgraph routes to be registered.
  - `OBSQRA_PROVER_API_URL` — base URL for zkRAG API (default `http://localhost:8002/api/v1`). If this service is down or wrong, health and agent/query routes can 502 or fail.
- **To give “access”:** Ensure the zkRAG service is running and reachable at `OBSQRA_PROVER_API_URL`, and set `ZKGRAPH_ENABLED=true` in the environment where the backend runs.

### 2.2 LLM providers

- **OpenAI (primary):** Used by `LLMEngine` (`backend/app/services/llm_engine.py`), strategy recommendation, narration, and agent orchestration.
  - **Env:** `OPENAI_API_KEY` must be set for real LLM calls; otherwise code falls back to deterministic behaviour.
- **LLM provider registry:** `backend/app/services/llm_provider_registry.py` registers OpenAI-compatible and local providers.
  - **Env (optional):** `LOCAL_LLM_URL` (e.g. `http://localhost:11434/v1` for Ollama), `LOCAL_LLM_MODEL`, `LOCAL_LLM_KEY`.
- **To give “access”:** Set `OPENAI_API_KEY` in the backend environment. For local LLM, set `LOCAL_LLM_URL` (and optionally `LOCAL_LLM_MODEL` / `LOCAL_LLM_KEY`). No code change required; configuration only.

### 2.3 502 mitigation

- **502 Bad Gateway** usually means the server acting as gateway got an invalid response from an upstream (e.g. zkRAG, or the main app crashing).
- **Checks:**
  1. Backend process healthy and listening.
  2. If using zkgraph: zkRAG service at `OBSQRA_PROVER_API_URL` up and `ZKGRAPH_ENABLED=true`.
  3. Env for LLM and other optional services correct so that routes do not crash when calling them.
- **Graceful degradation:** Existing code already uses optional routers and fallbacks (e.g. deterministic strategy when LLM unavailable). Ensuring env is set and upstreams reachable reduces 502s.

---

## 3. Implemented code changes

1. **frontend/src/lib/api/client.ts**  
   - Retry to canonical origin now uses `mergedInit` (so `Content-Type: application/json` is preserved on retry).

2. **backend/app/api/routes/strategies.py**  
   - `StrategyRecommendationRequest.validate_profile` normalises `"moderate"` to `"balanced"` and accepts it.

3. **frontend/src/components/zkdefi/mission-control/StreamCard.tsx**  
   - Added `toDisplayString(v)` to coerce any value to a string for display.
   - `item.title`, `item.subtitle`, `item.source`, `item.venue` rendered via `toDisplayString`; `composite_score` only rendered when a number.

4. **backend/app/api/routes/receipts.py**  
   - Added `GET ""` (`list_receipts`): optional query params `address`, `type`, `adapter`. Returns `[]` when `address` is missing/empty; otherwise returns list from `get_user_receipts(address)` with optional filters. Stops 404 from frontend `ReceiptService.getReceipts()` and TradeDesk. Frontend already passes `address` in filters when available.

---

## 4. Acceptance

- **screen/opportunity:** POST with JSON body returns 200 (or non-422 error) when skills backend is up; no 422 due to missing Content-Type.
- **strategies/recommend:** POST with `risk_profile: "moderate"` returns 200 and same behaviour as `"balanced"`.
- **React:** No “Objects are not valid as a React child” from stream items when API returns object-shaped fields.
- **zkgraph/LLM:** With correct env (`ZKGRAPH_ENABLED`, `OBSQRA_PROVER_API_URL`, `OPENAI_API_KEY`), zkgraph and LLM-backed routes respond; 502s from these paths reduced.

---

## 5. Follow-up (optional)

- **shielded_deposit 500:** Separate investigation; likely server-side exception in full_privacy or related route (logs + stack trace).
- **React #31 elsewhere:** If the same error appears in another component, apply the same pattern: never render API/state objects directly; use `toDisplayString()` or explicit primitive fields.
- **Centralise `toDisplayString`:** Move to a small `lib/display.ts` (or similar) and reuse in any component that displays API-derived values.

---

## 6. Run backend and verify (items 1–4)

1. **Start backend:** From repo root, `cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8003` (or use `backend/start.sh`). Ensure the process is the one that includes the latest code (receipts + ledger routes).
2. **Confirm GET /receipts:** `curl http://localhost:8003/api/v1/zkdefi/receipts` → 200 and JSON array `[]`. With `?address=0x...` → 200 and array (empty or with items). This removes receipts 404 and "Failed to refresh receipts" when the UI points at this backend.
3. **Ledger/notes:** `curl http://localhost:8003/api/v1/zkdefi/ledger/notes/0x...` → 200. If you see 404 in production, the deployed backend may be an older build; redeploy so the app that mounts the ledger router is live.
4. **502/500 hardening:** For `POST /api/v1/zkdefi/orchestration/deploy`, add a catch-all so upstream failures return 503 instead of 500: in `backend/app/api/routes/orchestration.py`, after the `except ValueError` block add `except Exception: raise HTTPException(status_code=503, detail="Deploy temporarily unavailable.")`. zkML `risk_score` already returns HTTPException(500) on failure; optional: return 503 with a generic message to avoid leaking internals.
