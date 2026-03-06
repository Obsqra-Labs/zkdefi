# Phase F Complete: ZK Constraint Gate — Onboarding → Vault Pipeline

**Date:** 2026-02-25

## What was built

### 1. `constraint_gate.py` — Central enforcement service
New backend service that loads onboarding constraints (fact_hash, identity_commitment, risk_tolerance, max_position, session_duration, claims) and runs 7 checks before any vault operation:

1. **Onboarding check** — User must have completed onboarding
2. **Identity verification** — fact_hash + identity_commitment + agent_initialized present
3. **Session validity** — elapsed time < session_duration_hours
4. **Profile enforcement** — requested profile cannot exceed onboarded profile (aggressive > balanced > conservative)
5. **Amount enforcement** — requested amount cannot exceed max_position in USD
6. **ZKML risk score** — calls `RiskScoreModel.compute_risk_score()` against tolerance threshold
7. **Vault policy bounds** — checks session_max_notional_usd from vault_policy_service

Returns a `ConstraintVerdict` with `allowed`, `violations[]`, and `attestation_hash` (SHA-256 of the full check).

### 2. Wired into all 3 vault pipeline endpoints
- `POST /strategies/allocate` — gate before AI allocation runs
- `POST /strategies/execute-allocation` — gate before Ekubo LP execution
- `POST /strategies/rebalance` — gate before drift analysis

All three return HTTP 403 with structured `{ error, violations, attestation_hash }` when gate denies.

### 3. `GET /strategies/user-constraints/{address}` — New endpoint
Returns the user's canonical onboarding constraints:
- `onboarded`, `risk_profile`, `risk_tolerance`, `max_position_usd`
- `session_valid`, `identity_verified`, `fact_hash`, `claims`

### 4. Frontend: Pre-populate risk profile from onboarding
- `getUserConstraints()` added to strategies API client
- `VaultDashboardPanel` fetches constraints on mount
- Risk profile selector auto-selects the onboarding profile
- Identity/session status banner shows verification state

## What was learned

### Data Flow Gap (Before)
```
Onboarding → [fact_hash, identity_commitment, risk_tolerance=70, max_position]
                          ↓ stored in onboarding_state.json
                          ↓ vault_policy_service.upsert_from_onboarding()
                          ↓ DEAD END — nothing reads it

Vault Dashboard → user freely picks "conservative" / "balanced" / "aggressive"
                          ↓ sends to /allocate
                          ↓ AI allocation runs unchecked
```

### Data Flow (After)
```
Onboarding → constraints + identity stored
                          ↓
Vault Dashboard → fetches GET /user-constraints/{addr}
                          ↓ pre-populates risk profile
                          ↓ shows identity verification banner
                          ↓
/allocate request → ConstraintGate.check()
                          ↓ loads onboarding state
                          ↓ verifies identity (fact_hash + commitment)
                          ↓ checks session window
                          ↓ enforces profile (can't escalate beyond onboarded level)
                          ↓ validates amount vs max_position
                          ↓ runs ZKML risk score
                          ↓ checks vault policy
                          ↓ returns ConstraintVerdict
                          ↓
                    ✅ allowed → AI allocation runs with canonical profile
                    ❌ denied → 403 with violations + attestation
```

### Key Discoveries
1. **Onboarding state path**: `backend/app/data/onboarding_state.json` (not `backend/data/` — the `__file__` resolution in onboarding.py puts it in `app/data/`)
2. **Risk tolerance mapping**: Onboarding uses ints (30=conservative, 50=neutral, 70=aggressive). Vault pipeline uses strings. The bridge function `tolerance_to_profile()` handles the conversion.
3. **Max position stored as scientific notation**: `"1e+21"` wei — float conversion needed rather than int parsing
4. **In-memory caching**: constraint_gate caches onboarding state on init. It re-reads from disk on cache miss (handles state written after service start).
5. **Session duration is meaningful**: 24h default means the gate expires after 24h and the user must re-authorize

## What it unlocks

1. **Provable AI decisions** — Every allocation now includes a constraint verdict attestation hash. The AI cannot operate outside the user's stated bounds.
2. **ZKML → AI bridge** — The `_check_zkml_risk()` method calls `RiskScoreModel.compute_risk_score()` from the ZKML circuit service. When snarkjs proof generation is wired in, this becomes a full ZK proof that risk score ≤ threshold.
3. **Session-based authorization** — Users re-authorize periodically. Expired sessions block all operations.
4. **Profile downgrade only** — A user who onboarded as "balanced" can request "conservative" but NOT "aggressive". The gate enforces monotonically decreasing risk.
5. **Audit trail** — Every gate check produces an attestation hash. Combined with the allocation attestation, the full pipeline is verifiable.
6. **Frontend identity awareness** — The vault dashboard now shows whether the user is verified, their session status, and their onboarding constraints.

## Files created/modified

| File | Action | Description |
|------|--------|-------------|
| `backend/app/services/constraint_gate.py` | **Created** | 310-line constraint enforcement service |
| `backend/app/api/routes/strategies.py` | Modified | Added gate to /allocate, /execute-allocation, /rebalance + new /user-constraints endpoint |
| `frontend/src/lib/api/strategies.ts` | Modified | Added `getUserConstraints()` + `UserConstraintsResponse` type |
| `frontend/src/components/zkdefi/VaultDashboardPanel.tsx` | Modified | Fetch constraints, pre-populate profile, identity banner |

## Verified

- ✅ `GET /user-constraints/{addr}` → returns onboarded constraints (profile, tolerance, max position, session, claims)
- ✅ `POST /allocate` with expired session → 403 "Session expired"
- ✅ `POST /allocate` with valid session → 200, allocation runs
- ✅ `POST /allocate` with un-onboarded address → 403 "User has not completed onboarding"
- ✅ Frontend builds cleanly (0 TS errors)
- ✅ Agent page returns HTTP 200
