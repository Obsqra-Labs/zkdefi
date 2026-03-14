# Tests

Integration and E2E tests for zkde.fi.

## Running

```bash
# From repo root
pytest tests/ -v

# Specific test
pytest tests/test_e2e_proof_pipeline.py -v
```

## Test Categories

| Test | What it covers |
|---|---|
| `test_e2e_proof_pipeline.py` | Full proof generation → verification pipeline |
| `test_full_e2e.py` | End-to-end system integration |
| `test_agent_identity_system.py` | Agent identity + proof-gated actions |
| `test_model_marketplace.py` | EZKL model registry + marketplace |
| `test_risk_passport_api.py` | Risk passport API endpoints |
| `test_poseidon_enforcement.py` | Poseidon hash integrity checks |
| `test_policy_engine.py` | Policy engine rules |
| `test_dex_smoke.py` | DEX integration smoke tests |
| `e2e_test_suite.py` | Comprehensive E2E suite |

Backend-specific unit tests are in `backend/tests/`.
