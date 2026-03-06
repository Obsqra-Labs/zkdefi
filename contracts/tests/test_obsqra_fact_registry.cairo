// Tests for ObsqraFactRegistry reputation proof verification

use starknet::ContractAddress;
use starknet::testing::{set_caller_address, set_contract_address};
use snforge_std::{declare, ContractClassTrait, start_cheat_caller_address, stop_cheat_caller_address};

use zkdefi::obsqra_fact_registry::{
    IObsqraFactRegistryDispatcher, IObsqraFactRegistryDispatcherTrait,
    FACT_TYPE_SOLVENCY, FACT_TYPE_RISK_PASSPORT, FACT_TYPE_TRADER_PERFORMANCE,
    FACT_TYPE_STRATEGY_INTEGRITY, FACT_TYPE_EXECUTION_INTEGRITY,
};

// Mock verifier that always returns Ok with test public inputs
#[starknet::interface]
trait IMockVerifier<TContractState> {
    fn verify_groth16_proof_bn254(
        self: @TContractState,
        full_proof_with_hints: Span<felt252>,
    ) -> Result<Span<u256>, felt252>;
    fn set_should_fail(ref self: TContractState, should_fail: bool);
}

#[starknet::contract]
mod MockVerifier {
    use super::IMockVerifier;

    #[storage]
    struct Storage {
        should_fail: bool,
    }

    #[abi(embed_v0)]
    impl MockVerifierImpl of IMockVerifier<ContractState> {
        fn verify_groth16_proof_bn254(
            self: @ContractState,
            full_proof_with_hints: Span<felt252>,
        ) -> Result<Span<u256>, felt252> {
            if self.should_fail.read() {
                Result::Err('MOCK_VERIFICATION_FAILED')
            } else {
                // Return some test public inputs (small u256 values that fit in felt252)
                Result::Ok(array![1_u256, 2_u256, 3_u256].span())
            }
        }

        fn set_should_fail(ref self: ContractState, should_fail: bool) {
            self.should_fail.write(should_fail);
        }
    }
}

fn deploy_registry() -> (IObsqraFactRegistryDispatcher, ContractAddress, ContractAddress) {
    let registry_class = declare("ObsqraFactRegistry").unwrap();
    let admin: ContractAddress = starknet::contract_address_const::<0x123>();
    let registrar: ContractAddress = starknet::contract_address_const::<0x456>();
    
    let (registry_address, _) = registry_class.deploy(@array![registrar.into(), admin.into()]).unwrap();
    
    (
        IObsqraFactRegistryDispatcher { contract_address: registry_address },
        admin,
        registrar
    )
}

fn deploy_mock_verifier() -> ContractAddress {
    let verifier_class = declare("MockVerifier").unwrap();
    let (verifier_address, _) = verifier_class.deploy(@array![]).unwrap();
    verifier_address
}

#[test]
fn test_set_verifiers_as_admin() {
    let (registry, admin, _registrar) = deploy_registry();
    let mock_verifier = deploy_mock_verifier();

    start_cheat_caller_address(registry.contract_address, admin);

    // Should succeed
    registry.set_solvency_verifier(mock_verifier);
    registry.set_risk_passport_verifier(mock_verifier);
    registry.set_trader_performance_verifier(mock_verifier);
    registry.set_strategy_integrity_verifier(mock_verifier);
    registry.set_execution_integrity_verifier(mock_verifier);

    stop_cheat_caller_address(registry.contract_address);
}

#[test]
#[should_panic(expected: ('ONLY_ADMIN',))]
fn test_set_verifier_as_non_admin_fails() {
    let (registry, _admin, _registrar) = deploy_registry();
    let mock_verifier = deploy_mock_verifier();
    let non_admin: ContractAddress = starknet::contract_address_const::<0x999>();

    start_cheat_caller_address(registry.contract_address, non_admin);
    registry.set_solvency_verifier(mock_verifier);
}

#[test]
#[should_panic(expected: ('ZERO_VERIFIER_ADDRESS',))]
fn test_set_zero_verifier_fails() {
    let (registry, admin, _registrar) = deploy_registry();
    let zero_address: ContractAddress = starknet::contract_address_const::<0x0>();

    start_cheat_caller_address(registry.contract_address, admin);
    registry.set_solvency_verifier(zero_address);
}

#[test]
fn test_successful_solvency_proof_verification() {
    let (registry, admin, _registrar) = deploy_registry();
    let mock_verifier = deploy_mock_verifier();
    let subject: ContractAddress = starknet::contract_address_const::<0x777>();

    // Set up verifier
    start_cheat_caller_address(registry.contract_address, admin);
    registry.set_solvency_verifier(mock_verifier);
    stop_cheat_caller_address(registry.contract_address);

    // Verify and register proof as subject
    start_cheat_caller_address(registry.contract_address, subject);
    let proof_data = array![1, 2, 3].span();
    registry.verify_and_register_reputation_proof(
        FACT_TYPE_SOLVENCY,
        subject.into(),
        proof_data
    );
    stop_cheat_caller_address(registry.contract_address);

    // Check fact count increased
    assert(registry.get_fact_count() == 1, 'Fact should be registered');
}

