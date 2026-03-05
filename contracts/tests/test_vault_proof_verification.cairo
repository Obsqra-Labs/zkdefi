// Test: VaultController requires valid STARK proof before executing proposal

use starknet::ContractAddress;
use starknet::testing::{set_caller_address, set_block_timestamp};
use snforge_std::{declare, ContractClassTrait, start_cheat_caller_address};

use zkdefi::vault_controller::{IVaultControllerDispatcher, IVaultControllerDispatcherTrait};
use zkdefi::obsqra_fact_registry::{IObsqraFactRegistryDispatcher, IObsqraFactRegistryDispatcherTrait};
use zkdefi::strategy_adapter::IStrategyAdapter;

#[test]
fn test_execute_proposal_without_proof_fails() {
    // Deploy fact registry
    let registry_class = declare("ObsqraFactRegistry").unwrap();
    let admin: ContractAddress = starknet::contract_address_const::<0x123>();
    let registrar: ContractAddress = starknet::contract_address_const::<0x456>();
    
    let (registry_address, _) = registry_class.deploy(@array![registrar.into(), admin.into()]).unwrap();
    
    // Deploy VaultController
    let vault_class = declare("VaultController").unwrap();
    let zkml_verifier: ContractAddress = starknet::contract_address_const::<0x789>();
    let eth_token: ContractAddress = starknet::contract_address_const::<0xabc>();
    let min_cooldown: u64 = 3600;
    
    let (vault_address, _) = vault_class.deploy(@array![
        admin.into(),
        zkml_verifier.into(),
        min_cooldown.into(),
        eth_token.into(),
        registry_address.into(),
    ]).unwrap();
    
    let vault = IVaultControllerDispatcher { contract_address: vault_address };
    
    // Setup: commit a proposal
    let proposal_hash: felt252 = 0x111;
    start_cheat_caller_address(vault_address, admin);
    vault.commit_proposal(proposal_hash);
    
    // Attempt to execute with unverified proof
    let adapters: Array<ContractAddress> = array![];
    let amounts: Array<u256> = array![];
    let salt: felt252 = 0x222;
    let invalid_proof_hash: felt252 = 0x999;  // Not registered in fact registry
    
    // This should fail with 'proof not verified'
    match vault.execute_proposal_with_proof(
        adapters.span(),
        amounts.span(),
        salt,
        invalid_proof_hash
    ) {
        Ok(_) => panic!("Should have failed: proof not verified"),
        Err(e) => {
            assert!(e.contains("proof not verified"), "Expected 'proof not verified' error");
        }
    }
}

#[test]
fn test_execute_proposal_with_valid_proof_succeeds() {
    // Deploy fact registry
    let registry_class = declare("ObsqraFactRegistry").unwrap();
    let admin: ContractAddress = starknet::contract_address_const::<0x123>();
    let registrar: ContractAddress = starknet::contract_address_const::<0x456>();
    
    let (registry_address, _) = registry_class.deploy(@array![registrar.into(), admin.into()]).unwrap();
    let registry = IObsqraFactRegistryDispatcher { contract_address: registry_address };
    
    // Register a valid proof
    let proof_hash: felt252 = 0x888;
    let security_bits: u128 = 128;  // >= 100 threshold
    let verifier_config: felt252 = 0x1;
    
    start_cheat_caller_address(registry_address, registrar);
    registry.register_fact(proof_hash, security_bits, verifier_config);
    
    // Deploy VaultController
    let vault_class = declare("VaultController").unwrap();
    let zkml_verifier: ContractAddress = starknet::contract_address_const::<0x789>();
    let eth_token: ContractAddress = starknet::contract_address_const::<0xabc>();
    let min_cooldown: u64 = 3600;
    
    let (vault_address, _) = vault_class.deploy(@array![
        admin.into(),
        zkml_verifier.into(),
        min_cooldown.into(),
        eth_token.into(),
        registry_address.into(),
    ]).unwrap();
    
    let vault = IVaultControllerDispatcher { contract_address: vault_address };
    
    // Setup: commit a proposal (empty for simplicity)
    let proposal_hash: felt252 = 0x0;  // Poseidon hash of empty arrays
    start_cheat_caller_address(vault_address, admin);
    vault.commit_proposal(proposal_hash);
    
    // Execute with valid proof
    let adapters: Array<ContractAddress> = array![];
    let amounts: Array<u256> = array![];
    let salt: felt252 = 0x0;
    
    // This should succeed
    vault.execute_proposal_with_proof(
        adapters.span(),
        amounts.span(),
        salt,
        proof_hash
    );
    
    // Verify proposal was executed (pending should be cleared)
    let pending = vault.get_pending_proposal();
    assert(pending == 0, 'Proposal should be executed');
}

#[test]
fn test_low_security_proof_fails() {
    // Deploy fact registry
    let registry_class = declare("ObsqraFactRegistry").unwrap();
    let admin: ContractAddress = starknet::contract_address_const::<0x123>();
    let registrar: ContractAddress = starknet::contract_address_const::<0x456>();
    
    let (registry_address, _) = registry_class.deploy(@array![registrar.into(), admin.into()]).unwrap();
    let registry = IObsqraFactRegistryDispatcher { contract_address: registry_address };
    
    // Register a proof with LOW security bits (< 100 threshold)
    let weak_proof_hash: felt252 = 0x777;
    let low_security_bits: u128 = 50;  // < 100 threshold
    let verifier_config: felt252 = 0x1;
    
    start_cheat_caller_address(registry_address, registrar);
    registry.register_fact(weak_proof_hash, low_security_bits, verifier_config);
    
    // Deploy VaultController
    let vault_class = declare("VaultController").unwrap();
    let zkml_verifier: ContractAddress = starknet::contract_address_const::<0x789>();
    let eth_token: ContractAddress = starknet::contract_address_const::<0xabc>();
    let min_cooldown: u64 = 3600;
    
    let (vault_address, _) = vault_class.deploy(@array![
        admin.into(),
        zkml_verifier.into(),
        min_cooldown.into(),
        eth_token.into(),
        registry_address.into(),
    ]).unwrap();
    
    let vault = IVaultControllerDispatcher { contract_address: vault_address };
    
    // Setup: commit a proposal
    let proposal_hash: felt252 = 0x0;
    start_cheat_caller_address(vault_address, admin);
    vault.commit_proposal(proposal_hash);
    
    // Attempt to execute with weak proof
    let adapters: Array<ContractAddress> = array![];
    let amounts: Array<u256> = array![];
    let salt: felt252 = 0x0;
    
    // This should fail with 'proof security too low'
    match vault.execute_proposal_with_proof(
        adapters.span(),
        amounts.span(),
        salt,
        weak_proof_hash
    ) {
        Ok(_) => panic!("Should have failed: proof security too low"),
        Err(e) => {
            assert!(e.contains("proof security too low"), "Expected 'proof security too low' error");
        }
    }
}
