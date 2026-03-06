// Compliance Profile: Productized selective disclosure profiles.
// Users can register compliance proofs and share with auditors/protocols.

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct ComplianceProfileData {
    pub user: ContractAddress,
    pub profile_type: felt252,        // 'kyc', 'risk', 'performance', 'aggregation'
    pub statement_hash: felt252,      // Hash of the statement proven
    pub proof_hash: felt252,          // Proof that statement is true
    pub threshold: u256,              // Threshold value (if applicable)
    pub result: felt252,              // Result of proof (e.g., 'above', 'below', 'eligible')
    pub timestamp: u64,
    pub expiry: u64,                  // When this proof expires
    pub is_active: bool,
}

#[starknet::interface]
pub trait IFactRegistry<TContractState> {
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
}

#[starknet::interface]
pub trait IComplianceProfile<TContractState> {
    // Register a new compliance profile
    fn register_profile(
        ref self: TContractState,
        profile_type: felt252,
        statement_hash: felt252,
        proof_hash: felt252,
        threshold: u256,
        result: felt252,
        validity_days: u64
    ) -> felt252;  // Returns profile_id
    
    // Revoke a profile
    fn revoke_profile(ref self: TContractState, profile_id: felt252);
    
    // Get profile by ID
    fn get_profile(self: @TContractState, profile_id: felt252) -> ComplianceProfileData;
    
    // Check if user has valid profile of type
    fn has_valid_profile(
        self: @TContractState,
        user: ContractAddress,
        profile_type: felt252
    ) -> bool;
    
    // Get user's profile count
    fn get_user_profile_count(self: @TContractState, user: ContractAddress) -> u64;
    
    // Get user's profile at index
    fn get_user_profile_at(self: @TContractState, user: ContractAddress, index: u64) -> felt252;
    
    // Verify profile is valid (not expired, proof valid)
    fn verify_profile(self: @TContractState, profile_id: felt252) -> bool;
}

#[starknet::contract]
mod ComplianceProfile {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::poseidon::poseidon_hash_span;
    
    use super::IFactRegistryDispatcher;
    use super::IFactRegistryDispatcherTrait;
    use super::ComplianceProfileData;
    
    const SECONDS_PER_DAY: u64 = 86400;
    
    #[storage]
    struct Storage {
        fact_registry: ContractAddress,
        profiles: Map<felt252, ComplianceProfileData>,
        user_profile_count: Map<ContractAddress, u64>,
        user_profiles: Map<(ContractAddress, u64), felt252>,
        user_profile_by_type: Map<(ContractAddress, felt252), felt252>,  // Latest profile of type
        next_profile_id: u64,
        admin: ContractAddress,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ProfileRegistered: ProfileRegistered,
        ProfileRevoked: ProfileRevoked,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ProfileRegistered {
        #[key]
        user: ContractAddress,
        #[key]
        profile_type: felt252,
        profile_id: felt252,
        proof_hash: felt252,
        expiry: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ProfileRevoked {
        #[key]
        user: ContractAddress,
        profile_id: felt252,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        fact_registry: ContractAddress,
        admin: ContractAddress
    ) {
        self.fact_registry.write(fact_registry);
        self.admin.write(admin);
        self.next_profile_id.write(1);
    }
    
    #[abi(embed_v0)]
    impl ComplianceProfileImpl of super::IComplianceProfile<ContractState> {
        fn register_profile(
            ref self: ContractState,
            profile_type: felt252,
            statement_hash: felt252,
            proof_hash: felt252,
            threshold: u256,
            result: felt252,
            validity_days: u64
        ) -> felt252 {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            let expiry = timestamp + (validity_days * SECONDS_PER_DAY);
            
            // Verify proof is valid
            let registry = IFactRegistryDispatcher {
                contract_address: self.fact_registry.read()
            };
            assert(registry.is_valid(proof_hash), 'Invalid proof');
            
            // Generate profile ID
            let profile_num = self.next_profile_id.read();
            self.next_profile_id.write(profile_num + 1);
            
            let profile_id_input: Array<felt252> = array![
                caller.into(),
                profile_type,
                profile_num.into(),
                timestamp.into()
            ];
            let profile_id = poseidon_hash_span(profile_id_input.span());
            
            // Create profile
            let profile = ComplianceProfileData {
                user: caller,
                profile_type,
                statement_hash,
                proof_hash,
                threshold,
                result,
                timestamp,
                expiry,
                is_active: true,
            };
            
            // Store profile
            self.profiles.write(profile_id, profile);
            
            // Track user profiles
            let count = self.user_profile_count.read(caller);
            self.user_profiles.write((caller, count), profile_id);
            self.user_profile_count.write(caller, count + 1);
            
            // Update latest profile of type
            self.user_profile_by_type.write((caller, profile_type), profile_id);
            
            // Emit event
            self.emit(ProfileRegistered {
                user: caller,
                profile_type,
                profile_id,
                proof_hash,
                expiry,
            });
            
            profile_id
        }
        
        fn revoke_profile(ref self: ContractState, profile_id: felt252) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            let mut profile = self.profiles.read(profile_id);
            
            // Only owner can revoke
            assert(profile.user == caller, 'Not profile owner');
            assert(profile.is_active, 'Profile already revoked');
            
            // Deactivate profile
            profile.is_active = false;
            self.profiles.write(profile_id, profile);
            
            // Emit event
            self.emit(ProfileRevoked {
                user: caller,
                profile_id,
                timestamp,
            });
        }
        
        fn get_profile(self: @ContractState, profile_id: felt252) -> ComplianceProfileData {
            self.profiles.read(profile_id)
        }
        
        fn has_valid_profile(
            self: @ContractState,
            user: ContractAddress,
            profile_type: felt252
        ) -> bool {
            let profile_id = self.user_profile_by_type.read((user, profile_type));
            if profile_id == 0 {
                return false;
            }
            
            let profile = self.profiles.read(profile_id);
            let timestamp = get_block_timestamp();
            
            profile.is_active && timestamp <= profile.expiry
        }
        
        fn get_user_profile_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_profile_count.read(user)
        }
        
        fn get_user_profile_at(self: @ContractState, user: ContractAddress, index: u64) -> felt252 {
            self.user_profiles.read((user, index))
        }
        
        fn verify_profile(self: @ContractState, profile_id: felt252) -> bool {
            let profile = self.profiles.read(profile_id);
            let timestamp = get_block_timestamp();
            
            if !profile.is_active {
                return false;
            }
            
            if timestamp > profile.expiry {
                return false;
            }
            
            // Verify proof is still valid in fact registry
            let registry = IFactRegistryDispatcher {
                contract_address: self.fact_registry.read()
            };
            registry.is_valid(profile.proof_hash)
        }
    }
}
