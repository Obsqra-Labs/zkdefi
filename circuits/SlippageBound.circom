pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * SlippageBound Circuit
 *
 * Privacy-preserving slippage verification for zkde.fi.
 * Proves that estimated trade slippage is within an acceptable bound
 * WITHOUT revealing trade amount, liquidity depth, or impact model.
 *
 * Slippage model (integer division):
 *   estimated_slippage_bps = floor(trade_amount * price_impact_coefficient
 *                                  / current_liquidity)
 *
 * Privacy guarantees:
 *   - Trade amount is PRIVATE
 *   - Current liquidity is PRIVATE
 *   - Price impact coefficient is PRIVATE
 *   - Estimated slippage witness is PRIVATE
 *   - Only slippage-within-bound boolean is PUBLIC
 */

template SlippageBoundModel() {
    // === PRIVATE INPUTS ===
    signal input trade_amount;
    signal input current_liquidity;
    signal input price_impact_coefficient;
    signal input estimated_slippage_bps;

    // === PUBLIC INPUTS ===
    signal input max_slippage_bps;
    signal input scale;

    // === OUTPUT ===
    signal output is_valid;

    // === CONSTRAINTS ===

    // Verify estimated_slippage_bps = floor(trade_amount * price_impact_coefficient / current_liquidity)
    //   estimated_slippage_bps * current_liquidity <= trade_amount * price_impact_coefficient
    //     < (estimated_slippage_bps + 1) * current_liquidity
    signal numerator;
    numerator <== trade_amount * price_impact_coefficient;

    signal lower_bound;
    lower_bound <== estimated_slippage_bps * current_liquidity;

    signal upper_bound;
    upper_bound <== (estimated_slippage_bps + 1) * current_liquidity;

    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== numerator;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(64);
    lt_upper.in[0] <== numerator;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Check estimated_slippage_bps <= max_slippage_bps
    component le_max = LessEqThan(64);
    le_max.in[0] <== estimated_slippage_bps;
    le_max.in[1] <== max_slippage_bps;

    is_valid <== le_max.out;
}

template SlippageBoundVerifier() {
    // Private inputs
    signal input trade_amount;
    signal input current_liquidity;
    signal input price_impact_coefficient;
    signal input estimated_slippage_bps;

    // Public inputs
    signal input max_slippage_bps;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component slippage_model = SlippageBoundModel();
    slippage_model.trade_amount <== trade_amount;
    slippage_model.current_liquidity <== current_liquidity;
    slippage_model.price_impact_coefficient <== price_impact_coefficient;
    slippage_model.estimated_slippage_bps <== estimated_slippage_bps;
    slippage_model.max_slippage_bps <== max_slippage_bps;
    slippage_model.scale <== scale;

    is_compliant <== slippage_model.is_valid;
    public_commitment <== commitment_hash;
}

component main {public [max_slippage_bps, scale, user_address, commitment_hash]} = SlippageBoundVerifier();
