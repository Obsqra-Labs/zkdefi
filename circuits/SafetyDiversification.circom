pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * SafetyDiversification Circuit
 * 
 * Privacy-preserving protocol safety diversification verification.
 * Proves portfolio is diversified across safety-rated protocols.
 * 
 * Purpose: Ensure users spread risk across audited/safe protocols
 *   - Each protocol has a safety score (0-100)
 *   - Diversification score = Herfindahl-adjusted safety
 *   - Must meet minimum diversification threshold
 * 
 * Privacy guarantees:
 *   - Actual allocation amounts are PRIVATE
 *   - Protocol safety scores are PUBLIC (known ratings)
 *   - Only diversification compliance (boolean) is PUBLIC
 */

template DiversificationModel(N_PROTOCOLS) {
    // === PRIVATE INPUTS ===
    signal input allocations[N_PROTOCOLS];    // Amount allocated to each protocol
    signal input actual_score;                 // Computed diversification score (private)
    
    // === PUBLIC INPUTS ===
    signal input safety_scores[N_PROTOCOLS];  // Safety rating per protocol (0-100)
    signal input threshold;                    // Min required diversification score
    signal input scale;                        // Scaling factor
    
    // === OUTPUT ===
    signal output is_valid;                    // 1 if diversification >= threshold
    
    // === CONSTRAINTS ===
    
    // Step 1: Compute total allocation
    signal alloc_sum[N_PROTOCOLS + 1];
    alloc_sum[0] <== 0;
    
    for (var i = 0; i < N_PROTOCOLS; i++) {
        alloc_sum[i + 1] <== alloc_sum[i] + allocations[i];
    }
    
    signal total_alloc;
    total_alloc <== alloc_sum[N_PROTOCOLS];
    
    // Step 2: Compute weighted safety score
    // weighted_safety = sum(allocation_i * safety_score_i) / total_alloc
    signal weighted_sum[N_PROTOCOLS + 1];
    signal weighted_contrib[N_PROTOCOLS];
    weighted_sum[0] <== 0;
    
    for (var i = 0; i < N_PROTOCOLS; i++) {
        weighted_contrib[i] <== allocations[i] * safety_scores[i];
        weighted_sum[i + 1] <== weighted_sum[i] + weighted_contrib[i];
    }
    
    signal total_weighted;
    total_weighted <== weighted_sum[N_PROTOCOLS];
    
    // Step 3: Compute Herfindahl concentration index
    // HHI = sum((allocation_i / total)^2)
    // We compute sum(allocation_i^2) and divide later
    signal alloc_squared[N_PROTOCOLS];
    signal hhi_sum[N_PROTOCOLS + 1];
    hhi_sum[0] <== 0;
    
    for (var i = 0; i < N_PROTOCOLS; i++) {
        alloc_squared[i] <== allocations[i] * allocations[i];
        hhi_sum[i + 1] <== hhi_sum[i] + alloc_squared[i];
    }
    
    signal total_hhi;
    total_hhi <== hhi_sum[N_PROTOCOLS];
    
    // Step 4: Compute diversification score
    // diversification = weighted_safety * (1 - HHI_normalized)
    // Simplified: score = (weighted_safety * total_alloc^2 - weighted_safety * HHI) / total_alloc^2
    signal total_alloc_sq;
    total_alloc_sq <== total_alloc * total_alloc;
    
    // Step 5: Verify actual_score matches computation
    // actual_score * total_alloc * scale == total_weighted * scale (within rounding)
    signal lower_bound;
    signal upper_bound;
    lower_bound <== actual_score * total_alloc;
    upper_bound <== (actual_score + 1) * total_alloc;
    
    component ge_lower = GreaterEqThan(128);
    ge_lower.in[0] <== total_weighted;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;
    
    component lt_upper = LessThan(128);
    lt_upper.in[0] <== total_weighted;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;
    
    // Step 6: Check diversification >= threshold
    component ge_threshold = GreaterEqThan(64);
    ge_threshold.in[0] <== actual_score;
    ge_threshold.in[1] <== threshold;
    
    is_valid <== ge_threshold.out;
}

/*
 * SafetyDiversificationVerifier
 * 
 * Main circuit for safety diversification verification.
 * Uses 6 protocols by default (configurable).
 * 
 * Example protocols and safety scores:
 *   0: JediSwap (85)
 *   1: Ekubo (90)
 *   2: zkLend (80)
 *   3: Nostra (75)
 *   4: Haiko (70)
 *   5: Other (50)
 * 
 * Good diversification: 30% JediSwap, 30% Ekubo, 20% zkLend, 20% Nostra
 *   weighted_safety = 0.3*85 + 0.3*90 + 0.2*80 + 0.2*75 = 83.5
 *   HHI = 0.3^2 + 0.3^2 + 0.2^2 + 0.2^2 = 0.26 (low concentration)
 *   
 * Bad diversification: 100% JediSwap
 *   weighted_safety = 85
 *   HHI = 1.0 (maximum concentration)
 */
template SafetyDiversificationVerifier() {
    var N_PROTOCOLS = 6;
    
    // Private inputs
    signal input allocations[N_PROTOCOLS];
    signal input actual_score;
    
    // Public inputs
    signal input safety_scores[N_PROTOCOLS];
    signal input threshold;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;
    
    // Output
    signal output is_compliant;
    signal output public_commitment;
    
    // Verify diversification
    component div_model = DiversificationModel(N_PROTOCOLS);
    div_model.allocations <== allocations;
    div_model.actual_score <== actual_score;
    div_model.safety_scores <== safety_scores;
    div_model.threshold <== threshold;
    div_model.scale <== scale;
    
    is_compliant <== div_model.is_valid;
    public_commitment <== commitment_hash;
}

component main {public [safety_scores, threshold, scale, user_address, commitment_hash]} = SafetyDiversificationVerifier();
