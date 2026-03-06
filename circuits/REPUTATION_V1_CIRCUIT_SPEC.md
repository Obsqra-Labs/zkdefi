# Reputation V1 Circuit Spec Sheet (FICO Pack)

**Last Updated**: March 5, 2026  
**Status**: Specification (implementation-ready)  
**Audience**: Circuit engineers, backend engineers, Cairo contract engineers, product/reputation team

---

## 1. Objective

Define a minimal, portable reputation pack that any trader, agent, lender, or fintech integrator can verify:

1. `SolvencyProof`
2. `RiskPassportTier`
3. `TraderPerformanceProof`
4. `StrategyIntegrity`
5. `ExecutionIntegrity`

This pack implements the reputation pipeline:

`activity -> proof -> fact -> receipt -> reputation`

---

## 2. Stack Mapping (Deterministic + Predictive)

### 2.1 Deterministic proofs (V1 core)

- **Authoring**: Circom
- **Proving**: Groth16 (`snarkjs`)
- **On-chain verification**: Garaga verifier contracts in Cairo
- **Attestation**: `ObsqraFactRegistry` + `ReceiptRegistry`

### 2.2 Predictive proofs (V1.5 extension)

- **Inference**: ONNX model
- **Proving**: EZKL (Halo2/KZG)
- **Bridge**: `ModelBridge.circom` to Groth16/Garaga path
- **Attestation**: same fact/receipt layer

### 2.3 Heavy preprocessing (optional)

- **RISC proofs** for long-horizon feature extraction and cross-chain aggregation
- Output commitments are consumed by deterministic circuits or `ModelBridge`

---

## 3. Standard Interfaces

### 3.1 Canonical circuit metadata

Each circuit MUST publish:

- `circuit_id` (string, stable)
- `version` (semver)
- `curve` (`bn254`)
- `proof_system` (`groth16`)
- `public_signal_schema_version`
- `vk_hash` (hash of verification key)

### 3.2 Canonical proof result payload

```json
{
  "circuit_id": "SolvencyProof",
  "version": "1.0.0",
  "proof_hash": "0x...",
  "fact_hash": "0x...",
  "commitment_hash": "0x...",
  "public_signals": ["..."],
  "claim": {
    "predicate": "assets_gte_liabilities",
    "result": true
  },
  "window": {
    "from_block": 0,
    "to_block": 0
  },
  "zkrag": {
    "fact_hash": "0x...",
    "block_range": "0-0",
    "source_count": 0
  },
  "generated_at": "2026-03-05T00:00:00Z"
}
```

### 3.3 Canonical receipt schema

```json
{
  "receipt_id": "uuid",
  "subject_type": "wallet|agent|protocol",
  "subject_id_hash": "0x...",
  "circuit_id": "ExecutionIntegrity",
  "claim_type": "execution_integrity",
  "claim_value": "pass|fail|tier_2|score_812",
  "threshold_descriptor": "max_slippage_bps=50,max_delay_blocks=3",
  "window_from_block": 0,
  "window_to_block": 0,
  "proof_hash": "0x...",
  "fact_hash": "0x...",
  "zkrag_fact_hash": "0x...",
  "created_at": "2026-03-05T00:00:00Z"
}
```

### 3.4 Reputation update rule (reference)

For a subject `s` and metric family `m`:

`rep[s,m,t] = decay * rep[s,m,t-1] + weight(circuit_id, claim_value, confidence) * receipt_valid`

Where:

- `decay` default: `0.985` per 24h
- `receipt_valid` is 1 only if proof + fact verification pass
- negative events are represented by negative weights

---

## 4. V1 Core Circuit Specifications

### 4.1 SolvencyProof (deterministic)

**Claim**: `total_assets >= total_liabilities`

**Private inputs**

- `asset_positions[N]` (scaled integers)
- `debt_positions[M]` (scaled integers)
- `pricing_commitment` (commitment to pricing source snapshot)
- `blinding`

**Public inputs**

- `min_solvency_ratio_bps` (default `10000`)
- `scale` (default `10000`)
- `subject_id_hash`
- `commitment_hash`

**Public outputs/signals**

- `is_solvent` (`0|1`)
- `solvency_ratio_bps_bucket` (coarse bucket, optional)

**Core constraints**

- `sum_assets = Σ asset_positions[i]`
- `sum_liabilities = Σ debt_positions[j]`
- `solvency_ratio_bps = (sum_assets * scale) / max(1, sum_liabilities)`
- enforce `solvency_ratio_bps >= min_solvency_ratio_bps`

**Receipt mapping**

- `claim_type = "solvency"`
- `claim_value = "pass|fail"`

---

