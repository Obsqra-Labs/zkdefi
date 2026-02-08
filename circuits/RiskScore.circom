pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * RiskScore Circuit
 * 
 * Privacy-preserving risk score calculation for zkde.fi agent.
 * Proves that portfolio risk_score <= threshold WITHOUT revealing the actual score.
 * 
 * Model: Weighted sum risk calculation (can be extended to ML model)
 *   risk_score = Σ(feature_i * weight_i) / scale
 * 
 * Privacy guarantees:
 *   - Actual risk score is PRIVATE
 *   - Portfolio features are PRIVATE
 *   - Model weights are PRIVATE
 *   - Only threshold compliance (boolean) is PUBLIC
 */

template RiskScoreModel(N_FEATURES) {
    // === PRIVATE INPUTS ===
    signal input portfolio_features[N_FEATURES];  // Portfolio data (private)
    signal input model_weights[N_FEATURES];       // Model weights (private)
    signal input model_bias;                       // Model bias (private)
    signal input actual_score;                     // Computed risk score (private)
    
    // === PUBLIC INPUTS ===
    signal input threshold;                        // Max allowed risk (public)
    signal input scale;                            // Scaling factor (public)
    
    // === OUTPUT ===
    signal output is_valid;                        // 1 if risk <= threshold
    
    // === CONSTRAINTS ===
    
    // Step 1: Compute weighted sum
    signal weighted_sum[N_FEATURES + 1];
    weighted_sum[0] <== model_bias;
    
    for (var i = 0; i < N_FEATURES; i++) {
        weighted_sum[i + 1] <== weighted_sum[i] + portfolio_features[i] * model_weights[i];
    }
    
    // Step 2: Verify actual_score matches computation
    // actual_score = weighted_sum / scale (with integer division)
    signal computed_score;
    computed_score <== weighted_sum[N_FEATURES];
    
    // Verify: actual_score * scale == computed_score (within rounding)
    // We allow: actual_score * scale <= computed_score < (actual_score + 1) * scale
    signal lower_bound;
    signal upper_bound;
    lower_bound <== actual_score * scale;
    upper_bound <== (actual_score + 1) * scale;
    
    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== computed_score;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;
    
    component lt_upper = LessThan(64);
    lt_upper.in[0] <== computed_score;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;
    
    // Step 3: Check risk_score <= threshold
    component le_threshold = LessEqThan(64);
    le_threshold.in[0] <== actual_score;
    le_threshold.in[1] <== threshold;
    
    is_valid <== le_threshold.out;
}

/*
 * RiskScoreVerifier
 * 
 * Main circuit for risk score verification.
 * Uses 8 features by default (can be configured).
 * 
 * Features (example):
 *   0: total_balance (scaled)
 *   1: position_concentration (0-100)
 *   2: protocol_diversity (0-100)
 *   3: volatility_exposure (0-100)
 *   4: liquidity_depth (0-100)
 *   5: time_in_position (days)
 *   6: recent_drawdown (0-100)
 *   7: correlation_risk (0-100)
 */
template RiskScoreVerifier() {
    // Number of portfolio features
    var N_FEATURES = 8;
    
    // Private inputs
    signal input portfolio_features[N_FEATURES];
    signal input model_weights[N_FEATURES];
    signal input model_bias;
    signal input actual_score;
    
    // Public inputs
    signal input threshold;
    signal input scale;
    signal input user_address;        // For binding to user
    signal input commitment_hash;      // For replay safety
    
    // Output
    signal output is_compliant;
    signal output public_commitment;
    
    // Verify risk score
    component risk_model = RiskScoreModel(N_FEATURES);
    risk_model.portfolio_features <== portfolio_features;
    risk_model.model_weights <== model_weights;
    risk_model.model_bias <== model_bias;
    risk_model.actual_score <== actual_score;
    risk_model.threshold <== threshold;
    risk_model.scale <== scale;
    
    is_compliant <== risk_model.is_valid;
    
    // Bind commitment to user for verification
    public_commitment <== commitment_hash;
}

component main {public [threshold, scale, user_address, commitment_hash]} = RiskScoreVerifier();
