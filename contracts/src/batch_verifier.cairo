// Batch Verifier: Handles Tier 2 optimistic execution with hourly batch proofs.
// Actions are executed immediately, then proven in batches.
// Failed batch proofs trigger collateral slashing.

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct PendingAction {
    pub user: ContractAddress,
    pub action_hash: felt252,
    pub timestamp: u64,
    pub verified: bool,
}

#[starknet::interface]
pub trait IReputationRegistry<TContractState> {
    fn slash_collateral(ref self: TContractState, user: ContractAddress, amount: u256, recipient: ContractAddress);
}

#[starknet::interface]
pub trait IFactRegistry<TContractState> {
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
}

#[starknet::interface]
pub trait IBatchVerifier<TContractState> {
    // Queue management
    fn queue_action(ref self: TContractState, user: ContractAddress, action_hash: felt252);
    fn get_pending_count(self: @TContractState) -> u64;
    fn get_pending_action(self: @TContractState, index: u64) -> PendingAction;
    
    // Batch proof submission
    fn submit_batch_proof(ref self: TContractState, batch_proof_hash: felt252, action_count: u64);
    fn get_last_batch_timestamp(self: @TContractState) -> u64;
    fn get_last_batch_proof(self: @TContractState) -> felt252;
    
    // Challenge mechanism
    fn challenge_action(ref self: TContractState, action_index: u64, fraud_proof_hash: felt252);
    fn get_challenge_window(self: @TContractState) -> u64;
    
    // Admin
    fn set_challenge_window(ref self: TContractState, window_seconds: u64);
    fn set_slash_amount(ref self: TContractState, amount: u256);
}

#[starknet::contract]
mod BatchVerifier {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_contract_address,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    
    use super::PendingAction;
    use super::IReputationRegistryDispatcher;
    use super::IReputationRegistryDispatcherTrait;
    use super::IFactRegistryDispatcher;
    use super::IFactRegistryDispatcherTrait;
    
    const DEFAULT_CHALLENGE_WINDOW: u64 = 3600; // 1 hour
    
    #[storage]
    struct Storage {
        reputation_registry: ContractAddress,
        fact_registry: ContractAddress,
        admin: ContractAddress,
        
        // Pending actions queue
        pending_actions: Map<u64, PendingAction>,
        pending_count: u64,
        pending_start: u64,  // Start of unverified window
        
        // Batch tracking
        last_batch_timestamp: u64,
        last_batch_proof: felt252,
        batches_submitted: u64,
        
        // Challenge parameters
        challenge_window: u64,
        slash_amount: u256,
        
