# Ekubo + zkde.fi Testnet Demo: Trading, Swaps & zkML Integration — Viability Report

**Date**: 2026-02-07  
**Scope**: Ekubo docs & Sepolia contracts, live testnet data, paper/real trading & swaps, zkML marketplace + automated agent flows.

---

## 1. Executive Summary

| Area | Viability | Depth | Notes |
|------|-----------|--------|--------|
| **Live data from testnet** | ✅ High | Ekubo API + RPC | Tokens, pairs, pools, TVL, volume, price history; Sepolia supported |
| **Paper trading / simulated swaps** | ✅ High | Quote-only + simulated PnL | No lock; use API quotes + local ledger; full performance metrics |
| **Real swaps on Sepolia** | ✅ High | ICore#lock + Router | Deployed Core/Router on Sepolia; routing is integrator’s responsibility |
| **zkML + automated “AI driving”** | ✅ High | Existing rebalancer + marketplace | Risk + anomaly gate; composable processors (credit, correlation, TWAP) + decision logic |
| **zkML marketplace + swap flow** | ✅ Medium–High | New pipeline | Wire “when to swap” to processor outputs; proof-gated execution already in place |

---

## 1.1 Sepolia = Paper Trading; Bot Orders Are the UX

On Sepolia there’s no real money — so in practice **everything is “paper trading”** in spirit. The useful distinction is:

- **Paper (simulated ledger)**  
  Orders never hit the chain. A **bot** (agent or cron) submits “orders” to our backend; we update a local ledger (positions, PnL) using live Sepolia data (e.g. Ekubo API). No gas, no testnet tokens needed; we just need prices and maybe depth to simulate fills.

- **Real testnet (on-chain Sepolia)**  
  Same bot submits orders, but this time we send real txs to Ekubo Sepolia (Core/Router). Still “paper” in the sense of testnet tokens only, but real execution, real liquidity, real on-chain history.

So **“we would just have to bot orders”** is the right framing: the demo is **bot-driven**. The bot can:

1. **Paper-only**: Agent (or scheduled job) decides “swap X for Y”; backend applies it to our ledger using API prices; we show PnL and performance. No chain.
2. **On-chain Sepolia**: Same logic, but we also (or instead) send a real swap tx to Ekubo Sepolia so users see real testnet execution and can inspect it on Voyager/Starkscan.

Recommendation: start with **paper-only bot orders** (simplest: no wallet, no gas, no Router integration). Use Ekubo API for prices and optional depth; bot runs on a schedule or on zkML “go” signal; we track performance in our DB. Add **optional** “submit to Sepolia” later so the same bot can fire real testnet txs for users who want on-chain demo.

---

## 2. Ekubo: Docs & Sepolia Contracts

### 2.1 Official resources

- **Docs**: https://docs.ekubo.org  
- **Swapping**: https://docs.ekubo.org/integration-guides/swapping  
- **Starknet contracts**: https://docs.ekubo.org/integration-guides/reference/starknet-contracts  
- **Reading pool price**: https://docs.ekubo.org/integration-guides/reference/reading-pool-price  
- **API**: https://docs.ekubo.org/integration-guides/reference/ekubo-api  
- **API base**: `https://prod-api.ekubo.org` (OpenAPI: `/openapi.json`)  
- **Starknet router example**: https://github.com/EkuboProtocol/starknet-contracts (e.g. `router.cairo`)  
- **Indexer**: https://github.com/EkuboProtocol/starknet-indexer (`.env.sepolia` → Sepolia indexing)

### 2.2 Sepolia contract addresses (from Ekubo docs)

