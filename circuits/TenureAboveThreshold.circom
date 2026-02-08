pragma circom 2.1.6;

// Tenure Above Threshold - Selective Disclosure Circuit
// Proves: "I have a commitment that was created at least X blocks ago"
// Without revealing: balance, pool, commitment identity

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/mux1.circom";

// Merkle Tree Proof Verifier
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;
    
    component hashers[levels];
    component mux[levels];
    
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;
    
    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);
        mux[i] = MultiMux1(2);
        
        mux[i].c[0][0] <== levelHashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== levelHashes[i];
        mux[i].s <== pathIndices[i];
        
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        
        levelHashes[i + 1] <== hashers[i].out;
    }
    
    root <== levelHashes[levels];
}

// Extended Commitment generator (includes creation timestamp)
template CommitmentWithTimestampHasher() {
    signal input userSecret;
    signal input amount;
    signal input poolType;
    signal input nonce;
    signal input creationBlock;  // Block number when commitment was created
    
    signal output commitment;
    
    component hasher = Poseidon(5);
    hasher.inputs[0] <== userSecret;
    hasher.inputs[1] <== amount;
    hasher.inputs[2] <== poolType;
    hasher.inputs[3] <== nonce;
    hasher.inputs[4] <== creationBlock;
    
    commitment <== hasher.out;
}

// Main tenure disclosure circuit
template TenureAboveThreshold(merkleLevels) {
    // ==================== PUBLIC INPUTS ====================
    signal input root;          // Merkle root (verifiable on-chain)
    signal input minBlocks;     // Minimum age in blocks
    signal input currentBlock;  // Current block number (from contract)
    
    // ==================== PRIVATE INPUTS ====================
    signal input userSecret;
    signal input amount;
    signal input poolType;
    signal input nonce;
    signal input creationBlock;                  // When commitment was created
    signal input pathElements[merkleLevels];
    signal input pathIndices[merkleLevels];
    
    // ==================== CONSTRAINT 1: Compute Commitment ====================
    component commitmentHasher = CommitmentWithTimestampHasher();
    commitmentHasher.userSecret <== userSecret;
    commitmentHasher.amount <== amount;
    commitmentHasher.poolType <== poolType;
    commitmentHasher.nonce <== nonce;
    commitmentHasher.creationBlock <== creationBlock;
    
    signal commitment;
    commitment <== commitmentHasher.commitment;
    
    // ==================== CONSTRAINT 2: Verify Merkle Membership ====================
    component merkleChecker = MerkleTreeChecker(merkleLevels);
    merkleChecker.leaf <== commitment;
    for (var i = 0; i < merkleLevels; i++) {
        merkleChecker.pathElements[i] <== pathElements[i];
        merkleChecker.pathIndices[i] <== pathIndices[i];
    }
    
    merkleChecker.root === root;
    
    // ==================== CONSTRAINT 3: Tenure Check ====================
    // Prove (currentBlock - creationBlock) >= minBlocks
    // i.e., creationBlock <= currentBlock - minBlocks
    signal maxCreationBlock;
    maxCreationBlock <== currentBlock - minBlocks;
    
    component tenureCheck = LessEqThan(64);
    tenureCheck.in[0] <== creationBlock;
    tenureCheck.in[1] <== maxCreationBlock;
    tenureCheck.out === 1;
}

// Main component
component main {public [root, minBlocks, currentBlock]} = TenureAboveThreshold(20);
