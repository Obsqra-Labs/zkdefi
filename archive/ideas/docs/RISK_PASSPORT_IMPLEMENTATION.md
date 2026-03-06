# Risk Passport Phase 1 — Implementation Summary

What was built for user and pool Risk Passport, receipts, and snapshot binding. See [RISK_PASSPORT_PRODUCT_SCOPE.md](RISK_PASSPORT_PRODUCT_SCOPE.md) for scope and [ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md](ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md) for next steps.

---

## 1. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/zkdefi/risk_passport/user/{address}` | User Risk Passport: composite score (0–100), letter (A/B/C/D), tier, credit_tier/credit_score (when identity exists), proof_receipts (newest first, up to 20). Composes reputation + onboarding + identity + receipts. |
| GET | `/api/v1/zkdefi/risk_passport/pool/{pool_id}` | Pool Risk Passport: safe, health_score, factors, proof_receipts, snapshot_hash. Returns "No passport yet" when pool has not been analyzed. |

**Base URL:** Same as backend (e.g. `http://localhost:8003` or production API).

---

## 2. User Passport Response Shape

```json
{
  "composite_score": 72,
  "letter_rating": "B",
  "tier": 1,
  "tier_name": "Standard",
  "credit_tier": "A",
  "credit_score": 650,
  "proof_receipts": [
    {
      "receipt_id": "0x...",
      "user": "0x...",
      "proof_type": "risk_score",
      "threshold_or_model": "30",
      "result": "compliant",
      "timestamp": "2026-02-07T...",
      "snapshot_hash": null,
      "tx_hash": null,
      "fact_hash": null,
      "model_hash": null,
      "pool_id": null,
      "on_chain": false
    }
  ]
}
```

- **composite_score:** Deterministic from tier, tenure_days, total_volume_eth, collateral_eth (formula in `risk_passport.py`).
- **letter_rating:** A ≥80, B ≥60, C ≥40, D &lt;40.
- **credit_tier / credit_score:** Present when user has completed onboarding and identity/credit proof (resolved via onboarding status → identity commitment → identity cache).
- **proof_receipts:** Appended when risk_score proof runs, anomaly (pool_safety) runs, rebalance check passes, or rebalance executes.

---

## 3. Pool Passport Response Shape

When pool has been analyzed (anomaly run):

```json
{
  "pool_id": "pool_1",
  "passport": { "pool_id", "safe", "health_score", "factors", "last_anomaly_result", "timestamp", "snapshot_hash" },
  "safe": true,
  "health_score": 100,
  "factors": {},
  "proof_receipts": [],
  "snapshot_hash": null
}
```

When pool has not been analyzed:

```json
{
  "pool_id": "pool_1",
  "passport": null,
  "safe": null,
  "health_score": null,
  "factors": {},
  "proof_receipts": [],
  "message": "No passport yet. Run anomaly analysis for this pool."
}
```

---

## 4. Receipt Shape (Proof Receipts)

Proof receipts are stored by `ReceiptService.append_proof_receipt()` and returned in user/pool passport and `get_user_receipts` / `get_receipts_by_pool`.

| Field | Type | Description |
|-------|------|-------------|
| receipt_id | string | Unique id (hash of user, proof_type, threshold, result, timestamp). |
| user | string | User address. |
| proof_type | string | `risk_score`, `pool_safety`, `rebalance`. |
| threshold_or_model | string | e.g. "30", "anomaly", proposal_id. |
| result | string | e.g. "compliant", "non_compliant", "safe", "unsafe", "completed". |
| timestamp | string | ISO timestamp. |
| snapshot_hash | string \| null | Optional; Phase 1 often null until oracle bound to zkML. |
| tx_hash | string \| null | Set when rebalance executes (simulated tx hash). |
| fact_hash | string \| null | Optional; for onboarding/STARK proofs. |
| model_hash | string \| null | Optional; circuit/version hash. |
| pool_id | string \| null | Set for pool_safety receipts. |
| on_chain | boolean | Default false. |

---

## 5. Where Receipts Are Appended

| Event | Location | proof_type | Notes |
|-------|----------|------------|-------|
| Risk score proof success | `backend/app/api/zkml.py` (POST /risk_score) | risk_score | After `generate_risk_proof` returns. |
| Anomaly proof success | `backend/app/api/zkml.py` (POST /anomaly) | pool_safety | After `analyze_pool_safety`; also updates pool_passport_store. |
| Rebalance zkML check passes | `backend/app/services/agent_rebalancer.py` (check_zkml_gates) | risk_score + pool_safety | One receipt per proof; pool passport saved. |
| Rebalance execute success | `backend/app/services/agent_rebalancer.py` (execute_rebalance) | rebalance | tx_hash set (simulated). |

---

## 6. Oracle Snapshot Hash

