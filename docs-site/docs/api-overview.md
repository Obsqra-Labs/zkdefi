# API overview

The zkde.fi backend is available at **https://zkde.fi**. Use it for health checks, contract addresses, reputation, risk passport, orchestration (Deploy to Ekubo), and more.

## Base URLs

- **App and API:** `https://zkde.fi`
- **zkdefi routes:** `https://zkde.fi/api/v1/zkdefi`

## Health check

```bash
curl https://zkde.fi/health
```

## Route groups

| Group | Prefix / Path | Purpose |
|-------|----------------|---------|
| Health | GET /health | Liveness |
| Contracts | GET /api/v1/zkdefi/contracts | Contract addresses |
| Reputation | /api/v1/zkdefi/reputation/* | Tiers, user, staking |
| Risk Passport | /api/v1/zkdefi/risk_passport/* | User/pool passport |
| Compliance | /api/v1/zkdefi/compliance/profiles/{address} | Compliance profiles |
| Orchestration | /api/v1/zkdefi/orchestration/deploy, receipt | Deploy to Ekubo, receipt |
| Full Privacy | /api/v1/zkdefi/full_privacy/* | Deposit/withdraw, merkle |
| zkML | /api/v1/zkdefi/zkml/* | risk_score, anomaly, combined |
| Rebalancer | /api/v1/zkdefi/rebalancer/* | Propose, check, execute |
| Session keys | /api/v1/zkdefi/session_keys/* | Grant, revoke, list |
| Relayer | /api/v1/zkdefi/relayer/* | Request, execute |
| Onboarding | /api/v1/zkdefi/onboarding/* | Status, submit |
| Linked addresses | /api/v1/zkdefi/linked_addresses/* | GET/PUT |
| DEX / Ekubo | /api/v1/zkdefi/dex/*, /ekubo/* | Quotes, swap, positions |

## Example requests

```bash
curl https://zkde.fi/health
curl https://zkde.fi/api/v1/zkdefi/contracts
curl https://zkde.fi/api/v1/zkdefi/reputation/tiers
```

Full API reference (OpenAPI) and SDK/CLI docs are planned. See [Developers](/developers) and [Reputation system](/reputation-system), [Risk Passport](/risk-passport) for endpoint details.

Next: [Developers](/developers) | [Reputation system](/reputation-system)
