# Stone prover API (zkde.fi)

zkde.fi uses the Obsqra Stone prover at **starknet.obsqra.fi** for cloud STARK proof generation (onboarding, credit proofs). Backend is reachable via nginx.

## Base URL

- Default: `https://starknet.obsqra.fi/api/v1`
- Override: `OBSQRA_PROVER_URL` or `OBSQRA_PROVER_API_URL` (env)

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| **GET** | `{base}/` | **Liveness** — returns 200 when API is up |
| **POST** | `{base}/proofs/generate` | **Stone proof generation** — request body: `jediswap_metrics`, `ekubo_metrics` (see onboarding route) |

## Liveness check

```bash
curl -s -o /dev/null -w "%{http_code}" https://starknet.obsqra.fi/api/v1
# 200 = API up; 502/5xx = gateway/backend down
```

## Proof generation

Used by onboarding (`/api/v1/zkdefi/onboarding/generate_authorization`). Payload shape: `jediswap_metrics`, `ekubo_metrics`. Long-running (2–3 min); backend uses 300s timeout and falls back to deterministic hash on 5xx or timeout.
