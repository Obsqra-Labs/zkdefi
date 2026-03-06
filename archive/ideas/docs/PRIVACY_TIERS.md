# Privacy tiers: on-chain visibility (zkde.fi)

This doc defines **privacy tiers** by **what is hidden on-chain** (deterministic, verifiable). Pool labels A/B/C and the roadmap are mapped to these tiers.

---

## Privacy tiers (1–4)

| Tier | What is hidden on-chain | Mechanism | Status |
|------|-------------------------|-----------|--------|
| **1** | Deposit↔withdraw link only | Commitment + nullifier; pool events minimal | **Today (B/C)** — token + calldata still leak depositor, amount, recipient |
| **2** | + Recipient and amount on withdraw | Recipient/amount in proof; relayer submits withdraw | **Implemented** (contract + API) |
| **3** | + Depositor on deposit | Relayer (or meta-tx) submits deposit; tx signer ≠ user | **Implemented** (API + calldata) |
| **4** | + Compliance / selective disclosure | Association set; prove "my note not in set" | Roadmap |

- **Tier 1** = current FullyShieldedPool behavior: note unlinkability + minimal pool events; token and calldata still expose depositor, amount, recipient.
- **Tier 2** = withdraw privacy: relayer submits; recipient/amount from proof only (contract change + circuit).
- **Tier 3** = depositor privacy: relayer submits deposit (contract + relayer service).
- **Tier 4** = compliance layer: association set, selective disclosure (circuit + contract).

---

## Mapping: pool label → tier

| Pool label | Meaning | Tier today | Roadmap |
|------------|---------|------------|---------|
| **A (Shielded)** | Balance-style, relayer option | Tier 1 (different contract/circuit; Garaga-only) | — |
| **B (Full Privacy)** | Note-unlinkable Merkle pool | Tier 1 | Same as C (shared contract) |
| **C (Tornado-style)** | Same as B; relayer emphasized; compliance-ready | Tier 1 | Tier 2 → 3 → 4 (relayer withdraw, relayer deposit, association set) |

---

## Reputation tiers

**Strict / Standard / Express** (see [BD_NOTE.md](BD_NOTE.md)) gate **relayer access** and limits; they do **not** change on-chain visibility. They control who can use Tier 2+ relayer features.

---

## Tier 2 relayer flow (implemented)

- **Request:** `POST /api/v1/zkdefi/relayer/request-tier2` — body: requester, nullifier_low/high, root_low/high, pool_type, proof_calldata (no recipient/amount).
- **Calldata:** `GET /api/v1/zkdefi/relayer/request/{id}/calldata` — returns pool_address, entrypoint (withdraw_relayed_u256), calldata for a third-party relayer to submit on-chain.
- **Execute:** Relayer submits the tx via Starknet SDK; then `POST /relayer/execute` with request_id and proof_calldata to mark executed.

## Tier 3 relayer flow (implemented)

- **Request:** `POST /api/v1/zkdefi/relayer/deposit-request` — body: requester, commitment_low, commitment_high, amount_wei. User sends tokens to relayer off-chain; relayer submits when funded.
- **Calldata:** `GET /api/v1/zkdefi/relayer/deposit-request/{id}/calldata` — returns pool_address, entrypoint (deposit_u256), calldata for relayer to submit.
- **Execute:** Relayer submits pool.deposit_u256; then `POST /relayer/deposit-request/{id}/execute` to mark executed.

## Tier 4: Association set (Phase 2 — plan only)

**Goal:** Prove "my note is not in this set" (e.g. excluded addresses) for compliance.

- **Set format (to be fixed):** Merkle root of excluded commitments, or nullifier set, or accumulator. Circuit proves non-membership.
- **Circuit:** Extend FullPrivacyWithdraw or new circuit; public inputs include association_set_root; constraint = my commitment not in set.
- **Contract:** New entrypoint e.g. withdraw_with_association_check(..., association_set_root, proof); new verifier.
- **Backend:** API to submit/update association set; proof generation accepts set and produces proof.
- **Implementation order:** (1) Design set format, (2) Implement circuit + verifier, (3) Deploy verifier + contract entrypoint, (4) Backend set API + proof.

## References

- [POOL_TYPES_AND_ROADMAP.md](POOL_TYPES_AND_ROADMAP.md) — implementation (contracts, API, frontend)
- [TX_PRIVACY_LOOKUP.md](TX_PRIVACY_LOOKUP.md) — current on-chain visibility (calldata, events, token)
- [OBSQRA_FI_EVM_PRIVACY_AND_DEPOSITOR_HIDING.md](OBSQRA_FI_EVM_PRIVACY_AND_DEPOSITOR_HIDING.md) — depositor hiding (Tier 3), obsqra.fi EVM
- [PROOF_FLOWS.md](PROOF_FLOWS.md) — circuits and proof flows
