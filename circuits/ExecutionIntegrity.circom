pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * ExecutionIntegrity Circuit
 *
 * Proves trade execution met delay, price deviation, and routing constraints
 * without revealing trade details.
 *
 * Constraints:
 *   inclusion_block >= submission_block
 *   delay = inclusion_block - submission_block <= max_delay_blocks
 *   computed_deviation_bps = floor(abs_diff * scale / expected_price)
 *   computed_deviation_bps <= max_price_deviation_bps
 *   route_commitment != 0, relay_commitment != 0, required_route_policy_hash != 0
 */

template ExecutionIntegrityModel() {
    // === PRIVATE INPUTS ===
    signal input submission_block;
    signal input inclusion_block;
    signal input expected_price;
    signal input actual_price;
    signal input route_commitment;
    signal input relay_commitment;
    signal input computed_deviation_bps;
    signal input blinding;

    // === PUBLIC INPUTS ===
    signal input max_delay_blocks;
    signal input max_price_deviation_bps;
    signal input scale;
    signal input required_route_policy_hash;

    // === OUTPUT ===
    signal output is_valid;

    // Step 1: Verify inclusion_block >= submission_block
    component ge_block = GreaterEqThan(64);
    ge_block.in[0] <== inclusion_block;
    ge_block.in[1] <== submission_block;
    signal block_order_ok;
    block_order_ok <== ge_block.out;

    // Step 2: Check delay <= max_delay_blocks
    signal delay;
    delay <== inclusion_block - submission_block;

    component le_delay = LessEqThan(64);
    le_delay.in[0] <== delay;
    le_delay.in[1] <== max_delay_blocks;
    signal delay_ok;
    delay_ok <== le_delay.out;

    // Step 3: Compute abs(actual_price - expected_price)
    component price_cmp = GreaterEqThan(64);
    price_cmp.in[0] <== actual_price;
    price_cmp.in[1] <== expected_price;

    signal diff_if_ge;
    diff_if_ge <== actual_price - expected_price;
    signal diff_if_lt;
    diff_if_lt <== expected_price - actual_price;

    signal sel_ge;
    sel_ge <== price_cmp.out * diff_if_ge;
    signal not_ge;
    not_ge <== 1 - price_cmp.out;
    signal sel_lt;
    sel_lt <== not_ge * diff_if_lt;
    signal abs_diff;
    abs_diff <== sel_ge + sel_lt;

    // Step 4: Verify computed_deviation_bps = floor(abs_diff * scale / expected_price)
    signal numerator;
    numerator <== abs_diff * scale;

    signal lower_bound;
    lower_bound <== computed_deviation_bps * expected_price;
    signal upper_bound;
    upper_bound <== (computed_deviation_bps + 1) * expected_price;

    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== numerator;
    ge_lower.in[1] <== lower_bound;

    component lt_upper = LessThan(64);
    lt_upper.in[0] <== numerator;
    lt_upper.in[1] <== upper_bound;

    signal div_ok;
    div_ok <== ge_lower.out * lt_upper.out;

    // Step 5: Check deviation within bounds
    component le_dev = LessEqThan(64);
    le_dev.in[0] <== computed_deviation_bps;
    le_dev.in[1] <== max_price_deviation_bps;
    signal dev_ok;
    dev_ok <== le_dev.out;

    // Step 6: Check route commitments are non-zero
    component route_nz = IsZero();
    route_nz.in <== route_commitment;
    signal route_exists;
    route_exists <== 1 - route_nz.out;

    component relay_nz = IsZero();
    relay_nz.in <== relay_commitment;
    signal relay_exists;
    relay_exists <== 1 - relay_nz.out;

    component policy_nz = IsZero();
    policy_nz.in <== required_route_policy_hash;
    signal policy_exists;
    policy_exists <== 1 - policy_nz.out;

    signal route_ok;
    signal route_ok_partial;
    route_ok_partial <== route_exists * relay_exists;
    route_ok <== route_ok_partial * policy_exists;

    // Combine all checks
    signal check1;
    check1 <== block_order_ok * delay_ok;
    signal check2;
    check2 <== check1 * div_ok;
    signal check3;
    check3 <== check2 * dev_ok;
    is_valid <== check3 * route_ok;
}

template ExecutionIntegrityVerifier() {
    // Private inputs
    signal input submission_block;
    signal input inclusion_block;
    signal input expected_price;
    signal input actual_price;
    signal input route_commitment;
    signal input relay_commitment;
    signal input computed_deviation_bps;
    signal input blinding;

    // Public inputs
    signal input max_delay_blocks;
    signal input max_price_deviation_bps;
    signal input scale;
    signal input required_route_policy_hash;
    signal input subject_id_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component model = ExecutionIntegrityModel();
    model.submission_block <== submission_block;
    model.inclusion_block <== inclusion_block;
    model.expected_price <== expected_price;
    model.actual_price <== actual_price;
    model.route_commitment <== route_commitment;
    model.relay_commitment <== relay_commitment;
    model.computed_deviation_bps <== computed_deviation_bps;
    model.blinding <== blinding;
    model.max_delay_blocks <== max_delay_blocks;
    model.max_price_deviation_bps <== max_price_deviation_bps;
    model.scale <== scale;
    model.required_route_policy_hash <== required_route_policy_hash;

    is_compliant <== model.is_valid;
    public_commitment <== subject_id_hash;
}

component main {public [max_delay_blocks, max_price_deviation_bps, scale, required_route_policy_hash, subject_id_hash]} = ExecutionIntegrityVerifier();
