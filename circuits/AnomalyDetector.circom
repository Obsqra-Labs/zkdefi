pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * AnomalyDetector Circuit
 * 
 * Privacy-preserving anomaly detection for zkde.fi agent.
 * Proves that a pool/protocol is safe (anomaly_flag == 0) WITHOUT revealing analysis.
 * 
 * Model: Multi-factor anomaly scoring
 *   - TVL stability check
 *   - Liquidity concentration check
 *   - Price impact check
 *   - Deployer reputation check
 *   - Volume pattern check
 * 
 * Privacy guarantees:
 *   - Pool analysis details are PRIVATE
 *   - Scoring logic is PRIVATE
 *   - Individual risk factors are PRIVATE
 *   - Only safety status (boolean) is PUBLIC
 */

template SafetyCheck(THRESHOLD) {
    signal input value;
    signal input max_allowed;
    signal output is_safe;
    
    component lt = LessThan(64);
    lt.in[0] <== value;
    lt.in[1] <== max_allowed;
    is_safe <== lt.out;
}

template AnomalyScorer(N_FACTORS) {
    // === PRIVATE INPUTS ===
    signal input risk_factors[N_FACTORS];         // Individual risk scores (private)
    signal input factor_weights[N_FACTORS];       // Weights for each factor (private)
    signal input factor_thresholds[N_FACTORS];    // Per-factor thresholds (private)
    
    // === PUBLIC INPUTS ===
    signal input max_anomaly_score;               // Max allowed total score (public)
    
    // === OUTPUT ===
    signal output is_safe;                        // 1 if no anomaly detected
    signal output anomaly_flag;                   // 0 = safe, 1 = anomaly
    
    // === CONSTRAINTS ===
    
    // Step 1: Check each factor against its threshold
    component factor_checks[N_FACTORS];
    signal factor_pass[N_FACTORS];
    
    for (var i = 0; i < N_FACTORS; i++) {
        factor_checks[i] = SafetyCheck(64);
        factor_checks[i].value <== risk_factors[i];
        factor_checks[i].max_allowed <== factor_thresholds[i];
        factor_pass[i] <== factor_checks[i].is_safe;
    }
    
    // Step 2: Compute weighted anomaly score
    signal weighted_scores[N_FACTORS + 1];
    signal penalties[N_FACTORS];
    weighted_scores[0] <== 0;
    
    for (var i = 0; i < N_FACTORS; i++) {
        // If factor fails its threshold, add weighted penalty
        penalties[i] <== (1 - factor_pass[i]) * factor_weights[i];
        weighted_scores[i + 1] <== weighted_scores[i] + penalties[i];
    }
    
    signal total_anomaly_score;
    total_anomaly_score <== weighted_scores[N_FACTORS];
    
    // Step 3: Check total anomaly score
    component total_check = LessThan(64);
    total_check.in[0] <== total_anomaly_score;
    total_check.in[1] <== max_anomaly_score;
    
    is_safe <== total_check.out;
    anomaly_flag <== 1 - is_safe;
}

/*
 * AnomalyDetectorVerifier
 * 
 * Main circuit for pool/protocol safety verification.
 * Uses 6 risk factors by default.
 * 
 * Risk Factors:
 *   0: tvl_volatility (0-1000, scaled)
 *   1: liquidity_concentration (0-100, % in top providers)
 *   2: price_impact_score (0-1000, scaled)
 *   3: deployer_age_days (0-3650, days since deployment)
 *   4: volume_anomaly (0-1000, deviation from normal)
 *   5: contract_risk_score (0-100, from analysis)
 */
template AnomalyDetectorVerifier() {
    var N_FACTORS = 6;
    
    // Private inputs - pool analysis data
    signal input tvl_volatility;
    signal input liquidity_concentration;
    signal input price_impact_score;
    signal input deployer_age_days;
    signal input volume_anomaly;
    signal input contract_risk_score;
    
    // Private inputs - model parameters
    signal input factor_weights[N_FACTORS];
    signal input factor_thresholds[N_FACTORS];
    
    // Public inputs
    signal input max_anomaly_score;
    signal input pool_id;              // For binding to specific pool
    signal input user_address;         // For binding to user
    signal input commitment_hash;      // For replay safety
    
    // Output
    signal output is_safe;
    signal output anomaly_flag;
    signal output public_commitment;
    
    // Assemble risk factors array
    signal risk_factors[N_FACTORS];
    risk_factors[0] <== tvl_volatility;
    risk_factors[1] <== liquidity_concentration;
    risk_factors[2] <== price_impact_score;
    risk_factors[3] <== deployer_age_days;
    risk_factors[4] <== volume_anomaly;
    risk_factors[5] <== contract_risk_score;
    
    // Run anomaly detection
    component scorer = AnomalyScorer(N_FACTORS);
    scorer.risk_factors <== risk_factors;
    scorer.factor_weights <== factor_weights;
    scorer.factor_thresholds <== factor_thresholds;
    scorer.max_anomaly_score <== max_anomaly_score;
    
    is_safe <== scorer.is_safe;
    anomaly_flag <== scorer.anomaly_flag;
    
    // Bind commitment
    public_commitment <== commitment_hash;
}

component main {public [max_anomaly_score, pool_id, user_address, commitment_hash]} = AnomalyDetectorVerifier();