| Contract | Sepolia address |
|----------|-----------------|
| **Core** | `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384` |
| Positions | `0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5` |
| Positions NFT | `0x04afc78d6fec3b122fc1f60276f074e557749df1a77a93416451be72c435120f` |
| TWAMM Extension | `0x073ec792c33b52d5f96940c2860d512b3884f2127d25e023eb9d44a678e4b971` |
| Oracle Extension | `0x003ccf3ee24638dd5f1a51ceb783e120695f53893f6fd947cc2dcabb3f86dc65` |
| Limit Orders Extension | `0x00c4c863f6de467b91ce974be48cc17ad7209d0d600926e82845a43a7848b822` |
| **Router V3.0.13** | `0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763` |
| Token Registry V3 | `0x04484f91f0d2482bad844471ca8dc8e846d3a0211792322e72f21f0f44be63e5` |
| Price Fetcher | `0x04613bee55d8a37adfa249b24c6b13451dedf7cf4f02d01de859579119de3add` |

### 2.3 Swapping on Ekubo (on-chain)

- **Entrypoint**: Call **`ICore#lock`** with calldata; Core calls back **`IYourContract#locked`** with that data.
- **In the callback**: Execute swap(s), pay input, withdraw output; order of pay/withdraw is flexible; multiple swaps in one callback to net amounts.
- **Routing**: Integrator must find the best list of pools (route); no built-in aggregator in the snippet — equivalent to “finding best route for arbitrage”.
- **Routers**: Starknet and EVM router examples in Ekubo repos show how to implement the lock/locked pattern.

**Implication for zkde.fi**: For real Sepolia swaps we need a contract that implements the `locked` callback and calls the pool swap logic, or we call an existing Router (e.g. Router V3.0.13) if its interface matches our flow (e.g. user → agent → Router → Core).

---

## 3. Live Data: How Deep We Can Integrate

### 3.1 Ekubo API (prod-api.ekubo.org)

API is chain-aware (`chainId` in path or query). Indexer has Sepolia config, so **Sepolia is a supported chain** once indexed; confirm `chainId` for Starknet Sepolia (e.g. decimal for `SN_SEPOLIA`) in OpenAPI or with Ekubo.

**Endpoints relevant for testnet demo:**

| Endpoint | Use case |
|----------|----------|
| `GET /tokens?chainId=...` | List tokens, metadata, `usd_price` |
| `GET /tokens/{chainId}/{tokenAddress}` | Token metadata |
| `GET /overview/pairs?chainId=...&minTvlUsd=...` | Top pairs, volume_24h, TVL, depth |
| `GET /overview/volume?chainId=...` | Volume by token/date |
| `GET /overview/tvl?chainId=...` | TVL by token |
| `GET /pair/{chainId}/{tokenA}/{tokenB}/pools?minTvlUsd=...` | Pools for a pair (fee, tick_spacing, core_address, extension, TVL, volume) |
| `GET /pair/{chainId}/{tokenA}/{tokenB}/tvl` | Pair TVL over time |
| `GET /pair/{chainId}/{tokenA}/{tokenB}/volume` | Pair volume |
| `GET /price/{chainId}/{baseToken}/{quoteToken}/history?interval=...` | **VWAP price history** (OHLC-style: vwap, max, min, k_volume) |
| `GET /pools/{chainId}/{coreAddress}/{token0}/{token1}/{fee}/{tickSpacing}/{extension}/liquidity` | Per-tick liquidity for routing/simulation |

**Reaction to live data:**

- **Dashboard**: Top pairs, TVL, volume, token USD prices.
- **Paper trading**: Use `/price/.../history` and pair/pool endpoints to simulate fills at VWAP or mid and compute PnL.
- **Agent inputs**: Feed pair/pool stats and price history into zkML (e.g. volatility, correlation, TWAP) and into “when to swap” logic.
- **Real swaps**: Use pool list + liquidity to choose route; then execute via Core#lock (or Router).

### 3.2 On-chain: reading pool price (Ekubo docs)

- Call **Core** with pool key (token0, token1, fee, tickSpacing, extension).
- Result includes `sqrt_ratio`, `tick`; price is derived from `sqrt_ratio` (64.128 fixed point): divide by `2^128`, square, then adjust for decimals.
- **Use**: Live on-chain spot for a pool; compare with API VWAP for sanity checks and slippage bounds.

