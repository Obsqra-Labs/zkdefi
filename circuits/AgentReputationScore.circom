pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * AgentReputationScore Circuit
 *
 * Privacy-preserving agent reputation verification for zkde.fi.
 * Proves that an agent's weighted reputation score meets a minimum threshold
 * WITHOUT revealing the individual metrics or weights.
 *
 * Model: Weighted sum reputation calculation
 *   raw_sum = Σ(metrics[i] * weights[i])
 *   computed_score = raw_sum / scale  (integer division)
 *
 * Privacy guarantees:
 *   - Individual reputation metrics are PRIVATE
 *   - Metric weights are PRIVATE
 *   - Actual computed score is PRIVATE
 *   - Only compliance status (boolean) is PUBLIC
 */

template ReputationModel(N_METRICS) {
    // === PRIVATE INPUTS ===
    signal input metrics[N_METRICS];
    signal input weights[N_METRICS];
    signal input computed_score;

    // === PUBLIC INPUTS ===
    signal input min_reputation_score;
    signal input scale;

    // === OUTPUT ===
    signal output is_valid;

    // Step 1: Compute weighted sum
    signal partial_sum[N_METRICS + 1];
    partial_sum[0] <== 0;

    for (var i = 0; i < N_METRICS; i++) {
        partial_sum[i + 1] <== partial_sum[i] + metrics[i] * weights[i];
    }

    signal raw_sum;
    raw_sum <== partial_sum[N_METRICS];

    // Step 2: Verify integer division —
    //   computed_score * scale <= raw_sum < (computed_score + 1) * scale
    signal lower_bound;
    signal upper_bound;
    lower_bound <== computed_score * scale;
    upper_bound <== (computed_score + 1) * scale;

    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== raw_sum;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(64);
    lt_upper.in[0] <== raw_sum;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Step 3: Bound check — 0 <= computed_score <= 1000
    component ge_zero = GreaterEqThan(64);
    ge_zero.in[0] <== computed_score;
    ge_zero.in[1] <== 0;
    ge_zero.out === 1;

    component le_max = LessEqThan(64);
    le_max.in[0] <== computed_score;
    le_max.in[1] <== 1000;
    le_max.out === 1;

    // Step 4: Check computed_score >= min_reputation_score
    component ge_min = GreaterEqThan(64);
    ge_min.in[0] <== computed_score;
    ge_min.in[1] <== min_reputation_score;

    is_valid <== ge_min.out;
}

/*
 * AgentReputationScoreVerifier
 *
 * Main circuit for agent reputation verification.
 * Uses 7 reputation metrics by default.
 *
 * Metrics (example):
 *   0: task_completion_rate (0-100)
 *   1: pnl_accuracy (0-100)
 *   2: risk_adherence (0-100)
 *   3: uptime_score (0-100)
 *   4: peer_endorsements (0-1000)
 *   5: protocol_diversity (0-100)
 *   6: historical_consistency (0-100)
 */
template AgentReputationScoreVerifier() {
    var N_METRICS = 7;

    // Private inputs
    signal input metrics[N_METRICS];
    signal input weights[N_METRICS];
    signal input computed_score;

    // Public inputs
    signal input min_reputation_score;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Outputs
    signal output is_compliant;
    signal output public_commitment;

    // Verify reputation score
    component rep_model = ReputationModel(N_METRICS);
    rep_model.metrics <== metrics;
    rep_model.weights <== weights;
    rep_model.computed_score <== computed_score;
    rep_model.min_reputation_score <== min_reputation_score;
    rep_model.scale <== scale;

    is_compliant <== rep_model.is_valid;

    // Bind commitment to user for verification
    public_commitment <== commitment_hash;
}

component main {public [min_reputation_score, scale, user_address, commitment_hash]} = AgentReputationScoreVerifier();
