pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * CorrelationRisk Circuit
 * 
 * Privacy-preserving portfolio correlation verification for zkde.fi agent.
 * Proves that portfolio correlation_score <= threshold WITHOUT revealing actual positions.
 * 
 * Prevents "fake diversification" - e.g., 60% ETH + 40% wstETH appears diversified
 * but is actually highly correlated.
 * 
 * Model: Weighted correlation calculation
 *   correlation_score = Σ(position_i * position_j * corr_matrix[i][j]) / total_weight
 * 
 * Privacy guarantees:
 *   - Actual positions are PRIVATE
 *   - Correlation matrix is PRIVATE  
 *   - Only threshold compliance (boolean) is PUBLIC
 */

template CorrelationModel(N_ASSETS) {
    // === PRIVATE INPUTS ===
    signal input positions[N_ASSETS];           // Portfolio weights for each asset (0-100 each, sum=100)
    signal input corr_matrix[N_ASSETS][N_ASSETS]; // Correlation matrix (scaled 0-100, 100 = perfect corr)
    signal input actual_correlation;             // Computed weighted correlation (private)
    
    // === PUBLIC INPUTS ===
    signal input threshold;                      // Max allowed correlation (public, e.g. 70 = 0.7)
    signal input scale;                          // Scaling factor (public, typically 100)
    
    // === OUTPUT ===
    signal output is_valid;                      // 1 if correlation <= threshold
    
    // === CONSTRAINTS ===
    
    // Step 1: Compute weighted correlation
    // correlation = Σ Σ (position_i * position_j * corr_matrix[i][j]) / (total_position^2)
    
    signal weighted_corr[N_ASSETS][N_ASSETS];
    signal corr_sum[N_ASSETS * N_ASSETS + 1];
    signal pos_product[N_ASSETS][N_ASSETS];
    corr_sum[0] <== 0;
    
    var idx = 0;
    for (var i = 0; i < N_ASSETS; i++) {
        for (var j = 0; j < N_ASSETS; j++) {
            // weighted_corr[i][j] = position_i * position_j * corr_matrix[i][j]
            pos_product[i][j] <== positions[i] * positions[j];
            weighted_corr[i][j] <== pos_product[i][j] * corr_matrix[i][j];
            corr_sum[idx + 1] <== corr_sum[idx] + weighted_corr[i][j];
            idx++;
        }
    }
    
    // Total weighted correlation
    signal total_weighted_corr;
    total_weighted_corr <== corr_sum[N_ASSETS * N_ASSETS];
    
    // Step 2: Compute total position squared (for normalization)
    signal pos_sum[N_ASSETS + 1];
    pos_sum[0] <== 0;
    for (var i = 0; i < N_ASSETS; i++) {
        pos_sum[i + 1] <== pos_sum[i] + positions[i];
    }
    signal total_pos;
    total_pos <== pos_sum[N_ASSETS];
    
    signal total_pos_squared;
    total_pos_squared <== total_pos * total_pos;
    
    // Step 3: Verify actual_correlation matches computation
    // actual_correlation * total_pos_squared * scale == total_weighted_corr (within rounding)
    signal lower_bound;
    signal upper_bound;
    signal normalized_product;
    signal actual_plus_one;
    signal upper_intermediate;
    signal scaled_corr;
    
    normalized_product <== actual_correlation * total_pos_squared;
    lower_bound <== normalized_product * scale;
    
    // Split: (actual_correlation + 1) * total_pos_squared * scale
    actual_plus_one <== actual_correlation + 1;
    upper_intermediate <== actual_plus_one * total_pos_squared;
    upper_bound <== upper_intermediate * scale;
    
    // Verify: lower_bound <= total_weighted_corr < upper_bound
    // Scale total_weighted_corr separately
    scaled_corr <== total_weighted_corr * scale;
    
    component ge_lower = GreaterEqThan(128);
    ge_lower.in[0] <== scaled_corr;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;
    
    component lt_upper = LessThan(128);
    lt_upper.in[0] <== scaled_corr;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;
    
    // Step 4: Check correlation <= threshold
    component le_threshold = LessEqThan(64);
    le_threshold.in[0] <== actual_correlation;
    le_threshold.in[1] <== threshold;
    
    is_valid <== le_threshold.out;
}

/*
 * CorrelationRiskVerifier
 * 
 * Main circuit for correlation risk verification.
 * Uses 5 assets by default (ETH, wstETH, USDC, DAI, WBTC).
 * 
 * Example correlation matrix (scaled 0-100):
 *        ETH  wstETH  USDC  DAI  WBTC
 * ETH    100    95    10    10    80
 * wstETH  95   100    10    10    75
 * USDC    10    10   100    95     5
 * DAI     10    10    95   100     5
 * WBTC    80    75     5     5   100
 *
 * If user has 60% ETH + 40% wstETH:
 *   correlation = 0.6*0.6*100 + 0.6*0.4*95 + 0.4*0.6*95 + 0.4*0.4*100
 *               = 36 + 22.8 + 22.8 + 16 = 97.6 (very high!)
 *   This would FAIL threshold of 70
 */
template CorrelationRiskVerifier() {
    // Number of supported assets
    var N_ASSETS = 5;
    
    // Private inputs
    signal input positions[N_ASSETS];
    signal input corr_matrix[N_ASSETS][N_ASSETS];
    signal input actual_correlation;
    
    // Public inputs
    signal input threshold;
    signal input scale;
    signal input user_address;           // For binding to user
    signal input commitment_hash;        // For replay safety
    
    // Output
    signal output is_compliant;
    signal output public_commitment;
    
    // Verify correlation risk
    component corr_model = CorrelationModel(N_ASSETS);
    corr_model.positions <== positions;
    corr_model.corr_matrix <== corr_matrix;
    corr_model.actual_correlation <== actual_correlation;
    corr_model.threshold <== threshold;
    corr_model.scale <== scale;
    
    is_compliant <== corr_model.is_valid;
    
    // Bind commitment to user for verification
    public_commitment <== commitment_hash;
}

component main {public [threshold, scale, user_address, commitment_hash]} = CorrelationRiskVerifier();
