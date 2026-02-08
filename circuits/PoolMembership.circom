pragma circom 2.1.6;

// Pool Membership - Selective Disclosure Circuit
// Proves: "I have a commitment in the merkle tree in pool X"
// Without revealing: balance, commitment identity

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

// Commitment generator
template CommitmentHasher() {
    signal input userSecret;
    signal input amount;
    signal input poolType;
    signal input nonce;
    signal input blinding;
    
    signal output commitment;
    
    component hasher = Poseidon(5);
    hasher.inputs[0] <== userSecret;
    hasher.inputs[1] <== amount;
    hasher.inputs[2] <== poolType;
    hasher.inputs[3] <== nonce;
    hasher.inputs[4] <== blinding;
    
    commitment <== hasher.out;
}

// Main pool membership circuit
template PoolMembership(merkleLevels) {
    // ==================== PUBLIC INPUTS ====================
    signal input root;        // Merkle root (verifiable on-chain)
    signal input claimedPool; // The pool type being proved (0=Conservative, 1=Neutral, 2=Aggressive)
    
    // ==================== PRIVATE INPUTS ====================
    signal input userSecret;
    signal input amount;                         // Balance (hidden)
    signal input poolType;                       // Actual pool type
    signal input nonce;
    signal input blinding;
    signal input pathElements[merkleLevels];
    signal input pathIndices[merkleLevels];
    
    // ==================== CONSTRAINT 1: Compute Commitment ====================
    component commitmentHasher = CommitmentHasher();
    commitmentHasher.userSecret <== userSecret;
    commitmentHasher.amount <== amount;
    commitmentHasher.poolType <== poolType;
    commitmentHasher.nonce <== nonce;
    commitmentHasher.blinding <== blinding;
    
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
    
    // ==================== CONSTRAINT 3: Pool Type Match ====================
    // Prove claimedPool == my actual poolType
    claimedPool === poolType;
}

// Main component
component main {public [root, claimedPool]} = PoolMembership(20);