### 3.3 zkde.fi today: mainnet oracle

- **mainnet_oracle.py** already pulls from JediSwap and Ekubo (mainnet) and writes `market_snapshots.json` (TVL, APY, volume, volatility).
- **Agent/rebalancer** use “protocol” (e.g. Ekubo vs JediSwap) and allocation; frontend shows “Ekubo” vs “JediSwap” APY/TVL.
- **Gap**: Oracle is mainnet-focused; Ekubo API and Sepolia contracts allow a **Sepolia-first** path: same schema, but chainId = Sepolia and Sepolia Core/pools.

**Recommendation**: Add a Sepolia Ekubo client (and optional JediSwap Sepolia if available) that uses `prod-api.ekubo.org` with Sepolia `chainId`, and optionally on-chain Core read for spot price. Unify “market snapshot” so the app can run in “testnet mode” with live Sepolia data.

---

## 4. Paper Trading / Simulated Swaps with Performance

### 4.1 What “paper trading” means here

- **No real on-chain swap**: User (or agent) chooses pair, size, direction; backend uses **live data** to simulate fill and updates a **local ledger** (e.g. positions, cost basis, PnL).
- **Performance**: Track per-user and per-strategy metrics: PnL, Sharpe, drawdown, win rate, volume, etc.

### 4.2 Data sources for simulation

- **Prices**: `GET /price/{chainId}/{baseToken}/{quoteToken}/history?interval=...` (VWAP + max/min).
- **Pools**: `GET /pair/{chainId}/{tokenA}/{tokenB}/pools` for fee and depth; approximate slippage (e.g. constant-product or tick-based if we have liquidity deltas).
- **Optional**: On-chain Core `get_pool` for latest sqrt_ratio → spot price.

### 4.3 Implementation sketch

1. **Paper order**: User/UI submits “paper swap” (e.g. tokenIn, tokenOut, amountIn, optional limit price).
2. **Quote**: Backend calls Ekubo API (and/or on-chain) for current price and, if available, quote endpoints; otherwise derive from price history + simple slippage model.
3. **Simulated fill**: Store in DB or in-memory: user_id, timestamp, side, amount_in, amount_out, price, fee.
4. **Ledger**: Maintain paper positions (balances per token); on each “paper swap”, debit one token, credit the other.
5. **Performance**:  
   - Realized PnL (closed positions), unrealized (mark-to-market from latest price).  
   - Time series of equity → Sharpe, max drawdown.  
   - Aggregates: total volume, win rate, number of trades.

### 4.4 How deep we can go

- **Full parity with “real” flow**: Same UI as real swap (pair, size, direction); toggle “Paper” vs “Live”.
- **Historical replay**: Use `/price/.../history` to backtest a strategy over past intervals.
- **zkML in the loop**: Use same price/pool inputs for risk/correlation/TWAP processors; “paper” execution only updates local ledger; later, when user enables “live”, same logic can drive proof-gated execution.

**Viability**: ✅ High. No Ekubo lock needed; only API + optional RPC; backend + DB and a clear “paper vs live” flag.

---

## 5. Real Swaps on Sepolia

### 5.1 Flow

1. **Route**: Choose tokenIn → tokenOut and list of (Core) pools (e.g. from `/pair/.../pools` or custom routing).
2. **Quote**: Use API and/or on-chain liquidity to compute expected amountOut and slippage.
3. **Execution**:  
   - **Option A**: Our contract implements `locked`; we call `Core#lock` with our contract and calldata; in `locked` we perform approve/transfer and swap calls.  
   - **Option B**: Use Ekubo’s Router (e.g. V3.0.13) if it exposes a simple “swap” entrypoint that internally does lock + callback.
4. **User/agent**: Account signs a tx that calls our contract or the Router; token approvals must be set for the Core (or Router).

### 5.2 Integration depth

