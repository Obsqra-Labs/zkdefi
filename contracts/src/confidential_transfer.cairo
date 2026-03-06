// Confidential transfer: Garaga Groth16 verifier + real ERC20 token.
// 
// BN254 Compatibility:
// - Commitments and nullifiers stored as u256 (low, high) pairs
// - BN254 Poseidon outputs can exceed felt252
// - Split storage ensures full compatibility with circomlib circuits

use starknet::ContractAddress;

#[starknet::interface]
pub trait IGaragaVerifier<TContractState> {
    fn verify_groth16_proof_bn254(
        self: @TContractState,
        full_proof_with_hints: Span<felt252>
    ) -> Result<Span<u256>, felt252>;
}

#[starknet::interface]
pub trait IConfidentialTransferU256<TContractState> {
    // ==================== u256 METHODS ====================
    
    fn private_deposit_u256(
        ref self: TContractState,
        commitment_low: u128,
        commitment_high: u128,
        amount_public: u256,
        proof_calldata: Span<felt252>
    );
    
    fn private_withdraw_u256(
        ref self: TContractState,
        nullifier_low: u128,
        nullifier_high: u128,
        commitment_low: u128,
        commitment_high: u128,
        amount_public: u256,
        proof_calldata: Span<felt252>,
        recipient: ContractAddress
    );
    
    fn get_commitment_balance_u256(
        self: @TContractState,
        commitment_low: u128,
        commitment_high: u128
    ) -> u256;
    
    // ==================== BACKWARDS COMPATIBLE METHODS ====================
    
    fn private_deposit(
        ref self: TContractState,
        commitment: felt252,
        amount_public: u256,
        proof_calldata: Span<felt252>
    );
    
    fn private_withdraw(
        ref self: TContractState,
        nullifier: felt252,
        commitment: felt252,
        amount_public: u256,
        proof_calldata: Span<felt252>,
        recipient: ContractAddress
    );
    
