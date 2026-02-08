// Tiered Agent Controller: Routes execution based on user's reputation tier.
// Strict (Tier 0): Full ZKML proof per action
// Standard (Tier 1): Constraint-bounded, setup proof only
// Express (Tier 2): Optimistic + batched proofs

use starknet::ContractAddress;

#[starknet::interface]
pub trait IReputationRegistry<TContractState> {
    fn get_user_tier(self: @TContractState, user: ContractAddress) -> super::reputation_registry::ProofTier;
    fn record_transaction(ref self: TContractState, user: ContractAddress, volume: u256, success: bool);
    fn check_position_limit(self: @TContractState, user: ContractAddress, new_position: u256) -> bool;
    fn increment_daily_deposit(ref self: TContractState, user: ContractAddress);
    fn increment_daily_withdrawal(ref self: TContractState, user: ContractAddress);
}

#[starknet::interface]
pub trait IAllocationRouter<TContractState> {
    fn deposit_to_pool(ref self: TContractState, pool_type: super::allocation_router::PoolType, amount: u256);
    fn rebalance_to_pool(ref self: TContractState, new_pool: super::allocation_router::PoolType);
    fn withdraw_from_pool(ref self: TContractState, amount: u256);
    fn calculate_risk_score(self: @TContractState, allocation: super::allocation_router::Allocation) -> u8;
}

#[starknet::interface]
pub trait IBatchVerifier<TContractState> {
    fn queue_action(ref self: TContractState, user: ContractAddress, action_hash: felt252);
}

#[starknet::interface]
pub trait IFactRegistry<TContractState> {
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
}

#[starknet::interface]
#[starknet::interface]
pub trait ICairoPerceptron<TContractState> {
    fn predict(self: @TContractState, inputs: Span<felt252>) -> bool;
}

#[starknet::interface]
pub trait IGaragaVerifier<TContractState> {
    fn verify_groth16_proof_bn254(
        self: @TContractState,
        full_proof_with_hints: Span<felt252>
    ) -> Result<Span<u256>, felt252>;
}

#[starknet::interface]
pub trait ITieredAgentController<TContractState> {
    // Main execution entry points
    fn deposit(
        ref self: TContractState,
        pool_type: u8,
        amount: u256,
        zkml_proof: Option<Span<felt252>>,
        execution_proof_hash: Option<felt252>
    );
    
    fn rebalance(
        ref self: TContractState,
        new_pool_type: u8,
        zkml_proof: Option<Span<felt252>>,
        execution_proof_hash: Option<felt252>
    );
    
    fn withdraw(
        ref self: TContractState,
        amount: u256,
        zkml_proof: Option<Span<felt252>>,
        execution_proof_hash: Option<felt252>
    );
    
    // Constraint management
    fn set_constraints(
        ref self: TContractState,
        max_position: u256,
        risk_tolerance: u8,
        constraint_proof_hash: felt252
    );
    fn get_user_constraints(self: @TContractState, user: ContractAddress) -> (u256, u8);
    
