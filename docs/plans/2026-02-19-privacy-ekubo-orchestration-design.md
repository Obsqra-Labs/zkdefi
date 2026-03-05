# Privacy → Ekubo Orchestration Design

**Date:** 2026-02-19  
**By:** Obsqra Labs (zkde.fi)  
**Status:** Design (Sections 1–4); implementation not started.

---

## 1. Architecture (approved)

- **Privacy:** Existing Full Privacy pool (note-unlinkable deposit/withdraw; Merkle + Garaga SNARK; root synced on-chain).
- **New layer:** Orchestration — “deployable balance” (personal v1 = one user’s notes; shared = aggregate + ledger, **designed but not built**) → calls existing **strategies** + **vault_execute** with **Ekubo Sepolia** as the only target → records **compliance proofs** (risk, anomaly, allocation).
- **Agent:** Existing rebalancer/autonomous decides *when*; orchestration decides *where/how* (Ekubo only) and attaches proofs.
- **Personal v1:** One user’s balance → recommend → execute to Ekubo → record proofs. **Shared:** Same flow over aggregate + ledger; Phase 2.
- **Design both, build one:** Single design covers personal and shared; we implement **personal** first and document shared as “not yet built.”

---

## 2. Ekubo Sepolia: What We Use (realistic methods)

Grounded in [EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md](../EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md), [EKUBO_SEPOLIA_INTEGRATION_SCOPE.md](../EKUBO_SEPOLIA_INTEGRATION_SCOPE.md), [EKUBO_YIELD_DEX_LOWDOWN.md](../EKUBO_YIELD_DEX_LOWDOWN.md), and existing `ekubo_client.py` / `ekubo_executor.py` / `dex.py`.

### 2.1 Contracts (Sepolia)

| Contract        | Address (Sepolia) |
|----------------|-------------------|
| Core           | `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384` |
| Router V3.0.13 | `0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763` |
| Positions      | `0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5` |
| Token Registry V3 | `0x04484f91f0d2482bad844471ca8dc8e846d3a0211792322e72f21f0f44be63e5` |