        // Challenged actions
        challenged_actions: Map<u64, bool>,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ActionQueued: ActionQueued,
        BatchProofSubmitted: BatchProofSubmitted,
        ActionChallenged: ActionChallenged,
        CollateralSlashed: CollateralSlashed,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ActionQueued {
        #[key]
        user: ContractAddress,
        action_hash: felt252,
        action_index: u64,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct BatchProofSubmitted {
        batch_proof_hash: felt252,
        actions_verified: u64,
        submitter: ContractAddress,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ActionChallenged {
        #[key]
        challenger: ContractAddress,
        action_index: u64,
        fraud_proof_hash: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct CollateralSlashed {
        #[key]
        user: ContractAddress,
        amount: u256,
        challenger: ContractAddress,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        reputation_registry: ContractAddress,
        fact_registry: ContractAddress,
        admin: ContractAddress,
        slash_amount: u256
    ) {
        self.reputation_registry.write(reputation_registry);
        self.fact_registry.write(fact_registry);
        self.admin.write(admin);
        self.challenge_window.write(DEFAULT_CHALLENGE_WINDOW);
        self.slash_amount.write(slash_amount);
        self.pending_count.write(0);
        self.pending_start.write(0);
    }
    
    #[abi(embed_v0)]
    impl BatchVerifierImpl of super::IBatchVerifier<ContractState> {
        fn queue_action(ref self: ContractState, user: ContractAddress, action_hash: felt252) {
            let timestamp = get_block_timestamp();
            let index = self.pending_count.read();
            
            self.pending_actions.write(index, PendingAction {
                user,
                action_hash,
                timestamp,
                verified: false,
            });
            
            self.pending_count.write(index + 1);
            
            self.emit(ActionQueued {
                user,
                action_hash,
                action_index: index,
                timestamp,
            });
        }
        
        fn get_pending_count(self: @ContractState) -> u64 {
            self.pending_count.read() - self.pending_start.read()
        }
        
        fn get_pending_action(self: @ContractState, index: u64) -> PendingAction {
            self.pending_actions.read(index)
        }
        
        fn submit_batch_proof(ref self: ContractState, batch_proof_hash: felt252, action_count: u64) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Verify batch proof in Integrity
            let registry = IFactRegistryDispatcher {
                contract_address: self.fact_registry.read()
            };
            assert(registry.is_valid(batch_proof_hash), 'Invalid batch proof');
            
            // Mark actions as verified
            let start = self.pending_start.read();
            let end = start + action_count;
            let total = self.pending_count.read();
            assert(end <= total, 'Action count exceeds pending');
            
            let mut i = start;
            loop {
                if i >= end {
                    break;
                }
                
                let mut action = self.pending_actions.read(i);
                action.verified = true;
                self.pending_actions.write(i, action);
                
                i += 1;
            };
            
            // Update batch tracking
            self.pending_start.write(end);
            self.last_batch_timestamp.write(timestamp);
            self.last_batch_proof.write(batch_proof_hash);
            self.batches_submitted.write(self.batches_submitted.read() + 1);
            
            self.emit(BatchProofSubmitted {
                batch_proof_hash,
                actions_verified: action_count,
                submitter: caller,
                timestamp,
            });
        }
        
        fn get_last_batch_timestamp(self: @ContractState) -> u64 {
            self.last_batch_timestamp.read()
        }
        
        fn get_last_batch_proof(self: @ContractState) -> felt252 {
            self.last_batch_proof.read()
        }
        
        fn challenge_action(ref self: ContractState, action_index: u64, fraud_proof_hash: felt252) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Check action exists and is not already challenged
            let action = self.pending_actions.read(action_index);
            assert(action.user.into() != 0_felt252, 'Action does not exist');
            assert(!self.challenged_actions.read(action_index), 'Already challenged');
            
            // Check within challenge window
            let window = self.challenge_window.read();
            assert(timestamp - action.timestamp <= window, 'Challenge window expired');
            
            // Verify fraud proof
            let registry = IFactRegistryDispatcher {
                contract_address: self.fact_registry.read()
            };
            assert(registry.is_valid(fraud_proof_hash), 'Invalid fraud proof');
            
            // Mark as challenged
            self.challenged_actions.write(action_index, true);
            
            // Slash user collateral
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            let slash_amount = self.slash_amount.read();
            rep_registry.slash_collateral(action.user, slash_amount, caller);
            
            self.emit(ActionChallenged {
                challenger: caller,
                action_index,
                fraud_proof_hash,
                timestamp,
            });
            
            self.emit(CollateralSlashed {
                user: action.user,
                amount: slash_amount,
                challenger: caller,
                timestamp,
            });
        }
        
        fn get_challenge_window(self: @ContractState) -> u64 {
            self.challenge_window.read()
        }
        
        fn set_challenge_window(ref self: ContractState, window_seconds: u64) {
            let caller = get_caller_address();
            let admin = self.admin.read();
            assert(caller == admin, 'Only admin');
            self.challenge_window.write(window_seconds);
        }
        
        fn set_slash_amount(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let admin = self.admin.read();
            assert(caller == admin, 'Only admin');
            self.slash_amount.write(amount);
        }
    }
}
