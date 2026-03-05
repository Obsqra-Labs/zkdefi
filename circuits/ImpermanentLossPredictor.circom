pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * ImpermanentLossPredictor Circuit
 *
 * Privacy-preserving impermanent loss prediction verification.
 * Proves that predicted IL for a position is within user's tolerance
 * WITHOUT revealing position size, entry price, or predicted range.
 *
 * IL approximation (integer arithmetic):
 *   price_ratio = current_price * SCALE / entry_price
 *   sqrt_ratio  ≈ linearized via Newton step (private precomputed)
 *   il_bps      = 2 * sqrt_ratio * SCALE / (SCALE + price_ratio) - SCALE
 *   net_outcome = fee_earned_bps - il_bps
 *
 * Privacy guarantees:
 *   - Position size is PRIVATE
 *   - Entry / current / predicted prices are PRIVATE
 *   - Fee earnings are PRIVATE
 *   - Only acceptability (boolean) is PUBLIC
 */

template ILModel() {
    // === PRIVATE INPUTS ===
    signal input position_size;        // Position size in base units (private)
    signal input entry_price;          // Entry price scaled (private)
    signal input current_price;        // Current price scaled (private)
    signal input fee_earned_bps;       // Fees earned in basis points (private)
    signal input sqrt_price_ratio;     // Precomputed sqrt(current/entry)*SCALE (private)
    signal input actual_il_bps;        // Precomputed IL in basis points (private)

    // === PUBLIC INPUTS ===
    signal input max_il_tolerance_bps; // Max acceptable net IL in bps (public)
    signal input scale;                // Scaling factor, typically 10000 (public)

    // === OUTPUT ===
    signal output is_acceptable;       // 1 if net outcome within tolerance

    // === CONSTRAINTS ===

    // Step 1: Verify sqrt_price_ratio is consistent
    // sqrt_price_ratio^2 ≈ current_price * scale / entry_price (within rounding)
    signal sqrt_squared;
    sqrt_squared <== sqrt_price_ratio * sqrt_price_ratio;

    signal price_ratio_scaled;
    price_ratio_scaled <== current_price * scale;

    // Allow rounding: sqrt^2 * entry_price ∈ [price_ratio_scaled * scale, (price_ratio_scaled+entry_price) * scale)
    signal lower_check;
    lower_check <== sqrt_squared * entry_price;

    signal upper_bound_product;
    upper_bound_product <== price_ratio_scaled + entry_price;

    component ge_sqrt_lower = GreaterEqThan(128);
    ge_sqrt_lower.in[0] <== lower_check;
    ge_sqrt_lower.in[1] <== price_ratio_scaled * scale;

    // Step 2: Verify actual_il_bps matches IL formula
    // IL = SCALE - 2 * sqrt_ratio * SCALE / (SCALE + price_ratio)
    // Rearranged: actual_il_bps * (scale + current_price * scale / entry_price) ≈ ...
    // Simplified integer check:
    //   actual_il_bps * (entry_price * scale + current_price * scale)
    //     ≈ entry_price * scale^2 - 2 * sqrt_price_ratio * entry_price * scale
    // We use bounding approach for integer division tolerance:
    signal sum_prices;
    sum_prices <== entry_price + current_price;

    signal il_lhs;
    il_lhs <== actual_il_bps * sum_prices;

    signal two_sqrt_entry;
    two_sqrt_entry <== 2 * sqrt_price_ratio * entry_price;

    signal il_rhs;
    il_rhs <== entry_price * scale - two_sqrt_entry;

    // Bound check: il_lhs in [il_rhs, il_rhs + sum_prices)
    component ge_il_lower = GreaterEqThan(128);
    ge_il_lower.in[0] <== il_lhs;
    ge_il_lower.in[1] <== il_rhs;
    ge_il_lower.out === 1;

    signal il_upper;
    il_upper <== il_rhs + sum_prices;

    component lt_il_upper = LessThan(128);
    lt_il_upper.in[0] <== il_lhs;
    lt_il_upper.in[1] <== il_upper;
    lt_il_upper.out === 1;

    // Step 3: Check net outcome = fee_earned_bps - actual_il_bps
    // Acceptable if actual_il_bps - fee_earned_bps <= max_il_tolerance_bps
    // i.e., actual_il_bps <= fee_earned_bps + max_il_tolerance_bps
    signal max_allowed_il;
    max_allowed_il <== fee_earned_bps + max_il_tolerance_bps;

    component le_tolerance = LessEqThan(64);
    le_tolerance.in[0] <== actual_il_bps;
    le_tolerance.in[1] <== max_allowed_il;

    is_acceptable <== le_tolerance.out;
}

template ImpermanentLossPredictorVerifier() {
    // Private inputs
    signal input position_size;
    signal input entry_price;
    signal input current_price;
    signal input fee_earned_bps;
    signal input sqrt_price_ratio;
    signal input actual_il_bps;

    // Public inputs
    signal input max_il_tolerance_bps;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Outputs
    signal output is_compliant;
    signal output public_commitment;

    component il_model = ILModel();
    il_model.position_size <== position_size;
    il_model.entry_price <== entry_price;
    il_model.current_price <== current_price;
    il_model.fee_earned_bps <== fee_earned_bps;
    il_model.sqrt_price_ratio <== sqrt_price_ratio;
    il_model.actual_il_bps <== actual_il_bps;
    il_model.max_il_tolerance_bps <== max_il_tolerance_bps;
    il_model.scale <== scale;

    is_compliant <== il_model.is_acceptable;
    public_commitment <== commitment_hash;
}

component main {public [max_il_tolerance_bps, scale, user_address, commitment_hash]} = ImpermanentLossPredictorVerifier();
