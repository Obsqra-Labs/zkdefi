pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * LiquidationRisk Circuit
 *
 * Privacy-preserving health factor verification for leveraged positions.
 * Proves all positions maintain acceptable health factors
 * WITHOUT revealing individual collateral values or debt amounts.
 *
 * Model (per position):
 *   health_factor_i = (collateral_value_i * liquidation_threshold_i) / debt_value_i
 *   is_healthy_i = health_factor_i >= min_health_factor
 *   aggregate_is_healthy = AND(is_healthy_i)
 *
 * Privacy guarantees:
 *   - Individual collateral/debt values are PRIVATE
 *   - Liquidation thresholds per position are PRIVATE
 *   - Only aggregate health status (boolean) is PUBLIC
 */

template HealthFactorModel(N_POSITIONS) {
    // === PRIVATE INPUTS ===
    signal input collateral_values[N_POSITIONS];       // Collateral value per position (private)
    signal input debt_values[N_POSITIONS];              // Debt value per position (private)
    signal input liquidation_thresholds[N_POSITIONS];   // LTV threshold per position in bps (private)
    signal input computed_health_factors[N_POSITIONS];  // Pre-computed health factors * scale (private)

    // === PUBLIC INPUTS ===
    signal input min_health_factor;    // Minimum acceptable health factor * scale (public)
    signal input scale;                // Precision scaling (e.g., 10000 for 4 decimals) (public)
    signal input num_active;           // Number of active positions (public, ≤ N_POSITIONS)

    // === OUTPUT ===
    signal output is_healthy;          // 1 if ALL positions are healthy

    // === CONSTRAINTS ===

    // Verify num_active <= N_POSITIONS
    component le_max = LessEqThan(8);
    le_max.in[0] <== num_active;
    le_max.in[1] <== N_POSITIONS;
    le_max.out === 1;

    // For each position, check health factor
    signal position_healthy[N_POSITIONS];
    signal is_active[N_POSITIONS];
    signal active_healthy[N_POSITIONS];

    component active_checks[N_POSITIONS];
    component debt_gt[N_POSITIONS];
    component ge_lower[N_POSITIONS];
    component lt_upper[N_POSITIONS];
    component hf_checks[N_POSITIONS];

    // Hoisted signal arrays (Circom forbids signal declarations inside loops)
    signal numerator[N_POSITIONS];
    signal denom_part[N_POSITIONS];
    signal lower[N_POSITIONS];
    signal hf_plus_one[N_POSITIONS];
    signal upper[N_POSITIONS];
    signal active_result[N_POSITIONS];
    signal inactive_pass[N_POSITIONS];

    for (var i = 0; i < N_POSITIONS; i++) {
        // Determine if position i is active (i < num_active)
        active_checks[i] = LessThan(8);
        active_checks[i].in[0] <== i;
        active_checks[i].in[1] <== num_active;
        is_active[i] <== active_checks[i].out;

        // numerator = collateral_values[i] * liquidation_thresholds[i]
        numerator[i] <== collateral_values[i] * liquidation_thresholds[i];

        // denominator_part = debt_values[i] * 10000
        denom_part[i] <== debt_values[i] * 10000;

        // lower = computed_health_factors[i] * denom_part
        lower[i] <== computed_health_factors[i] * denom_part[i];

        // upper = (computed_health_factors[i] + 1) * denom_part
        hf_plus_one[i] <== computed_health_factors[i] + 1;
        upper[i] <== hf_plus_one[i] * denom_part[i];

        // For active positions: numerator >= lower AND numerator < upper
        // For inactive: we bypass by checking is_active
        ge_lower[i] = GreaterEqThan(128);
        ge_lower[i].in[0] <== numerator[i] + (1 - is_active[i]) * 1000000000000;
        ge_lower[i].in[1] <== lower[i];
        ge_lower[i].out === 1;

        lt_upper[i] = LessThan(128);
        lt_upper[i].in[0] <== numerator[i];
        lt_upper[i].in[1] <== upper[i] + (1 - is_active[i]) * 1000000000000;
        lt_upper[i].out === 1;

        // Check health factor >= min
        hf_checks[i] = GreaterEqThan(64);
        hf_checks[i].in[0] <== computed_health_factors[i];
        hf_checks[i].in[1] <== min_health_factor;

        // Position is healthy if active AND hf >= min, OR if inactive
        // healthy = is_active * hf_check + (1 - is_active) * 1
        active_result[i] <== is_active[i] * hf_checks[i].out;
        inactive_pass[i] <== 1 - is_active[i];
        position_healthy[i] <== active_result[i] + inactive_pass[i];
    }

    // Aggregate: ALL must be healthy
    signal running_and[N_POSITIONS + 1];
    running_and[0] <== 1;
    for (var i = 0; i < N_POSITIONS; i++) {
        running_and[i + 1] <== running_and[i] * position_healthy[i];
    }

    is_healthy <== running_and[N_POSITIONS];
}

template LiquidationRiskVerifier() {
    var N_POSITIONS = 8;

    // Private
    signal input collateral_values[N_POSITIONS];
    signal input debt_values[N_POSITIONS];
    signal input liquidation_thresholds[N_POSITIONS];
    signal input computed_health_factors[N_POSITIONS];

    // Public
    signal input min_health_factor;
    signal input scale;
    signal input num_active;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component model = HealthFactorModel(N_POSITIONS);
    model.collateral_values <== collateral_values;
    model.debt_values <== debt_values;
    model.liquidation_thresholds <== liquidation_thresholds;
    model.computed_health_factors <== computed_health_factors;
    model.min_health_factor <== min_health_factor;
    model.scale <== scale;
    model.num_active <== num_active;

    is_compliant <== model.is_healthy;
    public_commitment <== commitment_hash;
}

component main {public [min_health_factor, scale, num_active, user_address, commitment_hash]} = LiquidationRiskVerifier();
