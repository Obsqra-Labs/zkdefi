# DEX swap status

**Short answer:** Swaps are **not** tested end-to-end on-chain. The backend returns quote and swap-calldata; the frontend can build and sign an invoke. Whether the transaction **succeeds** on Ekubo Sepolia depends on the Router ABI — we currently return a placeholder that may not match the real Router.

---

## What we have

- **Quote:** `POST /api/v1/zkdefi/dex/quote` — returns `amount_out`, `amount_out_min` (estimate from pool TVL; not exact).
- **Swap-calldata:** `POST /api/v1/zkdefi/dex/swap-calldata` — returns `contract_address` (Ekubo Router Sepolia), `entrypoint`, `calldata`.
- **Frontend:** Fills token in/out from pair selection; calls quote then swap-calldata; user signs `account.execute(contractAddress, entrypoint, calldata)`.

---

## Why swaps might fail on-chain

From [EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md](EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md):

- Ekubo’s flow is **`ICore#lock`** with calldata; Core calls back **`IYourContract#locked`**. So execution is **lock + locked callback**, not a single “swap” entrypoint.
- Our backend returns **`entrypoint="swap"`** and a **placeholder calldata** shape. The real Router (e.g. V3.0.13) may:
  - Expose a different entrypoint (e.g. `lock` with a specific payload), or
  - Expect a different calldata encoding.

Until we align with the Router ABI (e.g. from [EkuboProtocol/starknet-contracts](https://github.com/EkuboProtocol/starknet-contracts)), a user-submitted swap may **revert** (e.g. entrypoint not found or invalid args).

---

## What we have tested

- **API smoke:** E2E suite includes `test_dex_quote_and_swap_calldata`: GET pairs, POST quote, POST swap-calldata; asserts 200 and response shape. **No on-chain execution.** Run with `EKUBO_CHAIN_ID` set to hit real Ekubo API; otherwise the test is skipped (503).

---

## Next steps for real swaps

1. **Inspect Router ABI:** From Ekubo docs or starknet-contracts repo, confirm the Router’s public entrypoint(s) and calldata format (e.g. `lock` + struct).
2. **Align backend:** Change `dex_swap_calldata` to build calldata that matches the Router (and use the correct entrypoint name).
3. **Test on Sepolia:** Submit one swap with a test wallet; confirm tx succeeds on Starkscan.

**Update (2026-02-13):** Backend now builds calldata for Router.swap(RouteNode, TokenAmount) per EkuboProtocol/starknet-contracts. Approve token_in for Router before invoking; test one swap on Sepolia to confirm.
