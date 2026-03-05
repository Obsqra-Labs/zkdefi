pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/poseidon.circom";

// CreditEligibility: proves credit_score >= threshold AND collateral >= min
// without revealing exact values.
//
// Private inputs:
//   credit_score     - actual credit score (300-850 range)
//   collateral_wei   - actual collateral in wei
//   blinding         - random blinding factor for commitment
//
// Public inputs:
//   min_credit_score  - minimum credit score required
//   min_collateral    - minimum collateral required (wei)
//   commitment_hash   - Poseidon(credit_score, collateral_wei, blinding)

template CreditEligibility() {
    signal input credit_score;
    signal input collateral_wei;
    signal input blinding;

    signal input min_credit_score;
    signal input min_collateral;
    signal input commitment_hash;

    signal output eligible;

    // Verify commitment binds the private inputs
    component hasher = Poseidon(3);
    hasher.inputs[0] <== credit_score;
    hasher.inputs[1] <== collateral_wei;
    hasher.inputs[2] <== blinding;
    commitment_hash === hasher.out;

    // Check credit_score >= min_credit_score
    component score_check = GreaterEqThan(32);
    score_check.in[0] <== credit_score;
    score_check.in[1] <== min_credit_score;

    // Check collateral_wei >= min_collateral
    component collateral_check = GreaterEqThan(128);
    collateral_check.in[0] <== collateral_wei;
    collateral_check.in[1] <== min_collateral;

    // Eligible iff both checks pass
    eligible <== score_check.out * collateral_check.out;
    eligible === 1;
}

component main {public [min_credit_score, min_collateral, commitment_hash]} = CreditEligibility();
