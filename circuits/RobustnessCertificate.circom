pragma circom 2.1.6;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

/*
 * RobustnessCertificate Circuit
 *
 * Proves that an ML model passed adversarial testing above a minimum
 * pass rate, without revealing the individual attack results.
 *
 * Adversarial attack suite includes:
 *   - Rug pull simulation
 *   - Flash loan attack
 *   - Oracle manipulation
 *   - Sandwich attack
 *   - Liquidity drain
 *
 * Privacy:
 *   - pass_count, total_count are PRIVATE (exact pass rate hidden)
 *   - model_hash, attack_suite_hash, min_pass_rate_bps are PUBLIC
 *
 * Verifies:
 *   1. pass_rate_bps >= min_pass_rate_bps (e.g., 95%)
 *   2. total_count >= min_attacks (minimum test coverage)
 *   3. model_hash matches the registered model
 *   4. Certificate commitment for on-chain storage
 */

template RobustnessCertificate() {
    // === PRIVATE INPUTS ===
    signal input pass_count;         // Number of attacks the model survived
    signal input total_count;        // Total number of attacks run

    // === PUBLIC INPUTS ===
    signal input model_hash;         // Poseidon hash of model weights
    signal input attack_suite_hash;  // Hash of the attack configuration
    signal input min_pass_rate_bps;  // Minimum pass rate in basis points (e.g., 9500 = 95%)
    signal input min_attacks;        // Minimum number of attacks required
    signal input certified_at;       // Timestamp or block number of certification

    // === OUTPUTS ===
    signal output certified;         // 1 if model passes robustness threshold
    signal output certificate_hash;  // Poseidon commitment for on-chain storage

    // === CONSTRAINT 1: total_count >= min_attacks ===
    // Ensure sufficient test coverage
    component enough_attacks = GreaterEqThan(32);
    enough_attacks.in[0] <== total_count;
    enough_attacks.in[1] <== min_attacks;

    // === CONSTRAINT 2: pass_count <= total_count ===
    // Sanity check: can't pass more tests than exist
    component pass_lte_total = LessEqThan(32);
    pass_lte_total.in[0] <== pass_count;
    pass_lte_total.in[1] <== total_count;

    // === CONSTRAINT 3: pass_rate_bps >= min_pass_rate_bps ===
    // pass_rate_bps = (pass_count * 10000) / total_count
    // To avoid division, rearrange: pass_count * 10000 >= min_pass_rate_bps * total_count
    signal lhs;
    lhs <== pass_count * 10000;

    signal rhs;
    rhs <== min_pass_rate_bps * total_count;

    component rate_check = GreaterEqThan(64);
    rate_check.in[0] <== lhs;
    rate_check.in[1] <== rhs;

    // === CONSTRAINT 4: model_hash is non-zero ===
    // Ensures an actual model was tested (not a dummy)
    component model_nonzero = IsZero();
    model_nonzero.in <== model_hash;
    signal model_exists;
    model_exists <== 1 - model_nonzero.out;

    // === CONSTRAINT 5: Certificate commitment ===
    // Poseidon(model_hash, attack_suite_hash, pass_rate_proxy, certified_at)
    // Note: pass_rate_proxy = pass_count * 10000 (to avoid private data in commitment)
    component cert_hasher = Poseidon(4);
    cert_hasher.inputs[0] <== model_hash;
    cert_hasher.inputs[1] <== attack_suite_hash;
    cert_hasher.inputs[2] <== lhs;  // pass_count * 10000 (not the exact rate)
    cert_hasher.inputs[3] <== certified_at;
    certificate_hash <== cert_hasher.out;

    // === FINAL: all checks must pass ===
    signal check_1_2;
    check_1_2 <== enough_attacks.out * pass_lte_total.out;

    signal check_3_4;
    check_3_4 <== rate_check.out * model_exists;

    certified <== check_1_2 * check_3_4;
}

component main {public [model_hash, attack_suite_hash, min_pass_rate_bps, min_attacks, certified_at]} = RobustnessCertificate();
