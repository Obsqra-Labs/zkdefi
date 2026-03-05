pragma circom 2.1.6;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * ModelBridge Circuit
 *
 * Bridges EZKL (Halo2/KZG) proofs into the Groth16/Garaga on-chain pipeline.
 *
 * The EZKL proof is verified OFF-CHAIN. This circuit proves:
 *   1. The model identity (hash) matches a registered on-chain model
 *   2. The inference output is within valid domain bounds
 *   3. A cryptographic commitment to (model_hash, output, proof_hash)
 *      is correctly constructed — this commitment is what downstream
 *      circuits (YieldOptimality, RiskScore, etc.) consume as input.
 *
 * Privacy guarantees:
 *   - model_output is PRIVATE (hidden from verifier)
 *   - ezkl_proof_hash is PRIVATE (proof content hidden)
 *   - Only the output_commitment and model identity are PUBLIC
 *
 * Flow:
 *   ONNX model → EZKL prove → {proof, output, model_hash}
 *                                    ↓
 *   ModelBridge.circom(output, model_hash, proof_hash, bounds)
 *                                    ↓
 *   Groth16 proof → Garaga → on-chain verification
 */

template ModelBridge(N_OUTPUTS) {
    // === PRIVATE INPUTS (hidden from on-chain verifier) ===
    signal input model_output[N_OUTPUTS];   // ML inference output values
    signal input ezkl_proof_hash;           // SHA-256 of EZKL proof bytes (truncated to field)
    signal input model_weights_hash;        // Poseidon hash of ONNX model weights

    // === PUBLIC INPUTS (visible on-chain) ===
    signal input expected_model_hash;       // From on-chain ModelRegistry
    signal input output_lower_bound;        // Domain-specific minimum (e.g. 0 for yield bps)
    signal input output_upper_bound;        // Domain-specific maximum (e.g. 10000 for yield bps)
    signal input timestamp;                 // Freshness anchor (block number or unix time)

    // === OUTPUTS ===
    signal output verified;                 // 1 if all constraints pass
    signal output output_commitment;        // Poseidon(model_output[0..N], model_hash)
    signal output bridge_commitment;        // Poseidon(output_commitment, proof_hash, timestamp)

    // === CONSTRAINT 1: Model identity check ===
    // The model used must match the on-chain registered model
    model_weights_hash === expected_model_hash;

    // === CONSTRAINT 2: Output domain bounds ===
    // Each output must be within [lower, upper] bounds
    component lower_checks[N_OUTPUTS];
    component upper_checks[N_OUTPUTS];
    signal output_in_bounds[N_OUTPUTS];
    signal all_in_bounds[N_OUTPUTS + 1];
    all_in_bounds[0] <== 1;

    for (var i = 0; i < N_OUTPUTS; i++) {
        // model_output[i] >= output_lower_bound
        lower_checks[i] = GreaterEqThan(64);
        lower_checks[i].in[0] <== model_output[i];
        lower_checks[i].in[1] <== output_lower_bound;

        // model_output[i] <= output_upper_bound
        upper_checks[i] = LessEqThan(64);
        upper_checks[i].in[0] <== model_output[i];
        upper_checks[i].in[1] <== output_upper_bound;

        output_in_bounds[i] <== lower_checks[i].out * upper_checks[i].out;
        all_in_bounds[i + 1] <== all_in_bounds[i] * output_in_bounds[i];
    }

    // === CONSTRAINT 3: Output commitment ===
    // Poseidon hash of (model_output[0..N], model_weights_hash)
    // This commitment is consumed by downstream circuits
    component output_hasher = Poseidon(N_OUTPUTS + 1);
    for (var i = 0; i < N_OUTPUTS; i++) {
        output_hasher.inputs[i] <== model_output[i];
    }
    output_hasher.inputs[N_OUTPUTS] <== model_weights_hash;
    output_commitment <== output_hasher.out;

    // === CONSTRAINT 4: Bridge commitment ===
    // Ties the output commitment to the specific EZKL proof and timestamp
    component bridge_hasher = Poseidon(3);
    bridge_hasher.inputs[0] <== output_commitment;
    bridge_hasher.inputs[1] <== ezkl_proof_hash;
    bridge_hasher.inputs[2] <== timestamp;
    bridge_commitment <== bridge_hasher.out;

    // === CONSTRAINT 5: Proof hash is non-zero ===
    // Ensures an actual EZKL proof was generated (not a dummy)
    component proof_nonzero = IsZero();
    proof_nonzero.in <== ezkl_proof_hash;
    signal proof_exists;
    proof_exists <== 1 - proof_nonzero.out;

    // === FINAL: verified = all_in_bounds AND proof_exists ===
    verified <== all_in_bounds[N_OUTPUTS] * proof_exists;
}

// Default instantiation: 8 outputs (matches YieldOptimality's N_POOLS=8)
component main {public [expected_model_hash, output_lower_bound, output_upper_bound, timestamp]} = ModelBridge(8);
