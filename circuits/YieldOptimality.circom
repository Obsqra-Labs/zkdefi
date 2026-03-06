pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * YieldOptimality Circuit
 *
 * Privacy-preserving yield optimality verification for zkde.fi.
 * Proves that a pool allocation achieves near-optimal expected yield
 * across 8 pools WITHOUT revealing individual allocations or yields.
 *
 * Optimality check:
 *   actual_expected_yield >= max_single_yield - optimality_threshold_bps
 *   (i.e. the blended yield is within threshold of the best single pool)
 *
 * Privacy guarantees:
 *   - Pool allocations are PRIVATE
 *   - Predicted per-pool yields are PRIVATE
 *   - Blended expected yield witness is PRIVATE
 *   - Only optimality boolean is PUBLIC
 */

template YieldOptimalityModel() {
    var N_POOLS = 8;

    // === PRIVATE INPUTS ===
    signal input allocations[N_POOLS];
    signal input predicted_yields[N_POOLS];
    signal input actual_expected_yield;

    // === PUBLIC INPUTS ===
    signal input max_single_yield;
    signal input optimality_threshold_bps;
    signal input scale;

    // === OUTPUT ===
    signal output is_valid;

    // === CONSTRAINTS ===

    // Compute total allocation and weighted yield
    signal alloc_times_yield[N_POOLS];
    for (var i = 0; i < N_POOLS; i++) {
        alloc_times_yield[i] <== allocations[i] * predicted_yields[i];
    }

    signal cum_alloc[N_POOLS + 1];
    cum_alloc[0] <== 0;
    signal cum_weighted[N_POOLS + 1];
    cum_weighted[0] <== 0;

    for (var i = 0; i < N_POOLS; i++) {
        cum_alloc[i + 1] <== cum_alloc[i] + allocations[i];
        cum_weighted[i + 1] <== cum_weighted[i] + alloc_times_yield[i];
    }

    signal total_alloc;
    total_alloc <== cum_alloc[N_POOLS];

    signal weighted_yield;
    weighted_yield <== cum_weighted[N_POOLS];

    // Verify actual_expected_yield = floor(weighted_yield / total_alloc)
    //   actual_expected_yield * total_alloc <= weighted_yield
    //     < (actual_expected_yield + 1) * total_alloc
    signal lower_bound;
    lower_bound <== actual_expected_yield * total_alloc;

    signal upper_bound;
    upper_bound <== (actual_expected_yield + 1) * total_alloc;

    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== weighted_yield;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(64);
    lt_upper.in[0] <== weighted_yield;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Optimality: (max_single_yield - actual_expected_yield) <= optimality_threshold_bps
    signal yield_gap;
    yield_gap <== max_single_yield - actual_expected_yield;

    component le_threshold = LessEqThan(64);
    le_threshold.in[0] <== yield_gap;
    le_threshold.in[1] <== optimality_threshold_bps;

    is_valid <== le_threshold.out;
}

template YieldOptimalityVerifier() {
    var N_POOLS = 8;

    // Private inputs
    signal input allocations[N_POOLS];
    signal input predicted_yields[N_POOLS];
    signal input actual_expected_yield;

    // Public inputs
    signal input max_single_yield;
    signal input optimality_threshold_bps;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component yield_model = YieldOptimalityModel();
    for (var i = 0; i < N_POOLS; i++) {
        yield_model.allocations[i] <== allocations[i];
        yield_model.predicted_yields[i] <== predicted_yields[i];
    }
    yield_model.actual_expected_yield <== actual_expected_yield;
    yield_model.max_single_yield <== max_single_yield;
    yield_model.optimality_threshold_bps <== optimality_threshold_bps;
    yield_model.scale <== scale;

    is_compliant <== yield_model.is_valid;
    public_commitment <== commitment_hash;
}

component main {public [max_single_yield, optimality_threshold_bps, scale, user_address, commitment_hash]} = YieldOptimalityVerifier();