### 4.2 RiskPassportTier (deterministic)

**Claim**: Wallet risk posture falls into a verifiable tier.

**Private inputs**

- `volatility_bps`
- `max_drawdown_bps`
- `concentration_bps`
- `effective_leverage_bps`
- `liquidation_events_lookback`
- `tenure_days`
- `blinding`

**Public inputs**

- `tier_thresholds[5]` (policy table hash may also be used)
- `scale`
- `subject_id_hash`
- `policy_hash`

**Public outputs/signals**

- `risk_tier` (`1..5`)
- `is_within_required_tier` (`0|1`) for caller-provided requirement

**Core constraints**

- Weighted deterministic score (integer arithmetic only)
- Tier lookup via threshold comparisons
- Optional compliance gate: `risk_tier <= required_tier`

**Receipt mapping**

- `claim_type = "risk_passport"`
- `claim_value = "tier_1|tier_2|...|tier_5"`

---

### 4.3 TraderPerformanceProof (deterministic composite)

**Claim**: Trader meets performance thresholds over a fixed lookback window.

**Private inputs**

- `returns_bps[T]` (e.g., `T=30` daily values)
- `wins_count`
- `trades_count`
- `equity_curve[T]`
- `risk_free_bps`
- `blinding`

**Public inputs**

- `min_sharpe_x100` (e.g., `150` => `1.50`)
- `max_drawdown_bps`
- `min_win_rate_bps`
- `lookback_days`
- `subject_id_hash`

**Public outputs/signals**

- `meets_sharpe` (`0|1`)
- `meets_drawdown` (`0|1`)
- `meets_win_rate` (`0|1`)
- `performance_pass` (`0|1`)
- `performance_tier_bucket` (optional)

**Core constraints**

- Integer Sharpe approximation:
  - `mean_return_bps`
  - `stddev_proxy_bps` (witness-supplied with consistency checks)
  - `sharpe_x100 = (mean_excess_return * 100) / max(1, stddev_proxy)`
- Drawdown bound from `equity_curve`
- Win-rate bound: `(wins_count * scale) / max(1, trades_count)`

**Receipt mapping**

- `claim_type = "performance"`
- `claim_value = "pass|fail|tier_k"`

---

### 4.4 StrategyIntegrity (deterministic)

**Claim**: A strategy execution sequence complied with mandate constraints.

**Private inputs**

- `position_weights_bps[K]`
- `effective_leverage_bps`
- `observed_slippage_bps[L]`
- `asset_exposures_bps[K]`
- `blinding`

**Public inputs**

- `max_position_weight_bps`
- `max_leverage_bps`
- `max_slippage_bps`
- `allowlist_policy_hash`
- `subject_id_hash`

**Public outputs/signals**

- `position_ok` (`0|1`)
- `leverage_ok` (`0|1`)
- `slippage_ok` (`0|1`)
- `strategy_compliant` (`0|1`)

**Core constraints**

- `max(position_weights_bps) <= max_position_weight_bps`
- `effective_leverage_bps <= max_leverage_bps`
- `max(observed_slippage_bps) <= max_slippage_bps`
- all mandatory policy checks must be 1

**Receipt mapping**

- `claim_type = "strategy_integrity"`
- `claim_value = "pass|fail"`

---

### 4.5 ExecutionIntegrity (deterministic)

**Claim**: Trade/rebalance execution met fairness and anti-MEV constraints.

**Private inputs**

- `submission_block`
- `inclusion_block`
- `expected_price`
- `actual_price`
- `route_commitment`
- `relay_commitment`
- `blinding`

**Public inputs**

- `max_delay_blocks`
- `max_price_deviation_bps`
- `required_route_policy_hash`
- `subject_id_hash`

**Public outputs/signals**

- `delay_ok` (`0|1`)
- `price_ok` (`0|1`)
- `route_ok` (`0|1`)
- `execution_valid` (`0|1`)

**Core constraints**

- `delay = inclusion_block - submission_block`
- `deviation_bps = abs(actual_price - expected_price) * 10000 / expected_price`
- `delay <= max_delay_blocks`
- `deviation_bps <= max_price_deviation_bps`
- commitments non-zero and policy-bound

**Receipt mapping**

- `claim_type = "execution_integrity"`
- `claim_value = "pass|fail"`

---

## 5. V1.5 Predictive zkML Extension (Recommended)

These are modeled in ONNX, proven via EZKL, then bridged with `ModelBridge`.