- **File:** `backend/app/services/mainnet_oracle.py`
- **MarketSnapshot:** New field `snapshot_hash`. Computed as `SHA256(timestamp + json(jediswap) + json(ekubo))` first 32 hex chars, prefixed `0x`.
- **to_dict():** Response of `GET /api/v1/zkdefi/oracle/market-data` now includes `snapshot_hash`.
- **from_dict():** Accepts optional `snapshot_hash` when loading persisted snapshots.

Phase 1 zkML does not yet pass snapshot_hash into proofs; receipts often have `snapshot_hash: null`. Binding snapshot_hash to anomaly/risk inputs is a next step (ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md §7.1).

---

## 7. Pool Passport Store

- **File:** `backend/app/services/pool_passport_store.py`
- **save(pool_id, anomaly_result, snapshot_hash=None):** Called from zkml.py after successful anomaly proof. Stores safe, health_score (100 if safe else lower), factors, last_anomaly_result, timestamp.
- **get(pool_id):** Returns stored entry or None. Used by GET /risk_passport/pool/{pool_id}.

In-memory; no persistence across restarts.

---

## 8. Files Touched / Added

| Area | Files |
|------|--------|
| **New** | `backend/app/api/risk_passport.py` (user + pool GET), `backend/app/services/pool_passport_store.py` |
| **Router** | `backend/app/main.py` — include risk_passport router |
| **Receipts** | `backend/app/services/receipt_service.py` — append_proof_receipt, get_receipts_by_pool |
| **Oracle** | `backend/app/services/mainnet_oracle.py` — snapshot_hash on MarketSnapshot; `backend/app/api/oracle.py` — MarketDataResponse.snapshot_hash |
| **zkML** | `backend/app/api/zkml.py` — append_proof_receipt + pool_passport save on risk_score and anomaly success |
| **Rebalancer** | `backend/app/services/agent_rebalancer.py` — append_proof_receipt on check_zkml_gates and execute_rebalance |
| **Profile** | `frontend/src/app/profile/page.tsx` — passport state, fetch, Risk Passport card in Overview |
| **Agent** | `frontend/src/components/zkdefi/AgentRebalancer.tsx` — "Proof verified" line, pool passport in propose modal |
| **Tests** | `tests/test_risk_passport_api.py` — smoke tests via TestClient (health, user/pool passport, oracle snapshot_hash) |

---

## 9. How to Test

- **Health:** `curl -s http://127.0.0.1:8003/api/v1/zkdefi/status`
- **User passport:** `curl -s http://127.0.0.1:8003/api/v1/zkdefi/risk_passport/user/0x123...` (use any Starknet address; may return composite from reputation only if no receipts yet).
- **Pool passport (no data):** `curl -s http://127.0.0.1:8003/api/v1/zkdefi/risk_passport/pool/pool_1` → expect `"passport": null`, `"message": "No passport yet..."`.
- **Pool passport (after anomaly):** Run `POST /api/v1/zkdefi/zkml/anomaly` with pool_id e.g. `pool_1`, then GET pool passport again → expect safe, health_score.
- **Profile:** Open `/profile` with wallet connected; Overview tab should show Risk Passport card (score, letter, tier, receipts or "No passport data yet").
- **Rebalancer:** Propose rebalance → Run zkML Checks → Execute; proposal should show "Proof verified: Executed because risk score passed and pool safe." and Starkscan link when tx_hash present. In propose modal, "Pool passport (To pool)" should load when modal is open.
- **Automated (no live server):** From `zkdefi/backend`: `python3 ../tests/test_risk_passport_api.py` — uses FastAPI TestClient to hit health, user passport, pool passport, and oracle snapshot_hash.
- **Manual UI verification:** See [RISK_PASSPORT_UI_CHECKLIST.md](RISK_PASSPORT_UI_CHECKLIST.md) for pre-release checklist (Profile, Agent/Rebalancer, prerequisites).

---

## 10. What’s Next

See [RISK_PASSPORT_PRODUCT_SCOPE.md](RISK_PASSPORT_PRODUCT_SCOPE.md) “What’s next” table and [ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md](ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md) §7. Short list:

1. **Snapshot binding** — Pass oracle snapshot_hash into zkML requests and into append_proof_receipt so receipts are bound to snapshot.
2. **Proof timeline UX** — Frontend component for receipts with model hash, threshold, snapshot, link; reuse on Profile and Agent.
3. **Policy engine (v1)** — Backend policy_engine for rebalance (risk + anomaly); returns allowed + calldata; rebalancer uses it.
4. **Real execution path** — Execute rebalance via contract/relayer with Garaga calldata; return real tx_hash.
5. **Predictive / yield models** — Risk breach prob, drawdown, pool stress; APY forecast, TVL drift; then IL, depeg, etc.
6. **Privacy UX / concurrency** — Tier badge, visibility warnings, lock or cache for proof generation.
