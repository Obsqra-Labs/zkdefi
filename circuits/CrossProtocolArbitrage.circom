pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * CrossProtocolArbitrage Circuit
 *
 * Privacy-preserving cross-protocol arbitrage profitability proof for zkde.fi.
 * Proves that an arb trade is profitable after all fees and gas costs
 * WITHOUT revealing prices, fee structures, or trade size.
 *
 * Profit model (all scaled by 10000 for bps precision):
 *   gross_scaled = (dest_price - source_price) * trade_amount * 10000
 *   fee_cost     = source_fee_bps * trade_amount * source_price
 *                + dest_fee_bps   * trade_amount * dest_price
 *                + gas_cost * source_price * 10000
 *   net_scaled   = gross_scaled - fee_cost
 *   computed_profit_bps = floor(net_scaled / (trade_amount * source_price))
 *
 * Privacy guarantees:
 *   - Source / destination prices are PRIVATE
 *   - Fee structures are PRIVATE
 *   - Gas cost is PRIVATE
 *   - Trade amount is PRIVATE
 *   - Only profitability boolean is PUBLIC
 */

template CrossProtocolArbitrageModel() {
    // === PRIVATE INPUTS ===
    signal input source_price;
    signal input dest_price;
    signal input source_fee_bps;
    signal input dest_fee_bps;
    signal input gas_cost;
    signal input trade_amount;
    signal input computed_profit_bps;

    // === PUBLIC INPUTS ===
    signal input min_profit_bps;
    signal input scale;

    // === OUTPUT ===
    signal output is_valid;

    // === CONSTRAINTS ===

    // gross_scaled = (dest_price - source_price) * trade_amount * 10000
    signal price_diff;
    price_diff <== dest_price - source_price;

    signal gross_base;
    gross_base <== price_diff * trade_amount;

    signal gross_scaled;
    gross_scaled <== gross_base * 10000;

    // fee_cost = source_fee_bps * trade_amount * source_price
    //          + dest_fee_bps * trade_amount * dest_price
    //          + gas_cost * source_price * 10000
    signal source_fee_part_a;
    source_fee_part_a <== source_fee_bps * trade_amount;

    signal source_fee;
    source_fee <== source_fee_part_a * source_price;

    signal dest_fee_part_a;
    dest_fee_part_a <== dest_fee_bps * trade_amount;

    signal dest_fee;
    dest_fee <== dest_fee_part_a * dest_price;

    signal gas_fee_a;
    gas_fee_a <== gas_cost * source_price;

    signal gas_fee;
    gas_fee <== gas_fee_a * 10000;

    signal fee_cost;
    fee_cost <== source_fee + dest_fee + gas_fee;

    // net_scaled = gross_scaled - fee_cost
    signal net_scaled;
    net_scaled <== gross_scaled - fee_cost;

    // Denominator for integer division: trade_amount * source_price
    signal denom;
    denom <== trade_amount * source_price;

    // Verify computed_profit_bps = floor(net_scaled / denom)
    //   computed_profit_bps * denom <= net_scaled < (computed_profit_bps + 1) * denom
    signal lower_bound;
    lower_bound <== computed_profit_bps * denom;

    signal upper_bound;
    upper_bound <== (computed_profit_bps + 1) * denom;

    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== net_scaled;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(64);
    lt_upper.in[0] <== net_scaled;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Check computed_profit_bps >= min_profit_bps
    component ge_min = GreaterEqThan(64);
    ge_min.in[0] <== computed_profit_bps;
    ge_min.in[1] <== min_profit_bps;

    is_valid <== ge_min.out;
}

template CrossProtocolArbitrageVerifier() {
    // Private inputs
    signal input source_price;
    signal input dest_price;
    signal input source_fee_bps;
    signal input dest_fee_bps;
    signal input gas_cost;
    signal input trade_amount;
    signal input computed_profit_bps;

    // Public inputs
    signal input min_profit_bps;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component arb_model = CrossProtocolArbitrageModel();
    arb_model.source_price <== source_price;
    arb_model.dest_price <== dest_price;
    arb_model.source_fee_bps <== source_fee_bps;
    arb_model.dest_fee_bps <== dest_fee_bps;
    arb_model.gas_cost <== gas_cost;
    arb_model.trade_amount <== trade_amount;
    arb_model.computed_profit_bps <== computed_profit_bps;
    arb_model.min_profit_bps <== min_profit_bps;
    arb_model.scale <== scale;

    is_compliant <== arb_model.is_valid;
    public_commitment <== commitment_hash;
}

component main {public [min_profit_bps, scale, user_address, commitment_hash]} = CrossProtocolArbitrageVerifier();