- **Minimal**: Integrate with existing Ekubo frontend (link to app.ekubo.org for Sepolia) and use our app only for portfolio/agent/rebalancing.
- **Medium**: Our backend prepares calldata (route + amounts); frontend sends one tx (e.g. to Router or our adapter).
- **Deep**: Our Cairo contract is the lock callback; we implement routing and slippage checks; session-key agent can call this contract so “agent-driven swaps” stay within proof and session constraints.

**Viability**: ✅ High for medium (use Router + API for route/quote). Deep is viable with engineering time (Cairo lock contract + routing).

---

## 6. zkML Models & “The Brain”

### 6.1 Existing zkde.fi building blocks

- **Rebalancer** (`agent_rebalancer.py`): Proposes rebalances (from_protocol, to_protocol, amount); runs **risk** + **anomaly** zkML; both must pass; then proof-gated execution.
- **zkML services**: Risk (portfolio features, threshold), anomaly (pool/protocol safety); proofs feed into commitment and on-chain checks.
- **Proof-gated agent**: Deposit/withdraw gated by Integrity fact_hash; session keys constrain protocol and amount.
- **Cairo perceptron** (“brain”): TieredAgentController / proof-gated logic on-chain.

### 6.2 zkML marketplace (COMPOSABLE_ZKML_MARKETPLACE.md)

- **Processors**: Credit scoring, correlation risk, TWAP position, drawdown resilience, safety diversification, momentum risk; each: inputs → proof → signal.
- **Agent composer**: User selects a set of processors and **decision logic** (e.g. AND, OR, WEIGHTED threshold).
- **Execution**: Run processors, combine signals via decision_logic → boolean “should_execute”; then existing proof-gated execution.

### 6.3 “Automated IA driving AI”

Interpretation: **Automated agent** (IA) that uses **zkML** (AI) to decide **when** and **how much** to trade, with execution still proof-gated and session-bound.

**Concrete flows:**

1. **Rebalance → “swap”**: Today rebalance moves “amount” between protocol_ids (e.g. Ekubo vs JediSwap). Conceptually the same as “rebalancing via swap” (e.g. sell A on Ekubo, buy B on JediSwap). So current rebalancer is already a form of “automated allocation change”; we can label a subset as “swap” when the two protocols are different tokens/pools.
2. **Marketplace processors drive swap**:  
   - **TWAP**: Prove current position vs TWAP; if “below_threshold” or “above_threshold”, output “rebalance” or “swap size”.  
   - **Correlation**: Prove portfolio correlation is acceptable; if not, signal “reduce exposure to pair X” → map to a swap.  
   - **Momentum / risk**: Similar: output is a signal; backend maps signal to (tokenIn, tokenOut, size) and then either paper or real swap.
3. **Decision logic**: AND/OR/WEIGHTED over processors; e.g. “TWAP says rebalance AND correlation says safe” → execute; otherwise skip.
4. **Session key**: Execution (deposit/withdraw/swap) stays under session limits (max position, allowed protocols, expiry); zkML only gates *whether* we are allowed to propose this move.

**Viability**: ✅ High. Rebalancer + marketplace design already support “automated + proof-gated”; adding “swap” as an action and wiring processor outputs to swap size/direction is an extension of current architecture.

---

## 7. zkML Marketplace + Swap Flow: Concrete Ideas

### 7.1 Your ideas (reflected)

- **Paper trading with performance**: Use Ekubo API + local ledger; track PnL, Sharpe, drawdown; no on-chain execution. ✅ Above.
- **Live data reaction**: Dashboards and agent inputs from Ekubo API (and Sepolia RPC). ✅ Above.
- **Real swaps**: Sepolia Core + Router; our backend or contract prepares/executes. ✅ Above.
- **zkML + automated “AI driving”**: Processors (TWAP, correlation, risk) + decision logic → “should we swap / how much”; execution via existing proof-gated path. ✅ Above.

### 7.2 Additional ideas

