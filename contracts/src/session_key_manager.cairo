// Session Key Manager: Manages session keys for proof-gated autonomous agent.
// Session key = limited delegation + proof requirement.

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct SessionConfig {
    pub session_key: ContractAddress,     // Public key for session
    pub owner: ContractAddress,           // Account owner
    pub max_position: u256,               // Max position size allowed
    pub allowed_protocols: u8,            // Bitmap: 1=Pools, 2=Ekubo, 4=JediSwap
    pub expiry: u64,                      // Unix timestamp expiry
    pub is_active: bool,                  // Whether session is active
    pub created_at: u64,                  // Creation timestamp
}

#[starknet::interface]
pub trait IFactRegistry<TContractState> {
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
}

#[starknet::interface]
pub trait ISessionKeyManager<TContractState> {
    // Grant a new session key
    fn grant_session(
        ref self: TContractState,
        session_key: ContractAddress,
        max_position: u256,
        allowed_protocols: u8,
        duration_seconds: u64
    ) -> felt252;  // Returns session_id
    
    // Revoke a session key
    fn revoke_session(ref self: TContractState, session_id: felt252);
    
    // Validate session key + proof before execution
    fn validate_session_with_proof(
        self: @TContractState,
        session_id: felt252,
        proof_hash: felt252,
        protocol_id: u8,
        amount: u256
    ) -> bool;
    
    // Get session config
    fn get_session(self: @TContractState, session_id: felt252) -> SessionConfig;
    
    // Get active sessions for user
    fn get_user_session_count(self: @TContractState, user: ContractAddress) -> u64;
    
    // Check if session is valid (not expired, not revoked)
    fn is_session_valid(self: @TContractState, session_id: felt252) -> bool;
    
    // Get fact registry address
    fn get_fact_registry(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
mod SessionKeyManager {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::poseidon::poseidon_hash_span;
    
    use super::IFactRegistryDispatcher;
    use super::IFactRegistryDispatcherTrait;
    use super::SessionConfig;
    
    #[storage]
    struct Storage {
        fact_registry: ContractAddress,
        sessions: Map<felt252, SessionConfig>,
        user_session_count: Map<ContractAddress, u64>,
        user_sessions: Map<(ContractAddress, u64), felt252>,
        next_session_id: u64,
        admin: ContractAddress,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        SessionGranted: SessionGranted,
        SessionRevoked: SessionRevoked,
        SessionValidated: SessionValidated,
    }
    
    #[derive(Drop, starknet::Event)]
    struct SessionGranted {
        #[key]
        owner: ContractAddress,
        #[key]
        session_key: ContractAddress,
        session_id: felt252,
        max_position: u256,
        allowed_protocols: u8,
        expiry: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct SessionRevoked {
        #[key]
        owner: ContractAddress,
        session_id: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct SessionValidated {
        #[key]
        session_id: felt252,
        proof_hash: felt252,
        protocol_id: u8,
        amount: u256,
        is_valid: bool,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        fact_registry: ContractAddress,
        admin: ContractAddress
    ) {
        self.fact_registry.write(fact_registry);
        self.admin.write(admin);
        self.next_session_id.write(1);
    }
    
    #[abi(embed_v0)]
    impl SessionKeyManagerImpl of super::ISessionKeyManager<ContractState> {
        fn grant_session(
            ref self: ContractState,
            session_key: ContractAddress,
            max_position: u256,
            allowed_protocols: u8,
            duration_seconds: u64
        ) -> felt252 {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            let expiry = timestamp + duration_seconds;
            
            // Generate session ID
            let session_num = self.next_session_id.read();
            self.next_session_id.write(session_num + 1);
            
            let session_id_input: Array<felt252> = array![
                caller.into(),
                session_key.into(),
                session_num.into(),
                timestamp.into()
            ];
            let session_id = poseidon_hash_span(session_id_input.span());
            
            // Create session config
            let config = SessionConfig {
                session_key,
                owner: caller,
                max_position,
                allowed_protocols,
                expiry,
                is_active: true,
                created_at: timestamp,
            };
            
            // Store session
            self.sessions.write(session_id, config);
            
            // Track user sessions
            let count = self.user_session_count.read(caller);
            self.user_sessions.write((caller, count), session_id);
            self.user_session_count.write(caller, count + 1);
            
            // Emit event
            self.emit(SessionGranted {
                owner: caller,
                session_key,
                session_id,
                max_position,
                allowed_protocols,
                expiry,
            });
            
            session_id
        }
        
        fn revoke_session(ref self: ContractState, session_id: felt252) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            let mut config = self.sessions.read(session_id);
            
            // Only owner can revoke
            assert(config.owner == caller, 'Not session owner');
            assert(config.is_active, 'Session already revoked');
            
            // Deactivate session
            config.is_active = false;
            self.sessions.write(session_id, config);
            
            // Emit event
            self.emit(SessionRevoked {
                owner: caller,
                session_id,
                timestamp,
            });
        }
        
        fn validate_session_with_proof(
            self: @ContractState,
            session_id: felt252,
            proof_hash: felt252,
            protocol_id: u8,
            amount: u256
        ) -> bool {
            let config = self.sessions.read(session_id);
            let timestamp = get_block_timestamp();
            
            // Check session is active
            if !config.is_active {
                return false;
            }
            
            // Check session not expired
            if timestamp > config.expiry {
                return false;
            }
            
            // Check protocol is allowed
            let protocol_bit = if protocol_id == 0 { 1_u8 }
                else if protocol_id == 1 { 2_u8 }
                else if protocol_id == 2 { 4_u8 }
                else { 0_u8 };
            
            if (config.allowed_protocols & protocol_bit) == 0 {
                return false;
            }
            
            // Check amount within max position
            if amount > config.max_position && config.max_position != 0 {
                return false;
            }
            
            // Verify proof via Integrity
            let registry = IFactRegistryDispatcher {
                contract_address: self.fact_registry.read()
            };
            let proof_valid = registry.is_valid(proof_hash);
            
            proof_valid
        }
        
        fn get_session(self: @ContractState, session_id: felt252) -> SessionConfig {
            self.sessions.read(session_id)
        }
        
        fn get_user_session_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_session_count.read(user)
        }
        
        fn is_session_valid(self: @ContractState, session_id: felt252) -> bool {
            let config = self.sessions.read(session_id);
            let timestamp = get_block_timestamp();
            
            config.is_active && timestamp <= config.expiry
        }
        
        fn get_fact_registry(self: @ContractState) -> ContractAddress {
            self.fact_registry.read()
        }
    }
}
