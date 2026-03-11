# API overview

**Last updated:** 2026-03-10

## Base URL and OpenAPI

Production: https://zkde.fi/api (when proxied). Local: http://localhost:8003.

OpenAPI UI: {base}/docs. All endpoints and schemas: see OpenAPI.

## API areas

| Prefix | Description |
|--------|-------------|
| /api/v1/zkdefi | Agent, rebalancer, session keys, oracle, reputation, relayer, risk passport, full_privacy, dex, ekubo, onboarding, proofs, mc, ledger, vault, trade-desk, receipts, and more. |
| /api/v1/zkdefi/zkml | zkML risk, anomaly, combined. |
| /api/v1/zkdefi/session_keys | Grant/revoke/list session keys. |
| /api/v1/zkdefi/rebalancer | Propose, check, execute; autonomous. |
| /api/v1/zkdefi/full_privacy | Deposit commitment, register; withdraw proof. |
| /api/v1/zkdefi/mc | Rebalance-mode, stream. |
| /api/v1/zkdefi/trade-desk | Trade desk v2 opportunities, execute. |
| /api/v2/vault | Vault v2. |
| /api/v1/dao | DAO governance. |
| /api/v1/identity | Identity. |
| /api/v1/agents | Agents, marketplace. |
| /api/v1/strategies | Strategies; /api/v2/strategies legacy. |
| /api/v1/deployments | Deployments. |
| /api/v1/vault | Vault execute, compat. |

Routers from backend/app/main.py via _optional_router; some may be absent.

## Quick reference

Reputation: REPUTATION_PROOF_API.md. Full list and schemas: OpenAPI at {base}/docs. Key endpoints: PRODUCT_AND_MVP.md §8.
