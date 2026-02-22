# Reputation baseline from on-chain and cross-chain activity

Reputation (tier, tenure_days, successful_txns, total_volume_eth, collateral_eth) is used for Risk Passport composite score, relayer access, and proof mode. This doc describes how we establish a **baseline** from chain activity so new users don’t start at zero.

## Intent (from product scope)

- **Reputation** is the deterministic baseline for “what you can do” and behavioral signal (RISK_PASSPORT_PRODUCT_SCOPE §3c).
- **Credit scoring** (identity) uses cross-chain history: DeFi activity, protocol diversity, historical behavior, cross-chain presence (§3a).
- Baseline should come from **on-chain** (Starknet) and **cross-chain** (Ethereum, Arbitrum, Base when linked) activity so that:
  - Account age (tenure) reflects first-seen activity on chain.
  - Transaction count reflects real activity.
  - Volume can be inferred from chain data where available.

## Factors we use for baseline

| Factor | Source | How we get it |
|--------|--------|----------------|
| **tenure_days** | Chain(s) | Max of account_age_days across Starknet + any linked chains (first_tx → now). |
| **successful_txns** | Chain(s) | Sum (or max) of transaction_count per chain; merged with in-app recorded txns. |
| **total_volume_eth** | In-app + (future) chain | In-app from record-transaction; chain volume from explorers when we aggregate it. |
| **collateral_eth** | In-app only | From stake-collateral. |
| **tier** | In-app only | From upgrade-tier / opt-strict. |

## Implementation

- **Service:** `CrossChainFetcher` (`backend/app/services/cross_chain_fetcher.py`) fetches:
  - **Starknet:** RPC `starknet_getNonce` (proxy for tx count) + heuristic account age.
  - **Ethereum / Arbitrum / Base:** Etherscan/Arbiscan/Basescan tx list (when API keys and linked addresses provided).
- **Reputation GET** `GET /api/v1/zkdefi/reputation/user/{address}`:
  - Loads in-app user data (tier, collateral, in-app tenure/txns/volume).
  - Calls `fetch_combined_history(starknet_address, eth?, arb?, base?)` to get chain baseline.
  - Merges: **tenure_days** = max(in_app_tenure, chain account_age_days); **successful_txns** = in_app + chain total_transactions; **total_volume_eth** = in_app (chain volume in combined history can be added later).
- **Identity / Credit** already uses cross-chain history for credit proof; Profile “Credit Score” and Risk Passport pull credit from identity by commitment (onboarding → identity).

## Linked addresses (cross-chain)

Today we only pass the connected **Starknet** address to the baseline fetcher. To use Ethereum/Arbitrum/Base we need linked addresses (e.g. from onboarding or identity flow). When we have them, pass them into `fetch_combined_history` so tenure and tx count aggregate across chains.

**Where to store them:** Identity API already has `LinkedAddresses` (starknet, ethereum, arbitrum, optimism, base) and a commitment formula (see SRC_8004_ALIGNMENT). We don’t yet have a single stored “profile” of linked addresses. Options: backend store (onboarding/Profile “Link addresses” step), on-chain AA-native schema (contract stores or commits to linked addresses), or Starknet ID / ecosystem standard. See [RISK_PASSPORT_NEXT_STEPS.md](RISK_PASSPORT_NEXT_STEPS.md) § “Linked addresses (cross-chain baseline)” for a short deep dive and next steps. Most 8004-aligned: backend store (commitment on-chain; address set private). Starknet ID: use for .stark resolution; it does not yet provide linked multi-chain addresses. See same doc subsections "Most aligned with 8004" and "Using Starknet ID with 8004."

**Implemented:** Backend store in `linked_addresses_store.py` (data in `backend/data/linked_addresses.json`). API: `GET /api/v1/zkdefi/linked_addresses/{address}` and `PUT /api/v1/zkdefi/linked_addresses`. Reputation GET loads linked and passes them into `fetch_combined_history(starknet, eth, arb, base)`.

**End-to-end flow:** (1) Profile Linked addresses UI: GET linked_addresses/{address} to load, PUT linked_addresses to save (starknet_address + eth/arb/base/opt). (2) Store: linked_addresses_store.py writes to data/linked_addresses.json. (3) Reputation GET: loads get_linked(address), passes (starknet, eth, arb, base) into fetch_combined_history; merged baseline feeds Risk Passport. (4) Identity credit-proof: when only Starknet is sent, backend loads get_linked(starknet), fills eth/arb/base/opt from store, then fetches cross-chain history and generates proof.

## Related

- [RISK_PASSPORT_PRODUCT_SCOPE.md](RISK_PASSPORT_PRODUCT_SCOPE.md) §3a, §3c — Credit and reputation as passport inputs.
- [RISK_PASSPORT_IMPLEMENTATION.md](RISK_PASSPORT_IMPLEMENTATION.md) — Composite formula and receipt flow.
- `backend/app/api/reputation.py` — Reputation API; merges baseline in GET /user/{address}.
- `backend/app/services/cross_chain_fetcher.py` — Chain history fetcher and `fetch_combined_history`.
