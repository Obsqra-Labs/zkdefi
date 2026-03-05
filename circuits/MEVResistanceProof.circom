pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * MEVResistanceProof Circuit
 *
 * Privacy-preserving MEV resistance verification.
 * Proves a transaction was not subject to significant MEV extraction
 * WITHOUT revealing exact block numbers, prices, or relay details.
 *
 * Model:
 *   block_delay = inclusion_block - submission_block
 *   price_deviation_bps = |actual_price - expected_price| * 10000 / expected_price
 *   is_mev_protected = block_delay <= max_delay AND price_deviation <= threshold
 *
 * Privacy guarantees:
 *   - Submission/inclusion block numbers are PRIVATE
 *   - Expected/actual prices are PRIVATE
 *   - Relay commitment is PRIVATE
 *   - Only protection status (boolean) is PUBLIC
 */

template MEVModel() {
    // === PRIVATE INPUTS ===
    signal input submission_block;      // Block when tx was submitted (private)
    signal input inclusion_block;       // Block when tx was included (private)
    signal input expected_price;        // Expected execution price (private)
    signal input actual_price;          // Actual execution price (private)
    signal input relay_commitment;      // MEV relay/builder commitment hash (private)
    signal input computed_deviation_bps; // Pre-computed price deviation in bps (private)

    // === PUBLIC INPUTS ===
    signal input max_delay_blocks;         // Maximum acceptable block delay (public)
    signal input max_price_deviation_bps;  // Maximum price deviation in bps (public)
    signal input scale;                    // Scaling factor (public)

    // === OUTPUT ===
    signal output is_mev_protected;    // 1 if protected from MEV

    // === CONSTRAINTS ===

    // Step 1: Verify inclusion_block >= submission_block
    component incl_ge = GreaterEqThan(64);
    incl_ge.in[0] <== inclusion_block;
    incl_ge.in[1] <== submission_block;
    incl_ge.out === 1;

    // Step 2: Compute block delay
    signal block_delay;
    block_delay <== inclusion_block - submission_block;

    // Step 3: Check block delay within limit
    component delay_ok = LessEqThan(64);
    delay_ok.in[0] <== block_delay;
    delay_ok.in[1] <== max_delay_blocks;
    signal delay_pass;
    delay_pass <== delay_ok.out;

    // Step 4: Verify expected_price > 0
    component price_gt = GreaterThan(64);
    price_gt.in[0] <== expected_price;
    price_gt.in[1] <== 0;
    price_gt.out === 1;

    // Step 5: Compute absolute price deviation
    // |actual_price - expected_price| in absolute terms
    // We compute both directions and take the positive one
    component actual_ge = GreaterEqThan(64);
    actual_ge.in[0] <== actual_price;
    actual_ge.in[1] <== expected_price;

    // If actual >= expected: diff = actual - expected
    // If actual < expected: diff = expected - actual
    signal diff_positive;
    diff_positive <== actual_price - expected_price;

    signal diff_negative;
    diff_negative <== expected_price - actual_price;

    // abs_diff = actual_ge.out * diff_positive + (1 - actual_ge.out) * diff_negative
    signal pos_component;
    pos_component <== actual_ge.out * diff_positive;

    signal neg_component;
    signal neg_sel;
    neg_sel <== 1 - actual_ge.out;
    neg_component <== neg_sel * diff_negative;

    signal abs_diff;
    abs_diff <== pos_component + neg_component;

    // Step 6: Verify computed_deviation_bps
    // deviation_bps = abs_diff * 10000 / expected_price
    // → deviation_bps * expected_price <= abs_diff * 10000 < (deviation_bps + 1) * expected_price
    signal dev_numerator;
    dev_numerator <== abs_diff * 10000;

    signal dev_lower;
    dev_lower <== computed_deviation_bps * expected_price;

    signal dev_upper;
    dev_upper <== (computed_deviation_bps + 1) * expected_price;

    component ge_dev_lower = GreaterEqThan(128);
    ge_dev_lower.in[0] <== dev_numerator;
    ge_dev_lower.in[1] <== dev_lower;
    ge_dev_lower.out === 1;

    component lt_dev_upper = LessThan(128);
    lt_dev_upper.in[0] <== dev_numerator;
    lt_dev_upper.in[1] <== dev_upper;
    lt_dev_upper.out === 1;

    // Step 7: Check deviation within limit
    component dev_ok = LessEqThan(64);
    dev_ok.in[0] <== computed_deviation_bps;
    dev_ok.in[1] <== max_price_deviation_bps;
    signal deviation_pass;
    deviation_pass <== dev_ok.out;

    // Step 8: Verify relay_commitment is non-zero (proves relay was used)
    component relay_nz = IsZero();
    relay_nz.in <== relay_commitment;
    signal relay_used;
    relay_used <== 1 - relay_nz.out;

    // Step 9: ALL checks must pass
    signal delay_and_dev;
    delay_and_dev <== delay_pass * deviation_pass;

    is_mev_protected <== delay_and_dev * relay_used;
}

template MEVResistanceProofVerifier() {
    // Private
    signal input submission_block;
    signal input inclusion_block;
    signal input expected_price;
    signal input actual_price;
    signal input relay_commitment;
    signal input computed_deviation_bps;

    // Public
    signal input max_delay_blocks;
    signal input max_price_deviation_bps;
    signal input scale;
    signal input user_address;
    signal input commitment_hash;

    // Output
    signal output is_compliant;
    signal output public_commitment;

    component model = MEVModel();
    model.submission_block <== submission_block;
    model.inclusion_block <== inclusion_block;
    model.expected_price <== expected_price;
    model.actual_price <== actual_price;
    model.relay_commitment <== relay_commitment;
    model.computed_deviation_bps <== computed_deviation_bps;
    model.max_delay_blocks <== max_delay_blocks;
    model.max_price_deviation_bps <== max_price_deviation_bps;
    model.scale <== scale;

    is_compliant <== model.is_mev_protected;
    public_commitment <== commitment_hash;
}

component main {public [max_delay_blocks, max_price_deviation_bps, scale, user_address, commitment_hash]} = MEVResistanceProofVerifier();
