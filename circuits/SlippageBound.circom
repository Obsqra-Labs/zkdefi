pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * SlippageBound Circuit
 *
 * Privacy-preserving slippage verification.
 * Proves a trade's slippage is within acceptable bounds
 * WITHOUT revealing trade amount, current liquidity depth, or price impact model.
 *
 * Model:
 *   estimated_slippage_bps = (trade_amount * price_impact_coeff) / current_liquidity
 *   is_within_slippage = estimated_slippage_bps <= max_slippage_bps
 *
 * Privacy guarantees:
 *   - Trade amount is PRIVATE
 *   - Current liquidity depth is PRIVATE
 *   - Price impact coefficient is PRIVATE
 *   - Only within-bounds (boolean) is PUBLIC
 */

template SlippageModel() {
    // === PRIVATE INPUTS ===
    signal input trade_amount;              // Desired trade size in base units (private)
    signal input current_liquidity;         // Available liquidity in pool (private)
    signal input price_impact_coefficient;  // Constant-product impact multiplier (private)
    signal input estimated_slippage_bps;    // Pre-computed slippage in bps (private)

    // === PUBLIC INPUTS ===
    signal input max_slippage_bps;          // Maximum tolerable slippage in bps (public)
    signal input scale;                     // Scaling factor for precision (public)

    // === OUTPUT ===
    signal output is_within_slippage;       // 1 if slippage is within bounds

    // === CONSTRAINTS ===

    // Step 1: Verify trade_amount > 0
    component gt_zero = GreaterThan(64);
    gt_zero.in[0] <== trade_amount;
    gt_zero.in[1] <== 0;
    gt_zero.out === 1;

    // Step 2: Verify current_liquidity > 0
    component liq_gt_zero = GreaterThan(64);
    liq_gt_zero.in[0] <== current_liquidity;
    liq_gt_zero.in[1] <== 0;
    liq_gt_zero.out === 1;

    // Step 3: Verify estimated_slippage_bps matches computation
    // estimated_slippage_bps = (trade_amount * price_impact_coefficient) / current_liquidity
    // Rearranged: estimated_slippage_bps * current_liquidity <= trade_amount * price_impact_coefficient
    //         AND (estimated_slippage_bps + 1) * current_liquidity > trade_amount * price_impact_coefficient
    signal numerator;
    numerator <== trade_amount * price_impact_coefficient;

    signal lower_bound;
    lower_bound <== estimated_slippage_bps * current_liquidity;

    signal upper_bound;
    upper_bound <== (estimated_slippage_bps + 1) * current_liquidity;

    // numerator >= lower_bound
    component ge_lower = GreaterEqThan(128);
    ge_lower.in[0] <== numerator;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    // numerator < upper_bound
    component lt_upper = LessThan(128);
    lt_upper.in[0] <== numerator;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Step 4: Check slippage within bounds
    component cmp = LessEqThan(64);
    cmp.in[0] <== estimated_slippage_bps;
    cmp.in[1] <== max_slippage_bps;

    is_within_slippage <== cmp.out;
}

template SlippageBoundVerifier() {
    // Private
    signal input trade_amount;
    signal input current_liquidity;
    signal input price_impact_coefficient;
    signal input estimated_slippage_bps;

    // Public
    signal input max_slippage_bps;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component model = SlippageModel();
    model.trade_amount <== trade_amount;
    model.current_liquidity <== current_liquidity;
    model.price_impact_coefficient <== price_impact_coefficient;
    model.estimated_slippage_bps <== estimated_slippage_bps;
    model.max_slippage_bps <== max_slippage_bps;
    model.scale <== scale;

    is_compliant <== model.is_within_slippage;
    public_commitment <== commitment_hash;
}

component main {public [max_slippage_bps, scale, user_address, commitment_hash]} = SlippageBoundVerifier();