#[test]
#[should_panic(expected: ('INVALID_FACT_TYPE',))]
fn test_invalid_fact_type_panics() {
    let (registry, admin, _registrar) = deploy_registry();
    let mock_verifier = deploy_mock_verifier();
    let subject: ContractAddress = starknet::contract_address_const::<0x777>();

    start_cheat_caller_address(registry.contract_address, admin);
    registry.set_solvency_verifier(mock_verifier);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, subject);
    let proof_data = array![1, 2, 3].span();
    let invalid_type: felt252 = 999; // Not a valid fact type
    registry.verify_and_register_reputation_proof(
        invalid_type,
        subject.into(),
        proof_data
    );
}

#[test]
#[should_panic(expected: ('VERIFIER_NOT_SET',))]
fn test_verifier_not_set_panics() {
    let (registry, _admin, _registrar) = deploy_registry();
    let subject: ContractAddress = starknet::contract_address_const::<0x777>();

    // Don't set verifier, try to verify proof
    start_cheat_caller_address(registry.contract_address, subject);
    let proof_data = array![1, 2, 3].span();
    registry.verify_and_register_reputation_proof(
        FACT_TYPE_SOLVENCY,
        subject.into(),
        proof_data
    );
}

#[test]
#[should_panic(expected: ('CALLER_NOT_SUBJECT',))]
fn test_caller_not_subject_panics() {
    let (registry, admin, _registrar) = deploy_registry();
    let mock_verifier = deploy_mock_verifier();
    let subject: ContractAddress = starknet::contract_address_const::<0x777>();
    let attacker: ContractAddress = starknet::contract_address_const::<0x888>();

    start_cheat_caller_address(registry.contract_address, admin);
    registry.set_solvency_verifier(mock_verifier);
    stop_cheat_caller_address(registry.contract_address);

    // Attacker tries to register proof for subject
    start_cheat_caller_address(registry.contract_address, attacker);
    let proof_data = array![1, 2, 3].span();
    registry.verify_and_register_reputation_proof(
        FACT_TYPE_SOLVENCY,
        subject.into(),
        proof_data
    );
}

#[test]
#[should_panic(expected: ('PROOF_VERIFICATION_FAILED',))]
fn test_proof_verification_failed_panics() {
    let (registry, admin, _registrar) = deploy_registry();
    let mock_verifier = deploy_mock_verifier();
    let subject: ContractAddress = starknet::contract_address_const::<0x777>();

    start_cheat_caller_address(registry.contract_address, admin);
    registry.set_solvency_verifier(mock_verifier);
    stop_cheat_caller_address(registry.contract_address);

    // Set mock verifier to fail
    let mock_dispatcher = IMockVerifierDispatcher { contract_address: mock_verifier };
    mock_dispatcher.set_should_fail(true);

    // Try to verify proof
    start_cheat_caller_address(registry.contract_address, subject);
    let proof_data = array![1, 2, 3].span();
    registry.verify_and_register_reputation_proof(
        FACT_TYPE_SOLVENCY,
        subject.into(),
        proof_data
    );
}

#[test]
fn test_all_reputation_proof_types() {
    let (registry, admin, _registrar) = deploy_registry();
    let mock_verifier = deploy_mock_verifier();
    let subject: ContractAddress = starknet::contract_address_const::<0x777>();

    // Set up all verifiers
    start_cheat_caller_address(registry.contract_address, admin);
    registry.set_solvency_verifier(mock_verifier);
    registry.set_risk_passport_verifier(mock_verifier);
    registry.set_trader_performance_verifier(mock_verifier);
    registry.set_strategy_integrity_verifier(mock_verifier);
    registry.set_execution_integrity_verifier(mock_verifier);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, subject);
    let proof_data = array![1, 2, 3].span();

    // Test all 5 proof types
    registry.verify_and_register_reputation_proof(FACT_TYPE_SOLVENCY, subject.into(), proof_data);
    registry.verify_and_register_reputation_proof(FACT_TYPE_RISK_PASSPORT, subject.into(), proof_data);
    registry.verify_and_register_reputation_proof(FACT_TYPE_TRADER_PERFORMANCE, subject.into(), proof_data);
    registry.verify_and_register_reputation_proof(FACT_TYPE_STRATEGY_INTEGRITY, subject.into(), proof_data);
    registry.verify_and_register_reputation_proof(FACT_TYPE_EXECUTION_INTEGRITY, subject.into(), proof_data);

    stop_cheat_caller_address(registry.contract_address);

    // All 5 should be registered
    assert(registry.get_fact_count() == 5, 'Should have 5 facts');
}

#[test]
fn test_idempotent_fact_registration() {
    let (registry, admin, _registrar) = deploy_registry();
    let mock_verifier = deploy_mock_verifier();
    let subject: ContractAddress = starknet::contract_address_const::<0x777>();

    start_cheat_caller_address(registry.contract_address, admin);
    registry.set_solvency_verifier(mock_verifier);
    stop_cheat_caller_address(registry.contract_address);

    start_cheat_caller_address(registry.contract_address, subject);
    let proof_data = array![1, 2, 3].span();
    
    // Register same proof twice
    registry.verify_and_register_reputation_proof(FACT_TYPE_SOLVENCY, subject.into(), proof_data);
    registry.verify_and_register_reputation_proof(FACT_TYPE_SOLVENCY, subject.into(), proof_data);

    stop_cheat_caller_address(registry.contract_address);

    // Should only count as 1
    assert(registry.get_fact_count() == 1, 'Should be idempotent');
}
