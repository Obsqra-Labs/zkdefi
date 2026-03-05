# Ekubo Sepolia: Pool Data Sources

**Goal:** Find a real source of pool params (fee, tick_spacing, extension) for Ekubo Sepolia.

## 1. Ekubo API

Endpoints: GET /pair/{chainId}/{tokenA}/{tokenB}/pools. OpenAPI: https://prod-api.ekubo.org/openapi.json. chainId: hex or decimal string for pair/pools; some endpoints use integer (int64 max 9.2e18). Starknet Sepolia hex: 0x534e5f5345504f4c4941; decimal exceeds int64. **Observed:** API returns 500 for Sepolia pair/pools and overview/pairs (hex or decimal). Check indexer .env.sepolia or Ekubo Discord #devs for correct chain id.

## 2. On-chain: Ekubo Core (implemented)

**Implemented in:** `backend/app/services/ekubo_execution_service.py`.

- **Core address (Sepolia):** `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384`.
- **View:** `get_pool_price(pool_key: PoolKey) -> PoolPrice` (selector from `starknet_py.hash.selector.get_selector_from_name("get_pool_price")`).
- **PoolKey** (from EkuboProtocol/starknet-contracts `src/types/keys.cairo`): `token0`, `token1`, `fee` (u128, 0.05% = 0.0005*2^128), `tick_spacing`, `extension` (ContractAddress; use 0).
- **PoolPrice:** `sqrt_ratio` (u256), `tick` (i129). Non-zero `sqrt_ratio` means pool is initialized.
- **Discovery:** When Ekubo API fails, we call Core via `starknet_call` for (fee_pct, tick_spacing) combos `(0.0005, 1000)`, `(0.003, 60)`, `(0.01, 60)`; use first pool where `get_pool_price` returns non-zero sqrt_ratio. Then build Router.swap calldata with that pool.
- **Docs:** https://docs.ekubo.org/integration-guides/reference/reading-pool-price.

## 3. Manual

app.ekubo.org on Starknet Sepolia — URL for new position/swap includes fee and tickSpacing for live pools.

## 4. Our docs

EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md §3.1–3.2, EKUBO_SEPOLIA_INTEGRATION_SCOPE.md.
