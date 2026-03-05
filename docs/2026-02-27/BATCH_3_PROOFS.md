# Batch 3: Wire Real Proofs + Data Quality

**Status:** ✅ COMPLETE  
**Date:** 2026-02-27

## Overview

Replaced mock proof fallbacks with real Groth16 circuit proofs, fixed bare `except:` clauses, and corrected a critical circuit input bug.

---

## 3A — Fix Bare `except:` Clauses (4 occurrences)

Bare `except:` silently swallows `KeyboardInterrupt`, `SystemExit`, and masks real bugs.

### Files Changed

| File | Line(s) | Fix |
|------|---------|-----|
| `backend/app/services/zkdefi_agent_service.py` | 2 sites | `except:` → `except Exception as e:` |
| `backend/app/services/orchestrator_client.py` | 1 site | `except:` → `except Exception as e:` |
| `backend/app/services/obsqra_prover_client.py` | 1 site | `except:` → `except Exception as e:` |

---

## 3B — Rewrite `zkml_proof_service.py` with 3-Tier Proof Hierarchy

### Problem
The original proof service always returned mock hashes. Real Groth16 circuits were compiled (WASM + zkey present for all 8 circuits) but never invoked.

### Solution — 3-Tier Fallback

```
Tier 1: Groth16 via circuit_scanner  (real snarkjs proof)
Tier 2: Stone prover via obsqra API  (STARK proof)
Tier 3: Mock hash                    (development fallback)
```

### Key Functions

- **`generate_lp_risk_proof(token_a, token_b, fee_tier, volatility, tvl)`**  
  Uses `build_risk_score_inputs()` → RiskScore circuit → Groth16 proof.  
  Every response includes `proof_mode: "groth16" | "stone" | "mock"`.

- **`generate_rebalance_decision_proof(position_id, current_fee_tier, pool_volatility=0, volume_24h=0, **kwargs)`**  
  Uses AnomalyDetector circuit for rebalance decisions.

### Verification
```
Proof: mode=groth16 approved=True hash=0x67ed72acf85253...
```

---

## 3C — Fix `circuit_scanner.py` RiskScore Bug

### Problem
`build_risk_score_inputs()` set `actual_score = raw_sum` (raw weighted sum), but the circuit constraint requires:
```
actual_score * scale <= computed_score < (actual_score + 1) * scale
```
This meant the constraint always failed for any non-trivial input.

### Fix
```python
# Before (WRONG)
actual_score = raw_sum

# After (CORRECT)
actual_score = raw_sum // scale
```

This ensures `actual_score` is the integer-divided quotient, satisfying the circuit constraint.

---

## 3D — Fix Stone Prover Error Handling

### Problem
When the Obsqra Stone prover API returns a 404 or error, `fact_hash` was `None` but the service treated it as a valid result.

### Fix
Added guard: `if fact_hash:` before returning Stone proof result. If `fact_hash` is `None`, falls through to mock tier.

---

## 3E — Fix `autonomous_rebalancer.py` Signature

Updated the call to `generate_rebalance_decision_proof()` to match the new keyword-arg signature:
```python
proof = await svc.generate_rebalance_decision_proof(
    position_id=position_id,
    current_fee_tier=fee_tier,
    pool_volatility=volatility
)
```

---

## Verification

- All 14 modified backend modules import successfully
- Groth16 proof generated in smoke test: `mode=groth16 approved=True`
- All 8 circuits have WASM + zkey artifacts confirmed
