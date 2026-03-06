# Gating from Risk Profile

**Date:** 2026-03-02  
**Purpose:** Document how access control and execution gating relate to the Risk Profile bundle. Reputation-based gating is **implemented but not mandatory** — services may resolve tier/onboarding from the Risk Profile when available and fall back to existing sources otherwise.

See also: [docs/plans/2026-03-02-profile-unified-vision.md](plans/2026-03-02-profile-unified-vision.md) (step 5).

---

## 1. Vision: one source of truth

The **Risk Profile** (`GET /api/v1/zkdefi/risk_profile/{address}`) is the composable artifact that aggregates:

- **Reputation** — tier, tenure, collateral, successful_txns
- **Risk passport** — composite score, letter rating, proof_receipts
- **Onboarding** — has_agent, fact_hash, identity_commitment, constraints
- **Linked addresses**, **compliance summary**, **session summary**

Gating (relayer access, constraint checks, execution policy) can use this same object so that:

- Tier for relayer comes from the same place as the profile UI.
- Onboarding and constraints for ConstraintGate match what the profile shows.
- ExecutionGuard policy can be validated or derived from the same profile.

When the risk_profile endpoint is not available (e.g. not yet deployed), services **fall back** to existing data sources so behaviour remains correct.

---

## 2. Current implementation

| Component | Data source today | Role of Risk Profile |
|-----------|--------------------|----------------------|
| **Relayer** | `app.api.reputation.get_user_data(address)` → `tier` | **Reputation gate implemented.** Tier 0 → 403 on relay/deposit/claim. Optional: resolve tier from risk_profile when available (single source); fallback to reputation. |
| **ConstraintGate** | Onboarding state file + vault policy | Uses onboarding (fact_hash, identity_commitment, constraints) and vault policy. No tier. Can optionally be fed onboarding/tier from a Risk Profile service later. |
| **ExecutionGuard** | VaultPolicy only | Cooldown, daily notional, strategy allowlist, etc. No reputation. Policy can remain separate; optional validation against profile when needed. |

---

## 3. Reputation gate (implemented, not mandatory)

- **Relayer** enforces tier for withdraw/deposit/claim: Tier 0 cannot use relayer (403). Tier is resolved via `_get_user_tier(address)`.
- **Not mandatory** in the sense:
  - We do **not** require the risk_profile endpoint to be deployed. Tier is resolved from reputation when risk_profile is unavailable.
  - When risk_profile is available, we **optionally** resolve tier from it first so relayer and profile UI share one source of truth.
- Bypass: relayer has no dev bypass for tier; ConstraintGate has a bypass list for onboarding. So reputation gate stays enforced; only the *source* of tier is optional (profile vs reputation).

---

## 4. Optional: resolve tier from Risk Profile

In `app.api.relayer`, `_get_user_tier(address)`:

1. Optionally try to get tier from the Risk Profile bundle (same app, internal request or shared service).
2. If that fails or risk_profile is not deployed, use existing `get_user_data(address)` from reputation.

This keeps relayer working everywhere while allowing a single source of truth when the profile API is available.

---

## 5. References

- [docs/plans/2026-03-02-profile-unified-vision.md](plans/2026-03-02-profile-unified-vision.md) — step 5 (gating from profile)
- [docs/SRC_8004_ALIGNMENT.md](SRC_8004_ALIGNMENT.md) — on-chain registries
- [docs/PROFILE_REFACTOR_PLAN.md](PROFILE_REFACTOR_PLAN.md) — profile UI
