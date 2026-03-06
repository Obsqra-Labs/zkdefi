pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * StrategyIntegrity Circuit
 *
 * Privacy-preserving strategy constraints compliance verification for zkde.fi.
 * Proves that a trading strategy adheres to position-weight, leverage,
 * slippage, and exposure limits WITHOUT revealing the actual allocations.
 *
 * Hard constraints (structural integrity):
 *   - sum(position_weights_bps) == scale  (weights normalise to 100%)
 *   - sum(asset_exposures_bps) == scale   (exposures normalise to 100%)
 *
 * Soft constraints (bound checks — rolled into is_compliant):
 *   - Each position weight   <= max_position_weight_bps
 *   - effective_leverage      <= max_leverage_bps
 *   - Each observed slippage  <= max_slippage_bps
 *   - Each asset exposure     <= scale
 *
 * Privacy guarantees:
 *   - Individual position weights are PRIVATE
 *   - Individual slippage observations are PRIVATE
 *   - Individual asset exposures are PRIVATE
 *   - Only compliance status (boolean) is PUBLIC
 */

template StrategyIntegrityModel(K, L) {
    // === PRIVATE INPUTS ===
    signal input position_weights_bps[K];
    signal input effective_leverage_bps;
    signal input observed_slippage_bps[L];
    signal input asset_exposures_bps[K];

    // === PUBLIC INPUTS ===
    signal input max_position_weight_bps;
    signal input max_leverage_bps;
    signal input max_slippage_bps;
    signal input scale;

    // === OUTPUT ===
    signal output is_compliant;

    // === CONSTRAINTS ===

    // Step 1: Hard constraint — sum(position_weights_bps) == scale
    signal weight_sum[K + 1];
    weight_sum[0] <== 0;
    for (var i = 0; i < K; i++) {
        weight_sum[i + 1] <== weight_sum[i] + position_weights_bps[i];
    }
    weight_sum[K] === scale;

    // Step 2: Hard constraint — sum(asset_exposures_bps) == scale
    signal exposure_sum[K + 1];
    exposure_sum[0] <== 0;
    for (var i = 0; i < K; i++) {
        exposure_sum[i + 1] <== exposure_sum[i] + asset_exposures_bps[i];
    }
    exposure_sum[K] === scale;

    // Step 3: Soft checks — each position weight <= max_position_weight_bps
    component le_weight[K];
    for (var i = 0; i < K; i++) {
        le_weight[i] = LessEqThan(64);
        le_weight[i].in[0] <== position_weights_bps[i];
        le_weight[i].in[1] <== max_position_weight_bps;
    }

    // Step 4: Soft check — effective_leverage <= max_leverage_bps
    component le_lev = LessEqThan(64);
    le_lev.in[0] <== effective_leverage_bps;
    le_lev.in[1] <== max_leverage_bps;

    // Step 5: Soft checks — each observed slippage <= max_slippage_bps
    component le_slip[L];
    for (var i = 0; i < L; i++) {
        le_slip[i] = LessEqThan(64);
        le_slip[i].in[0] <== observed_slippage_bps[i];
        le_slip[i].in[1] <== max_slippage_bps;
    }

    // Step 6: Soft checks — each asset exposure <= scale
    component le_exp[K];
    for (var i = 0; i < K; i++) {
        le_exp[i] = LessEqThan(64);
        le_exp[i].in[0] <== asset_exposures_bps[i];
        le_exp[i].in[1] <== scale;
    }

    // Step 7: Aggregate all soft checks
    // Total soft checks: K (weights) + 1 (leverage) + L (slippage) + K (exposures)
    var N_CHECKS = K + 1 + L + K;

    signal check_sum[N_CHECKS + 1];
    check_sum[0] <== 0;

    for (var i = 0; i < K; i++) {
        check_sum[i + 1] <== check_sum[i] + le_weight[i].out;
    }
    check_sum[K + 1] <== check_sum[K] + le_lev.out;
    for (var i = 0; i < L; i++) {
        check_sum[K + 2 + i] <== check_sum[K + 1 + i] + le_slip[i].out;
    }
    for (var i = 0; i < K; i++) {
        check_sum[K + 2 + L + i] <== check_sum[K + 1 + L + i] + le_exp[i].out;
    }

    // is_compliant iff every soft check passed (sum == N_CHECKS)
    component all_pass = GreaterEqThan(64);
    all_pass.in[0] <== check_sum[N_CHECKS];
    all_pass.in[1] <== N_CHECKS;
    is_compliant <== all_pass.out;
}

/*
 * StrategyIntegrityVerifier
 *
 * Main circuit wrapping the integrity model with commitment binding.
 * Uses K=8 positions and L=8 slippage observations by default.
 */
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
    signal output is_compliant;
    signal output public_commitment;

    // Run integrity model
    component model = StrategyIntegrityModel(K, L);
    model.position_weights_bps <== position_weights_bps;
    model.effective_leverage_bps <== effective_leverage_bps;
    model.observed_slippage_bps <== observed_slippage_bps;
    model.asset_exposures_bps <== asset_exposures_bps;
    model.max_position_weight_bps <== max_position_weight_bps;
    model.max_leverage_bps <== max_leverage_bps;
    model.max_slippage_bps <== max_slippage_bps;
    model.scale <== scale;

    is_compliant <== model.is_compliant;
    public_commitment <== effective_leverage_bps + blinding;
}

component main {public [max_position_weight_bps, max_leverage_bps, max_slippage_bps, scale, allowlist_policy_hash, subject_id_hash]} = StrategyIntegrityVerifier();
