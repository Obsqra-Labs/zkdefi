// ValidationProofRegistry: On-chain catalog of validated proofs
// 
// Aligns with ERC-8004's Validation Proofs Registry:
// - Records which proofs have been verified
// - Enables discovery of agent proofs
// - Links proofs to agents and actions
// - Provides trust attestation for cross-agent communication

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct ProofRecord {
    pub agent_id: felt252,
    pub fact_hash: felt252,
    pub proof_type: felt252,      // 'groth16', 'risc_zero', 'stark'
    pub action_type: felt252,     // 'deposit', 'withdraw', 'rebalance', 'init'
    pub verifier_address: ContractAddress,
    pub verified_at: u64,
    pub submitter: ContractAddress,
    pub is_valid: bool,
}

#[starknet::interface]
pub trait IValidationProofRegistry<TContractState> {
    // Register a proof after verification
    fn register_proof(
        ref self: TContractState, 
        fact_hash: felt252, 
        agent_id: felt252, 
        proof_type: felt252,
        action_type: felt252,
        verifier_address: ContractAddress
    ) -> u64;
    
    // Invalidate a proof (admin only)
    fn invalidate_proof(ref self: TContractState, proof_id: u64);
    
    // Query functions
    fn get_proof(self: @TContractState, proof_id: u64) -> ProofRecord;
    fn get_proof_by_hash(self: @TContractState, fact_hash: felt252) -> ProofRecord;
    fn has_proof(self: @TContractState, fact_hash: felt252) -> bool;
    fn is_proof_valid(self: @TContractState, fact_hash: felt252) -> bool;
    
    // Discovery functions (ERC-8004 alignment)
    fn get_agent_proofs(self: @TContractState, agent_id: felt252) -> Array<u64>;
    fn get_agent_proof_count(self: @TContractState, agent_id: felt252) -> u64;
    fn get_proofs_by_type(self: @TContractState, proof_type: felt252) -> Array<u64>;
    fn get_proofs_by_action(self: @TContractState, action_type: felt252) -> Array<u64>;
    fn get_recent_proofs(self: @TContractState, limit: u64) -> Array<u64>;
    
    // Stats
    fn get_total_proofs(self: @TContractState) -> u64;
    fn get_valid_proofs_count(self: @TContractState) -> u64;
    
    // Batch operations
    fn register_proofs_batch(
        ref self: TContractState,
        fact_hashes: Span<felt252>,
        agent_id: felt252,
        proof_type: felt252,
        action_type: felt252,
        verifier_address: ContractAddress
    ) -> Array<u64>;
    
    // Authorized verifiers
    fn add_authorized_verifier(ref self: TContractState, verifier: ContractAddress);
    fn remove_authorized_verifier(ref self: TContractState, verifier: ContractAddress);
    fn is_authorized_verifier(self: @TContractState, verifier: ContractAddress) -> bool;
}

#[starknet::contract]
mod ValidationProofRegistry {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use super::ProofRecord;

    const MAX_RECENT_PROOFS: u64 = 100;

    #[storage]
    struct Storage {
        // Proof storage
        proofs: Map<u64, ProofRecord>,
        proof_by_hash: Map<felt252, u64>,
        
        // Indexes for discovery
        agent_proofs: Map<(felt252, u64), u64>,
        agent_proof_count: Map<felt252, u64>,
        type_proofs: Map<(felt252, u64), u64>,
        type_proof_count: Map<felt252, u64>,
        action_proofs: Map<(felt252, u64), u64>,
        action_proof_count: Map<felt252, u64>,
        
        // Recent proofs (circular buffer)
        recent_proofs: Map<u64, u64>,
        recent_proof_index: u64,
        
        // Counters
        next_proof_id: u64,
        total_proofs: u64,
        valid_proofs: u64,
        
        // Authorized verifiers
        authorized_verifiers: Map<ContractAddress, bool>,
        
