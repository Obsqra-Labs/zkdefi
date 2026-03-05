pragma circom 2.1.6;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

/*
 * RebalanceTimingCommitment Circuit
 *
 * MEV-Resistant Timing Proof — proves that a rebalance timing
 * was committed BEFORE execution, preventing front-running.
 *
 * The pre-commitment scheme:
 *   1. Agent predicts optimal rebalance window → target_block
 *   2. Agent publishes timing_hash = Poseidon(target_block, action_type, user_address, nonce) on-chain
 *   3. At execution time, this circuit proves:
 *      a. The commitment hash matches the pre-image
 *      b. The execution block is within tolerance of the target
 *      c. The target block was in the past (commitment was before execution)
 *
 * Privacy:
 *   - target_block, action_type, user_address, nonce are PRIVATE
 *   - Only timing_hash, current_block, tolerance_blocks are PUBLIC
 *
 * This prevents:
 *   - Agent front-running users (commitment published beforehand)
 *   - Miners manipulating execution timing (tolerance bound)
 *   - Replay attacks (nonce uniqueness)
 */

template RebalanceTimingCommitment() {
    // === PRIVATE INPUTS ===
    signal input target_block;     // Predicted optimal rebalance block
    signal input action_type;      // 1=rebalance, 2=deposit, 3=withdraw
    signal input user_address;     // User's felt-encoded address
    signal input nonce;            // Unique per-commitment

    // === PUBLIC INPUTS ===
    signal input timing_hash;      // Published on-chain before target_block
    signal input current_block;    // Actual execution block
    signal input tolerance_blocks; // Max allowed deviation from target

    // === OUTPUTS ===
    signal output valid;           // 1 if commitment verifies

    // === CONSTRAINT 1: Commitment hash matches ===
    // Poseidon(target_block, action_type, user_address, nonce) === timing_hash
    component hasher = Poseidon(4);
    hasher.inputs[0] <== target_block;
    hasher.inputs[1] <== action_type;
    hasher.inputs[2] <== user_address;
    hasher.inputs[3] <== nonce;

    hasher.out === timing_hash;

    // === CONSTRAINT 2: target_block <= current_block ===
    // The commitment was made for a block that has now passed
    component target_before_current = LessEqThan(64);
    target_before_current.in[0] <== target_block;
    target_before_current.in[1] <== current_block;

    // === CONSTRAINT 3: |current_block - target_block| <= tolerance_blocks ===
    // Execution happened within the acceptable window
    // Since target_block <= current_block (from constraint 2),
    // this simplifies to: current_block - target_block <= tolerance_blocks
    signal delta;
    delta <== current_block - target_block;

    component within_tolerance = LessEqThan(64);
    within_tolerance.in[0] <== delta;
    within_tolerance.in[1] <== tolerance_blocks;

    // === CONSTRAINT 4: action_type in valid range [1, 3] ===
    component action_gte_1 = GreaterEqThan(8);
    action_gte_1.in[0] <== action_type;
    action_gte_1.in[1] <== 1;

    component action_lte_3 = LessEqThan(8);
    action_lte_3.in[0] <== action_type;
    action_lte_3.in[1] <== 3;

    signal action_valid;
    action_valid <== action_gte_1.out * action_lte_3.out;

    // === FINAL: all constraints must pass (split into two binary multiplications) ===
    signal intermediate;
    intermediate <== target_before_current.out * within_tolerance.out;
    valid <== intermediate * action_valid;
}

component main {public [timing_hash, current_block, tolerance_blocks]} = RebalanceTimingCommitment();
