// Tier-2H Pool (Pool D): withdraw claims emit only a hash, no recipient/amount transfer.
// - Deposit: same as Full Privacy (commitment inserted into Merkle tree).
// - Withdraw claim: verifies proof, marks nullifier, emits claim hash.
// - Payout: handled off-chain or via shielded transfer primitive (see product plan).

#[starknet::interface]
pub trait IMerkleTreeU256<TContractState> {
    fn insert_u256(ref self: TContractState, leaf_low: u128, leaf_high: u128) -> u64;
    fn insert(ref self: TContractState, leaf: felt252) -> u64;
    fn get_root(self: @TContractState) -> felt252;
    fn get_root_u256(self: @TContractState) -> (u128, u128);
    fn is_known_root(self: @TContractState, root: felt252) -> bool;
    fn is_known_root_u256(self: @TContractState, root_low: u128, root_high: u128) -> bool;
    fn verify_proof(
        self: @TContractState,
        leaf: felt252,
        path_elements: Span<felt252>,
        path_indices: Span<u8>,
        root: felt252
    ) -> bool;
}

#[starknet::interface]
pub trait IGaragaVerifier<TContractState> {
    fn verify_groth16_proof_bn254(
        self: @TContractState,
        full_proof_with_hints: Span<felt252>
    ) -> Result<Span<u256>, felt252>;
}

#[starknet::interface]
pub trait IHashedWithdrawPoolU256<TContractState> {
    fn deposit_u256(
        ref self: TContractState,
        commitment_low: u128,
        commitment_high: u128,
        amount: u256
    );
    fn deposit(ref self: TContractState, commitment: felt252, amount: u256);

    /// Tier-2H: Withdraw claim (hash-only public output). No token transfer.
    /// Public inputs expected in proof: root, nullifier, claim_hash, poolType.
    fn withdraw_claim_u256(
        ref self: TContractState,
        nullifier_low: u128,
        nullifier_high: u128,
        root_low: u128,
        root_high: u128,
        pool_type: u8,
        zk_proof: Span<felt252>
    );
    fn withdraw_claim(
        ref self: TContractState,
        nullifier: felt252,
        root: felt252,
        pool_type: u8,
        zk_proof: Span<felt252>
    );

    fn is_claimed_u256(
        self: @TContractState,
        claim_low: u128,
        claim_high: u128
    ) -> bool;
}

