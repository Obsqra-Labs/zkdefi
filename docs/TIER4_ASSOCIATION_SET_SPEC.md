# Tier 4: Association set / selective disclosure (Phase 2 spec)

**Status:** Plan only. Implementation after Tier 2 and Tier 3.

## Goal

Prove "my note is not in this set" for compliance (e.g. excluded addresses or commitments). User can withdraw only if their commitment is not in a sanctioned/excluded association set.

## Set representation (to be fixed)

- **Option A:** Merkle root of excluded commitments. Circuit proves: my commitment ≠ any leaf under `association_set_root`.
- **Option B:** Nullifier set (list of nullifiers to exclude). Circuit proves: my nullifier is not in the set (e.g. set commitment or accumulator).
- **Option C:** Commitment accumulator (e.g. Poseidon accumulator of excluded commitments). Circuit proves non-membership.

Design choice depends on: (1) who updates the set (admin vs governance), (2) set size and update frequency, (3) circuit complexity and proof size.

## Circuit spec (draft)

- **Extend** FullPrivacyWithdraw or **new circuit** e.g. `FullPrivacyWithdrawWithAssociationCheck`.
- **Private inputs:** same as FullPrivacyWithdraw (note preimage, path, etc.) plus any set-related witness.
- **Public inputs:** merkle root, nullifier, recipient, withdrawAmount, poolType, **association_set_root** (or set commitment).
- **Constraint:** "my commitment is not in the set" (non-membership proof for the chosen set representation).

## Contract

- New entrypoint e.g. `withdraw_with_association_check(..., association_set_root, zk_proof)` or integrate into existing withdraw with an optional association root.
- Verifier: new Garaga verifier for the association-check circuit (or same verifier with extra public input).
- Contract stores or receives `association_set_root` and checks proof.

## Backend

- API to submit/update association set (e.g. list of nullifiers or commitments to exclude); compute and expose set root/commitment.
- Proof generation: accept set (or set root) and produce proof that includes set non-membership.

## Implementation order (Phase 2)

1. **Design:** Fix set format (Merkle vs nullifier set vs accumulator); document in this file.
2. **Circuit:** Implement non-membership circuit; generate Garaga verifier.
3. **Deploy:** Deploy new verifier; add contract entrypoint and wire to pool.
4. **Backend:** Set API + proof generation for association-check proof.
5. **Frontend:** Optional UI for "withdraw with compliance check" (e.g. select association set by regulator id).

## References

- [PRIVACY_TIERS.md](PRIVACY_TIERS.md) — tier overview
- [POOL_TYPES_AND_ROADMAP.md](POOL_TYPES_AND_ROADMAP.md) — roadmap
