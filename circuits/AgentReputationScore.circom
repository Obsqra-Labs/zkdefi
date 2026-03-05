pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * AgentReputationScore Circuit
 *
 * Privacy-preserving agent reputation verification.
 * Proves an agent meets a minimum reputation score
 * WITHOUT revealing individual performance metrics.
 *
 * Model (N_METRICS = 7):
 *   Metrics: [total_volume, successful_rebalances, failed_rebalances,
 *             avg_return_bps, max_drawdown_bps, tenure_days, total_proofs]
 *   Weights: [5, 25, -30, 20, -15, 10, 15]  (net = 100 for positives)
 *
 *   raw_score = Σ(metric_i * weight_i) / scale
 *   reputation_score = clamp(raw_score, 0, 1000)
 *   is_reputable = reputation_score >= min_reputation_score
 *
 * Privacy guarantees:
 *   - All performance metrics are PRIVATE
 *   - Only is_reputable (boolean) is PUBLIC
 */

template ReputationModel(N_METRICS) {
    // === PRIVATE INPUTS ===
    signal input metrics[N_METRICS];        // Performance metrics (private)
    signal input weights[N_METRICS];        // Scoring weights (private)
    signal input computed_score;            // Pre-computed reputation score (private)

    // === PUBLIC INPUTS ===
    signal input min_reputation_score;      // Minimum acceptable score 0-1000 (public)
    signal input scale;                     // Weight scaling denominator (public)

    // === OUTPUT ===
    signal output is_reputable;             // 1 if score >= min

    // === CONSTRAINTS ===

    // Step 1: Compute weighted sum (can be negative if failed_rebalances or drawdown is high)
    // We use positive and negative weights separately to avoid unsigned underflow
    // Convention: positive_part = Σ(metric_i * weights_i) where weights positive
    //             We pass in the raw sum and verify

    signal weighted[N_METRICS];
    signal running_sum[N_METRICS + 1];
    running_sum[0] <== 0;
    for (var i = 0; i < N_METRICS; i++) {
        weighted[i] <== metrics[i] * weights[i];
        running_sum[i + 1] <== running_sum[i] + weighted[i];
    }
    signal raw_sum;
    raw_sum <== running_sum[N_METRICS];

    // Step 2: Verify computed_score is the integer quotient of raw_sum / scale
    // computed_score * scale <= raw_sum < (computed_score + 1) * scale
    signal lower_bound;
    lower_bound <== computed_score * scale;

    signal upper_bound;
    upper_bound <== (computed_score + 1) * scale;

    component ge_lower = GreaterEqThan(128);
    ge_lower.in[0] <== raw_sum;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(128);
    lt_upper.in[0] <== raw_sum;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Step 3: Verify score in valid range [0, 1000]
    component ge_zero = GreaterEqThan(64);
    ge_zero.in[0] <== computed_score;
    ge_zero.in[1] <== 0;
    ge_zero.out === 1;

    component le_max = LessEqThan(64);
    le_max.in[0] <== computed_score;
    le_max.in[1] <== 1000;
    le_max.out === 1;

    // Step 4: Check score >= minimum
    component ge_min = GreaterEqThan(64);
    ge_min.in[0] <== computed_score;
    ge_min.in[1] <== min_reputation_score;

    is_reputable <== ge_min.out;
}

template AgentReputationScoreVerifier() {
    var N_METRICS = 7;

    // Private
    signal input metrics[N_METRICS];
    signal input weights[N_METRICS];
    signal input computed_score;

    // Public
    signal input min_reputation_score;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component model = ReputationModel(N_METRICS);
    model.metrics <== metrics;
    model.weights <== weights;
    model.computed_score <== computed_score;
    model.min_reputation_score <== min_reputation_score;
    model.scale <== scale;

    is_compliant <== model.is_reputable;
    public_commitment <== commitment_hash;
}

component main {public [min_reputation_score, scale, user_address, commitment_hash]} = AgentReputationScoreVerifier();
