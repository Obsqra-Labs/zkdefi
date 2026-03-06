pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * LiquidationRisk Circuit
 *
 * Privacy-preserving liquidation risk verification for zkde.fi.
 * Proves that all active lending/borrowing positions have healthy
 * collateral ratios (health factors above minimum) WITHOUT revealing
 * individual collateral values, debts, or thresholds.
 *
 * Health factor model (per position, scaled by 10000):
 *   hf[i] = floor(collateral[i] * threshold[i] / (debt[i] * 10000))
 *
 * Only positions with index < num_active are checked.
 *
 * Privacy guarantees:
 *   - Collateral values are PRIVATE
 *   - Debt values are PRIVATE
 *   - Liquidation thresholds are PRIVATE
 *   - Health factors are PRIVATE
 *   - Only all-healthy boolean is PUBLIC
 */

template LiquidationRiskModel() {
    var N_POSITIONS = 8;

    // === PRIVATE INPUTS ===
    signal input collateral_values[N_POSITIONS];
    signal input debt_values[N_POSITIONS];
    signal input liquidation_thresholds[N_POSITIONS];
    signal input computed_health_factors[N_POSITIONS];

    // === PUBLIC INPUTS ===
    signal input min_health_factor;
    signal input scale;
    signal input num_active;

    // === OUTPUT ===
    signal output is_valid;

    // === CONSTRAINTS ===

    // For each position, verify:
    //   hf[i] * debt[i] * 10000 <= collateral[i] * threshold[i]
    //     < (hf[i] + 1) * debt[i] * 10000
    // and hf[i] >= min_health_factor (only for active positions)

    // Determine which positions are active (index < num_active)
    component is_active[N_POSITIONS];
    for (var i = 0; i < N_POSITIONS; i++) {
        is_active[i] = LessThan(64);
        is_active[i].in[0] <== i;
        is_active[i].in[1] <== num_active;
    }

    // Per-position health factor verification
    signal numerator[N_POSITIONS];
    signal debt_scaled[N_POSITIONS];
    signal lower_bound[N_POSITIONS];
    signal upper_bound[N_POSITIONS];

    component ge_lower[N_POSITIONS];
    component lt_upper[N_POSITIONS];
    component ge_min_hf[N_POSITIONS];

    signal hf_check[N_POSITIONS];
    signal div_lower_ok[N_POSITIONS];
    signal div_upper_ok[N_POSITIONS];
    signal div_ok[N_POSITIONS];
    signal position_ok[N_POSITIONS];
    signal active_result[N_POSITIONS];
    signal active_contribution[N_POSITIONS];
    signal inactive_contribution[N_POSITIONS];

    for (var i = 0; i < N_POSITIONS; i++) {
        numerator[i] <== collateral_values[i] * liquidation_thresholds[i];
        debt_scaled[i] <== debt_values[i] * 10000;
        lower_bound[i] <== computed_health_factors[i] * debt_scaled[i];
        upper_bound[i] <== (computed_health_factors[i] + 1) * debt_scaled[i];

        ge_lower[i] = GreaterEqThan(64);
        ge_lower[i].in[0] <== numerator[i];
        ge_lower[i].in[1] <== lower_bound[i];

        lt_upper[i] = LessThan(64);
        lt_upper[i].in[0] <== numerator[i];
        lt_upper[i].in[1] <== upper_bound[i];

        div_lower_ok[i] <== ge_lower[i].out;
        div_upper_ok[i] <== lt_upper[i].out;
        div_ok[i] <== div_lower_ok[i] * div_upper_ok[i];

        ge_min_hf[i] = GreaterEqThan(64);
        ge_min_hf[i].in[0] <== computed_health_factors[i];
        ge_min_hf[i].in[1] <== min_health_factor;
        hf_check[i] <== ge_min_hf[i].out;

        active_result[i] <== div_ok[i] * hf_check[i];
        active_contribution[i] <== is_active[i].out * active_result[i];
        inactive_contribution[i] <== 1 - is_active[i].out;
        position_ok[i] <== inactive_contribution[i] + active_contribution[i];
    }

    // All positions must be ok: product of all position_ok must equal 1
    signal cum_ok[N_POSITIONS + 1];
    cum_ok[0] <== 1;
    for (var i = 0; i < N_POSITIONS; i++) {
        cum_ok[i + 1] <== cum_ok[i] * position_ok[i];
    }

    is_valid <== cum_ok[N_POSITIONS];
}

template LiquidationRiskVerifier() {
    var N_POSITIONS = 8;

    // Private inputs
    signal input collateral_values[N_POSITIONS];
    signal input debt_values[N_POSITIONS];
    signal input liquidation_thresholds[N_POSITIONS];
    signal input computed_health_factors[N_POSITIONS];

    // Public inputs
    signal input min_health_factor;
    signal input scale;
    signal input num_active;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component risk_model = LiquidationRiskModel();
    for (var i = 0; i < N_POSITIONS; i++) {
        risk_model.collateral_values[i] <== collateral_values[i];
        risk_model.debt_values[i] <== debt_values[i];
        risk_model.liquidation_thresholds[i] <== liquidation_thresholds[i];
        risk_model.computed_health_factors[i] <== computed_health_factors[i];
    }
    risk_model.min_health_factor <== min_health_factor;
    risk_model.scale <== scale;
    risk_model.num_active <== num_active;

    is_compliant <== risk_model.is_valid;
    public_commitment <== commitment_hash;
}

component main {public [min_health_factor, scale, num_active, user_address, commitment_hash]} = LiquidationRiskVerifier();
