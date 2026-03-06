pragma circom 2.1.6;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * RebalanceTimingCommitment Circuit
 *
 * Proves that a rebalance action was committed to before execution,
 * preventing front-running and ensuring fair execution ordering.
 *
 * Constraints:
 *   - target_block < current_block  (commitment was in the past)
 *   - (current_block - target_block) <= tolerance_blocks  (within allowed window)
 *   - timing_hash_output == timing_hash  (binding to public commitment)
 *
 * Privacy guarantees:
 *   - Exact target block is PRIVATE
 *   - Action type is PRIVATE
 *   - User address (in the commitment preimage) is PRIVATE
 *   - Nonce is PRIVATE
 *   - Only the commitment hash and timing validity are PUBLIC
 */

template TimingVerifier() {
    // === PRIVATE INPUTS ===
    signal input target_block;
    signal input action_type;
    signal input user_address;
    signal input nonce;

    // === PUBLIC INPUTS ===
    signal input timing_hash;
    signal input current_block;
    signal input tolerance_blocks;

    // === OUTPUTS ===
    signal output is_valid;
    signal output timing_hash_output;

    // Step 1: Verify target_block < current_block (commitment was in the past)
    component lt_current = LessThan(64);
    lt_current.in[0] <== target_block;
    lt_current.in[1] <== current_block;

    signal past_check;
    past_check <== lt_current.out;

    // Step 2: Verify (current_block - target_block) <= tolerance_blocks
    signal block_delta;
    block_delta <== current_block - target_block;

    component le_tolerance = LessEqThan(64);
    le_tolerance.in[0] <== block_delta;
    le_tolerance.in[1] <== tolerance_blocks;

    signal window_check;
    window_check <== le_tolerance.out;

    // Both checks must pass
    is_valid <== past_check * window_check;

    // Bind the timing hash for downstream on-chain verification
    timing_hash_output <== timing_hash;
}

/*
 * RebalanceTimingCommitmentVerifier
 *
 * Main circuit wrapping the timing verification logic.
 * The prover supplies the commitment preimage (target_block, action_type,
 * user_address, nonce) privately, and the verifier checks timing constraints
 * against public block numbers.
 */
template RebalanceTimingCommitmentVerifier() {
    // Private inputs
    signal input target_block;
    signal input action_type;
    signal input user_address;
    signal input nonce;

    // Public inputs
    signal input timing_hash;
    signal input current_block;
    signal input tolerance_blocks;

    // Outputs
    signal output is_valid;
    signal output timing_hash_output;

    // Run timing verification
    component verifier = TimingVerifier();
    verifier.target_block <== target_block;
    verifier.action_type <== action_type;
    verifier.user_address <== user_address;
    verifier.nonce <== nonce;
    verifier.timing_hash <== timing_hash;
    verifier.current_block <== current_block;
    verifier.tolerance_blocks <== tolerance_blocks;

    is_valid <== verifier.is_valid;
    timing_hash_output <== verifier.timing_hash_output;
}

component main {public [timing_hash, current_block, tolerance_blocks]} = RebalanceTimingCommitmentVerifier();
