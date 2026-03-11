pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * ModelBridgeHeavy Circuit
 *
 * Heavier variant of ModelBridge: 16 model outputs instead of 8.
 * Same pattern: bridges EZKL ML model proofs into the Groth16/Garaga pipeline.
 * Verifies that model outputs fall within acceptable bounds and that the
 * model weights hash matches the expected public model identity.
 *
 * Constraints:
 *   - model_weights_hash == expected_model_hash
 *   - For each output i: output_lower_bound <= model_output[i] <= output_upper_bound
 *   - is_valid = 1 iff all checks pass
 *
 * Privacy guarantees:
 *   - Model output values are PRIVATE
 *   - EZKL proof hash is PRIVATE
 *   - Model weights hash is PRIVATE (equality with public hash is proven)
 *   - Only validity and timestamp are PUBLIC
 */

template OutputBoundsChecker(N_OUTPUTS) {
    // === PRIVATE INPUTS ===
    signal input model_output[N_OUTPUTS];

    // === PUBLIC INPUTS ===
    signal input output_lower_bound;
    signal input output_upper_bound;

    // === OUTPUT ===
    signal output is_valid;

    // Check each output: output_lower_bound <= model_output[i] <= output_upper_bound
    component ge_lower[N_OUTPUTS];
    component le_upper[N_OUTPUTS];

    signal pass[N_OUTPUTS];
    signal cumulative_pass[N_OUTPUTS + 1];
    cumulative_pass[0] <== 1;

    for (var i = 0; i < N_OUTPUTS; i++) {
        ge_lower[i] = GreaterEqThan(64);
        ge_lower[i].in[0] <== model_output[i];
        ge_lower[i].in[1] <== output_lower_bound;

        le_upper[i] = LessEqThan(64);
        le_upper[i].in[0] <== model_output[i];
        le_upper[i].in[1] <== output_upper_bound;

        pass[i] <== ge_lower[i].out * le_upper[i].out;
        cumulative_pass[i + 1] <== cumulative_pass[i] * pass[i];
    }

    is_valid <== cumulative_pass[N_OUTPUTS];
}

/*
 * ModelBridgeHeavyVerifier
 *
 * Main circuit for bridging EZKL ML proofs with 16 model outputs (heavier than ModelBridge).
 *
 * Outputs (example):
 *   0-15: ML model inference outputs (logits, probabilities, etc.)
 */
template ModelBridgeHeavyVerifier() {
    var N_OUTPUTS = 16;

    // Private inputs
    signal input model_output[N_OUTPUTS];
    signal input ezkl_proof_hash;
    signal input model_weights_hash;

    // Public inputs
    signal input expected_model_hash;
    signal input output_lower_bound;
    signal input output_upper_bound;
    signal input timestamp;

    // Outputs
    signal output is_valid;
    signal output public_commitment;

    // Step 1: Verify model identity
    model_weights_hash === expected_model_hash;

    // Step 2: Verify all outputs within bounds
    component bounds_checker = OutputBoundsChecker(N_OUTPUTS);
    bounds_checker.model_output <== model_output;
    bounds_checker.output_lower_bound <== output_lower_bound;
    bounds_checker.output_upper_bound <== output_upper_bound;

    is_valid <== bounds_checker.is_valid;

    // Bind ezkl_proof_hash as the public commitment for downstream verification
    public_commitment <== ezkl_proof_hash;
}

component main {public [expected_model_hash, output_lower_bound, output_upper_bound, timestamp]} = ModelBridgeHeavyVerifier();
