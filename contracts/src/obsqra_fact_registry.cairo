// Obsqra Fact Registry: On-chain persistence for verified proofs.
//
// Two verification modes:
//   1. Reputation proofs (FICO Pack): On-chain verification via Garaga Groth16 BN254 verifiers.
//      These proofs use Garaga's optimized verification that fits within Starknet's step limits.
//   2. Other facts: Registered by trusted backend after off-chain verification.
//
// Trust model for backend-registered facts (identical to Atlantic/Herodotus Satellite):
//   1. Backend runs call_contract against verifier on a Starknet node.
//      The node executes the FULL verification cryptographically.
//   2. If call_contract succeeds, backend invokes register_fact here (~5K steps).
//   3. Downstream contracts query is_valid / get_all_verifications_for_fact_hash.
//
// The registrar (backend wallet) is the sole authority to register facts.
// Admin can update the registrar address and verifier addresses.

use starknet::ContractAddress;

// Reputation proof types (FICO Pack)
const FACT_TYPE_SOLVENCY: felt252 = 100;
const FACT_TYPE_RISK_PASSPORT: felt252 = 101;
const FACT_TYPE_TRADER_PERFORMANCE: felt252 = 102;
const FACT_TYPE_STRATEGY_INTEGRITY: felt252 = 103;
const FACT_TYPE_EXECUTION_INTEGRITY: felt252 = 104;

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
    fn verify_and_register_reputation_proof(
        ref self: TContractState,
        fact_type: felt252,
        subject: felt252,
        proof_data: Span<felt252>,
    );
    fn set_registrar(ref self: TContractState, new_registrar: ContractAddress);
    fn set_solvency_verifier(ref self: TContractState, verifier: ContractAddress);
    fn set_risk_passport_verifier(ref self: TContractState, verifier: ContractAddress);
    fn set_trader_performance_verifier(ref self: TContractState, verifier: ContractAddress);
    fn set_strategy_integrity_verifier(ref self: TContractState, verifier: ContractAddress);
    fn set_execution_integrity_verifier(ref self: TContractState, verifier: ContractAddress);
}

#[starknet::interface]
pub trait IGroth16VerifierBN254<TContractState> {
    fn verify_groth16_proof_bn254(
        self: @TContractState,
        full_proof_with_hints: Span<felt252>,
    ) -> Result<Span<u256>, felt252>;
}

#[starknet::contract]
mod ObsqraFactRegistry {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess};
    use core::poseidon;
    use core::num::traits::Zero;
    use super::{VerificationListElement, IGroth16VerifierBN254Dispatcher, IGroth16VerifierBN254DispatcherTrait};
    use super::{FACT_TYPE_SOLVENCY, FACT_TYPE_RISK_PASSPORT, FACT_TYPE_TRADER_PERFORMANCE, 
                FACT_TYPE_STRATEGY_INTEGRITY, FACT_TYPE_EXECUTION_INTEGRITY};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        registrar: ContractAddress,
        registered_facts: Map<felt252, bool>,
        fact_verification_hash: Map<felt252, felt252>,
        fact_security_bits: Map<felt252, u128>,
        fact_verifier_config: Map<felt252, felt252>,
        fact_count: u64,
        solvency_verifier: ContractAddress,
        risk_passport_verifier: ContractAddress,
        trader_performance_verifier: ContractAddress,
        strategy_integrity_verifier: ContractAddress,
        execution_integrity_verifier: ContractAddress,
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

        fn verify_and_register_reputation_proof(
            ref self: ContractState,
            fact_type: felt252,
            subject: felt252,
            proof_data: Span<felt252>,
        ) {
            // Only the subject can verify their own proof
            let caller = get_caller_address();
            let subject_address: ContractAddress = subject.try_into().unwrap();
            assert(caller == subject_address, 'CALLER_NOT_SUBJECT');

            // Route to correct verifier based on fact_type
            let verifier_address = if fact_type == FACT_TYPE_SOLVENCY {
                self.solvency_verifier.read()
            } else if fact_type == FACT_TYPE_RISK_PASSPORT {
                self.risk_passport_verifier.read()
            } else if fact_type == FACT_TYPE_TRADER_PERFORMANCE {
                self.trader_performance_verifier.read()
            } else if fact_type == FACT_TYPE_STRATEGY_INTEGRITY {
                self.strategy_integrity_verifier.read()
            } else if fact_type == FACT_TYPE_EXECUTION_INTEGRITY {
                self.execution_integrity_verifier.read()
            } else {
                panic!("INVALID_FACT_TYPE")
            };

            assert(!verifier_address.is_zero(), 'VERIFIER_NOT_SET');

            // Call the verifier's verify_groth16_proof_bn254 function
            let verifier = IGroth16VerifierBN254Dispatcher { contract_address: verifier_address };
            let verification_result = verifier.verify_groth16_proof_bn254(proof_data);

            // Check if verification succeeded
            match verification_result {
                Result::Ok(public_inputs) => {
                    // Verification succeeded, compute fact hash and register
                    // fact_hash = hash(fact_type, subject, public_inputs)
                    let mut hash_data = array![fact_type, subject];
                    for input in public_inputs {
                        match (*input).try_into() {
                            Option::Some(val) => hash_data.append(val),
                            Option::None => panic!("PUBLIC_INPUT_TOO_LARGE"),
                        }
                    };
                    let fact_hash = poseidon::poseidon_hash_span(hash_data.span());

                    // Register the fact (skip if already registered)
                    if !self.registered_facts.entry(fact_hash).read() {
                        self.registered_facts.entry(fact_hash).write(true);
                        self.fact_verification_hash.entry(fact_hash).write(fact_hash);
                        self.fact_security_bits.entry(fact_hash).write(128);
                        self.fact_verifier_config.entry(fact_hash).write(fact_type);
                        self.fact_count.write(self.fact_count.read() + 1);

                        self.emit(FactRegistered { 
                            fact_hash, 
                            security_bits: 128, 
                            verifier_config: fact_type 
                        });
                    }
                },
                Result::Err(_error) => {
                    panic!("PROOF_VERIFICATION_FAILED")
                }
            }
        }

        fn set_registrar(ref self: ContractState, new_registrar: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');

            let old_registrar = self.registrar.read();
            self.registrar.write(new_registrar);

            self.emit(RegistrarUpdated { old_registrar, new_registrar });
        }

        fn set_solvency_verifier(ref self: ContractState, verifier: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');
            assert(!verifier.is_zero(), 'ZERO_VERIFIER_ADDRESS');
            self.solvency_verifier.write(verifier);
        }

        fn set_risk_passport_verifier(ref self: ContractState, verifier: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');
            assert(!verifier.is_zero(), 'ZERO_VERIFIER_ADDRESS');
            self.risk_passport_verifier.write(verifier);
        }

        fn set_trader_performance_verifier(ref self: ContractState, verifier: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');
            assert(!verifier.is_zero(), 'ZERO_VERIFIER_ADDRESS');
            self.trader_performance_verifier.write(verifier);
        }

        fn set_strategy_integrity_verifier(ref self: ContractState, verifier: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');
            assert(!verifier.is_zero(), 'ZERO_VERIFIER_ADDRESS');
            self.strategy_integrity_verifier.write(verifier);
        }

        fn set_execution_integrity_verifier(ref self: ContractState, verifier: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');
            assert(!verifier.is_zero(), 'ZERO_VERIFIER_ADDRESS');
            self.execution_integrity_verifier.write(verifier);
        }
    }
}
