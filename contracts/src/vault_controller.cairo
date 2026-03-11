use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct AdapterConfig {
    pub max_allocation_bps: u16,
    pub enabled: bool,
    pub circuit_breaker: bool,
}

#[derive(Drop, Copy, Serde, PartialEq)]
pub enum VaultState {
    Idle,
    PendingProposal,
    CircuitBreakerActive,
}

#[starknet::interface]
pub trait IVaultController<TContractState> {
    fn register_adapter(ref self: TContractState, adapter: ContractAddress, max_bps: u16);
    fn set_adapter_enabled(ref self: TContractState, adapter: ContractAddress, enabled: bool);
    fn trigger_circuit_breaker(ref self: TContractState, adapter: ContractAddress);
    fn register_constraint(ref self: TContractState, constraint_hash: felt252, session_key_hash: felt252);
    fn update_policy_root(ref self: TContractState, new_root: felt252);
    fn commit_proposal(ref self: TContractState, proposal_hash: felt252);
    fn execute_proposal(
        ref self: TContractState,
        adapters: Span<ContractAddress>,
        amounts: Span<u256>,
        salt: felt252,
    );
    fn execute_proposal_with_proof(  // NEW: Require STARK proof
        ref self: TContractState,
        adapters: Span<ContractAddress>,
        amounts: Span<u256>,
        salt: felt252,
        proof_hash: felt252,
    );
    fn emergency_withdraw(ref self: TContractState, adapter: ContractAddress);
    fn cancel_proposal(ref self: TContractState);
    fn total_value(self: @TContractState) -> u256;
    fn get_adapter_config(self: @TContractState, adapter: ContractAddress) -> AdapterConfig;
    fn get_policy_root(self: @TContractState) -> felt252;
    fn get_pending_proposal(self: @TContractState) -> felt252;
    fn get_last_rebalance_ts(self: @TContractState) -> u64;
    fn get_admin(self: @TContractState) -> ContractAddress;
    fn get_vault_state(self: @TContractState) -> felt252;
    fn get_fact_registry(self: @TContractState) -> ContractAddress;
    fn get_receipt_registry(self: @TContractState) -> ContractAddress;
    fn set_fact_registry(ref self: TContractState, new_address: ContractAddress);  // NEW: Admin setter
    fn set_receipt_registry(ref self: TContractState, new_address: ContractAddress);  // NEW: Admin setter
}