| Circuit ID | Type | Public Claim |
|---|---|---|
| `TraderSkillScoreModel` | zkML | `skill_score >= threshold` |
| `RugProbabilityModel` | zkML | `rug_probability <= threshold` |
| `VolatilityForecastModel` | zkML | `predicted_vol_bps <= threshold` |
| `SlippageForecastModel` | zkML | `predicted_slippage_bps <= threshold` |
| `ProtocolSafetyCompositeModel` | zkML | `protocol_risk_score <= threshold` |

**Required public anchors**

- `expected_model_hash`
- `output_bounds`
- `timestamp`
- `model_registry_id` (optional, if using on-chain model registry)

---

## 6. Backend API and Service Contracts

### 6.1 Proposed pipeline methods (`proof_pipeline.py`)

```python
async def generate_solvency_proof(user_address: str, assets: list[int], liabilities: list[int], *, min_ratio_bps: int = 10000) -> dict: ...
async def generate_risk_passport_proof(user_address: str, features: dict[str, int], *, required_tier: int | None = None) -> dict: ...
async def generate_trader_performance_proof(user_address: str, returns_bps: list[int], equity_curve: list[int], wins: int, trades: int, *, thresholds: dict[str, int]) -> dict: ...
async def generate_strategy_integrity_proof(user_address: str, strategy_metrics: dict[str, Any], policy: dict[str, int]) -> dict: ...
async def generate_execution_integrity_proof(user_address: str, execution_metrics: dict[str, int], policy: dict[str, int]) -> dict: ...
```

### 6.2 Proposed API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/zkdefi/reputation/proof/solvency` | Build solvency proof |
| `POST` | `/api/v1/zkdefi/reputation/proof/risk-passport` | Build risk-tier proof |
| `POST` | `/api/v1/zkdefi/reputation/proof/performance` | Build trader performance proof |
| `POST` | `/api/v1/zkdefi/reputation/proof/strategy-integrity` | Build strategy compliance proof |
| `POST` | `/api/v1/zkdefi/reputation/proof/execution-integrity` | Build execution fairness proof |
| `POST` | `/api/v1/zkdefi/reputation/receipt/register` | Register proof-linked receipt |
| `GET` | `/api/v1/zkdefi/reputation/subject/{subject_hash}` | Read aggregated reputation |

---

## 7. Cairo Verifier Interface (Reference)

```cairo
#[starknet::interface]
trait IReputationProofVerifier<TContractState> {
    fn verify_reputation_proof(
        ref self: TContractState,
        circuit_id: felt252,
        proof: Span<felt252>,
        public_inputs_hash: felt252,
        subject_id_hash: felt252
    ) -> bool;
}
```

**Verification flow**

1. Verify Groth16 proof via circuit verifier.
2. Register `fact_hash` in `ObsqraFactRegistry`.
3. Write receipt in `ReceiptRegistry`.
4. Update reputation state/index off-chain and/or on-chain.

---

## 8. Witness Schema Conventions

- All numeric values are integers (fixed-point where required).
- Use explicit scales:
  - bps scale: `10000`
  - percentage scale: `100`
  - sharpe scale: `x100`
- Arrays are fixed-length per circuit version.
- Hashes are field-compatible integers (or hex converted to decimal string for witness files).

Example witness file shape:

```json
{
  "subject_id_hash": "123456789",
  "commitment_hash": "987654321",
  "private_payload": {
    "feature_a": "1000",
    "feature_b": "250"
  },
  "policy": {
    "threshold_a": "500"
  },
  "scale": "10000"
}
```

---

## 9. Test and Acceptance Criteria

A circuit is "V1-ready" only if all pass:

1. Valid witness -> `snarkjs groth16 verify` returns `OK!`
2. Invalid witness (threshold violation) fails proof generation or verification
3. Garaga calldata conversion succeeds
4. Cairo verifier accepts valid proof, rejects tampered public input
5. Fact and receipt registration complete with deterministic IDs
6. Reputation updater applies weight/decay exactly once (idempotent receipt handling)

---

## 10. Rollout Plan

1. **Phase A (Deterministic pack)**: implement and ship all 5 core circuits.
2. **Phase B (Registry integration)**: harden receipt schema + reputation update jobs.
3. **Phase C (zkML extension)**: add 2-3 predictive models via EZKL + `ModelBridge`.
4. **Phase D (Cross-chain/RISC)**: add long-horizon and multi-chain feature proofs.

---

## 11. Compatibility Notes

- Reuse existing artifacts and services where possible:
  - `backend/app/services/proof_pipeline.py`
  - `backend/app/services/zkml/circuit_scanner.py`
  - `circuits/ModelBridge.circom`
  - `ObsqraFactRegistry` / `ReceiptRegistry` integration path
- Maintain backward compatibility by versioning each circuit independently.
- Avoid changing existing public signal ordering in production circuits; treat changes as `v2.0.0`.
