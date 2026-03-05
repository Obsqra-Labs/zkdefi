pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";

/*
 * ExecutionIntegrity Circuit
 *
 * Proves delay/slippage/fair-routing constraints were satisfied
 * for a trade or rebalance execution.
 */

template ExecutionIntegrityModel() {
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

    // Outputs
    signal output delay_ok;
    signal output price_ok;
    signal output route_ok;
    signal output execution_valid;
    signal output data_binding;

    // inclusion >= submission
    component incl_ge_sub = GreaterEqThan(64);
    incl_ge_sub.in[0] <== inclusion_block;
    incl_ge_sub.in[1] <== submission_block;
    incl_ge_sub.out === 1;

    signal block_delay;
    block_delay <== inclusion_block - submission_block;

    component delay_le_max = LessEqThan(64);
    delay_le_max.in[0] <== block_delay;
    delay_le_max.in[1] <== max_delay_blocks;
    delay_ok <== delay_le_max.out;

    // expected_price > 0
    component expected_gt_zero = GreaterThan(64);
    expected_gt_zero.in[0] <== expected_price;
    expected_gt_zero.in[1] <== 0;
    expected_gt_zero.out === 1;

    // abs(actual - expected)
    component actual_ge_expected = GreaterEqThan(64);
    actual_ge_expected.in[0] <== actual_price;
    actual_ge_expected.in[1] <== expected_price;

    signal diff_pos;
    signal diff_neg;
    signal abs_diff;
    signal sel;

    diff_pos <== actual_price - expected_price;
    diff_neg <== expected_price - actual_price;
    sel <== actual_ge_expected.out;
    // abs_diff = sel * diff_pos + (1 - sel) * diff_neg
    //          = diff_neg + sel * (diff_pos - diff_neg)   [quadratic form]
    signal sel_times_delta;
    sel_times_delta <== sel * (diff_pos - diff_neg);
    abs_diff <== diff_neg + sel_times_delta;

    // computed_deviation_bps ~= abs_diff * scale / expected_price
    signal dev_num;
    signal dev_lower;
    signal dev_upper;

    dev_num <== abs_diff * scale;
    dev_lower <== computed_deviation_bps * expected_price;
    dev_upper <== (computed_deviation_bps + 1) * expected_price;

    component ge_dev_lower = GreaterEqThan(128);
    ge_dev_lower.in[0] <== dev_num;
    ge_dev_lower.in[1] <== dev_lower;
    ge_dev_lower.out === 1;

    component lt_dev_upper = LessThan(128);
    lt_dev_upper.in[0] <== dev_num;
    lt_dev_upper.in[1] <== dev_upper;
    lt_dev_upper.out === 1;

    component dev_le_max = LessEqThan(64);
    dev_le_max.in[0] <== computed_deviation_bps;
    dev_le_max.in[1] <== max_price_deviation_bps;
    price_ok <== dev_le_max.out;

    // Route/relay/policy commitments must be non-zero.
    component route_zero = IsZero();
    route_zero.in <== route_commitment;

    component relay_zero = IsZero();
    relay_zero.in <== relay_commitment;

    component policy_zero = IsZero();
    policy_zero.in <== required_route_policy_hash;

    signal route_used;
    signal relay_used;
    signal policy_set;
    route_used <== 1 - route_zero.out;
    relay_used <== 1 - relay_zero.out;
    policy_set <== 1 - policy_zero.out;

    signal route_relay;
    route_relay <== route_used * relay_used;
    route_ok <== route_relay * policy_set;

    signal delay_and_price;
    delay_and_price <== delay_ok * price_ok;
    execution_valid <== delay_and_price * route_ok;

    data_binding <==
        submission_block * 7 +
        inclusion_block * 11 +
        expected_price * 13 +
        actual_price * 17 +
        route_commitment * 19 +
        relay_commitment * 23 +
        computed_deviation_bps * 29 +
        blinding * 31;
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

    // Outputs
    signal output delay_ok;
    signal output price_ok;
    signal output route_ok;
    signal output execution_valid;
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

    delay_ok <== model.delay_ok;
    price_ok <== model.price_ok;
    route_ok <== model.route_ok;
    execution_valid <== model.execution_valid;
    public_commitment <== model.data_binding + subject_id_hash + required_route_policy_hash;
}

component main {public [max_delay_blocks, max_price_deviation_bps, scale, required_route_policy_hash, subject_id_hash]} = ExecutionIntegrityVerifier();
