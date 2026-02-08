# Innovation and differentiation

## What's novel

- **Privacy-preserving autonomous agent** — Combines AI-driven allocation (deterministic risk engine) with privacy primitives: proof-gating, confidential transactions, and selective disclosure. The agent acts on your behalf; intents stay hidden; actions are verifiable.
- **Proof-gated session keys (Starknet AA)** — Uses Starknet's native account abstraction (session keys) plus proof verification. The agent needs *both* a valid session *and* a valid proof to execute. That combination is rare: delegation with cryptographic guarantees.
- **STARKs for execution, Groth16 for privacy** — Execution proofs are verified via Integrity (STARK/SHARP); confidential transfers use a Groth16 verifier (Garaga on Sepolia). One stack for both verifiable execution and confidential balances.
- **Selective disclosure + confidential on one stack** — You can prove compliance or eligibility (selective disclosure) while also holding confidential positions (private deposits). Same app, same chain, same narrative.
- **Complete confidential transfer cycle** — Private deposits *and* private withdrawals. Nullifier-based double-spend prevention. Your amounts stay hidden from deposit to withdrawal.
- **Multi-dimensional selective disclosure** — Beyond basic thresholds: risk compliance (VaR, Sharpe), performance proofs (APY over time), KYC eligibility, and portfolio aggregation across protocols.
- **Cross-protocol privacy aggregation** — Prove total portfolio value across Ekubo, JediSwap, and private commitments without revealing individual protocol amounts or allocation strategy.

## Privacy features

| Feature | Description |
|---------|-------------|
| Private Deposits | Hide deposit amounts using commitments |
| Private Withdrawals | Withdraw without revealing amounts (nullifier-based) |
| Risk Compliance | Prove portfolio risk below threshold |
| Performance Proofs | Prove APY exceeded target over period |
| KYC Eligibility | Prove financial standing for compliance |
| Portfolio Aggregation | Prove total value without breakdown |

## Starknet-native

- Built for **Starknet** (Sepolia for demo; mainnet-ready). Uses native account abstraction, Integrity fact registry, and existing DeFi protocols (Ekubo, JediSwap).
- No mock data: real prover on Sepolia, real Integrity, real ERC20 token. Proof-gated deposits and disclosures are fully on-chain and verifiable.
- **Garaga integration** for on-chain Groth16 verification of privacy proofs.

Next: [FAQ](/faq)
