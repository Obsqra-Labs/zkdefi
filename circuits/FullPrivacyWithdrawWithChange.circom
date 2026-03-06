pragma circom 2.1.6;

// Full Privacy Withdraw WITH CHANGE (V2)
// Proves:
// 1. I know the preimage of a commitment in the merkle tree
// 2. The nullifier is correctly derived from commitment + secret
// 3. withdrawAmount + changeAmount === commitmentAmount (exact split)
// 4. changeCommitment = H(userSecret, changeAmount, poolType, changeNonce, changeBlinding)
// 5. Pool type matches
//
// Public outputs: root, nullifier, recipient, withdrawAmount, changeAmount, changeCommitment, poolType
// Contract transfers withdrawAmount to recipient and inserts changeCommitment into merkle tree.

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/mux1.circom";

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

template NullifierHasher() {
    signal input commitment;
    signal input userSecret;

    signal output nullifier;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== commitment;
    hasher.inputs[1] <== userSecret;

    nullifier <== hasher.out;
}

template FullPrivacyWithdrawWithChange(merkleLevels) {
    // ==================== PUBLIC INPUTS ====================
    signal input root;
    signal input nullifier;
    signal input recipient;
    signal input withdrawAmount;
    signal input changeAmount;
    signal input changeCommitment;
    signal input poolType;

    // ==================== PRIVATE INPUTS ====================
    signal input userSecret;
    signal input commitmentAmount;
    signal input commitmentPoolType;
    signal input nonce;
    signal input blinding;
    signal input pathElements[merkleLevels];
    signal input pathIndices[merkleLevels];
    signal input leaf;
    signal input changeNonce;
    signal input changeBlinding;

    // ==================== CONSTRAINT 1: Commitment ====================
    component commitmentHasher = CommitmentHasher();
    commitmentHasher.userSecret <== userSecret;
    commitmentHasher.amount <== commitmentAmount;
    commitmentHasher.poolType <== commitmentPoolType;
    commitmentHasher.nonce <== nonce;
    commitmentHasher.blinding <== blinding;

    signal commitment;
    commitment <== commitmentHasher.commitment;

    // ==================== CONSTRAINT 2: Merkle Membership ====================
    component merkleChecker = MerkleTreeChecker(merkleLevels);
    merkleChecker.leaf <== leaf;
    for (var i = 0; i < merkleLevels; i++) {
        merkleChecker.pathElements[i] <== pathElements[i];
        merkleChecker.pathIndices[i] <== pathIndices[i];
    }
    merkleChecker.root === root;

    // ==================== CONSTRAINT 3: Nullifier ====================
    component nullifierHasher = NullifierHasher();
    nullifierHasher.commitment <== commitment;
    nullifierHasher.userSecret <== userSecret;
    nullifierHasher.nullifier === nullifier;


    // ==================== CONSTRAINT 4: withdrawAmount + changeAmount === commitmentAmount ====================
    signal sum;
    sum <== withdrawAmount + changeAmount;
    component amountEq = IsEqual();
    amountEq.in[0] <== sum;
    amountEq.in[1] <== commitmentAmount;
    amountEq.out === 1;

    // ==================== CONSTRAINT 5: changeCommitment = H(userSecret, changeAmount, poolType, changeNonce, changeBlinding) ====================
    component changeHasher = CommitmentHasher();
    changeHasher.userSecret <== userSecret;
    changeHasher.amount <== changeAmount;
    changeHasher.poolType <== poolType;
    changeHasher.nonce <== changeNonce;
    changeHasher.blinding <== changeBlinding;
    changeHasher.commitment === changeCommitment;

    // ==================== CONSTRAINT 6: Pool Type ====================
    poolType === commitmentPoolType;

    // ==================== CONSTRAINT 7: Non-zero ====================
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

component main {public [root, nullifier, recipient, withdrawAmount, changeAmount, changeCommitment, poolType]} = FullPrivacyWithdrawWithChange(20);
