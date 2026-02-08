// Intent Commitment: Replay-safe and fork-safe intent commitments.
// commitment = hash(intent_data, nonce, chain_id, block_number)

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct IntentRecord {
    pub user: ContractAddress,
    pub commitment: felt252,
    pub chain_id: felt252,
    pub block_number: u64,
    pub timestamp: u64,
    pub used: bool,
    pub action_hash: felt252,
}

#[starknet::interface]
pub trait IIntentCommitment<TContractState> {
    // Submit an intent commitment
    fn submit_commitment(
        ref self: TContractState,
        commitment: felt252,
        chain_id: felt252,
        block_number: u64
    ) -> bool;
    
    // Use a commitment (mark as used, prevent replay)
    fn use_commitment(
        ref self: TContractState,
        commitment: felt252,
        action_hash: felt252
    ) -> bool;
    
    // Check if commitment is valid and unused
    fn is_commitment_valid(
        self: @TContractState,
        commitment: felt252
    ) -> bool;
    
    // Check if commitment has been used
    fn is_commitment_used(self: @TContractState, commitment: felt252) -> bool;
    
    // Get intent record
    fn get_intent_record(self: @TContractState, commitment: felt252) -> IntentRecord;
    
    // Get user's commitment count
    fn get_user_commitment_count(self: @TContractState, user: ContractAddress) -> u64;
    
    // Verify commitment matches expected values (for validation)
    fn verify_commitment(
        self: @TContractState,
        commitment: felt252,
        expected_user: ContractAddress,
        expected_chain_id: felt252
    ) -> bool;
}

#[starknet::contract]
mod IntentCommitment {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_block_number,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    
    use super::IntentRecord;
    
    // Max block window for valid commitments (e.g., 100 blocks)
    const MAX_BLOCK_WINDOW: u64 = 100;
    
    #[storage]
    struct Storage {
        intents: Map<felt252, IntentRecord>,
        user_commitment_count: Map<ContractAddress, u64>,
        user_commitments: Map<(ContractAddress, u64), felt252>,
        expected_chain_id: felt252,
        admin: ContractAddress,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CommitmentSubmitted: CommitmentSubmitted,
        CommitmentUsed: CommitmentUsed,
        CommitmentRejected: CommitmentRejected,
    }
    
    #[derive(Drop, starknet::Event)]
    struct CommitmentSubmitted {
        #[key]
        user: ContractAddress,
        commitment: felt252,
        block_number: u64,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct CommitmentUsed {
        #[key]
        commitment: felt252,
        action_hash: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct CommitmentRejected {
        commitment: felt252,
        reason: felt252,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        expected_chain_id: felt252,
        admin: ContractAddress
    ) {
        self.expected_chain_id.write(expected_chain_id);
        self.admin.write(admin);
    }
    
    #[abi(embed_v0)]
    impl IntentCommitmentImpl of super::IIntentCommitment<ContractState> {
        fn submit_commitment(
            ref self: ContractState,
            commitment: felt252,
            chain_id: felt252,
            block_number: u64
        ) -> bool {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            let current_block = get_block_number();
            
            // Check chain_id matches
            let expected_chain = self.expected_chain_id.read();
            if chain_id != expected_chain {
                self.emit(CommitmentRejected {
                    commitment,
                    reason: 'wrong_chain_id'
                });
                return false;
            }
            
            // Check block number is within window
            if block_number > current_block {
                self.emit(CommitmentRejected {
                    commitment,
                    reason: 'future_block'
                });
                return false;
            }
            
            if current_block - block_number > MAX_BLOCK_WINDOW {
                self.emit(CommitmentRejected {
                    commitment,
                    reason: 'block_too_old'
                });
                return false;
            }
            
            // Check commitment not already used
            let existing = self.intents.read(commitment);
            if existing.used {
                self.emit(CommitmentRejected {
                    commitment,
                    reason: 'already_used'
                });
                return false;
            }
            
            // Store commitment
            let record = IntentRecord {
                user: caller,
                commitment,
                chain_id,
                block_number,
                timestamp,
                used: false,
                action_hash: 0,
            };
            self.intents.write(commitment, record);
            
            // Track user commitments
            let count = self.user_commitment_count.read(caller);
            self.user_commitments.write((caller, count), commitment);
            self.user_commitment_count.write(caller, count + 1);
            
            // Emit event
            self.emit(CommitmentSubmitted {
                user: caller,
                commitment,
                block_number,
                timestamp,
            });
            
            true
        }
        
        fn use_commitment(
            ref self: ContractState,
            commitment: felt252,
            action_hash: felt252
        ) -> bool {
            let timestamp = get_block_timestamp();
            
            let mut record = self.intents.read(commitment);
            
            // Check commitment exists and not used
            if record.commitment == 0 {
                return false;
            }
            if record.used {
                return false;
            }
            
            // Mark as used
            record.used = true;
            record.action_hash = action_hash;
            self.intents.write(commitment, record);
            
            // Emit event
            self.emit(CommitmentUsed {
                commitment,
                action_hash,
                timestamp,
            });
            
            true
        }
        
        fn is_commitment_valid(self: @ContractState, commitment: felt252) -> bool {
            let record = self.intents.read(commitment);
            let current_block = get_block_number();
            
            // Must exist, not used, and within block window
            record.commitment != 0 
                && !record.used 
                && (current_block - record.block_number <= MAX_BLOCK_WINDOW)
        }
        
        fn is_commitment_used(self: @ContractState, commitment: felt252) -> bool {
            self.intents.read(commitment).used
        }
        
        fn get_intent_record(self: @ContractState, commitment: felt252) -> IntentRecord {
            self.intents.read(commitment)
        }
        
        fn get_user_commitment_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_commitment_count.read(user)
        }
        
        fn verify_commitment(
            self: @ContractState,
            commitment: felt252,
            expected_user: ContractAddress,
            expected_chain_id: felt252
        ) -> bool {
            let record = self.intents.read(commitment);
            
            record.commitment != 0
                && record.user == expected_user
                && record.chain_id == expected_chain_id
                && !record.used
        }
    }
}
