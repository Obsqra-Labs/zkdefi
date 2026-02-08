// Obsqra Fact Registry: On-chain persistence for node-verified STARK proofs.
//
// Trust model (identical to Atlantic/Herodotus Satellite):
//   1. Backend runs call_contract against Integrity Verifier on a Starknet node.
//      The node executes the FULL STARK verification cryptographically.
//   2. If call_contract succeeds, backend invokes register_fact here (~5K steps).
//   3. Downstream contracts query is_valid / get_all_verifications_for_fact_hash.
//
// Why not trustless on-chain verification?
//   invoke_tx_max_n_steps = 10M. STARK verification exceeds this for ANY proof.
//   Even Integrity's own example proofs fail. Zero FactRegistered events on Sepolia.
//   Atlantic/Herodotus uses the same admin-gated pattern (setCairoMockedFact).
//
// The registrar (backend wallet) is the sole authority to register facts.
// Admin can update the registrar address.

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde)]
pub struct VerificationListElement {
    pub verification_hash: felt252,
    pub security_bits: u128,
    pub verifier_config: felt252,
}

#[starknet::interface]
pub trait IObsqraFactRegistry<TContractState> {
    // --- Read (public) ---
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
    fn get_all_verifications_for_fact_hash(
        self: @TContractState, fact_hash: felt252
    ) -> Array<VerificationListElement>;
    fn get_fact_count(self: @TContractState) -> u64;
    fn get_registrar(self: @TContractState) -> ContractAddress;
    fn get_admin(self: @TContractState) -> ContractAddress;

    // --- Write (access-controlled) ---
    fn register_fact(
        ref self: TContractState,
        fact_hash: felt252,
        security_bits: u128,
        verifier_config: felt252,
    );
    fn set_registrar(ref self: TContractState, new_registrar: ContractAddress);
}

#[starknet::contract]
mod ObsqraFactRegistry {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::VerificationListElement;

    #[storage]
    struct Storage {
        admin: ContractAddress,
        registrar: ContractAddress,
        registered_facts: Map<felt252, bool>,
        fact_verification_hash: Map<felt252, felt252>,
        fact_security_bits: Map<felt252, u128>,
        fact_verifier_config: Map<felt252, felt252>,
        fact_count: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        FactRegistered: FactRegistered,
        RegistrarUpdated: RegistrarUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct FactRegistered {
        #[key]
        fact_hash: felt252,
        security_bits: u128,
        verifier_config: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct RegistrarUpdated {
        old_registrar: ContractAddress,
        new_registrar: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        registrar: ContractAddress,
        admin: ContractAddress,
    ) {
        self.registrar.write(registrar);
        self.admin.write(admin);
        self.fact_count.write(0);
    }

    #[abi(embed_v0)]
    impl ObsqraFactRegistryImpl of super::IObsqraFactRegistry<ContractState> {
        // ──────────── Public reads ────────────

        fn is_valid(self: @ContractState, fact_hash: felt252) -> bool {
            self.registered_facts.entry(fact_hash).read()
        }

        fn get_all_verifications_for_fact_hash(
            self: @ContractState, fact_hash: felt252
        ) -> Array<VerificationListElement> {
            let mut result = array![];
            if self.registered_facts.entry(fact_hash).read() {
                result.append(VerificationListElement {
                    verification_hash: self.fact_verification_hash.entry(fact_hash).read(),
                    security_bits: self.fact_security_bits.entry(fact_hash).read(),
                    verifier_config: self.fact_verifier_config.entry(fact_hash).read(),
                });
            }
            result
        }

        fn get_fact_count(self: @ContractState) -> u64 {
            self.fact_count.read()
        }

        fn get_registrar(self: @ContractState) -> ContractAddress {
            self.registrar.read()
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        // ──────────── Access-controlled writes ────────────

        fn register_fact(
            ref self: ContractState,
            fact_hash: felt252,
            security_bits: u128,
            verifier_config: felt252,
        ) {
            let caller = get_caller_address();
            assert(caller == self.registrar.read(), 'ONLY_REGISTRAR');
            assert(fact_hash != 0, 'ZERO_FACT_HASH');

            // Idempotent: skip if already registered
            if self.registered_facts.entry(fact_hash).read() {
                return;
            }

            self.registered_facts.entry(fact_hash).write(true);
            self.fact_verification_hash.entry(fact_hash).write(fact_hash);
            self.fact_security_bits.entry(fact_hash).write(security_bits);
            self.fact_verifier_config.entry(fact_hash).write(verifier_config);
            self.fact_count.write(self.fact_count.read() + 1);

            self.emit(FactRegistered { fact_hash, security_bits, verifier_config });
        }

        fn set_registrar(ref self: ContractState, new_registrar: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');

            let old_registrar = self.registrar.read();
            self.registrar.write(new_registrar);

            self.emit(RegistrarUpdated { old_registrar, new_registrar });
        }
    }
}