#[starknet::contract]
mod VaultController {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_block_info, get_tx_info,
    };
    use starknet::storage::{
        Map, StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess,
    };
    use core::poseidon::poseidon_hash_span;

    use super::{AdapterConfig, VaultState};
    use crate::strategy_adapter::{IStrategyAdapterDispatcher, IStrategyAdapterDispatcherTrait};
    use crate::obsqra_fact_registry::{IObsqraFactRegistryDispatcher, IObsqraFactRegistryDispatcherTrait};
    use crate::receipt_registry::{IReceiptRegistryDispatcher, IReceiptRegistryDispatcherTrait};

    #[storage]
    struct Storage {
        adapters: Map<ContractAddress, AdapterConfig>,
        adapter_addresses: Map<u64, ContractAddress>,
        adapter_count: u64,
        policy_root: felt252,
        last_rebalance_ts: u64,
        min_cooldown_seconds: u64,
        pending_proposal: felt252,
        proposal_block: u64,
        admin: ContractAddress,
        zkml_verifier: ContractAddress,
        eth_token: ContractAddress,
        constraint_hashes: Map<felt252, felt252>,
        fact_registry: ContractAddress,  // ERC-8004 proof registry
        receipt_registry: ContractAddress,  // NEW: On-chain receipt storage
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        AdapterRegistered: AdapterRegistered,
        AdapterEnabledChanged: AdapterEnabledChanged,
        CircuitBreakerTriggered: CircuitBreakerTriggered,
        ConstraintRegistered: ConstraintRegistered,
        PolicyRootUpdated: PolicyRootUpdated,
        ProposalCommitted: ProposalCommitted,
        ProposalExecuted: ProposalExecuted,
        ProofVerified: ProofVerified,  // NEW
        EmergencyWithdraw: EmergencyWithdraw,
    }

    #[derive(Drop, starknet::Event)]
    struct AdapterRegistered {
        #[key]
        adapter: ContractAddress,
        max_allocation_bps: u16,
        index: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct AdapterEnabledChanged {
        #[key]
        adapter: ContractAddress,
        enabled: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct CircuitBreakerTriggered {
        #[key]
        adapter: ContractAddress,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct ConstraintRegistered {
        #[key]
        session_key_hash: felt252,
        constraint_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct PolicyRootUpdated {
        old_root: felt252,
        new_root: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct ProposalCommitted {
        proposal_hash: felt252,
        block_number: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct ProposalExecuted {
        proposal_hash: felt252,
        adapter_count: u32,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct ProofVerified {
        #[key]
        proof_hash: felt252,
        security_bits: u128,
        proposal_hash: felt252,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct EmergencyWithdraw {
        #[key]
        adapter: ContractAddress,
        timestamp: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        zkml_verifier: ContractAddress,
        min_cooldown_seconds: u64,
        eth_token: ContractAddress,
        fact_registry: ContractAddress,
        receipt_registry: ContractAddress,  // NEW
    ) {
        self.admin.write(admin);
        self.zkml_verifier.write(zkml_verifier);
        self.min_cooldown_seconds.write(min_cooldown_seconds);
        self.eth_token.write(eth_token);
        self.fact_registry.write(fact_registry);
        self.receipt_registry.write(receipt_registry);  // NEW
        self.adapter_count.write(0);
        self.pending_proposal.write(0);
        self.proposal_block.write(0);
        self.last_rebalance_ts.write(0);
        self.policy_root.write(0);
    }

    fn assert_admin(self: @ContractState) {
        assert(get_caller_address() == self.admin.read(), 'only admin');
    }

    fn vault_state(self: @ContractState) -> VaultState {
        let count = self.adapter_count.read();
        let mut i: u64 = 0;
        let mut has_breaker = false;
        while i < count {
            let addr = self.adapter_addresses.read(i);
            let cfg = self.adapters.read(addr);
            if cfg.circuit_breaker {
                has_breaker = true;
            }
            i += 1;
        };
        if has_breaker {
            return VaultState::CircuitBreakerActive;
        }
        if self.pending_proposal.read() != 0 {
            return VaultState::PendingProposal;
        }
        VaultState::Idle
    }

    #[abi(embed_v0)]
    impl VaultControllerImpl of super::IVaultController<ContractState> {
        fn register_adapter(
            ref self: ContractState,
            adapter: ContractAddress,
            max_bps: u16,
        ) {
            assert_admin(@self);
            assert(max_bps > 0 && max_bps <= 10000, 'bps out of range');

            let existing = self.adapters.read(adapter);
            assert(existing.max_allocation_bps == 0, 'adapter already registered');

            let idx = self.adapter_count.read();
            self.adapter_addresses.write(idx, adapter);
            self.adapter_count.write(idx + 1);

            self.adapters.write(adapter, AdapterConfig {
                max_allocation_bps: max_bps,
                enabled: true,
                circuit_breaker: false,
            });

            self.emit(AdapterRegistered {
                adapter,
                max_allocation_bps: max_bps,
                index: idx,
            });
        }

        fn set_adapter_enabled(
            ref self: ContractState,
            adapter: ContractAddress,
            enabled: bool,
        ) {
            assert_admin(@self);
            let mut cfg = self.adapters.read(adapter);
            assert(cfg.max_allocation_bps > 0, 'adapter not registered');
            cfg.enabled = enabled;
            self.adapters.write(adapter, cfg);

            self.emit(AdapterEnabledChanged { adapter, enabled });
        }

        fn trigger_circuit_breaker(ref self: ContractState, adapter: ContractAddress) {
            assert_admin(@self);
            let mut cfg = self.adapters.read(adapter);
            assert(cfg.max_allocation_bps > 0, 'adapter not registered');
            cfg.circuit_breaker = true;
            cfg.enabled = false;
            self.adapters.write(adapter, cfg);

            self.emit(CircuitBreakerTriggered {
                adapter,
                timestamp: get_block_timestamp(),
            });
        }

        fn register_constraint(
            ref self: ContractState,
            constraint_hash: felt252,
            session_key_hash: felt252,
        ) {
            self.constraint_hashes.write(session_key_hash, constraint_hash);
            self.emit(ConstraintRegistered { session_key_hash, constraint_hash });
        }

        fn update_policy_root(ref self: ContractState, new_root: felt252) {
            assert_admin(@self);
            let old_root = self.policy_root.read();
            self.policy_root.write(new_root);
            self.emit(PolicyRootUpdated { old_root, new_root });
        }

        fn commit_proposal(ref self: ContractState, proposal_hash: felt252) {
            assert_admin(@self);
            assert(proposal_hash != 0, 'empty proposal hash');
            assert(self.pending_proposal.read() == 0, 'proposal already pending');

            let block_number = get_block_info().unbox().block_number;
            self.pending_proposal.write(proposal_hash);
            self.proposal_block.write(block_number);

            self.emit(ProposalCommitted { proposal_hash, block_number });
        }

        fn cancel_proposal(ref self: ContractState) {
            assert_admin(@self);
            let pending = self.pending_proposal.read();
            assert(pending != 0, 'no pending proposal');
            self.pending_proposal.write(0);
            self.proposal_block.write(0);
        }

        fn execute_proposal(
            ref self: ContractState,
            adapters: Span<ContractAddress>,
            amounts: Span<u256>,
            salt: felt252,
        ) {
            assert_admin(@self);

            let pending = self.pending_proposal.read();
            assert(pending != 0, 'no pending proposal');

            // Verify cooldown
            let now = get_block_timestamp();
            let last = self.last_rebalance_ts.read();
            let cooldown = self.min_cooldown_seconds.read();
            if last > 0 {
                assert(now >= last + cooldown, 'cooldown not elapsed');
            }

            // Verify commit-reveal: recompute hash from params
            assert(adapters.len() == amounts.len(), 'length mismatch');
            let mut hash_input: Array<felt252> = array![salt];
            let adapter_len = adapters.len();
            let mut i: u32 = 0;
            while i < adapter_len {
                let addr: ContractAddress = *adapters.at(i);
                let amt: u256 = *amounts.at(i);
                hash_input.append(addr.into());
                hash_input.append(amt.low.into());
                hash_input.append(amt.high.into());
                i += 1;
            };
            let computed_hash = poseidon_hash_span(hash_input.span());
            assert(computed_hash == pending, 'proposal hash mismatch');

            // Execute deploys with per-adapter bound checks
            let mut j: u32 = 0;
            while j < adapter_len {
                let adapter_addr: ContractAddress = *adapters.at(j);
                let amount: u256 = *amounts.at(j);

                let cfg = self.adapters.read(adapter_addr);
                assert(cfg.max_allocation_bps > 0, 'adapter not registered');
                assert(cfg.enabled, 'adapter disabled');
                assert(!cfg.circuit_breaker, 'circuit breaker active');

                let dispatcher = IStrategyAdapterDispatcher { contract_address: adapter_addr };
                let empty_params: Array<felt252> = array![];
                dispatcher.deploy(amount, empty_params.span());

                j += 1;
            };

            self.pending_proposal.write(0);
            self.proposal_block.write(0);
            self.last_rebalance_ts.write(now);

            self.emit(ProposalExecuted {
                proposal_hash: pending,
                adapter_count: adapter_len,
                timestamp: now,
            });
        }

        fn execute_proposal_with_proof(
            ref self: ContractState,
            adapters: Span<ContractAddress>,
            amounts: Span<u256>,
            salt: felt252,
            proof_hash: felt252,
        ) {
            assert_admin(@self);

            // STEP 1: Verify STARK proof via Obsqra Fact Registry
            let registry = IObsqraFactRegistryDispatcher {
                contract_address: self.fact_registry.read()
            };
            
            // Check proof exists and is valid
            assert(registry.is_valid(proof_hash), 'proof not verified');
            
            // Get proof verification details
            let verifications = registry.get_all_verifications_for_fact_hash(proof_hash);
            assert(verifications.len() > 0, 'no verifications found');
            
            // Verify security threshold (require >= 100 bits)
            let first_verification = verifications.at(0);
            let security_bits = *first_verification.security_bits;
            assert(security_bits >= 100, 'proof security too low');

            // Emit proof verification event
            let pending = self.pending_proposal.read();
            let now = get_block_timestamp();
            self.emit(ProofVerified {
                proof_hash,
                security_bits,
                proposal_hash: pending,
                timestamp: now,
            });

            // STEP 2: Execute proposal (same logic as execute_proposal)
            assert(pending != 0, 'no pending proposal');

            // Verify cooldown
            let last = self.last_rebalance_ts.read();
            let cooldown = self.min_cooldown_seconds.read();
            if last > 0 {
                assert(now >= last + cooldown, 'cooldown not elapsed');
            }

            // Verify commit-reveal
            assert(adapters.len() == amounts.len(), 'length mismatch');
            let mut hash_input: Array<felt252> = array![salt];
            let adapter_len = adapters.len();
            let mut i: u32 = 0;
            while i < adapter_len {
                let addr: ContractAddress = *adapters.at(i);
                let amt: u256 = *amounts.at(i);
                hash_input.append(addr.into());
                hash_input.append(amt.low.into());
                hash_input.append(amt.high.into());
                i += 1;
            };
            let computed_hash = poseidon_hash_span(hash_input.span());
            assert(computed_hash == pending, 'proposal hash mismatch');

            // Execute deploys
            let mut j: u32 = 0;
            while j < adapter_len {
                let adapter_addr: ContractAddress = *adapters.at(j);
                let amount: u256 = *amounts.at(j);

                let cfg = self.adapters.read(adapter_addr);
                assert(cfg.max_allocation_bps > 0, 'adapter not registered');
                assert(cfg.enabled, 'adapter disabled');
                assert(!cfg.circuit_breaker, 'circuit breaker active');

                let dispatcher = IStrategyAdapterDispatcher { contract_address: adapter_addr };
                let empty_params: Array<felt252> = array![];
                dispatcher.deploy(amount, empty_params.span());

                j += 1;
            };

            self.pending_proposal.write(0);
            self.proposal_block.write(0);
            self.last_rebalance_ts.write(now);

            // Create on-chain receipt (NEW)
            let receipt_registry = IReceiptRegistryDispatcher {
                contract_address: self.receipt_registry.read()
            };
            
            // Calculate total amount allocated
            let mut total_amount: u256 = 0;
            let mut k: u32 = 0;
            while k < adapter_len {
                total_amount += *amounts.at(k);
                k += 1;
            };
            
            let tx_info = get_tx_info().unbox();
            let _receipt_id = receipt_registry.create_receipt(
                get_caller_address(),
                'allocate',
                total_amount,
                proof_hash,
                tx_info.transaction_hash,
            );

            self.emit(ProposalExecuted {
                proposal_hash: pending,
                adapter_count: adapter_len,
                timestamp: now,
            });
        }

        fn emergency_withdraw(ref self: ContractState, adapter: ContractAddress) {
            assert_admin(@self);
            let mut cfg = self.adapters.read(adapter);
            assert(cfg.max_allocation_bps > 0, 'adapter not registered');

            cfg.circuit_breaker = true;
            cfg.enabled = false;
            self.adapters.write(adapter, cfg);

            let dispatcher = IStrategyAdapterDispatcher { contract_address: adapter };
            let value = dispatcher.value_of();
            if value > 0 {
                dispatcher.withdraw(0, value);
            }

            self.emit(EmergencyWithdraw {
                adapter,
                timestamp: get_block_timestamp(),
            });
        }

        fn total_value(self: @ContractState) -> u256 {
            let count = self.adapter_count.read();
            let mut total: u256 = 0;
            let mut i: u64 = 0;
            while i < count {
                let addr = self.adapter_addresses.read(i);
                let cfg = self.adapters.read(addr);
                if cfg.enabled && !cfg.circuit_breaker {
                    let dispatcher = IStrategyAdapterDispatcher { contract_address: addr };
                    total += dispatcher.value_of();
                }
                i += 1;
            };
            total
        }

        fn get_adapter_config(self: @ContractState, adapter: ContractAddress) -> AdapterConfig {
            self.adapters.read(adapter)
        }

        fn get_policy_root(self: @ContractState) -> felt252 {
            self.policy_root.read()
        }

        fn get_pending_proposal(self: @ContractState) -> felt252 {
            self.pending_proposal.read()
        }

        fn get_last_rebalance_ts(self: @ContractState) -> u64 {
            self.last_rebalance_ts.read()
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        fn get_vault_state(self: @ContractState) -> felt252 {
            let state = vault_state(self);
            match state {
                VaultState::Idle => 'idle',
                VaultState::PendingProposal => 'pending_proposal',
                VaultState::CircuitBreakerActive => 'circuit_breaker',
            }
        }

        fn get_fact_registry(self: @ContractState) -> ContractAddress {
            self.fact_registry.read()
        }

        fn get_receipt_registry(self: @ContractState) -> ContractAddress {
            self.receipt_registry.read()
        }

        fn set_fact_registry(ref self: ContractState, new_address: ContractAddress) {
            assert_admin(@self);
            self.fact_registry.write(new_address);
        }

        fn set_receipt_registry(ref self: ContractState, new_address: ContractAddress) {
            assert_admin(@self);
            self.receipt_registry.write(new_address);
        }
    }
}
