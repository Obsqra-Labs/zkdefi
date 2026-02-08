# Key concepts

## Proof-gating

**Proof-gating** means: the smart contract only executes an action if a valid proof is provided. The proof attests that the action satisfies your constraints (e.g. max position, allowed protocols). Proofs are verified on-chain via Starknet's **Integrity** fact registry (SHARP). No proof, no execution — so you get MEV protection and verifiable intent.

## Session keys

**Session keys** let you delegate limited authority to the agent. You sign once (e.g. "agent can act for the next 24h within these limits"); the agent can then submit proof-gated transactions on your behalf. You don't sign every trade; the agent is bounded by the constraints you set.

## Selective disclosure

**Selective disclosure** means proving a *statement* without revealing the underlying data. zkde.fi supports multiple disclosure types:

- **Yield/Balance thresholds** — Prove yield or balance exceeds a value
- **Risk compliance** — Prove portfolio risk (VaR, Sharpe, max drawdown) is below limits
- **Performance proofs** — Prove APY exceeded threshold over a period
- **KYC eligibility** — Prove financial standing for regulatory compliance
- **Portfolio aggregation** — Prove total value across protocols without revealing breakdown

You generate a proof and register it on-chain; auditors or protocols see the statement, not your full history.

## Confidential transfers

**Confidential transfers** hide amounts and balances on the public ledger. Instead of publishing "Alice sent 100 USDC," the chain stores a **commitment** (e.g. a hash). Only the holder can spend or disclose. On Starknet Sepolia, zkde.fi uses **Garaga** (Groth16 verifier) for this; on mainnet, the stack can use MIST.cash.

### Private deposits

When you make a **private deposit**, the amount is hidden. The contract stores a commitment instead of a public balance. You can later prove properties about your deposit without revealing the exact amount.

### Private withdrawals

**Private withdrawals** complete the confidential transfer cycle. To withdraw:

1. **Generate nullifier** — A unique hash derived from your commitment, nonce, and secret. Prevents double-spend.
2. **Prove ownership** — Prove you own the commitment and have sufficient balance.
3. **Submit withdrawal** — Contract verifies proof, marks nullifier as used, transfers funds.

Your withdrawal amount stays hidden. The chain only sees "commitment X was spent via nullifier Y."

## Private position aggregation

**Private position aggregation** lets you prove your total portfolio value across multiple protocols without revealing:

- Individual protocol amounts
- Asset allocation breakdown
- Trading strategy

This enables access to protocol tiers or institutional requirements while maintaining full position privacy.

Next: [How it works](/flow)
