# Ekubo Sepolia Integration — Scope

**Goal:** Add a DEX so users can trade/swap. Scope the integration before building.

**Existing research:** [EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md](EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md) — Sepolia contracts, API, lock/locked flow, paper vs real swaps, zkML wiring. Use it as the source of truth for addresses, endpoints, and flow.

---

## What we have today

| Piece | Status |
|-------|--------|
| **Pools** | Full-privacy (B/C) + shielded (A); deposit/withdraw; relayer Tier 2/3. |
| **Protocol tabs** | Frontend has "Ekubo" and "JediSwap" in ProtocolPanel / allocation labels. |
| **Oracle** | mainnet_oracle.py pulls Ekubo (mainnet); market_snapshots for TVL/APY. |
| **Agent/rebalancer** | Protocol ids (pools, ekubo, jediswap); rebalance moves allocation between protocols; no swap execution yet. |
| **Ekubo research** | Viability report: Sepolia Core/Router addresses, API (prod-api.ekubo.org), swapping via ICore#lock + locked callback. |

**Implemented:** Ekubo API client (`backend/app/services/ekubo_client.py`), read-only DEX routes (`backend/app/api/routes/dex.py`), quote + swap-calldata endpoints, DEX tab with pairs/TVL/volume and swap UI (`frontend/src/components/zkdefi/DexPanel.tsx`). Phase 2 (paper) was **skipped**; order is Phase 1 then Phase 3.

---

## Scoped phases

### Phase 1: Read-only Ekubo Sepolia (minimal)

**Goal:** Show live Sepolia data (pairs, TVL, volume, prices) and optionally use it in the oracle/rebalancer.

| Deliverable | Detail |
|-------------|--------|
| **Backend** | Ekubo API client for Sepolia: `chainId = SN_SEPOLIA`; endpoints: `/tokens`, `/overview/pairs`, `/pair/.../pools`, `/price/.../history`. Optional: replace or extend mainnet_oracle with Sepolia mode. |
| **Frontend** | Ekubo tab or dashboard: list pairs (from API), TVL, volume; optional simple price chart from `/price/.../history`. No trading yet. |
| **Contracts** | None. Read-only. |

**Effort:** Low. **Dependencies:** None. **Reference:** Viability report §2 (addresses), §3 (API).

---

### Phase 2: Paper trading (simulated swaps)

**Goal:** Users (or agent) can “swap” with simulated execution; positions and PnL in our ledger only.

| Deliverable | Detail |
|-------------|--------|
| **Backend** | Paper swap API: e.g. `POST /api/v1/zkdefi/dex/paper-swap` (tokenIn, tokenOut, amountIn, optional limit). Quote via Ekubo API (or simple price + slippage); persist fill in DB; maintain per-user paper balances. Optional: performance (PnL, Sharpe, drawdown). |
| **Frontend** | Swap UI: pair selector (from Ekubo Sepolia pairs), amount, “Paper” mode; show quote and confirm; update “portfolio” from paper ledger. |
| **zkML** | Optional: rebalancer or marketplace processor outputs “swap intent”; backend executes as paper swap. |

**Effort:** Medium. **Dependencies:** Phase 1 (or at least Ekubo API client for Sepolia). **Reference:** Viability report §4 (paper trading), §6–7 (zkML + swap).

---

### Phase 3: Real swaps on Sepolia

**Goal:** One-click (or agent) swap that sends a real tx to Ekubo Sepolia.

| Deliverable | Detail |
|-------------|--------|
| **Routing** | Use Ekubo API `/pair/.../pools` to get route (tokenIn → tokenOut, pool list). Optional: simple router (single pool or known route). |
| **Execution** | **Option A:** Call existing Ekubo Router (e.g. V3.0.13) if it exposes a swap entrypoint we can invoke with user/agent account. **Option B:** Our Cairo contract implements `locked`; we call Core#lock; in callback we do approve + swap. |
| **Backend** | Build calldata (route + amounts + slippage); optional endpoint `POST /api/v1/zkdefi/dex/quote` and `.../dex/swap-calldata` for frontend to sign and submit. |
| **Frontend** | Same swap UI with “Live” mode: sign tx (Router or our adapter); show tx link (Starkscan Sepolia). |
| **Session key / agent** | If agent executes: session key allows “ekubo”; agent calls Router (or our contract); proof-gated unchanged. |

**Effort:** Medium–High. **Dependencies:** Phase 1; Phase 2 optional but recommended for UX. **Reference:** Viability report §2.2 (Sepolia addresses), §2.3 (lock/locked), §5 (real swaps).

---

## Out of scope (for now)

- **Phase 2 (paper trading):** Simulated swaps and paper ledger are **not** part of this integration; we go straight from read-only to real swaps.
- **Privacy-preserving swap:** Swap is public (tokenIn, tokenOut, amount, user). Hiding swap with pool/relayer is a later design.
- **JediSwap Sepolia:** Scope is Ekubo only; JediSwap can be added later with a similar phase plan.
- **Mainnet:** All of the above is Sepolia-first; mainnet DEX is a separate scope.

---

## Suggested order (this integration)

1. **Phase 1** — Ekubo Sepolia client + read-only data in UI (and optional oracle). Validates API and chainId; no wallet or tx.
2. **Phase 3** — Real swap via Router (or our lock contract); swap UI with sign and submit; optional agent execution. **(Phase 2 paper trading skipped.)**

**Phase 2 (paper trading) is out of scope** for this integration.

---

## Contract addresses (Sepolia, from viability report)

| Contract | Address |
|----------|---------|
| Core | `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384` |
| Router V3.0.13 | `0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763` |
| Positions | `0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5` |
| Token Registry V3 | `0x04484f91f0d2482bad844471ca8dc8e846d3a0211792322e72f21f0f44be63e5` |

**API:** `https://prod-api.ekubo.org` (use `chainId` for Starknet Sepolia in paths/queries).

---

## Summary

| Phase | What | Effort |
|-------|------|--------|
| 1 | Read-only Ekubo Sepolia (API client, pairs/TVL/prices in UI) | Low |
| 2 | Paper trading (simulated swaps, ledger, PnL, swap UI) | Medium |
| 3 | Real swaps (Router or lock contract, calldata, Live mode) | Medium–High |

We have pools; this integration is scoped as: **read-only first** (Phase 1), then **real swaps** (Phase 3). Phase 2 (paper) is skipped. Set `EKUBO_CHAIN_ID` in backend env for Starknet Sepolia when using pair/price/quote/swap-calldata endpoints.
