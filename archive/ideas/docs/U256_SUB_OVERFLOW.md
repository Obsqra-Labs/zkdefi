# u256_sub Overflow (STRK / token contract)

**Symptom:** Transaction fails with:

- `Error in contract (contract address: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d, ...)` (STRK token)
- `0x753235365f737562204f766572666c6f77` → **'u256_sub Overflow'**

**Cause:** The token contract performs a subtraction that underflows. In our Ekubo router flow, the most common reasons are:

1. **Insufficient wallet input balance:** Your wallet has less of the input token (STRK or USDC) than the swap amount.
2. **Wrong router execution pattern:** Calling `Router.swap` without first transferring input tokens into the Router contract can underflow in token transfer paths.
3. **Pool-side output shortage:** On thin Sepolia pools, requested output can exceed available token balance in the pool for that route/size.

**Fix:**

1. **Deploy flow (USDC → STRK):** We cap the STRK/USDC position to **10 USDC** per deploy so the pool has enough STRK to send (Sepolia pools often have limited liquidity). If you deploy a larger amount, the STRK/USDC leg is capped at 10 USDC; the rest goes to ETH/USDC. To deploy more to STRK/USDC, run Deploy again or use a smaller total amount.
2. Ensure your wallet holds **at least the swap amount** of the input token (STRK for STRK→USDC, USDC for USDC→STRK/ETH).
3. Use this execution order for wallet mode:
   - `token_in.transfer(router, amount)`
   - `router.swap(...)`
   - `router.clear(token_out)` (and optionally `router.clear(token_in)` for dust)
4. For **STRK → USDC** (`/swap-strk-to-usdc`): send `amount_strk_wei` that is ≤ your STRK balance (18 decimals), and try smaller sizes if route liquidity is thin.

**API:** `POST /api/v1/zkdefi/orchestration/swap-strk-to-usdc` returns `balance_required` guidance for transfer→swap→clear.

**Frontend:** If the error message contains `u256_sub` or `Overflow`, we show guidance for insufficient input balance / pool liquidity and suggest smaller size.
