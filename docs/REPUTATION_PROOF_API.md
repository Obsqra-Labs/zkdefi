# Reputation Proof API

Zero-knowledge reputation proofs (FICO pack) for obsqra.xyz.

## Proof status

`GET /api/v1/zkdefi/reputation/proofs/{address}`

Returns status of all 5 proofs for an address: `complete`, `pending`, or `available`.

## Generate proofs

- `POST /api/v1/zkdefi/reputation/proof/solvency` — assets >= liabilities
- `POST /api/v1/zkdefi/reputation/proof/risk-passport` — risk tier
- `POST /api/v1/zkdefi/reputation/proof/performance` — trader performance
- `POST /api/v1/zkdefi/reputation/proof/strategy-integrity` — strategy constraints
- `POST /api/v1/zkdefi/reputation/proof/execution-integrity` — execution integrity

See backend OpenAPI or `backend/app/api/reputation.py` for request schemas.

## Verifiers (Starknet Sepolia)

From `.env.verifiers`:

- SolvencyProofVerifier, RiskPassportTierVerifier, TraderPerformanceVerifier, StrategyIntegrityVerifier, ExecutionIntegrityVerifier
- FactRegistry: `0x02009ab87f581a0a92f65906ce84664a5cfcb86f7266651f48a04fac3c62faa3`
