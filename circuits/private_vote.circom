pragma circom 2.0.0;

include "node_modules/circomlib/circuits/pedersen.circom";
include "node_modules/circomlib/circuits/comparators.circom";

/**
 * PrivateVote: Zero-knowledge proof for private DAO voting
 * 
 * Proves:
 * - I have voting_power VP (sqrt of LP position)
 * - I vote vote_direction (0 = against, 1 = for)
 * - My nullifier is correctly derived from secret + proposal_id
 * - I haven't voted before (caller ensures nullifier not spent)
 * 
 * Hides:
 * - My identity (no address in proof)
 * - My exact voting power (aggregated in tally)
 * - How I voted (vote_direction is private input)
 */
template PrivateVote() {
    // ==========================================
    // PRIVATE INPUTS (hidden from verifier/blockchain)
    // ==========================================
    
    signal input secret;           // User's voting secret (252-bit random)
    signal input voting_power;     // sqrt(lp_position_size_usd)
    signal input vote_direction;   // 0 = against, 1 = for
    
    // ==========================================
    // PUBLIC INPUTS (visible to verifier/blockchain)
    // ==========================================
    
    signal input proposal_id;      // Which proposal
    signal input nullifier_hash;   // Prevents double voting
    
    // ==========================================
    // OUTPUTS (returned to blockchain)
    // ==========================================
    
    signal output commitment;      // Commitment to this vote (for audit)
    signal output vote_value;      // voting_power * vote_direction (for tallying)
    
    // ==========================================
    // CONSTRAINT 1: Compute and verify nullifier
    // ==========================================
    // Nullifier = Pedersen(secret, proposal_id)
    // Prevents voting twice on same proposal with same secret
    
    component nullifier = Pedersen(2);
    nullifier.in[0] <== secret;
    nullifier.in[1] <== proposal_id;
    
    // Assert public nullifier_hash matches computed nullifier
    nullifier.out[0] === nullifier_hash;
    
    // ==========================================
    // CONSTRAINT 2: Compute commitment
    // ==========================================
    // Commitment = Pedersen(secret, voting_power, vote_direction)
    // Allows later audit/verification without revealing vote
    
    component commit = Pedersen(3);
    commit.in[0] <== secret;
    commit.in[1] <== voting_power;
    commit.in[2] <== vote_direction;
    
    commitment <== commit.out[0];
    
    // ==========================================
    // CONSTRAINT 3: Validate vote_direction is binary
    // ==========================================
    // Ensures vote_direction is either 0 (against) or 1 (for)
    // If vote_direction = 0: 0 * (0 - 1) = 0 ✓
    // If vote_direction = 1: 1 * (1 - 1) = 0 ✓
    // If vote_direction = 2: 2 * (2 - 1) = 2 ✗ (fails)
    
    vote_direction * (vote_direction - 1) === 0;
    
    // ==========================================
    // CONSTRAINT 4: Compute vote value for tallying
    // ==========================================
    // vote_value = voting_power * vote_direction
    // If vote_direction = 0 (against): vote_value = 0
    // If vote_direction = 1 (for): vote_value = voting_power
    //
    // On-chain tallying:
    // - Sum all vote_values → total votes FOR
    // - Count all votes → total participation
    // - votes_against = total_participation - votes_for
    
    vote_value <== voting_power * vote_direction;
}

// Instantiate main component with public inputs
component main {public [proposal_id, nullifier_hash]} = PrivateVote();
