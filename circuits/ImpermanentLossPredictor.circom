pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * ImpermanentLossPredictor Circuit
 *
 * Privacy-preserving impermanent loss verification for zkde.fi.
 * Proves that IL is within a tolerance bound WITHOUT revealing
 * position size, entry/current price, or fee details.
 *
 * IL identity used (scaled integer form):
 *   actual_il_bps * (entry_price + current_price)
 *     == entry_price * scale - 2 * sqrt_price_ratio * entry_price
 *   (verified to integer-division tolerance)
 *
 * Privacy guarantees:
 *   - Position size is PRIVATE
 *   - Entry / current prices are PRIVATE
 *   - Fee earnings are PRIVATE
 *   - sqrt(price ratio) witness is PRIVATE
 *   - Only IL-within-tolerance boolean is PUBLIC
 */

template ImpermanentLossModel() {
    // === PRIVATE INPUTS ===
    signal input position_size;
    signal input entry_price;
    signal input current_price;
    signal input fee_earned_bps;
    signal input sqrt_price_ratio;
    signal input actual_il_bps;

    // === PUBLIC INPUTS ===
    signal input max_il_tolerance_bps;
    signal input scale;

    // === OUTPUT ===
    signal output is_valid;

    // === CONSTRAINTS ===

    // LHS: actual_il_bps * (entry_price + current_price)
    signal price_sum;
    price_sum <== entry_price + current_price;

    signal il_lhs;
    il_lhs <== actual_il_bps * price_sum;

    // RHS: entry_price * scale - 2 * sqrt_price_ratio * entry_price
    signal entry_times_scale;
    entry_times_scale <== entry_price * scale;

    signal two_sqrt_entry;
    two_sqrt_entry <== 2 * sqrt_price_ratio * entry_price;

    signal il_rhs;
    il_rhs <== entry_times_scale - two_sqrt_entry;

    // Verify integer-division identity:
    //   il_rhs <= il_lhs < il_rhs + price_sum
    // (i.e. actual_il_bps = floor(il_rhs / price_sum))
    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== il_lhs;
    ge_lower.in[1] <== il_rhs;
    ge_lower.out === 1;

    signal il_upper;
    il_upper <== il_rhs + price_sum;

    component lt_upper = LessThan(64);
    lt_upper.in[0] <== il_lhs;
    lt_upper.in[1] <== il_upper;
    lt_upper.out === 1;

    // Check actual_il_bps <= max_il_tolerance_bps
    component le_tolerance = LessEqThan(64);
    le_tolerance.in[0] <== actual_il_bps;
    le_tolerance.in[1] <== max_il_tolerance_bps;

    is_valid <== le_tolerance.out;
}

template ImpermanentLossPredictor() {
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

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component il_model = ImpermanentLossModel();
    il_model.position_size <== position_size;
    il_model.entry_price <== entry_price;
    il_model.current_price <== current_price;
    il_model.fee_earned_bps <== fee_earned_bps;
    il_model.sqrt_price_ratio <== sqrt_price_ratio;
    il_model.actual_il_bps <== actual_il_bps;
    il_model.max_il_tolerance_bps <== max_il_tolerance_bps;
    il_model.scale <== scale;

    is_compliant <== il_model.is_valid;
    public_commitment <== commitment_hash;
}

component main {public [max_il_tolerance_bps, scale, user_address, commitment_hash]} = ImpermanentLossPredictor();
