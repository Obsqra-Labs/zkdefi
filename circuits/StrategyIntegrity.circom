pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";

/*
 * StrategyIntegrity Circuit
 *
 * Proves strategy-level policy compliance for position concentration,
 * leverage, slippage, and exposure normalization.
 */

template StrategyIntegrityModel(K, L) {
    // Private inputs
    signal input position_weights_bps[K];
    signal input effective_leverage_bps;
    signal input observed_slippage_bps[L];
    signal input asset_exposures_bps[K];
    signal input blinding;

    // Public inputs
    signal input max_position_weight_bps;
    signal input max_leverage_bps;
    signal input max_slippage_bps;
    signal input scale;
    signal input allowlist_policy_hash;

    // Outputs
    signal output position_ok;
    signal output leverage_ok;
    signal output slippage_ok;
    signal output exposures_ok;
    signal output strategy_compliant;
    signal output data_binding;

    // Position bounds.
    component pos_le[K];
    signal pos_flag[K];
    signal pos_acc[K + 1];
    pos_acc[0] <== 1;

    for (var i = 0; i < K; i++) {
        pos_le[i] = LessEqThan(64);
        pos_le[i].in[0] <== position_weights_bps[i];
        pos_le[i].in[1] <== max_position_weight_bps;
        pos_flag[i] <== pos_le[i].out;
        pos_acc[i + 1] <== pos_acc[i] * pos_flag[i];
    }
    position_ok <== pos_acc[K];

    // Slippage bounds.
    component slp_le[L];
    signal slp_flag[L];
    signal slp_acc[L + 1];
    slp_acc[0] <== 1;

    for (var j = 0; j < L; j++) {
        slp_le[j] = LessEqThan(64);
        slp_le[j].in[0] <== observed_slippage_bps[j];
        slp_le[j].in[1] <== max_slippage_bps;
        slp_flag[j] <== slp_le[j].out;
        slp_acc[j + 1] <== slp_acc[j] * slp_flag[j];
    }
    slippage_ok <== slp_acc[L];

    // Leverage bound.
    component lev_le = LessEqThan(64);
    lev_le.in[0] <== effective_leverage_bps;
    lev_le.in[1] <== max_leverage_bps;
    leverage_ok <== lev_le.out;

    // Exposure checks + normalization to scale.
    component exp_le_scale[K];
    signal exp_flag[K];
    signal exp_acc[K + 1];
    exp_acc[0] <== 1;

    signal sum_weights[K + 1];
    signal sum_exposures[K + 1];
    sum_weights[0] <== 0;
    sum_exposures[0] <== 0;

    for (var k = 0; k < K; k++) {
        exp_le_scale[k] = LessEqThan(64);
        exp_le_scale[k].in[0] <== asset_exposures_bps[k];
        exp_le_scale[k].in[1] <== scale;
        exp_flag[k] <== exp_le_scale[k].out;
        exp_acc[k + 1] <== exp_acc[k] * exp_flag[k];

        sum_weights[k + 1] <== sum_weights[k] + position_weights_bps[k];
        sum_exposures[k + 1] <== sum_exposures[k] + asset_exposures_bps[k];
    }

    // Both vectors must normalize to total scale (e.g., 10000 bps).
    sum_weights[K] === scale;
    sum_exposures[K] === scale;

    exposures_ok <== exp_acc[K];

    // Split quad-product into quadratic steps
    signal pos_and_lev;
    pos_and_lev <== position_ok * leverage_ok;
    signal slip_and_exp;
    slip_and_exp <== slippage_ok * exposures_ok;
    strategy_compliant <== pos_and_lev * slip_and_exp;

    // Deterministic payload binding.
    signal bind_positions[K + 1];
    bind_positions[0] <== blinding + effective_leverage_bps;
    for (var p = 0; p < K; p++) {
        bind_positions[p + 1] <== bind_positions[p] + position_weights_bps[p] * (p + 17);
    }

    signal bind_slippage[L + 1];
    bind_slippage[0] <== bind_positions[K];
    for (var q = 0; q < L; q++) {
        bind_slippage[q + 1] <== bind_slippage[q] + observed_slippage_bps[q] * (q + 53);
    }

    signal bind_exposures[K + 1];
    bind_exposures[0] <== bind_slippage[L];
    for (var r = 0; r < K; r++) {
        bind_exposures[r + 1] <== bind_exposures[r] + asset_exposures_bps[r] * (r + 89);
    }

    data_binding <== bind_exposures[K] + allowlist_policy_hash;
}

template StrategyIntegrityVerifier() {
    var K = 8;
    var L = 8;

    // Private inputs
    signal input position_weights_bps[K];
    signal input effective_leverage_bps;
    signal input observed_slippage_bps[L];
    signal input asset_exposures_bps[K];
    signal input blinding;

    // Public inputs
    signal input max_position_weight_bps;
    signal input max_leverage_bps;
    signal input max_slippage_bps;
    signal input scale;
    signal input allowlist_policy_hash;
    signal input subject_id_hash;

    // Outputs
    signal output position_ok;
    signal output leverage_ok;
    signal output slippage_ok;
    signal output exposures_ok;
    signal output strategy_compliant;
    signal output public_commitment;

    component model = StrategyIntegrityModel(K, L);
    model.position_weights_bps <== position_weights_bps;
    model.effective_leverage_bps <== effective_leverage_bps;
    model.observed_slippage_bps <== observed_slippage_bps;
    model.asset_exposures_bps <== asset_exposures_bps;
    model.blinding <== blinding;

    model.max_position_weight_bps <== max_position_weight_bps;
    model.max_leverage_bps <== max_leverage_bps;
    model.max_slippage_bps <== max_slippage_bps;
    model.scale <== scale;
    model.allowlist_policy_hash <== allowlist_policy_hash;

    position_ok <== model.position_ok;
    leverage_ok <== model.leverage_ok;
    slippage_ok <== model.slippage_ok;
    exposures_ok <== model.exposures_ok;
    strategy_compliant <== model.strategy_compliant;
    public_commitment <== model.data_binding + subject_id_hash;
}

component main {public [max_position_weight_bps, max_leverage_bps, max_slippage_bps, scale, allowlist_policy_hash, subject_id_hash]} = StrategyIntegrityVerifier();
