pragma circom 2.1.6;

// Private Deposit Circuit for Shielded Pool (ConfidentialTransfer)
// Proves: commitment = Poseidon(amount, nonce) and balance >= amount
// Public outputs: commitment, amount_public
//
// Uses circomlib Poseidon (BN254 field) for commitment generation
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/poseidon.circom";

template PrivateDeposit() {
    // Private inputs (hidden from verifier)
    signal input amount;
    signal input nonce;
    signal input balance;

    // Public outputs
    signal output commitment;
    signal output amount_public;

    // Constraint: balance >= amount (user has enough)
    component lt = LessThan(252);
    lt.in[0] <== amount;
    lt.in[1] <== balance + 1;
    lt.out === 1;

    // Commitment = Poseidon(amount, nonce)
    // Uses circomlib Poseidon which outputs values in BN254 field
    component hasher = Poseidon(2);
    hasher.inputs[0] <== amount;
    hasher.inputs[1] <== nonce;
    commitment <== hasher.out;
    
    // Output the deposit amount (public)
    amount_public <== amount;
}

component main = PrivateDeposit();
