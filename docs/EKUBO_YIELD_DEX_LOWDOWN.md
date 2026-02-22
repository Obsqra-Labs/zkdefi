# Ekubo Yield & DEX Integration — Lowdown

**Scope:** Yield on Ekubo (Sepolia vs mainnet), why pairs don't show price, strategies we have or can add, and what we can integrate or package.

---

## 1. Yield on Ekubo

**Mainnet:** LP fees (share of trading fees per pool) + **Starknet DeFi Spring** STRK incentives. LPs on eligible pairs earn STRK; claim at app.ekubo.org/rewards. No extra action required.

**Sepolia:** No STRK incentives (DeFi Spring is mainnet). **Yield = LP fees only** (fee share from volume). Same API with chainId = Sepolia: pairs, pools, TVL, volume, price history. No dedicated "yield product" API—we surface fee APY ourselves (fees/TVL).

---

## 2. Why Pairs Don't Show Price

**Ekubo API** `GET /overview/pairs` returns token0, token1, volume, TVL—**no price field**. Our DEX tab shows Pair, TVL, 24h Volume only.

**Fix:** (1) **Token usd_price:** `/tokens` returns `usd_price`. Price (token1 per token0) = usd_price_token0 / usd_price_token1. Add Price column using tokens we already load. (2) **Fallback:** TVL ratio tvl1/tvl0. (3) Optional: `/price/{chainId}/{base}/{quote}/history` for latest VWAP (heavier).

---

## 3. Strategies Today

**Rebalancer:** Rebalance between protocols (Ekubo vs JediSwap); no per-pool strategy. **DEX tab:** Swap only; no "strategies" list, no LP UI. So **no Ekubo-specific strategies in UI yet**. We can add: fee APY column, "Top yield" sort, link to Ekubo LP, or "zkde.fi Yield" product (deposit → we LP into chosen pool).

---

## 4. What We Can Do

**A) Integrate existing:** Show Sepolia pairs + TVL + volume + **price** (from token usd_price or TVL ratio). Add **fee APY** column (fees_24h/TVL * 365). Link "Add liquidity" to Ekubo app.

**B) Package yield product:** "zkde.fi Yield: deposit → we allocate into Ekubo pool(s)." Need: pool choice, fee APY from API, deposit path (user approves Core/Positions or our vault). Sepolia for demo; mainnet for real product.

**C) Strategies to add:** (1) Fee APY per pair — low. (2) Sort by yield — low. (3) Rebalancer to move between Ekubo pools — medium. (4) Our vault into Ekubo — high.

---

## 5. Next Steps

1. **DEX tab price:** Type token `usd_price` in frontend; compute pair price = usd_price_0 / usd_price_1; add Price column (fallback: TVL ratio).
2. **Optional:** Fee APY column from fees_24h and TVL.
3. **Strategies:** "Yield" section with link to Ekubo LP; later "zkde.fi Yield" product.
4. **References:** docs.ekubo.org, prod-api.ekubo.org/openapi.json, EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md, ekubo_client.py, dex.py, DexPanel.tsx.
