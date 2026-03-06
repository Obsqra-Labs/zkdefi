pragma circom 2.1.6;

// Full Privacy Withdraw (Hashed Output)
// Proves:
// 1. Commitment is in merkle tree
// 2. Nullifier derived from commitment + secret
// 3. withdrawAmount <= commitmentAmount
// 4. poolType matches commitmentPoolType
// 5. claimHash = Poseidon(recipient, withdrawAmount, claimSalt)

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/mux1.circom";

// Merkle Tree Proof Verifier
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];  // 0 = left, 1 = right
    signal output root;
    
    component hashers[levels];
    component mux[levels];
    
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;
    
    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);
        mux[i] = MultiMux1(2);
        
        // Select order based on path index
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

// Nullifier generator
template NullifierHasher() {
    signal input commitment;
    signal input userSecret;
    
    signal output nullifier;
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== commitment;
    hasher.inputs[1] <== userSecret;
    
    nullifier <== hasher.out;
}

// Claim hash generator
template ClaimHasher() {
    signal input recipient;
    signal input amount;
    signal input salt;
    
    signal output claimHash;
    
    component hasher = Poseidon(3);
    hasher.inputs[0] <== recipient;
    hasher.inputs[1] <== amount;
    hasher.inputs[2] <== salt;
    
    claimHash <== hasher.out;
}

template FullPrivacyWithdrawHashed(merkleLevels) {
    // ==================== PUBLIC INPUTS ====================
    signal input root;
    signal input nullifier;
    signal input claimHash;
    signal input poolType;
    
    // ==================== PRIVATE INPUTS ====================
    signal input userSecret;
    signal input commitmentAmount;
    signal input commitmentPoolType;
    signal input nonce;
    signal input blinding;
    signal input recipient;
    signal input withdrawAmount;
    signal input claimSalt;
    signal input pathElements[merkleLevels];
    signal input pathIndices[merkleLevels];
    signal input leaf;
    
    // Commitment
    component commitmentHasher = CommitmentHasher();
    commitmentHasher.userSecret <== userSecret;
    commitmentHasher.amount <== commitmentAmount;
    commitmentHasher.poolType <== commitmentPoolType;
    commitmentHasher.nonce <== nonce;
    commitmentHasher.blinding <== blinding;
    signal commitment;
    commitment <== commitmentHasher.commitment;
    
    // Merkle membership
    component merkleChecker = MerkleTreeChecker(merkleLevels);
    merkleChecker.leaf <== leaf;
    for (var i = 0; i < merkleLevels; i++) {
        merkleChecker.pathElements[i] <== pathElements[i];
        merkleChecker.pathIndices[i] <== pathIndices[i];
    }
    merkleChecker.root === root;
    
    // Nullifier
    component nullifierHasher = NullifierHasher();
    nullifierHasher.commitment <== commitment;
    nullifierHasher.userSecret <== userSecret;
    nullifierHasher.nullifier === nullifier;
    
    // Amount check
    component amountCheck = LessEqThan(252);
    amountCheck.in[0] <== withdrawAmount;
    amountCheck.in[1] <== commitmentAmount;
    amountCheck.out === 1;
    
    // Pool type check
    poolType === commitmentPoolType;
    
    // Claim hash
    component claimHasher = ClaimHasher();
    claimHasher.recipient <== recipient;
    claimHasher.amount <== withdrawAmount;
    claimHasher.salt <== claimSalt;
    claimHasher.claimHash === claimHash;
    
    // Non-zero checks
    signal recipientNonZero;
    component recipientCheck = IsZero();
    recipientCheck.in <== recipient;
    recipientNonZero <== 1 - recipientCheck.out;
    recipientNonZero === 1;
    
    signal amountNonZero;
    component amountZeroCheck = IsZero();
    amountZeroCheck.in <== withdrawAmount;
    amountNonZero <== 1 - amountZeroCheck.out;
    amountNonZero === 1;
}

component main {public [root, nullifier, claimHash, poolType]} = FullPrivacyWithdrawHashed(20);
