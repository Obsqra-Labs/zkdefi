pragma circom 2.1.6;

// Private Withdrawal Circuit for Shielded Pool (ConfidentialTransfer)
// Proves:
// 1. Commitment ownership: commitment = Poseidon(balance, nonce)
// 2. Sufficient balance: balance >= amount
// 3. Nullifier derivation: nullifier = Poseidon(commitment, user_secret)
//
// Uses circomlib Poseidon (BN254 field) for all hashes
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/poseidon.circom";

template PrivateWithdraw() {
    // Private inputs (hidden from verifier)
    signal input amount;          // Withdrawal amount
    signal input nonce;           // Commitment nonce
    signal input balance;         // Original deposit balance
    signal input user_secret;     // User's private secret

    // Public inputs (verified by contract)
    signal input commitment_public;  // The commitment being spent from

    // Public outputs
    signal output commitment;     // Echoed commitment
    signal output amount_public;  // Withdrawal amount
    signal output nullifier;      // Derived nullifier (prevents double-spend)

    // Constraint 1: balance >= amount (sufficient funds)
    component lt = LessThan(252);
    lt.in[0] <== amount;
    lt.in[1] <== balance + 1;
    lt.out === 1;

    // Constraint 2: Commitment verification
    // Verify that commitment_public = Poseidon(balance, nonce)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== balance;
    commitmentHasher.inputs[1] <== nonce;
    commitment_public === commitmentHasher.out;
    
    // Echo the commitment for contract verification
    commitment <== commitment_public;

    // Constraint 3: Nullifier derivation
    // nullifier = Poseidon(commitment, user_secret)
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== commitment_public;
    nullifierHasher.inputs[1] <== user_secret;
    nullifier <== nullifierHasher.out;

    // Output the withdrawal amount (public)
    amount_public <== amount;
}

component main {public [commitment_public]} = PrivateWithdraw();
