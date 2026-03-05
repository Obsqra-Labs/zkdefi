pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * YieldOptimality Circuit
 *
 * Privacy-preserving yield optimality verification.
 * Proves the chosen allocation is within ε of the optimal allocation
 * WITHOUT revealing the allocation vector, predicted yields, or volatilities.
 *
 * Model:
 *   expected_yield = Σ(allocation_i * predicted_yield_i) / total_allocation
 *   max_yield = max(predicted_yield_i) (best single-pool)
 *   optimality_gap = (max_yield - expected_yield) * 10000 / max_yield
 *   is_near_optimal = optimality_gap <= threshold_bps
 *
 * Privacy guarantees:
 *   - Allocation vector is PRIVATE
 *   - Predicted yields are PRIVATE
 *   - Only near-optimality (boolean) is PUBLIC
 */

template YieldOptimalityModel(N_POOLS) {
    // === PRIVATE INPUTS ===
    signal input allocations[N_POOLS];       // Capital allocated to each pool (private)
    signal input predicted_yields[N_POOLS];  // Expected yield per pool in bps (private)
    signal input max_single_yield;           // Best single-pool yield in bps (private)
    signal input actual_expected_yield;      // Computed portfolio yield in bps (private)

    // === PUBLIC INPUTS ===
    signal input optimality_threshold_bps;   // Max gap from optimal in bps (public)
    signal input scale;                      // Scaling factor (public)

    // === OUTPUT ===
    signal output is_near_optimal;           // 1 if within threshold of optimal

    // === CONSTRAINTS ===

    // Step 1: Verify max_single_yield >= each predicted_yield
    component max_checks[N_POOLS];
    for (var i = 0; i < N_POOLS; i++) {
        max_checks[i] = GreaterEqThan(64);
        max_checks[i].in[0] <== max_single_yield;
        max_checks[i].in[1] <== predicted_yields[i];
        max_checks[i].out === 1;
    }

    // Step 2: Verify max_single_yield equals at least one predicted_yield
    // (it must be an actual pool yield, not an arbitrary large number)
    // Check: Σ(max_single_yield == predicted_yields[i]) >= 1
    // We use product of differences: if none match, product != 0
    signal diffs[N_POOLS];
    signal diff_product[N_POOLS + 1];
    diff_product[0] <== 1;
    for (var i = 0; i < N_POOLS; i++) {
        diffs[i] <== max_single_yield - predicted_yields[i];
        diff_product[i + 1] <== diff_product[i] * diffs[i];
    }
    // Product must be 0 (at least one diff is 0)
    component prod_zero = IsZero();
    prod_zero.in <== diff_product[N_POOLS];
    prod_zero.out === 1;

    // Step 3: Compute total allocation
    signal alloc_sum[N_POOLS + 1];
    alloc_sum[0] <== 0;
    for (var i = 0; i < N_POOLS; i++) {
        alloc_sum[i + 1] <== alloc_sum[i] + allocations[i];
    }
    signal total_alloc;
    total_alloc <== alloc_sum[N_POOLS];

    // Step 4: Compute weighted yield sum
    signal weighted_yields[N_POOLS];
    signal yield_sum[N_POOLS + 1];
    yield_sum[0] <== 0;
    for (var i = 0; i < N_POOLS; i++) {
        weighted_yields[i] <== allocations[i] * predicted_yields[i];
        yield_sum[i + 1] <== yield_sum[i] + weighted_yields[i];
    }
    signal total_weighted_yield;
    total_weighted_yield <== yield_sum[N_POOLS];

    // Step 5: Verify actual_expected_yield matches computation
    // actual_expected_yield = total_weighted_yield / total_alloc (integer division)
    signal lower_bound;
    signal upper_bound;
    lower_bound <== actual_expected_yield * total_alloc;
    upper_bound <== (actual_expected_yield + 1) * total_alloc;

    component ge_lower = GreaterEqThan(128);
    ge_lower.in[0] <== total_weighted_yield;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(128);
    lt_upper.in[0] <== total_weighted_yield;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Step 6: Check optimality gap
    // gap_bps = (max_single_yield - actual_expected_yield) * 10000 / max_single_yield
    // Rearranged: gap_bps * max_single_yield <= (max - actual) * 10000
    // And: gap_bps * max_single_yield >= (max - actual - 1) * 10000 (rounding)
    // We just need: (max - actual) * 10000 <= threshold * max_single_yield
    signal yield_gap;
    yield_gap <== max_single_yield - actual_expected_yield;

    signal gap_scaled;
    gap_scaled <== yield_gap * 10000;

    signal threshold_scaled;
    threshold_scaled <== optimality_threshold_bps * max_single_yield;

    component le_optimal = LessEqThan(128);
    le_optimal.in[0] <== gap_scaled;
    le_optimal.in[1] <== threshold_scaled;

    is_near_optimal <== le_optimal.out;
}

template YieldOptimalityVerifier() {
    var N_POOLS = 8;

    // Private
    signal input allocations[N_POOLS];
    signal input predicted_yields[N_POOLS];
    signal input max_single_yield;
    signal input actual_expected_yield;

    // Public
    signal input optimality_threshold_bps;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component model = YieldOptimalityModel(N_POOLS);
    model.allocations <== allocations;
    model.predicted_yields <== predicted_yields;
    model.max_single_yield <== max_single_yield;
    model.actual_expected_yield <== actual_expected_yield;
    model.optimality_threshold_bps <== optimality_threshold_bps;
    model.scale <== scale;

    is_compliant <== model.is_near_optimal;
    public_commitment <== commitment_hash;
}

component main {public [optimality_threshold_bps, scale, user_address, commitment_hash]} = YieldOptimalityVerifier();
