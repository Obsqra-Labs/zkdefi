pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * TWAPPosition Circuit
 * 
 * Privacy-preserving Time-Weighted Average Position verification.
 * Proves that 7-day TWAP position <= threshold WITHOUT revealing daily positions.
 */

template TWAPModel(N_DAYS) {
    signal input daily_positions[N_DAYS];
    signal input actual_twap;
    signal input threshold;
    signal input scale;
    signal output is_valid;
    
    // Step 1: Compute sum of daily positions
    signal pos_sum[N_DAYS + 1];
    pos_sum[0] <== 0;
    
    for (var i = 0; i < N_DAYS; i++) {
        pos_sum[i + 1] <== pos_sum[i] + daily_positions[i];
    }
    
    signal total_sum;
    total_sum <== pos_sum[N_DAYS];
    
    // Step 2: Verify actual_twap matches computation
    signal lower_bound;
    signal upper_bound;
    lower_bound <== actual_twap * N_DAYS;
    upper_bound <== (actual_twap + 1) * N_DAYS;
    
    component ge_lower = GreaterEqThan(128);
    ge_lower.in[0] <== total_sum;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;
    
    component lt_upper = LessThan(128);
    lt_upper.in[0] <== total_sum;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;
    
    // Step 3: Check TWAP <= threshold
    component le_threshold = LessEqThan(128);
    le_threshold.in[0] <== actual_twap;
    le_threshold.in[1] <== threshold;
    
    is_valid <== le_threshold.out;
}

template TWAPPositionVerifier() {
    var N_DAYS = 7;
    
    signal input daily_positions[N_DAYS];
    signal input actual_twap;
    signal input threshold;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;
    
    signal output is_compliant;
    signal output public_commitment;
    
    component twap_model = TWAPModel(N_DAYS);
    twap_model.daily_positions <== daily_positions;
    twap_model.actual_twap <== actual_twap;
    twap_model.threshold <== threshold;
    twap_model.scale <== scale;
    
    is_compliant <== twap_model.is_valid;
    public_commitment <== commitment_hash;
}

component main {public [threshold, scale, user_address, commitment_hash]} = TWAPPositionVerifier();