    fn get_commitment_balance(self: @TContractState, commitment: felt252) -> u256;
    fn get_garaga_verifier_deposit(self: @TContractState) -> ContractAddress;
    fn get_garaga_verifier_withdraw(self: @TContractState) -> ContractAddress;
    fn get_token(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
mod ConfidentialTransfer {
    use core::poseidon::poseidon_hash_span;
    use starknet::{
        ContractAddress, get_caller_address, get_contract_address,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };

    use super::IGaragaVerifierDispatcher;
    use super::IGaragaVerifierDispatcherTrait;
    use crate::erc20_interface::IERC20Dispatcher;
    use crate::erc20_interface::IERC20DispatcherTrait;

    #[storage]
    struct Storage {
        garaga_verifier_deposit: ContractAddress,
        garaga_verifier_withdraw: ContractAddress,
        token: ContractAddress,
        // u256 commitment balance storage (key = hash of low, high)
        commitment_balance: Map<felt252, u256>,
        // Store original commitment parts for reference
        commitment_low: Map<felt252, u128>,
        commitment_high: Map<felt252, u128>,
        // u256 nullifier storage (key = hash of low, high)
        nullifiers: Map<felt252, bool>,
        admin: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        garaga_verifier_deposit: ContractAddress,
        garaga_verifier_withdraw: ContractAddress,
        token: ContractAddress,
        admin: ContractAddress
    ) {
        self.garaga_verifier_deposit.write(garaga_verifier_deposit);
        self.garaga_verifier_withdraw.write(garaga_verifier_withdraw);
        self.token.write(token);
        self.admin.write(admin);
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn commitment_key(self: @ContractState, low: u128, high: u128) -> felt252 {
            // Hash (low, high) to create a felt252 key for storage
            let arr = array![low.into(), high.into()];
            poseidon_hash_span(arr.span())
        }
        
        fn felt_to_u256(self: @ContractState, value: felt252) -> (u128, u128) {
            let as_u256: u256 = value.into();
            (as_u256.low, as_u256.high)
        }
    }

    #[abi(embed_v0)]
    impl ConfidentialTransferU256Impl of super::IConfidentialTransferU256<ContractState> {
        fn private_deposit_u256(
            ref self: ContractState,
            commitment_low: u128,
            commitment_high: u128,
            amount_public: u256,
            proof_calldata: Span<felt252>
        ) {
            assert(amount_public > 0, 'Amount must be positive');
            let caller = get_caller_address();

            let verifier = IGaragaVerifierDispatcher { 
                contract_address: self.garaga_verifier_deposit.read() 
            };
            let result = verifier.verify_groth16_proof_bn254(proof_calldata);
            assert(result.is_ok(), 'Invalid proof');

            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer_from(caller, get_contract_address(), amount_public);
            assert(ok, 'Transfer failed');

            // Store using commitment key
            let key = self.commitment_key(commitment_low, commitment_high);
            let current = self.commitment_balance.read(key);
            self.commitment_balance.write(key, current + amount_public);
            
            // Store original commitment parts
            self.commitment_low.write(key, commitment_low);
            self.commitment_high.write(key, commitment_high);
        }

        fn private_withdraw_u256(
            ref self: ContractState,
            nullifier_low: u128,
            nullifier_high: u128,
            commitment_low: u128,
            commitment_high: u128,
            amount_public: u256,
            proof_calldata: Span<felt252>,
            recipient: ContractAddress
        ) {
            assert(amount_public > 0, 'Amount must be positive');
            
            // Check nullifier
            let null_key = self.commitment_key(nullifier_low, nullifier_high);
            assert(!self.nullifiers.read(null_key), 'Nullifier already used');

            let verifier = IGaragaVerifierDispatcher { 
                contract_address: self.garaga_verifier_withdraw.read() 
            };
            let result = verifier.verify_groth16_proof_bn254(proof_calldata);
            assert(result.is_ok(), 'Invalid proof');

            self.nullifiers.write(null_key, true);

            // Check commitment balance
            let commit_key = self.commitment_key(commitment_low, commitment_high);
            let current = self.commitment_balance.read(commit_key);
            assert(current >= amount_public, 'Insufficient commitment balance');
            self.commitment_balance.write(commit_key, current - amount_public);

            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer(recipient, amount_public);
            assert(ok, 'Transfer to recipient failed');
        }

        fn get_commitment_balance_u256(
            self: @ContractState,
            commitment_low: u128,
            commitment_high: u128
        ) -> u256 {
            let key = self.commitment_key(commitment_low, commitment_high);
            self.commitment_balance.read(key)
        }

        // ==================== BACKWARDS COMPATIBLE METHODS ====================
        
        fn private_deposit(
            ref self: ContractState,
            commitment: felt252,
            amount_public: u256,
            proof_calldata: Span<felt252>
        ) {
            let (low, high) = self.felt_to_u256(commitment);
            self.private_deposit_u256(low, high, amount_public, proof_calldata);
        }

        fn private_withdraw(
            ref self: ContractState,
            nullifier: felt252,
            commitment: felt252,
            amount_public: u256,
            proof_calldata: Span<felt252>,
            recipient: ContractAddress
        ) {
            let (null_low, null_high) = self.felt_to_u256(nullifier);
            let (commit_low, commit_high) = self.felt_to_u256(commitment);
            self.private_withdraw_u256(
                null_low, null_high, 
                commit_low, commit_high, 
                amount_public, 
                proof_calldata, 
                recipient
            );
        }

        fn get_commitment_balance(self: @ContractState, commitment: felt252) -> u256 {
            let (low, high) = self.felt_to_u256(commitment);
            self.get_commitment_balance_u256(low, high)
        }

        fn get_garaga_verifier_deposit(self: @ContractState) -> ContractAddress {
            self.garaga_verifier_deposit.read()
        }

        fn get_garaga_verifier_withdraw(self: @ContractState) -> ContractAddress {
            self.garaga_verifier_withdraw.read()
        }

        fn get_token(self: @ContractState) -> ContractAddress {
            self.token.read()
        }
    }

    // Admin functions for updating verifier addresses
    #[external(v0)]
    fn set_garaga_verifier_deposit(ref self: ContractState, verifier: ContractAddress) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        self.garaga_verifier_deposit.write(verifier);
    }

    #[external(v0)]
    fn set_garaga_verifier_withdraw(ref self: ContractState, verifier: ContractAddress) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        self.garaga_verifier_withdraw.write(verifier);
    }
}