        // Admin
        admin: ContractAddress,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ProofRegistered: ProofRegistered,
        ProofInvalidated: ProofInvalidated,
        VerifierAuthorized: VerifierAuthorized,
        VerifierRevoked: VerifierRevoked,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ProofRegistered {
        #[key]
        proof_id: u64,
        #[key]
        agent_id: felt252,
        fact_hash: felt252,
        proof_type: felt252,
        action_type: felt252,
        verifier_address: ContractAddress,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ProofInvalidated {
        #[key]
        proof_id: u64,
        #[key]
        fact_hash: felt252,
    }
    
    #[derive(Drop, starknet::Event)]
    struct VerifierAuthorized {
        #[key]
        verifier: ContractAddress,
    }
    
    #[derive(Drop, starknet::Event)]
    struct VerifierRevoked {
        #[key]
        verifier: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        self.next_proof_id.write(1);
        self.total_proofs.write(0);
        self.valid_proofs.write(0);
        self.recent_proof_index.write(0);
    }

    #[abi(embed_v0)]
    impl ValidationProofRegistryImpl of super::IValidationProofRegistry<ContractState> {
        fn register_proof(
            ref self: ContractState, 
            fact_hash: felt252, 
            agent_id: felt252, 
            proof_type: felt252,
            action_type: felt252,
            verifier_address: ContractAddress
        ) -> u64 {
            let caller = get_caller_address();
            
            // Verify caller is authorized (admin or authorized verifier)
            assert(
                caller == self.admin.read() || self.authorized_verifiers.read(caller),
                'Not authorized'
            );
            
            // Check if proof already registered
            let existing = self.proof_by_hash.read(fact_hash);
            if existing != 0 {
                return existing;
            }
            
            let timestamp = get_block_timestamp();
            let proof_id = self.next_proof_id.read();
            self.next_proof_id.write(proof_id + 1);
            
            // Create proof record
            let record = ProofRecord {
                agent_id,
                fact_hash,
                proof_type,
                action_type,
                verifier_address,
                verified_at: timestamp,
                submitter: caller,
                is_valid: true,
            };
            
            self.proofs.write(proof_id, record);
            self.proof_by_hash.write(fact_hash, proof_id);
            
            // Update indexes
            let agent_count = self.agent_proof_count.read(agent_id);
            self.agent_proofs.write((agent_id, agent_count), proof_id);
            self.agent_proof_count.write(agent_id, agent_count + 1);
            
            let type_count = self.type_proof_count.read(proof_type);
            self.type_proofs.write((proof_type, type_count), proof_id);
            self.type_proof_count.write(proof_type, type_count + 1);
            
            let action_count = self.action_proof_count.read(action_type);
            self.action_proofs.write((action_type, action_count), proof_id);
            self.action_proof_count.write(action_type, action_count + 1);
            
            // Add to recent proofs (circular buffer)
            let recent_idx = self.recent_proof_index.read() % MAX_RECENT_PROOFS;
            self.recent_proofs.write(recent_idx, proof_id);
            self.recent_proof_index.write(self.recent_proof_index.read() + 1);
            
            // Update counters
            self.total_proofs.write(self.total_proofs.read() + 1);
            self.valid_proofs.write(self.valid_proofs.read() + 1);
            
            self.emit(ProofRegistered {
                proof_id,
                agent_id,
                fact_hash,
                proof_type,
                action_type,
                verifier_address,
            });
            
            proof_id
        }
        
        fn invalidate_proof(ref self: ContractState, proof_id: u64) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Admin only');
            
            let mut record = self.proofs.read(proof_id);
            assert(record.verified_at != 0, 'Proof does not exist');
            assert(record.is_valid, 'Already invalidated');
            
            record.is_valid = false;
            self.proofs.write(proof_id, record);
            self.valid_proofs.write(self.valid_proofs.read() - 1);
            
            self.emit(ProofInvalidated {
                proof_id,
                fact_hash: record.fact_hash,
            });
        }
        
        fn get_proof(self: @ContractState, proof_id: u64) -> ProofRecord {
            self.proofs.read(proof_id)
        }
        
        fn get_proof_by_hash(self: @ContractState, fact_hash: felt252) -> ProofRecord {
            let proof_id = self.proof_by_hash.read(fact_hash);
            self.proofs.read(proof_id)
        }
        
        fn has_proof(self: @ContractState, fact_hash: felt252) -> bool {
            self.proof_by_hash.read(fact_hash) != 0
        }
        
        fn is_proof_valid(self: @ContractState, fact_hash: felt252) -> bool {
            let proof_id = self.proof_by_hash.read(fact_hash);
            if proof_id == 0 {
                return false;
            }
            self.proofs.read(proof_id).is_valid
        }
        
        fn get_agent_proofs(self: @ContractState, agent_id: felt252) -> Array<u64> {
            let count = self.agent_proof_count.read(agent_id);
            let mut proofs: Array<u64> = ArrayTrait::new();
            let mut i: u64 = 0;
            loop {
                if i >= count {
                    break;
                }
                proofs.append(self.agent_proofs.read((agent_id, i)));
                i += 1;
            };
            proofs
        }
        
        fn get_agent_proof_count(self: @ContractState, agent_id: felt252) -> u64 {
            self.agent_proof_count.read(agent_id)
        }
        
        fn get_proofs_by_type(self: @ContractState, proof_type: felt252) -> Array<u64> {
            let count = self.type_proof_count.read(proof_type);
            let mut proofs: Array<u64> = ArrayTrait::new();
            let mut i: u64 = 0;
            loop {
                if i >= count {
                    break;
                }
                proofs.append(self.type_proofs.read((proof_type, i)));
                i += 1;
            };
            proofs
        }
        
        fn get_proofs_by_action(self: @ContractState, action_type: felt252) -> Array<u64> {
            let count = self.action_proof_count.read(action_type);
            let mut proofs: Array<u64> = ArrayTrait::new();
            let mut i: u64 = 0;
            loop {
                if i >= count {
                    break;
                }
                proofs.append(self.action_proofs.read((action_type, i)));
                i += 1;
            };
            proofs
        }
        
        fn get_recent_proofs(self: @ContractState, limit: u64) -> Array<u64> {
            let total_idx = self.recent_proof_index.read();
            let actual_limit = if limit > MAX_RECENT_PROOFS { MAX_RECENT_PROOFS } else { limit };
            let start = if total_idx > actual_limit { total_idx - actual_limit } else { 0 };
            
            let mut proofs: Array<u64> = ArrayTrait::new();
            let mut i = start;
            loop {
                if i >= total_idx {
                    break;
                }
                let idx = i % MAX_RECENT_PROOFS;
                let proof_id = self.recent_proofs.read(idx);
                if proof_id != 0 {
                    proofs.append(proof_id);
                }
                i += 1;
            };
            proofs
        }
        
        fn get_total_proofs(self: @ContractState) -> u64 {
            self.total_proofs.read()
        }
        
        fn get_valid_proofs_count(self: @ContractState) -> u64 {
            self.valid_proofs.read()
        }
        
        fn register_proofs_batch(
            ref self: ContractState,
            fact_hashes: Span<felt252>,
            agent_id: felt252,
            proof_type: felt252,
            action_type: felt252,
            verifier_address: ContractAddress
        ) -> Array<u64> {
            let mut proof_ids: Array<u64> = ArrayTrait::new();
            let mut i: u32 = 0;
            loop {
                if i >= fact_hashes.len() {
                    break;
                }
                let proof_id = self.register_proof(
                    *fact_hashes.at(i),
                    agent_id,
                    proof_type,
                    action_type,
                    verifier_address
                );
                proof_ids.append(proof_id);
                i += 1;
            };
            proof_ids
        }
        
        fn add_authorized_verifier(ref self: ContractState, verifier: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Admin only');
            
            self.authorized_verifiers.write(verifier, true);
            self.emit(VerifierAuthorized { verifier });
        }
        
        fn remove_authorized_verifier(ref self: ContractState, verifier: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Admin only');
            
            self.authorized_verifiers.write(verifier, false);
            self.emit(VerifierRevoked { verifier });
        }
        
        fn is_authorized_verifier(self: @ContractState, verifier: ContractAddress) -> bool {
            self.authorized_verifiers.read(verifier)
        }
    }
}
