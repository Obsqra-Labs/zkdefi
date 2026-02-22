# Risk Passport — Next Steps (Phase 2)

Phase 2 / follow-up work after Phase 1 is signed off. Use this doc to track what to do next.

**Phase 1 complete when:** [RISK_PASSPORT_UI_CHECKLIST.md](RISK_PASSPORT_UI_CHECKLIST.md) is checked off.

**Scoped build plan (execution order, files, acceptance criteria):** [BUILD_PLAN.md](BUILD_PLAN.md).

**Detailed scope:** [RISK_PASSPORT_PRODUCT_SCOPE.md](RISK_PASSPORT_PRODUCT_SCOPE.md) “What’s next” table; [ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md](ZKML_AND_RISK_ENGINE_IMPROVEMENTS.md) §7.

**Source:** Items pulled from [RISK_PASSPORT_IMPLEMENTATION.md](RISK_PASSPORT_IMPLEMENTATION.md) §10 and product scope; aligned with ZKML improvements doc.

---

## Plan (in order)

| # | Item | Brief acceptance / note |
|---|------|-------------------------|
| 1 | Snapshot binding | Pass oracle `snapshot_hash` into zkML requests and `append_proof_receipt`; receipts show non-null snapshot_hash where applicable. |
| 2 | Proof timeline UX | Frontend component for receipts (model hash, threshold, snapshot, link); reused on Profile and Agent/Rebalancer. |
| 3 | Policy engine (v1) | Backend policy_engine for rebalance (risk + anomaly); returns allowed + calldata; rebalancer uses it. |
| 4 | Real execution path | Execute rebalance via contract/relayer with Garaga calldata; return real tx_hash. |
| 5 | Predictive / yield models | Risk breach prob, drawdown, pool stress; APY forecast, TVL drift; then IL, depeg, etc. |
| 6 | Privacy UX / concurrency | Tier badge, visibility warnings; lock or cache for proof generation. |
| 7 | **Linked addresses (cross-chain baseline)** | Store and use eth/arb/base addresses so reputation and credit use full cross-chain history. See [Linked addresses (research)](#linked-addresses-cross-chain-baseline) below. |

---

## Linked addresses (cross-chain baseline)

**Goal:** Reputation and credit tier should use tenure/tx count (and eventually volume) from Ethereum, Arbitrum, Base when the user has linked those addresses — not just Starknet.

**What we have today:**

- **Link addresses UI** is on Profile (GET/PUT linked_addresses); reputation and identity credit-proof use the store.
- **Identity API** already has a schema: `LinkedAddresses` (starknet, ethereum, arbitrum, optimism, base) and `CreditProofRequest` with commitment + addresses + signatures. So credit proof *accepts* linked addresses at proof-generation time; we don’t yet have a single place where the user “saves” them for reuse.
- **Commitment formula** (SRC_8004_ALIGNMENT, identity): `commitment = Poseidon(starknet_addr, eth_addr, arb_addr, opt_addr, base_addr, salt)` — the identity commitment can bind the set of addresses; proving ownership is via signatures.
- **Contracts:** Agent/identity use a single `identity_commitment` (felt252). No on-chain struct yet for “linked addresses” or multi-address mapping. So nothing AA-native today that stores linked addresses.

**Options (for next steps / deep dive):**

1. **Backend-only (fast):** Extend onboarding state (or a small “link addresses” step) to store optional eth/arb/base addresses + proof of ownership (signatures). Key by Starknet address. Reputation GET and identity credit-proof read from this store so we pass linked addresses into `fetch_combined_history` and into `POST /identity/credit-proof`. No contract changes.
2. **AA-native (later):** Add an on-chain place for linked addresses — e.g. a registry or the agent contract that stores (or commits to) eth/arb/base for a given Starknet account. Requires contract schema + frontend to write; then backend can read from chain or we keep a mirror in backend for speed.
3. **Starknet ID / ecosystem:** Check if Starknet ID or another standard exposes “linked addresses” or social/chain links we could reuse. If yes, we could resolve linked addresses from there instead of storing ourselves.

**Concrete next step:** Choose storage (1 = backend store, 2 = on-chain schema, 3 = Starknet ID). Then: (a) add “Link addresses” UX (optional step in onboarding or Profile) with signatures; (b) pass linked addresses from that store into reputation baseline and identity credit-proof; (c) document the flow in [REPUTATION_BASELINE.md](REPUTATION_BASELINE.md).

### Most aligned with 8004

SRC-8004 (and ERC-8004) put **identity on-chain** as an agent NFT; our extension is the **identity commitment** (Poseidon of addresses) for Sybil resistance. The spec keeps the **address-to-commitment mapping private** ("Commitment is on-chain; mapping is private" — [SRC_8004_ALIGNMENT.md](SRC_8004_ALIGNMENT.md)). So:

- **Option 1 (backend store)** is the most 8004-aligned: the commitment lives on-chain (AgentIdentity, ReputationRegistry); the set of linked addresses that feed the commitment stays off-chain and private. We need that set only to call `fetch_combined_history` and to generate credit-proof; storing it in the backend is consistent with "mapping is private."
- **Option 2 (AA-native store)** would put linked addresses (or a hash) on the user's account or our contract. 8004 does not require this; it is an optional enhancement.
- **Option 3 (Starknet ID)** — see below.

### Using Starknet ID with 8004

**Yes, we can use Starknet ID in an 8004 context.** Starknet ID is the ecosystem standard for Starknet identity (.stark domains, identity NFT, getStarkName / getAddressFromStarkName). It composes with 8004; it does not replace it:

- **Today:** Use Starknet ID for **Starknet address to .stark name** resolution (display, UX). Our 8004 identity (AgentIdentity NFT + commitment) remains the source of truth for agent trust and Sybil-resistant commitment.
- **Linked addresses:** Starknet ID is Starknet-centric (name to address on one chain). It does not currently define a standard for linked Ethereum/Arbitrum/Base addresses. If Starknet ID (or an extension) adds verifiable linked accounts for other chains, we could resolve linked addresses from there and feed them into our commitment and reputation baseline. Until then, we use our own store (option 1) or on-chain schema (option 2).
- **Summary:** Use Starknet ID for .stark resolution and ecosystem compatibility; keep 8004 commitment and linked-address handling as above. If Starknet ID gains multi-chain linkage, integrate it as an optional source for linked addresses.

---

## Dependencies

- **1** is foundational for verifiable receipts.
- **3** and **4** build on current rebalancer flow.
- **2** can start once receipt shape is stable (optionally after 1).
- **7** is independent; can run in parallel once we pick storage (backend vs on-chain vs ID).