    // Getters
    fn get_reputation_registry(self: @TContractState) -> ContractAddress;
    fn get_allocation_router(self: @TContractState) -> ContractAddress;
    fn get_batch_verifier(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
mod TieredAgentController {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    
    use super::IReputationRegistryDispatcher;
    use super::IReputationRegistryDispatcherTrait;
    use super::IAllocationRouterDispatcher;
    use super::IAllocationRouterDispatcherTrait;
    use super::IBatchVerifierDispatcher;
    use super::IBatchVerifierDispatcherTrait;
    use super::IFactRegistryDispatcher;
    use super::IFactRegistryDispatcherTrait;
    use super::IGaragaVerifierDispatcher;
    use super::ICairoPerceptronDispatcher;
    use super::ICairoPerceptronDispatcherTrait;
    use super::IGaragaVerifierDispatcherTrait;
    
    use crate::reputation_registry::ProofTier;
    use crate::allocation_router::{PoolType, Allocation};
    
    #[derive(Drop, Copy, Serde, starknet::Store)]
    struct UserConstraints {
        max_position: u256,
        risk_tolerance: u8,
        constraint_proof_hash: felt252,
    }
    
    #[storage]
    struct Storage {
        reputation_registry: ContractAddress,
        allocation_router: ContractAddress,
        batch_verifier: ContractAddress,
        fact_registry: ContractAddress,
        garaga_verifier: ContractAddress,
        cairo_perceptron: ContractAddress,
        admin: ContractAddress,
        
        // User constraints (proven at setup)
        user_constraints: Map<ContractAddress, UserConstraints>,
        
        // User positions
        user_position: Map<ContractAddress, u256>,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        DepositExecuted: DepositExecuted,
        RebalanceExecuted: RebalanceExecuted,
        WithdrawExecuted: WithdrawExecuted,
        ConstraintsSet: ConstraintsSet,
    }
    
    #[derive(Drop, starknet::Event)]
    struct DepositExecuted {
        #[key]
        user: ContractAddress,
        pool_type: u8,
        amount: u256,
        tier: ProofTier,
        proof_verified: bool,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct RebalanceExecuted {
        #[key]
        user: ContractAddress,
        new_pool_type: u8,
        tier: ProofTier,
        proof_verified: bool,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct WithdrawExecuted {
        #[key]
        user: ContractAddress,
        amount: u256,
        tier: ProofTier,
        proof_verified: bool,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ConstraintsSet {
        #[key]
        user: ContractAddress,
        max_position: u256,
        risk_tolerance: u8,
        constraint_proof_hash: felt252,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        reputation_registry: ContractAddress,
        allocation_router: ContractAddress,
        batch_verifier: ContractAddress,
        fact_registry: ContractAddress,
        garaga_verifier: ContractAddress,
        cairo_perceptron: ContractAddress,
        admin: ContractAddress
    ) {
        self.reputation_registry.write(reputation_registry);
        self.allocation_router.write(allocation_router);
        self.batch_verifier.write(batch_verifier);
        self.fact_registry.write(fact_registry);
        self.garaga_verifier.write(garaga_verifier);
        self.admin.write(admin);
    }
    
    #[abi(embed_v0)]
    impl TieredAgentControllerImpl of super::ITieredAgentController<ContractState> {
        fn deposit(
            ref self: ContractState,
            pool_type: u8,
            amount: u256,
            zkml_proof: Option<Span<felt252>>,
            execution_proof_hash: Option<felt252>
        ) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Get user tier
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            let tier = rep_registry.get_user_tier(caller);
            
            // Check position limit
            let current_pos = self.user_position.read(caller);
            let new_pos = current_pos + amount;
            assert(rep_registry.check_position_limit(caller, new_pos), 'Exceeds position limit');
            
            // Tier-based proof verification
            let proof_verified = self.verify_action_proof(tier, zkml_proof, execution_proof_hash, caller);
            
            // Execute deposit through allocation router
            let router = IAllocationRouterDispatcher {
                contract_address: self.allocation_router.read()
            };
            let pool = self.u8_to_pool_type(pool_type);
            router.deposit_to_pool(pool, amount);
            
            // Update state
            self.user_position.write(caller, new_pos);
            rep_registry.increment_daily_deposit(caller);
            rep_registry.record_transaction(caller, amount, true);
            
            self.emit(DepositExecuted {
                user: caller,
                pool_type,
                amount,
                tier,
                proof_verified,
                timestamp,
            });
        }
        
        fn rebalance(
            ref self: ContractState,
            new_pool_type: u8,
            zkml_proof: Option<Span<felt252>>,
            execution_proof_hash: Option<felt252>
        ) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Get user tier
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            let tier = rep_registry.get_user_tier(caller);
            
            // Check constraints
            let constraints = self.user_constraints.read(caller);
            let new_pool = self.u8_to_pool_type(new_pool_type);
            let router = IAllocationRouterDispatcher {
                contract_address: self.allocation_router.read()
            };
            
            // Get risk score for new allocation
            let pool_allocation = match new_pool {
                PoolType::Conservative => Allocation { jediswap_bps: 8000, ekubo_bps: 2000 },
                PoolType::Neutral => Allocation { jediswap_bps: 5000, ekubo_bps: 5000 },
                PoolType::Aggressive => Allocation { jediswap_bps: 2000, ekubo_bps: 8000 },
            };
            let new_risk = router.calculate_risk_score(pool_allocation);
            assert(new_risk <= constraints.risk_tolerance, 'Exceeds risk tolerance');
            
            // Tier-based proof verification
            let proof_verified = self.verify_action_proof(tier, zkml_proof, execution_proof_hash, caller);
            
            // Execute rebalance
            router.rebalance_to_pool(new_pool);
            
            self.emit(RebalanceExecuted {
                user: caller,
                new_pool_type,
                tier,
                proof_verified,
                timestamp,
            });
        }
        
        fn withdraw(
            ref self: ContractState,
            amount: u256,
            zkml_proof: Option<Span<felt252>>,
            execution_proof_hash: Option<felt252>
        ) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Get user tier
            let rep_registry = IReputationRegistryDispatcher {
                contract_address: self.reputation_registry.read()
            };
            let tier = rep_registry.get_user_tier(caller);
            
            // Check position
            let current_pos = self.user_position.read(caller);
            assert(current_pos >= amount, 'Insufficient position');
            
            // Tier-based proof verification
            let proof_verified = self.verify_action_proof(tier, zkml_proof, execution_proof_hash, caller);
            
            // Execute withdrawal
            let router = IAllocationRouterDispatcher {
                contract_address: self.allocation_router.read()
            };
            router.withdraw_from_pool(amount);
            
            // Update state
            self.user_position.write(caller, current_pos - amount);
            rep_registry.increment_daily_withdrawal(caller);
            rep_registry.record_transaction(caller, amount, true);
            
            self.emit(WithdrawExecuted {
                user: caller,
                amount,
                tier,
                proof_verified,
                timestamp,
            });
        }
        
        fn set_constraints(
            ref self: ContractState,
            max_position: u256,
            risk_tolerance: u8,
            constraint_proof_hash: felt252
        ) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Verify constraint proof in Integrity
            let registry = IFactRegistryDispatcher {
                contract_address: self.fact_registry.read()
            };
            assert(registry.is_valid(constraint_proof_hash), 'Invalid constraint proof');
            
            self.user_constraints.write(caller, UserConstraints {
                max_position,
                risk_tolerance,
                constraint_proof_hash,
            });
            
            self.emit(ConstraintsSet {
                user: caller,
                max_position,
                risk_tolerance,
                constraint_proof_hash,
                timestamp,
            });
        }
        
        fn get_user_constraints(self: @ContractState, user: ContractAddress) -> (u256, u8) {
            let constraints = self.user_constraints.read(user);
            (constraints.max_position, constraints.risk_tolerance)
        }
        
        fn get_reputation_registry(self: @ContractState) -> ContractAddress {
            self.reputation_registry.read()
        }
        
        fn get_allocation_router(self: @ContractState) -> ContractAddress {
            self.allocation_router.read()
        }
        
        fn get_batch_verifier(self: @ContractState) -> ContractAddress {
            self.batch_verifier.read()
        }
    }
    
    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        /// Tier 0: Quick on-chain perceptron check
        /// Blocks obviously bad actions before expensive proof verification
        fn tier0_perceptron_check(
            self: @ContractState,
            features: Span<felt252>
        ) -> bool {
            let perceptron_addr = self.cairo_perceptron.read();
            if perceptron_addr.is_zero() {
                // No perceptron configured, skip check
                return true;
            }
            let perceptron = ICairoPerceptronDispatcher {
                contract_address: perceptron_addr
            };
            perceptron.predict(features)
        }
        

        fn verify_action_proof(
            ref self: ContractState,
            tier: ProofTier,
            zkml_proof: Option<Span<felt252>>,
            execution_proof_hash: Option<felt252>,
            user: ContractAddress
        ) -> bool {
            match tier {
                ProofTier::Strict => {
                    // Tier 0: Require full ZKML proof
                    assert(zkml_proof.is_some(), 'ZKML proof required for Strict');
                    let garaga = IGaragaVerifierDispatcher {
                        contract_address: self.garaga_verifier.read()
                    };
                    let result = garaga.verify_groth16_proof_bn254(zkml_proof.unwrap());
                    assert(result.is_ok(), 'Invalid ZKML proof');
                    true
                },
                ProofTier::Standard => {
                    // Tier 1: Just check constraints are valid (already verified at setup)
                    let constraints = self.user_constraints.read(user);
                    let fact_registry = IFactRegistryDispatcher {
                        contract_address: self.fact_registry.read()
                    };
                    assert(fact_registry.is_valid(constraints.constraint_proof_hash), 'Constraints expired');
                    false  // No per-action proof
                },
                ProofTier::Express => {
                    // Tier 2: Queue for batch verification
                    let batch = IBatchVerifierDispatcher {
                        contract_address: self.batch_verifier.read()
                    };
                    let action_hash = self.compute_action_hash(user);
                    batch.queue_action(user, action_hash);
                    false  // Optimistic, batched later
                },
            }
        }
        
        fn compute_action_hash(self: @ContractState, user: ContractAddress) -> felt252 {
            let input: Array<felt252> = array![
                user.into(),
                get_block_timestamp().into()
            ];
            poseidon_hash_span(input.span())
        }
        
        fn u8_to_pool_type(self: @ContractState, value: u8) -> PoolType {
            if value == 0 {
                PoolType::Conservative
            } else if value == 1 {
                PoolType::Neutral
            } else {
                PoolType::Aggressive
            }
        }
    }
}
