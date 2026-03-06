pragma circom 2.1.6;

include "node_modules/circomlib/circuits/pedersen.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * PrivateVote Circuit
 *
 * Privacy-preserving on-chain voting with Pedersen commitments for zkde.fi.
 * Enables a voter to cast a ballot (for / against / abstain) without revealing
 * their secret identity or voting power on-chain.
 *
 * Cryptographic primitives:
 *   - Nullifier = Pedersen(secret || proposal_id)   → prevents double-voting
 *   - Ballot    = Pedersen(secret || direction || power) → commits the vote
 *
 * Vote directions:
 *   0 = Against
 *   1 = For
 *   2 = Abstain
 *
 * Privacy guarantees:
 *   - Voter secret is PRIVATE
 *   - Voting power is PRIVATE
 *   - Only nullifier, direction, and ballot commitment are PUBLIC / output
 */

template PrivateVote() {
    // === PRIVATE INPUTS ===
    signal input secret;
    signal input voting_power;

    // === PUBLIC INPUTS ===
    signal input vote_direction;
    signal input proposal_id;
    signal input nullifier_hash;

    // === OUTPUTS ===
    signal output is_compliant;
    signal output ballot_commitment;
    signal output public_commitment;

    // === CONSTRAINTS ===

    // Step 1: Convert secret to bits (reused for both hashes)
    component n2b_secret = Num2Bits(254);
    n2b_secret.in <== secret;

    // Step 2: Verify nullifier = Pedersen(secret, proposal_id)
    component n2b_proposal = Num2Bits(254);
    n2b_proposal.in <== proposal_id;

    component nullifier_hasher = Pedersen(508);
    for (var i = 0; i < 254; i++) {
        nullifier_hasher.in[i] <== n2b_secret.out[i];
        nullifier_hasher.in[254 + i] <== n2b_proposal.out[i];
    }
    nullifier_hash === nullifier_hasher.out[0];

    // Step 3: Constrain vote_direction ∈ {0, 1, 2}
    // d * (d-1) * (d-2) === 0, split into two degree-2 constraints
    signal v_times_v_minus_1;
    v_times_v_minus_1 <== vote_direction * (vote_direction - 1);
    v_times_v_minus_1 * (vote_direction - 2) === 0;

    // Step 4: Enforce voting_power > 0
    component vp_positive = GreaterEqThan(64);
    vp_positive.in[0] <== voting_power;
    vp_positive.in[1] <== 1;
    vp_positive.out === 1;

    // Step 5: Compute ballot_commitment = Pedersen(secret, vote_direction, voting_power)
    component n2b_vote = Num2Bits(2);
    n2b_vote.in <== vote_direction;

    component n2b_power = Num2Bits(64);
    n2b_power.in <== voting_power;

    component ballot_hasher = Pedersen(320);
    for (var i = 0; i < 254; i++) {
        ballot_hasher.in[i] <== n2b_secret.out[i];
    }
    for (var i = 0; i < 2; i++) {
        ballot_hasher.in[254 + i] <== n2b_vote.out[i];
    }
    for (var i = 0; i < 64; i++) {
        ballot_hasher.in[256 + i] <== n2b_power.out[i];
    }

    ballot_commitment <== ballot_hasher.out[0];
    public_commitment <== ballot_hasher.out[0];
    is_compliant <== vp_positive.out;
}

component main {public [vote_direction, proposal_id, nullifier_hash]} = PrivateVote();
