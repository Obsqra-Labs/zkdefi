pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * CrossProtocolArbitrage Circuit
 *
 * Privacy-preserving arbitrage opportunity verification.
 * Proves an arbitrage trade between two protocols is profitable
 * after fees and gas, WITHOUT revealing trade details.
 *
 * Model:
 *   gross_profit = (dest_price - source_price) * amount / source_price
 *   total_cost = source_fee + dest_fee + gas_cost
 *   net_profit = gross_profit - total_cost
 *   net_profit_bps = net_profit * 10000 / amount
 *   is_profitable = net_profit_bps >= min_profit_bps
 *
 * Privacy guarantees:
 *   - Source/dest prices are PRIVATE
 *   - Trade amount is PRIVATE
 *   - Fee structures are PRIVATE
 *   - Only profitability (boolean) is PUBLIC
 */

template ArbitrageModel() {
    // === PRIVATE INPUTS ===
    signal input source_price;         // Price at source DEX (private)
    signal input dest_price;           // Price at destination DEX (private)
    signal input source_fee_bps;       // Source swap fee in bps (private)
    signal input dest_fee_bps;         // Dest swap fee in bps (private)
    signal input gas_cost;             // Gas/bridging cost in base units (private)
    signal input trade_amount;         // Amount to trade (private)
    signal input computed_profit_bps;  // Pre-computed net profit in bps (private)

    // === PUBLIC INPUTS ===
    signal input min_profit_bps;       // Minimum required profit in bps (public)
    signal input scale;                // Precision scaling factor (public)

    // === OUTPUT ===
    signal output is_profitable;       // 1 if arbitrage is profitable

    // === CONSTRAINTS ===

    // Step 1: Verify dest_price > source_price (there IS an arb opportunity)
    component price_gt = GreaterThan(64);
    price_gt.in[0] <== dest_price;
    price_gt.in[1] <== source_price;
    price_gt.out === 1;

    // Step 2: Verify trade_amount > 0
    component amt_gt = GreaterThan(64);
    amt_gt.in[0] <== trade_amount;
    amt_gt.in[1] <== 0;
    amt_gt.out === 1;

    // Step 3: Compute gross profit (scaled to avoid fractions)
    // gross_profit_scaled = (dest_price - source_price) * trade_amount
    signal price_diff;
    price_diff <== dest_price - source_price;

    signal gross_profit_scaled;
    gross_profit_scaled <== price_diff * trade_amount;

    // Step 4: Compute total fees (in price*amount units)
    // source_fee_cost = source_fee_bps * trade_amount * source_price / 10000
    // dest_fee_cost = dest_fee_bps * trade_amount * dest_price / 10000
    // Gas is in base units, scaled: gas_scaled = gas_cost * source_price
    signal source_fee_amt;
    source_fee_amt <== source_fee_bps * trade_amount;

    signal source_fee_cost;
    source_fee_cost <== source_fee_amt * source_price;

    signal dest_fee_amt;
    dest_fee_amt <== dest_fee_bps * trade_amount;

    signal dest_fee_cost;
    dest_fee_cost <== dest_fee_amt * dest_price;

    signal gas_scaled;
    gas_scaled <== gas_cost * source_price * 10000;

    // total_fee_scaled = source_fee_cost + dest_fee_cost + gas_scaled
    // (all in source_price * amount * bps scale)
    signal total_fee_scaled;
    total_fee_scaled <== source_fee_cost + dest_fee_cost + gas_scaled;

    // Step 5: Net profit = gross_profit_scaled * 10000 - total_fee_scaled
    signal gross_profit_bps_scaled;
    gross_profit_bps_scaled <== gross_profit_scaled * 10000;

    signal net_profit_scaled;
    net_profit_scaled <== gross_profit_bps_scaled - total_fee_scaled;

    // Step 6: Verify computed_profit_bps
    // computed_profit_bps = net_profit_scaled / (trade_amount * source_price)
    signal denominator;
    denominator <== trade_amount * source_price;

    signal lower_bound;
    lower_bound <== computed_profit_bps * denominator;

    signal upper_bound;
    upper_bound <== (computed_profit_bps + 1) * denominator;

    component ge_lower = GreaterEqThan(128);
    ge_lower.in[0] <== net_profit_scaled;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(128);
    lt_upper.in[0] <== net_profit_scaled;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Step 7: Check if profitable above minimum
    component ge_min = GreaterEqThan(64);
    ge_min.in[0] <== computed_profit_bps;
    ge_min.in[1] <== min_profit_bps;

    is_profitable <== ge_min.out;
}

template CrossProtocolArbitrageVerifier() {
    // Private
    signal input source_price;
    signal input dest_price;
    signal input source_fee_bps;
    signal input dest_fee_bps;
    signal input gas_cost;
    signal input trade_amount;
    signal input computed_profit_bps;

    // Public
    signal input min_profit_bps;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component model = ArbitrageModel();
    model.source_price <== source_price;
    model.dest_price <== dest_price;
    model.source_fee_bps <== source_fee_bps;
    model.dest_fee_bps <== dest_fee_bps;
    model.gas_cost <== gas_cost;
    model.trade_amount <== trade_amount;
    model.computed_profit_bps <== computed_profit_bps;
    model.min_profit_bps <== min_profit_bps;
    model.scale <== scale;

    is_compliant <== model.is_profitable;
    public_commitment <== commitment_hash;
}

component main {public [min_profit_bps, scale, user_address, commitment_hash]} = CrossProtocolArbitrageVerifier();
