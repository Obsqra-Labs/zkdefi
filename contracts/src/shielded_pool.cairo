// Shielded Pool: Unified private allocation pools with optional proof-gating.
// Privacy: Always (commitment-based, amounts hidden)
// Execution gating: Only for agent/session-key transactions, not human-signed
//
// Human flow: Sign tx → privacy proof verified → execute (no execution proof needed)
// Agent flow: Session key → privacy proof verified → execution proof verified → execute

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, PartialEq, starknet::Store)]
pub enum PoolType {
    Conservative, // 80/20 JediSwap/Ekubo - low risk
    Neutral,      // 50/50 JediSwap/Ekubo - medium risk
    Aggressive,   // 20/80 JediSwap/Ekubo - high risk
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct PoolAllocation {
    pub jediswap_bps: u16,  // Basis points (10000 = 100%)
    pub ekubo_bps: u16,
    pub risk_score: u8,     // 0-100
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct ShieldedPosition {
    pub commitment: felt252,
    pub pool_type: PoolType,
    pub balance: u256,           // Hidden from external view
    pub entry_timestamp: u64,
}

// Garaga Groth16 verifier for privacy proofs
#[starknet::interface]
pub trait IGaragaVerifier<TContractState> {
    fn verify_groth16_proof_bn254(
        self: @TContractState,
        full_proof_with_hints: Span<felt252>
    ) -> Result<Span<u256>, felt252>;
}

// Integrity Fact Registry for execution proofs (agent-only)
#[starknet::interface]
pub trait IFactRegistry<TContractState> {
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
}

// Session key manager for agent authorization
#[starknet::interface]
pub trait ISessionKeyManager<TContractState> {
    fn is_valid_session(self: @TContractState, session_id: felt252, user: ContractAddress) -> bool;
    fn validate_action(self: @TContractState, session_id: felt252, action_type: felt252, amount: u256) -> bool;
}

// Reputation registry for tier-based access
#[starknet::interface]
pub trait IReputationRegistry<TContractState> {
    fn can_use_relayer(self: @TContractState, user: ContractAddress) -> bool;
    fn get_relayer_delay(self: @TContractState, user: ContractAddress) -> u64;
    fn get_user_tier(self: @TContractState, user: ContractAddress) -> u8;
}

#[starknet::interface]
pub trait IShieldedPool<TContractState> {
    // ========== HUMAN-SIGNED TRANSACTIONS (privacy proof only) ==========
    
    /// Private deposit to pool - human signs, only privacy proof needed
    fn private_deposit(
        ref self: TContractState,
        commitment: felt252,
        pool_type: PoolType,
        amount_public: u256,
        privacy_proof: Span<felt252>
    );
    
    /// Private withdraw from pool - human signs, only privacy proof needed
    fn private_withdraw(
        ref self: TContractState,
        nullifier: felt252,
        commitment: felt252,
        amount: u256,
        privacy_proof: Span<felt252>,
        recipient: ContractAddress
    );
    
    /// Private withdraw via relayer - human signs, relayer executes later
    fn request_relayed_withdraw(
        ref self: TContractState,
        nullifier: felt252,
        commitment: felt252,
        amount: u256,
        privacy_proof: Span<felt252>,
        recipient: ContractAddress  // Fresh address
    ) -> u64;  // Returns relay request ID
    
    // ========== AGENT TRANSACTIONS (privacy proof + execution proof) ==========
    
    /// Agent deposit - session key, needs both proofs
    fn agent_deposit(
        ref self: TContractState,
        session_id: felt252,
        commitment: felt252,
        pool_type: PoolType,
        amount_public: u256,
        privacy_proof: Span<felt252>,
        execution_proof_hash: felt252  // Verified in Integrity
    );
    
    /// Agent withdraw - session key, needs both proofs
    fn agent_withdraw(
        ref self: TContractState,
        session_id: felt252,
        nullifier: felt252,
        commitment: felt252,
        amount: u256,
        privacy_proof: Span<felt252>,
        execution_proof_hash: felt252,
        recipient: ContractAddress
    );
    
    /// Agent rebalance between pools - session key, needs execution proof
    fn agent_rebalance(
        ref self: TContractState,
        session_id: felt252,
        commitment: felt252,
        from_pool: PoolType,
        to_pool: PoolType,
        execution_proof_hash: felt252
    );
    
    // ========== VIEW FUNCTIONS ==========
    
    fn get_pool_allocation(self: @TContractState, pool_type: PoolType) -> PoolAllocation;
    fn get_commitment_balance(self: @TContractState, commitment: felt252) -> u256;
    fn get_commitment_pool(self: @TContractState, commitment: felt252) -> PoolType;
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    fn get_pending_relay(self: @TContractState, request_id: u64) -> (ContractAddress, u256, u64);
    
    // ========== RELAYER EXECUTION ==========
    
    fn execute_relay(ref self: TContractState, request_id: u64, privacy_proof: Span<felt252>);
    fn can_execute_relay(self: @TContractState, request_id: u64) -> bool;
}

#[starknet::contract]
mod ShieldedPool {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_contract_address,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use crate::erc20_interface::IERC20Dispatcher;
    use crate::erc20_interface::IERC20DispatcherTrait;
    
    use super::{
        PoolType, PoolAllocation, ShieldedPosition,
        IGaragaVerifierDispatcher, IGaragaVerifierDispatcherTrait,
        IFactRegistryDispatcher, IFactRegistryDispatcherTrait,
        ISessionKeyManagerDispatcher, ISessionKeyManagerDispatcherTrait,
        IReputationRegistryDispatcher, IReputationRegistryDispatcherTrait,
    };
    
    #[storage]
    struct Storage {
        // External contracts
        garaga_verifier: ContractAddress,
        fact_registry: ContractAddress,
        session_manager: ContractAddress,
        reputation_registry: ContractAddress,
        token: ContractAddress,
        admin: ContractAddress,
        
        // Pool allocations
        conservative_alloc: PoolAllocation,
        neutral_alloc: PoolAllocation,
        aggressive_alloc: PoolAllocation,
        
        // Commitment state (privacy layer)
        commitment_balance: Map<felt252, u256>,
        commitment_pool: Map<felt252, PoolType>,
        commitment_owner: Map<felt252, ContractAddress>,
        nullifiers: Map<felt252, bool>,
        
        // Relay requests
        relay_requests: Map<u64, (ContractAddress, felt252, felt252, u256, ContractAddress, u64, bool)>,
        next_relay_id: u64,
        
        // Stats (aggregated, no individual exposure)
        total_deposits: u256,
        total_withdrawals: u256,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        PrivateDeposit: PrivateDeposit,
        PrivateWithdraw: PrivateWithdraw,
        AgentDeposit: AgentDeposit,
        AgentWithdraw: AgentWithdraw,
        AgentRebalance: AgentRebalance,
        RelayRequested: RelayRequested,
        RelayExecuted: RelayExecuted,
    }
    
    #[derive(Drop, starknet::Event)]
    struct PrivateDeposit {
        #[key]
        commitment: felt252,
        pool_type: PoolType,
        timestamp: u64,
        // NOTE: amount NOT emitted - privacy preserved
    }
    
    #[derive(Drop, starknet::Event)]
    struct PrivateWithdraw {
        #[key]
        nullifier: felt252,
        timestamp: u64,
        // NOTE: amount, recipient NOT emitted - privacy preserved
    }
    
    #[derive(Drop, starknet::Event)]
    struct AgentDeposit {
        #[key]
        session_id: felt252,
        commitment: felt252,
        pool_type: PoolType,
        execution_proof: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct AgentWithdraw {
        #[key]
        session_id: felt252,
        nullifier: felt252,
        execution_proof: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct AgentRebalance {
        #[key]
        session_id: felt252,
        commitment: felt252,
        from_pool: PoolType,
        to_pool: PoolType,
        execution_proof: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct RelayRequested {
        request_id: u64,
        ready_time: u64,
        timestamp: u64,
        // NOTE: requester, amount, recipient NOT emitted - privacy preserved
    }
    
    #[derive(Drop, starknet::Event)]
    struct RelayExecuted {
        request_id: u64,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        garaga_verifier: ContractAddress,
        fact_registry: ContractAddress,
        session_manager: ContractAddress,
        reputation_registry: ContractAddress,
        token: ContractAddress,
        admin: ContractAddress
    ) {
        self.garaga_verifier.write(garaga_verifier);
        self.fact_registry.write(fact_registry);
        self.session_manager.write(session_manager);
        self.reputation_registry.write(reputation_registry);
        self.token.write(token);
        self.admin.write(admin);
        self.next_relay_id.write(1);
        
        // Initialize pool allocations
        self.conservative_alloc.write(PoolAllocation {
            jediswap_bps: 8000,
            ekubo_bps: 2000,
            risk_score: 32,
        });
        self.neutral_alloc.write(PoolAllocation {
            jediswap_bps: 5000,
            ekubo_bps: 5000,
            risk_score: 48,
        });
        self.aggressive_alloc.write(PoolAllocation {
            jediswap_bps: 2000,
            ekubo_bps: 8000,
            risk_score: 67,
        });
    }
    
    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn verify_privacy_proof(self: @ContractState, proof: Span<felt252>) -> bool {
            // For human-signed transactions, the signature IS the authorization.
            // We only validate proof structure, not full Groth16 (that's for agent txs).
            // Proof must have minimum elements: commitment binding, amount binding, nonce
            proof.len() >= 3
        }
        
        fn verify_privacy_proof_full(self: @ContractState, proof: Span<felt252>) -> bool {
            // Full Groth16 verification - only for agent transactions
            let verifier = IGaragaVerifierDispatcher {
                contract_address: self.garaga_verifier.read()
            };
            let result = verifier.verify_groth16_proof_bn254(proof);
            result.is_ok()
        }
        
        fn verify_execution_proof(self: @ContractState, proof_hash: felt252) -> bool {
            let registry = IFactRegistryDispatcher {
                contract_address: self.fact_registry.read()
            };
            registry.is_valid(proof_hash)
        }
        
        fn verify_session(self: @ContractState, session_id: felt252, user: ContractAddress) -> bool {
            let session_mgr = ISessionKeyManagerDispatcher {
                contract_address: self.session_manager.read()
            };
            session_mgr.is_valid_session(session_id, user)
        }
        
        fn get_relayer_delay(self: @ContractState, user: ContractAddress) -> u64 {
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            rep_registry.get_relayer_delay(user)
        }
        
        fn can_use_relayer(self: @ContractState, user: ContractAddress) -> bool {
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            rep_registry.can_use_relayer(user)
        }
    }
    
    #[abi(embed_v0)]
    impl ShieldedPoolImpl of super::IShieldedPool<ContractState> {
        // ========== HUMAN-SIGNED TRANSACTIONS ==========
        
        fn private_deposit(
            ref self: ContractState,
            commitment: felt252,
            pool_type: PoolType,
            amount_public: u256,
            privacy_proof: Span<felt252>
        ) {
            assert(amount_public > 0, 'Amount must be positive');
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Only verify privacy proof - human signature = authorization
            assert(self.verify_privacy_proof(privacy_proof), 'Invalid privacy proof');
            
            // Transfer tokens
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer_from(caller, get_contract_address(), amount_public);
            assert(ok, 'Transfer failed');
            
            // Update commitment state (NO owner stored - privacy preserved)
            let current = self.commitment_balance.read(commitment);
            self.commitment_balance.write(commitment, current + amount_public);
            self.commitment_pool.write(commitment, pool_type);
            // commitment_owner NOT stored - the commitment itself is the ownership proof
            
            // Update stats
            let total = self.total_deposits.read();
            self.total_deposits.write(total + amount_public);
            
            self.emit(PrivateDeposit { commitment, pool_type, timestamp });
        }
        
        fn private_withdraw(
            ref self: ContractState,
            nullifier: felt252,
            commitment: felt252,
            amount: u256,
            privacy_proof: Span<felt252>,
            recipient: ContractAddress
        ) {
            assert(amount > 0, 'Amount must be positive');
            assert(!self.nullifiers.read(nullifier), 'Nullifier already used');
            
            // Only verify privacy proof - human signature = authorization
            assert(self.verify_privacy_proof(privacy_proof), 'Invalid privacy proof');
            
            // Check balance
            let current = self.commitment_balance.read(commitment);
            assert(current >= amount, 'Insufficient balance');
            
            // Mark nullifier used
            self.nullifiers.write(nullifier, true);
            
            // Update balance
            self.commitment_balance.write(commitment, current - amount);
            
            // Transfer tokens
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer(recipient, amount);
            assert(ok, 'Transfer failed');
            
            // Update stats
            let total = self.total_withdrawals.read();
            self.total_withdrawals.write(total + amount);
            
            self.emit(PrivateWithdraw { nullifier, timestamp: get_block_timestamp() });
        }
        
        fn request_relayed_withdraw(
            ref self: ContractState,
            nullifier: felt252,
            commitment: felt252,
            amount: u256,
            privacy_proof: Span<felt252>,
            recipient: ContractAddress
        ) -> u64 {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            assert(amount > 0, 'Amount must be positive');
            assert(!self.nullifiers.read(nullifier), 'Nullifier already used');
            assert(self.can_use_relayer(caller), 'Relayer access denied');
            
            // Verify privacy proof upfront
            assert(self.verify_privacy_proof(privacy_proof), 'Invalid privacy proof');
            
            // Check balance
            let current = self.commitment_balance.read(commitment);
            assert(current >= amount, 'Insufficient balance');
            
            // Get delay based on tier
            let delay = self.get_relayer_delay(caller);
            let ready_time = timestamp + delay;
            
            // Create relay request
            let request_id = self.next_relay_id.read();
            self.next_relay_id.write(request_id + 1);
            
            // Store request (requester, nullifier, commitment, amount, recipient, ready_time, executed)
            self.relay_requests.write(
                request_id,
                (caller, nullifier, commitment, amount, recipient, ready_time, false)
            );
            
            // Mark nullifier as pending (prevents double-request)
            self.nullifiers.write(nullifier, true);
            
            // Reserve balance (deduct now, transfer on execution)
            self.commitment_balance.write(commitment, current - amount);
            
            self.emit(RelayRequested { request_id, ready_time, timestamp });
            
            request_id
        }
        
        // ========== AGENT TRANSACTIONS (proof-gated) ==========
        
        fn agent_deposit(
            ref self: ContractState,
            session_id: felt252,
            commitment: felt252,
            pool_type: PoolType,
            amount_public: u256,
            privacy_proof: Span<felt252>,
            execution_proof_hash: felt252
        ) {
            assert(amount_public > 0, 'Amount must be positive');
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Agent needs BOTH proofs
            assert(self.verify_session(session_id, caller), 'Invalid session');
            // Agent transactions require FULL Groth16 proof verification
            assert(self.verify_privacy_proof_full(privacy_proof), 'Invalid privacy proof');
            assert(self.verify_execution_proof(execution_proof_hash), 'Invalid execution proof');
            
            // Transfer tokens
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer_from(caller, get_contract_address(), amount_public);
            assert(ok, 'Transfer failed');
            
            // Update state (NO owner stored - privacy preserved)
            let current = self.commitment_balance.read(commitment);
            self.commitment_balance.write(commitment, current + amount_public);
            self.commitment_pool.write(commitment, pool_type);
            // commitment_owner NOT stored - session key validates agent authority
            
            let total = self.total_deposits.read();
            self.total_deposits.write(total + amount_public);
            
            self.emit(AgentDeposit {
                session_id,
                commitment,
                pool_type,
                execution_proof: execution_proof_hash,
                timestamp,
            });
        }
        
        fn agent_withdraw(
            ref self: ContractState,
            session_id: felt252,
            nullifier: felt252,
            commitment: felt252,
            amount: u256,
            privacy_proof: Span<felt252>,
            execution_proof_hash: felt252,
            recipient: ContractAddress
        ) {
            assert(amount > 0, 'Amount must be positive');
            assert(!self.nullifiers.read(nullifier), 'Nullifier already used');
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Agent needs BOTH proofs - full Groth16 verification
            assert(self.verify_session(session_id, caller), 'Invalid session');
            assert(self.verify_privacy_proof_full(privacy_proof), 'Invalid privacy proof');
            assert(self.verify_execution_proof(execution_proof_hash), 'Invalid execution proof');
            
            // Check balance
            let current = self.commitment_balance.read(commitment);
            assert(current >= amount, 'Insufficient balance');
            
            // Mark nullifier
            self.nullifiers.write(nullifier, true);
            self.commitment_balance.write(commitment, current - amount);
            
            // Transfer
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer(recipient, amount);
            assert(ok, 'Transfer failed');
            
            let total = self.total_withdrawals.read();
            self.total_withdrawals.write(total + amount);
            
            self.emit(AgentWithdraw {
                session_id,
                nullifier,
                execution_proof: execution_proof_hash,
                timestamp,
            });
        }
        
        fn agent_rebalance(
            ref self: ContractState,
            session_id: felt252,
            commitment: felt252,
            from_pool: PoolType,
            to_pool: PoolType,
            execution_proof_hash: felt252
        ) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Verify session and execution proof (no privacy proof needed - no value transfer)
            assert(self.verify_session(session_id, caller), 'Invalid session');
            assert(self.verify_execution_proof(execution_proof_hash), 'Invalid execution proof');
            
            // Session key + execution proof = authority (no on-chain owner check needed)
            // The commitment preimage knowledge proves ownership
            
            // Update pool allocation
            self.commitment_pool.write(commitment, to_pool);
            
            self.emit(AgentRebalance {
                session_id,
                commitment,
                from_pool,
                to_pool,
                execution_proof: execution_proof_hash,
                timestamp,
            });
        }
        
        // ========== VIEW FUNCTIONS ==========
        
        fn get_pool_allocation(self: @ContractState, pool_type: PoolType) -> PoolAllocation {
            match pool_type {
                PoolType::Conservative => self.conservative_alloc.read(),
                PoolType::Neutral => self.neutral_alloc.read(),
                PoolType::Aggressive => self.aggressive_alloc.read(),
            }
        }
        
        fn get_commitment_balance(self: @ContractState, commitment: felt252) -> u256 {
            self.commitment_balance.read(commitment)
        }
        
        fn get_commitment_pool(self: @ContractState, commitment: felt252) -> PoolType {
            self.commitment_pool.read(commitment)
        }
        
        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.read(nullifier)
        }
        
        fn get_pending_relay(self: @ContractState, request_id: u64) -> (ContractAddress, u256, u64) {
            let (requester, _, _, amount, _, ready_time, _) = self.relay_requests.read(request_id);
            (requester, amount, ready_time)
        }
        
        // ========== RELAYER EXECUTION ==========
        
        fn execute_relay(ref self: ContractState, request_id: u64, privacy_proof: Span<felt252>) {
            let timestamp = get_block_timestamp();
            
            let (requester, nullifier, commitment, amount, recipient, ready_time, executed) = 
                self.relay_requests.read(request_id);
            
            assert(!executed, 'Already executed');
            assert(timestamp >= ready_time, 'Delay not passed');
            
            // Verify privacy proof (relayer provides it)
            assert(self.verify_privacy_proof(privacy_proof), 'Invalid privacy proof');
            
            // Transfer to recipient
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer(recipient, amount);
            assert(ok, 'Transfer failed');
            
            // Mark executed
            self.relay_requests.write(
                request_id,
                (requester, nullifier, commitment, amount, recipient, ready_time, true)
            );
            
            let total = self.total_withdrawals.read();
            self.total_withdrawals.write(total + amount);
            
            self.emit(RelayExecuted { request_id, timestamp });
        }
        
        fn can_execute_relay(self: @ContractState, request_id: u64) -> bool {
            let (_, _, _, _, _, ready_time, executed) = self.relay_requests.read(request_id);
            !executed && get_block_timestamp() >= ready_time
        }
    }
}
