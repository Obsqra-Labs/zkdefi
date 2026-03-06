pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * MEVResistanceProof Circuit
 *
 * Privacy-preserving MEV resistance verification for zkde.fi.
 * Proves that a transaction was not subject to MEV extraction by
 * verifying inclusion delay and price deviation are within bounds,
 * WITHOUT revealing block numbers, prices, or relay details.
 *
 * Checks:
 *   1. inclusion_block >= submission_block
 *   2. delay = inclusion_block - submission_block <= max_delay_blocks
 *   3. |actual_price - expected_price| deviation is within max_price_deviation_bps
 *
 * Privacy guarantees:
 *   - Submission / inclusion blocks are PRIVATE
 *   - Expected / actual prices are PRIVATE
 *   - Relay commitment is PRIVATE
 *   - Only MEV-resistance boolean is PUBLIC
 */

template MEVResistanceModel() {
    // === PRIVATE INPUTS ===
    signal input submission_block;
    signal input inclusion_block;
    signal input expected_price;
    signal input actual_price;
    signal input relay_commitment;
    signal input computed_deviation_bps;

    // === PUBLIC INPUTS ===
    signal input max_delay_blocks;
    signal input max_price_deviation_bps;
    signal input scale;

    // === OUTPUT ===
    signal output is_valid;

    // === CONSTRAINTS ===

    // 1. inclusion_block >= submission_block
    component ge_order = GreaterEqThan(64);
    ge_order.in[0] <== inclusion_block;
    ge_order.in[1] <== submission_block;
    ge_order.out === 1;

    // 2. delay = inclusion_block - submission_block <= max_delay_blocks
    signal delay;
    delay <== inclusion_block - submission_block;

    component le_delay = LessEqThan(64);
    le_delay.in[0] <== delay;
    le_delay.in[1] <== max_delay_blocks;

    signal delay_ok;
    delay_ok <== le_delay.out;

    // 3. Compute |actual_price - expected_price|
    //    We compare both directions and pick the non-negative one.
    //    abs_diff = max(actual - expected, expected - actual)
    //    Since one will underflow in field arithmetic, we use comparators.

    component price_ge = GreaterEqThan(64);
    price_ge.in[0] <== actual_price;
    price_ge.in[1] <== expected_price;

    // If actual >= expected: abs_diff = actual - expected
    // If actual <  expected: abs_diff = expected - actual
    signal diff_pos;
    diff_pos <== actual_price - expected_price;

    signal diff_neg;
    diff_neg <== expected_price - actual_price;

    // abs_diff = price_ge.out * diff_pos + (1 - price_ge.out) * diff_neg
    signal abs_part_pos;
    abs_part_pos <== price_ge.out * diff_pos;

    signal abs_part_neg_selector;
    abs_part_neg_selector <== 1 - price_ge.out;

    signal abs_part_neg;
    abs_part_neg <== abs_part_neg_selector * diff_neg;

    signal abs_diff;
    abs_diff <== abs_part_pos + abs_part_neg;

    // Verify computed_deviation_bps = floor(abs_diff * scale / expected_price)
    //   computed_deviation_bps * expected_price <= abs_diff * scale
    //     < (computed_deviation_bps + 1) * expected_price
    signal numerator;
    numerator <== abs_diff * scale;

    signal lower_bound;
    lower_bound <== computed_deviation_bps * expected_price;

    signal upper_bound;
    upper_bound <== (computed_deviation_bps + 1) * expected_price;

    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== numerator;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(64);
    lt_upper.in[0] <== numerator;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Check computed_deviation_bps <= max_price_deviation_bps
    component le_dev = LessEqThan(64);
    le_dev.in[0] <== computed_deviation_bps;
    le_dev.in[1] <== max_price_deviation_bps;

    signal deviation_ok;
    deviation_ok <== le_dev.out;

    // Both delay and deviation must be within bounds
    is_valid <== delay_ok * deviation_ok;
}

template MEVResistanceVerifier() {
    // Private inputs
    signal input submission_block;
    signal input inclusion_block;
    signal input expected_price;
    signal input actual_price;
    signal input relay_commitment;
    signal input computed_deviation_bps;

    // Public inputs
    signal input max_delay_blocks;
    signal input max_price_deviation_bps;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component mev_model = MEVResistanceModel();
    mev_model.submission_block <== submission_block;
    mev_model.inclusion_block <== inclusion_block;
    mev_model.expected_price <== expected_price;
    mev_model.actual_price <== actual_price;
    mev_model.relay_commitment <== relay_commitment;
    mev_model.computed_deviation_bps <== computed_deviation_bps;
    mev_model.max_delay_blocks <== max_delay_blocks;
    mev_model.max_price_deviation_bps <== max_price_deviation_bps;
    mev_model.scale <== scale;

    is_compliant <== mev_model.is_valid;
    public_commitment <== commitment_hash;
}

component main {public [max_delay_blocks, max_price_deviation_bps, scale, user_address, commitment_hash]} = MEVResistanceVerifier();
