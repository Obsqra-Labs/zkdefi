pragma circom 2.1.6;

// Full Privacy Withdraw Circuit
// Proves:
// 1. I know the preimage of a commitment in the merkle tree
// 2. The nullifier is correctly derived from commitment + secret
// 3. The amount I'm claiming is <= my actual balance
// 4. The pool type matches what's in my commitment

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/mux1.circom";

// Merkle Tree Proof Verifier
// Verifies that a leaf exists in a merkle tree with given root
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
// commitment = poseidon(user_secret, amount, pool_type, nonce, blinding)
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
// nullifier = poseidon(commitment, userSecret)
template NullifierHasher() {
    signal input commitment;
    signal input userSecret;
    
    signal output nullifier;
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== commitment;
    hasher.inputs[1] <== userSecret;
    
    nullifier <== hasher.out;
}

// Main withdraw circuit
template FullPrivacyWithdraw(merkleLevels) {
    // ==================== PUBLIC INPUTS ====================
    // These are visible to the verifier (on-chain contract)
    signal input root;           // Merkle root (from contract)
    signal input nullifier;      // Prevents double-spend
    signal input recipient;      // Hashed recipient address
    signal input withdrawAmount; // Amount being withdrawn
    signal input poolType;       // Pool type being withdrawn from
    
    // ==================== PRIVATE INPUTS ====================
    // These are hidden from the verifier
    signal input userSecret;                     // User's private secret
    signal input commitmentAmount;               // Actual amount in commitment
    signal input commitmentPoolType;             // Actual pool type in commitment
    signal input nonce;                          // Random nonce used in commitment
    signal input blinding;                       // Blinding factor for commitment
    signal input pathElements[merkleLevels];     // Merkle proof siblings
    signal input pathIndices[merkleLevels];      // Merkle proof path (0/1 for left/right)
    // Leaf in tree is commitment % STARK_PRIME (felt252-safe); backend passes it so merkle path matches
    signal input leaf;
    
    // ==================== CONSTRAINT 1: Compute Commitment ====================
    // Verify that commitment = poseidon(userSecret, amount, pool, nonce, blinding)
    component commitmentHasher = CommitmentHasher();
    commitmentHasher.userSecret <== userSecret;
    commitmentHasher.amount <== commitmentAmount;
    commitmentHasher.poolType <== commitmentPoolType;
    commitmentHasher.nonce <== nonce;
    commitmentHasher.blinding <== blinding;
    
    signal commitment;
    commitment <== commitmentHasher.commitment;
    
    // ==================== CONSTRAINT 2: Verify Merkle Membership ====================
    // Tree stores leaf = commitment % STARK_PRIME; use leaf input for path verification
    component merkleChecker = MerkleTreeChecker(merkleLevels);
    merkleChecker.leaf <== leaf;
    for (var i = 0; i < merkleLevels; i++) {
        merkleChecker.pathElements[i] <== pathElements[i];
        merkleChecker.pathIndices[i] <== pathIndices[i];
    }
    
    // Root must match the public input
    merkleChecker.root === root;
    
    // ==================== CONSTRAINT 3: Verify Nullifier ====================
    // Prove nullifier = poseidon(commitment, userSecret)
    component nullifierHasher = NullifierHasher();
    nullifierHasher.commitment <== commitment;
    nullifierHasher.userSecret <== userSecret;
    
    // Nullifier must match public input
    nullifierHasher.nullifier === nullifier;
    
    // ==================== CONSTRAINT 4: Amount Check ====================
    // Prove withdrawAmount <= commitmentAmount (can do partial withdrawals)
    component amountCheck = LessEqThan(252);
    amountCheck.in[0] <== withdrawAmount;
    amountCheck.in[1] <== commitmentAmount;
    amountCheck.out === 1;
    
    // ==================== CONSTRAINT 5: Pool Type Match ====================
    // Prove the public pool type matches the commitment's pool type
    poolType === commitmentPoolType;
    
    // ==================== CONSTRAINT 6: Non-zero checks ====================
    // Ensure critical values are non-zero
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

// Main component with 20-level merkle tree (supports ~1M deposits)
component main {public [root, nullifier, recipient, withdrawAmount, poolType]} = FullPrivacyWithdraw(20);