#[starknet::contract]
mod HashedWithdrawPool {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_contract_address,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };

    use super::IMerkleTreeU256Dispatcher;
    use super::IMerkleTreeU256DispatcherTrait;
    use super::IGaragaVerifierDispatcher;
    use super::IGaragaVerifierDispatcherTrait;
    use crate::erc20_interface::IERC20Dispatcher;
    use crate::erc20_interface::IERC20DispatcherTrait;

    #[storage]
    struct Storage {
        merkle_tree: ContractAddress,
        withdraw_verifier: ContractAddress,
        token: ContractAddress,
        admin: ContractAddress,

        // Nullifiers as u256 (prevent double-spend)
        nullifiers: Map<felt252, bool>,
        nullifiers_low: Map<felt252, u128>,
        nullifiers_high: Map<felt252, u128>,

        // Claim hashes (hash(recipient, amount, salt))
        claims: Map<felt252, bool>,
        claims_low: Map<felt252, u128>,
        claims_high: Map<felt252, u128>,

        // Stats
        total_deposited: u256,
        deposit_count: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        DepositU256: DepositU256,
        WithdrawalClaimU256: WithdrawalClaimU256,
    }

    #[derive(Drop, starknet::Event)]
    struct DepositU256 {
        #[key]
        commitment_low: u128,
        #[key]
        commitment_high: u128,
        leaf_index: u64,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct WithdrawalClaimU256 {
        #[key]
        nullifier_low: u128,
        #[key]
        nullifier_high: u128,
        #[key]
        claim_low: u128,
        #[key]
        claim_high: u128,
        timestamp: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        merkle_tree: ContractAddress,
        withdraw_verifier: ContractAddress,
        token: ContractAddress,
        admin: ContractAddress
    ) {
        self.merkle_tree.write(merkle_tree);
        self.withdraw_verifier.write(withdraw_verifier);
        self.token.write(token);
        self.admin.write(admin);
        self.deposit_count.write(0);
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn u256_to_felt(self: @ContractState, low: u128, high: u128) -> felt252 {
            let low_felt: felt252 = low.into();
            let high_felt: felt252 = high.into();
            // 2^128 = 340282366920938463463374607431768211456
            low_felt + high_felt * 340282366920938463463374607431768211456
        }

        fn nullifier_key(self: @ContractState, low: u128, high: u128) -> felt252 {
            let arr = array![low.into(), high.into()];
            poseidon_hash_span(arr.span())
        }

        fn claim_key(self: @ContractState, low: u128, high: u128) -> felt252 {
            let arr = array![low.into(), high.into()];
            poseidon_hash_span(arr.span())
        }

        fn felt_to_u256(self: @ContractState, value: felt252) -> (u128, u128) {
            let as_u256: u256 = value.into();
            (as_u256.low, as_u256.high)
        }

        fn verify_withdraw_proof_and_get_public_inputs(
            self: @ContractState,
            zk_proof: Span<felt252>
        ) -> Span<u256> {
            let verifier_addr = self.withdraw_verifier.read();
            assert(!verifier_addr.is_zero(), 'Verifier required');
            let verifier = IGaragaVerifierDispatcher {
                contract_address: verifier_addr
            };
            let result = verifier.verify_groth16_proof_bn254(zk_proof);
            match result {
                Result::Ok(public_inputs) => public_inputs,
                Result::Err(_) => panic!("Invalid withdrawal proof"),
            }
        }
    }

    #[abi(embed_v0)]
    impl HashedWithdrawPoolU256Impl of super::IHashedWithdrawPoolU256<ContractState> {
        fn deposit_u256(
            ref self: ContractState,
            commitment_low: u128,
            commitment_high: u128,
            amount: u256
        ) {
            assert(amount > 0, 'Amount must be positive');
            assert(commitment_low != 0 || commitment_high != 0, 'Invalid commitment');

            let caller = get_caller_address();
            let timestamp = get_block_timestamp();

            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer_from(caller, get_contract_address(), amount);
            assert(ok, 'Transfer failed');

            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            let leaf_index = tree.insert_u256(commitment_low, commitment_high);

            let total = self.total_deposited.read();
            self.total_deposited.write(total + amount);
            let count = self.deposit_count.read();
            self.deposit_count.write(count + 1);

            self.emit(DepositU256 { commitment_low, commitment_high, leaf_index, timestamp });
        }

        fn deposit(ref self: ContractState, commitment: felt252, amount: u256) {
            let (low, high) = self.felt_to_u256(commitment);
            self.deposit_u256(low, high, amount);
        }

        fn withdraw_claim_u256(
            ref self: ContractState,
            nullifier_low: u128,
            nullifier_high: u128,
            root_low: u128,
            root_high: u128,
            pool_type: u8,
            zk_proof: Span<felt252>
        ) {
            let public_inputs = self.verify_withdraw_proof_and_get_public_inputs(zk_proof);
            assert(public_inputs.len() >= 4, 'Invalid public inputs');
            let pi_root = public_inputs.at(0);
            let pi_nullifier = public_inputs.at(1);
            let pi_claim = public_inputs.at(2);
            let pi_pool = public_inputs.at(3);

            assert(*pi_root.low == root_low && *pi_root.high == root_high, 'Root mismatch');
            assert(*pi_nullifier.low == nullifier_low && *pi_nullifier.high == nullifier_high, 'Nullifier mismatch');
            assert(*pi_pool.low == pool_type.into() && *pi_pool.high == 0, 'Pool mismatch');

            assert(*pi_claim.low != 0 || *pi_claim.high != 0, 'Invalid claim');

            let null_key = self.nullifier_key(nullifier_low, nullifier_high);
            assert(!self.nullifiers.read(null_key), 'Nullifier already used');

            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            assert(tree.is_known_root_u256(root_low, root_high), 'Unknown merkle root');

            let claim_key = self.claim_key(*pi_claim.low, *pi_claim.high);
            assert(!self.claims.read(claim_key), 'Claim already exists');

            self.nullifiers.write(null_key, true);
            self.nullifiers_low.write(null_key, nullifier_low);
            self.nullifiers_high.write(null_key, nullifier_high);

            self.claims.write(claim_key, true);
            self.claims_low.write(claim_key, *pi_claim.low);
            self.claims_high.write(claim_key, *pi_claim.high);

            self.emit(WithdrawalClaimU256 {
                nullifier_low,
                nullifier_high,
                claim_low: *pi_claim.low,
                claim_high: *pi_claim.high,
                timestamp: get_block_timestamp()
            });
        }

        fn withdraw_claim(
            ref self: ContractState,
            nullifier: felt252,
            root: felt252,
            pool_type: u8,
            zk_proof: Span<felt252>
        ) {
            let (null_low, null_high) = self.felt_to_u256(nullifier);
            let (root_low, root_high) = self.felt_to_u256(root);
            self.withdraw_claim_u256(null_low, null_high, root_low, root_high, pool_type, zk_proof);
        }

        fn is_claimed_u256(
            self: @ContractState,
            claim_low: u128,
            claim_high: u128
        ) -> bool {
            let key = self.claim_key(claim_low, claim_high);
            self.claims.read(key)
        }
    }
}
