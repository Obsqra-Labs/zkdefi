# Reputation Proofs (FICO Pack)

Zero-knowledge reputation proofs for obsqra.xyz: prove solvency, risk tier, trader performance, strategy integrity, and execution integrity without revealing private data. Proofs are verified on Starknet via Garaga BN254 verifiers and registered in ObsqraFactRegistry.

## Overview

| Proof | Endpoint | Claim |
|-------|----------|--------|
| Solvency | `POST .../reputation/proof/solvency` | total_assets ≥ total_liabilities |
| Risk Passport | `POST .../reputation/proof/risk-passport` | risk_tier ≤ required_tier |
| Trader Performance | `POST .../reputation/proof/performance` | Sharpe, drawdown, win rate within bounds |
| Strategy Integrity | `POST .../reputation/proof/strategy-integrity` | Position, leverage, slippage within policy |
| Execution Integrity | `POST .../reputation/proof/execution-integrity` | Delay and price deviation within bounds |

## Get proof status

**GET** `/api/v1/zkdefi/reputation/proofs/{address}`

Returns status of all five proofs for an address.

**Response:** `address`, `proofs` (array of `{ proof_type, status, generated_at?, proof_hash?, on_chain_verified }`), `tier`, `tier_name`, `total_proofs_complete`.

- `status`: `"complete"` | `"pending"` | `"available"`.
- When `complete`, `generated_at` (Unix s), `proof_hash`, and `on_chain_verified` are set when available.

## Generate proofs

Base URL: `/api/v1/zkdefi/reputation/proof/`

All POST bodies must include `user_address` (hex). Request/response shapes are in the backend OpenAPI spec; summary:

- **solvency**: `asset_positions[]`, `debt_positions[]`, `min_solvency_ratio_bps`.
- **risk-passport**: `volatility_bps`, `max_drawdown_bps`, `concentration_bps`, `effective_leverage_bps`, `liquidation_events`, `tenure_days`, `required_tier` (optional).
- **performance**: `returns_bps` (30), `equity_curve` (30), plus threshold params.
- **strategy-integrity**: `position_weights_bps[]`, `effective_leverage_bps`, `observed_slippage_bps[]`, policy bounds.
- **execution-integrity**: `submission_block`, `inclusion_block`, `expected_price`, `actual_price`, `max_delay_blocks`, `max_price_deviation_bps`.

**Response:** Circuit scan result with `all_pass`, `results[]` (per-circuit success, proof hash, timing).

## Tier upgrade flow

1. Generate required proofs for the target tier (e.g. Risk Passport for Express).
2. Call `POST /api/v1/zkdefi/reputation/upgrade-tier` with `address`, `target_tier`, `upgrade_proof_hash` (placeholder supported for current backend).
3. Backend updates tier; frontend Credit & Reputation Hub reflects the new tier and proof status.

## Contracts (Starknet Sepolia)

- **ObsqraFactRegistry**: `0x02009ab87f581a0a92f65906ce84664a5cfcb86f7266651f48a04fac3c62faa3`
- Verifiers: see [Contracts](/contracts) for SolvencyProofVerifier, RiskPassportTierVerifier, TraderPerformanceVerifier, StrategyIntegrityVerifier, ExecutionIntegrityVerifier addresses.

## Privacy

Proofs use BN254 Poseidon hashing for on-chain verification. Private inputs (positions, returns, etc.) are not sent to the API in plain form for production flows; the backend builds witnesses and runs the circuits. See [Reputation system](/reputation-system) and circuit spec in the repo (`circuits/REPUTATION_V1_CIRCUIT_SPEC.md`).

Next: [API overview](/api-overview) | [Contracts](/contracts) | [Reputation system](/reputation-system)