**Official docs:** [Starknet contracts](https://docs.ekubo.org/integration-guides/reference/starknet-contracts), [Swapping](https://docs.ekubo.org/integration-guides/swapping), [Add liquidity](https://docs.ekubo.org/user-guides/add-liquidity).

### 2.2 API (prod-api.ekubo.org)

- **Base:** `https://prod-api.ekubo.org`; use `chainId` for Starknet Sepolia in paths/queries (`EKUBO_CHAIN_ID` in env).
- **Endpoints we use:**
  - `GET /tokens`, `GET /tokens/{chainId}/{tokenAddress}` — tokens, `usd_price`.
  - `GET /overview/pairs?chainId=...&minTvlUsd=...` — pairs, TVL, volume (no price field; we derive price from token `usd_price` or TVL ratio per EKUBO_YIELD_DEX_LOWDOWN).
  - `GET /pair/{chainId}/{tokenA}/{tokenB}/pools` — pools for routing and LP pool choice.
  - `GET /price/{chainId}/{base}/{quote}/history` — VWAP price history for quotes and simulation.
  - `GET /pools/{chainId}/{coreAddress}/.../liquidity` — per-tick liquidity when needed for routing/simulation.

**Existing code:** `backend/app/services/ekubo_client.py` (all above); `backend/app/api/routes/dex.py` (tokens, pairs, quote, swap-calldata).

### 2.3 Swaps (realistic method)

- **Pattern:** Call **Core#lock** with calldata; Core calls back **IYourContract#locked**; in callback execute swap(s), pay input, withdraw output. Multiple swaps in one callback allowed.
- **Routing:** Integrator responsibility. We use API `/pair/.../pools` to get pool list and pick route; no built-in aggregator.
- **Options:** (A) Our Cairo contract implements `locked` and performs approve + swap. (B) Call existing **Router V3.0.13** if it exposes a swap entrypoint that does lock + callback internally.
- **Orchestration:** For personal v1, agent/orchestration builds route + amounts; execution goes through Router (or our lock contract); session key / proof-gated unchanged.

### 2.4 LP (add liquidity / positions)

- **Positions contract:** LP is created via **Positions** (mint/deposit); fee collection and liquidity removal via Core/Router (per docs and `ekubo_executor.py`).
- **Parameters:** Token pair, fee tier, tick spacing (~2× fee), price range (lower_tick, upper_tick), amounts.
- **Sepolia:** Same Core/Positions addresses; no STRK incentives (mainnet-only); yield = LP fees only (fee share from volume). Fee APY we derive as fees_24h/TVL (or from API where available).
- **Existing code:** `ekubo_executor.py` — `create_lp_position`, `collect_fees`, `remove_liquidity`, `get_position_value`; currently simulated/Mock; design assumes we **wire these to real contract calls** (Positions.mint_and_deposit, Core/Router for collect/remove) using the addresses above.

### 2.5 What’s available on Sepolia (summary)

| Capability        | On Sepolia | How we use it |
|-------------------|------------|----------------|
| Pairs / TVL / volume | Yes (API) | Dashboard, oracle, recommend |
| Token prices       | Yes (`usd_price` or price history) | Quote, fee APY, risk |
| Swap execution     | Yes (Core#lock or Router) | vault_execute / agent execute |
| LP (add/remove/fees) | Yes (Core + Positions) | Orchestration “deploy” = allocate into Ekubo LP when we build it |
| STRK incentives    | No (mainnet only) | N/A; we use fee-based yield only on Sepolia |

---

## 3. Components

| Component | Responsibility |
|-----------|----------------|
| **Orchestration module** | Maps “deployable balance” (personal v1: one user’s notes) → input to strategies; calls strategies/recommend and vault_execute; target = Ekubo Sepolia only; records compliance proofs (risk, anomaly, allocation). |
| **Deployable balance (personal v1)** | Source = user’s Full Privacy pool balance (notes) represented as a single deployable amount (e.g. after conversion to a canonical asset or “max withdrawable” proxy). No shared ledger in v1. |
| **Strategies** | Existing: recommend (risk_profile + amount → allocation, APY, reasoning). Orchestration passes deployable balance as amount; strategy returns allocation (e.g. Ekubo pool/pairs or swap targets). |
| **Vault execute** | Existing: execute allocation (deployments/execute or vault_execute). Orchestration calls with Ekubo-only options; execution uses Ekubo API + Core/Router (swap) or Positions (LP) per §2. |
| **Ekubo config** | Single target: Sepolia. EKUBO_CHAIN_ID, Core/Router/Positions addresses from §2.1; API base from §2.2. No JediSwap or other DEX in orchestration v1. |
| **Proof recording** | Existing receipt/risk-passport and rebalancer proof flow. Orchestration attaches proofs (risk_score, anomaly, allocation proof) to each deploy action for compliance. |

**Shared (designed, not built):** Deployable balance = aggregate of multiple users’ notes + internal ledger; same pipeline (recommend → execute → Ekubo → proofs). Phase 2.

---

## 4. Data flow

1. **User** has notes in Full Privacy pool (deposit/withdraw already private).
2. **Orchestration** derives deployable balance for that user (personal v1).
3. **Orchestration** calls **strategies/recommend** with that amount; gets allocation (Ekubo pools/swaps).
4. **Agent/rebalancer** (existing) may propose when to deploy; **orchestration** performs the “where/how” (Ekubo only).
5. **Orchestration** calls **vault_execute** (or equivalent) with Ekubo-specific calldata (swap via Router or LP via Positions), using **realistic methods** in §2 (API for route/quote, Core#lock or Router for swap, Positions for LP).
6. **Proof recording:** Risk, anomaly, and allocation proofs are stored and linked to the deploy action (existing receipt/passport flow).

---

## 5. Error handling and testing

- **Errors:** API/network failures (Ekubo API, RPC): retry with backoff; surface “Ekubo unavailable” in UI. Contract revert: surface tx failure and do not update deployable balance until confirmed. Proof failure: same as existing rebalancer (no execution if zkML gates fail).
- **Testing:** (1) Unit: orchestration with mock strategies and mock vault_execute; (2) Integration: real Ekubo API (Sepolia) for pairs/prices/quote; (3) E2E: deploy path with testnet (optional real tx or simulated execution depending on env). Reuse existing rebalancer and full-privacy tests where applicable.

---

## 6. References

- [EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md](../EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md)
- [EKUBO_SEPOLIA_INTEGRATION_SCOPE.md](../EKUBO_SEPOLIA_INTEGRATION_SCOPE.md)
- [EKUBO_YIELD_DEX_LOWDOWN.md](../EKUBO_YIELD_DEX_LOWDOWN.md)
- [PROJECT_STATUS.md](../PROJECT_STATUS.md)
- Backend: `ekubo_client.py`, `ekubo_executor.py`, `dex.py`, `strategies`, `vault_execute`, `agent_rebalancer`, `receipt_service`