1. **“Swap intent” as a processor output**  
   - New processor (or extend TWAP/correlation): inputs = (portfolio, market data, constraints); output = (tokenIn, tokenOut, amountIn, limitPrice) or “no trade”.  
   - Proof proves “this intent satisfies my strategy” without revealing the strategy.  
   - Backend turns intent into paper or real swap.

2. **Slippage / execution quality as a zkML input**  
   - Processor that proves “execution price is within X% of oracle/VWAP”.  
   - Inputs: trade (amount, pair), post-trade price; output: pass/fail.  
   - Use to gate “only execute if proof passes” (MEV / bad execution protection).

3. **Backtest → proof**  
   - Backtest a strategy on `/price/.../history`; compute strategy outputs (e.g. daily rebalance).  
   - Optionally prove in zkML “this backtest result is correct” (e.g. hash of inputs + outputs) for transparency or audits.

4. **Limit-order style with zkML**  
   - User sets “execute swap when TWAP processor says go”; agent watches price/TWAP, gets proof, then executes when condition holds.  
   - Fits existing “propose → zkML gate → execute” flow.

5. **Sepolia “demo mode” end-to-end**  
   - One-click: “Start demo”.  
   - Backend seeds paper positions; UI shows Ekubo Sepolia pairs (from API); user (or bot) does paper swaps; dashboard shows live Sepolia TVL/volume and paper PnL.  
   - Later: “Promote to real” uses same UI with real Sepolia swaps (small amounts).

6. **Protocol whitelist + Ekubo**  
   - Session key already has “allowed_protocols” (e.g. pools, ekubo, jediswap).  
   - Ensure “ekubo” allows calling our Ekubo adapter or Router; agent can then propose Ekubo swaps within session limits.

---

## 8. Summary: What’s Viable

| Idea | Viable | Effort | Dependencies |
|------|--------|--------|--------------|
| Live Sepolia data (Ekubo API + RPC) | ✅ Yes | Low | Sepolia chainId; optional own indexer |
| Paper trading + PnL/Sharpe/drawdown | ✅ Yes | Medium | API + DB + ledger + endpoints |
| Real Sepolia swaps (Router or lock contract) | ✅ Yes | Medium–High | Router calldata or Cairo lock contract |
| zkML gates “when to swap” (TWAP, correlation, risk) | ✅ Yes | Medium | Wire processor outputs to swap intent; reuse rebalancer |
| Marketplace processors driving swap size/direction | ✅ Yes | Medium | New or extended processor; decision_logic |
| “Swap intent” processor (private strategy → public intent) | ✅ Yes | Medium | New processor schema |
| Execution-quality / slippage zkML | ✅ Yes | Higher | New circuit + oracle inputs |
| Demo mode (paper → real on Sepolia) | ✅ Yes | Medium | Unify Sepolia data + paper ledger + real execution toggle |

**Suggested order**: (1) Sepolia Ekubo client + live data in UI and oracle, (2) paper trading + performance, (3) real swaps via Router or small lock adapter, (4) wire one marketplace processor (e.g. TWAP) to “rebalance/swap” and decision logic, then expand.

---

## 9. References

- Ekubo swapping: https://docs.ekubo.org/integration-guides/swapping  
- Ekubo Starknet contracts: https://docs.ekubo.org/integration-guides/reference/starknet-contracts  
- Ekubo API: https://docs.ekubo.org/integration-guides/reference/ekubo-api  
- Ekubo OpenAPI: https://prod-api.ekubo.org/openapi.json  
- Reading pool price: https://docs.ekubo.org/integration-guides/reference/reading-pool-price  
- Starknet contracts (router): https://github.com/EkuboProtocol/starknet-contracts  
- Starknet indexer (Sepolia): https://github.com/EkuboProtocol/starknet-indexer  
- zkde.fi ARCHITECTURE.md, COMPOSABLE_ZKML_MARKETPLACE.md  
- zkde.fi backend: mainnet_oracle.py, agent_rebalancer.py, zkdefi_agent_service.py  
