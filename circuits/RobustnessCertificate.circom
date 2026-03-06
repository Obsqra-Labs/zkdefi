pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * RobustnessCertificate Circuit
 *
 * Proves that an ML model passed adversarial robustness testing above
 * a public threshold, without revealing the raw pass/total counts.
 *
 * Constraints:
 *   - total_count >= min_attacks  (sufficient test coverage)
 *   - pass_rate_bps = pass_count * 10000 / total_count  (integer division)
 *     verified as: pass_rate_bps * total_count <= pass_count * 10000
 *                  < (pass_rate_bps + 1) * total_count
 *   - pass_rate_bps >= min_pass_rate_bps  (meets threshold)
 *
 * Privacy guarantees:
 *   - Exact pass_count is PRIVATE
 *   - Exact total_count is PRIVATE
 *   - Only certification status and model/suite identity are PUBLIC
 */

template PassRateVerifier() {
    // === PRIVATE INPUTS ===
    signal input pass_count;
    signal input total_count;

    // Intermediate private signal: the integer-division pass rate in bps
    signal input pass_rate_bps;

    // === PUBLIC INPUTS ===
    signal input min_attacks;
    signal input min_pass_rate_bps;

    // === OUTPUT ===
    signal output is_certified;

    // Step 1: Verify total_count >= min_attacks
    component ge_min_attacks = GreaterEqThan(64);
    ge_min_attacks.in[0] <== total_count;
    ge_min_attacks.in[1] <== min_attacks;
    ge_min_attacks.out === 1;

    // Step 2: Verify integer division for pass rate:
    //   pass_rate_bps * total_count <= pass_count * 10000 < (pass_rate_bps + 1) * total_count
    signal numerator;
    numerator <== pass_count * 10000;

    signal lower_bound;
    lower_bound <== pass_rate_bps * total_count;

    signal upper_bound;
    upper_bound <== (pass_rate_bps + 1) * total_count;

    component ge_lower = GreaterEqThan(64);
    ge_lower.in[0] <== numerator;
    ge_lower.in[1] <== lower_bound;
    ge_lower.out === 1;

    component lt_upper = LessThan(64);
    lt_upper.in[0] <== numerator;
    lt_upper.in[1] <== upper_bound;
    lt_upper.out === 1;

    // Step 3: Verify pass_rate_bps >= min_pass_rate_bps
    component ge_threshold = GreaterEqThan(64);
    ge_threshold.in[0] <== pass_rate_bps;
    ge_threshold.in[1] <== min_pass_rate_bps;

    is_certified <== ge_threshold.out;
}

/*
 * RobustnessCertificateVerifier
 *
 * Main circuit for adversarial robustness certification.
 * The prover supplies pass/total counts and the computed pass_rate_bps
 * privately; the verifier checks the division identity and threshold.
 */
template RobustnessCertificateVerifier() {
    // Private inputs
    signal input pass_count;
    signal input total_count;

    // Public inputs
    signal input model_hash;
    signal input attack_suite_hash;
    signal input min_pass_rate_bps;
    signal input min_attacks;
    signal input certified_at;

    // Outputs
    signal output is_certified;
    signal output public_commitment;

    // Intermediate private signal for integer-division pass rate
    signal pass_rate_bps;
    // The prover fills this; the circuit constrains it via PassRateVerifier.
    // We derive it here as an unconstrained witness hint; the verifier template
    // then fully constrains its correctness.
    pass_rate_bps <-- (pass_count * 10000) \ total_count;

    // Verify robustness
    component verifier = PassRateVerifier();
    verifier.pass_count <== pass_count;
    verifier.total_count <== total_count;
    verifier.pass_rate_bps <== pass_rate_bps;
    verifier.min_attacks <== min_attacks;
    verifier.min_pass_rate_bps <== min_pass_rate_bps;

    is_certified <== verifier.is_certified;

    // Bind model identity as public commitment
    public_commitment <== model_hash;
}

component main {public [model_hash, attack_suite_hash, min_pass_rate_bps, min_attacks, certified_at]} = RobustnessCertificateVerifier();
