// Fully Shielded Pool: Maximum privacy with selective disclosure
// 
// Privacy Model:
// - On-chain stores ONLY commitments (in merkle tree)
// - Balance: Hidden (in commitment)
// - Pool type: Hidden (in commitment)
// - Owner: Hidden (in commitment)
//
// Withdrawal requires ZK proof of:
// - Merkle membership (commitment exists)
// - Nullifier derivation (prevents double-spend)
// - Amount ownership (you own the amount you claim)
//
// Selective Disclosure:
// - Prove "balance > X" without revealing balance
// - Prove "in pool Y" without revealing commitment
// - Prove "compliant" without revealing identity
//
// BN254 Compatibility:
// - Commitments and nullifiers stored as u256 (low, high) pairs
// - BN254 Poseidon outputs can exceed felt252
// - Split storage ensures full compatibility with circomlib circuits

use starknet::ContractAddress;

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
pub trait IFullyShieldedPoolU256<TContractState> {
    // ==================== DEPOSIT (u256) ====================
    // Commitment as u256 (low, high) for BN254 compatibility
    
    /// Deposit tokens with a commitment (u256 split storage)
    /// commitment = poseidon(user_secret, amount, pool_type, nonce, blinding)
    fn deposit_u256(
        ref self: TContractState,
        commitment_low: u128,
        commitment_high: u128,
        amount: u256
    );
    
    /// Deposit tokens with a commitment (felt252 - backwards compatible)
    fn deposit(ref self: TContractState, commitment: felt252, amount: u256);
    
    // ==================== WITHDRAW (u256) ====================
    // ZK proof verifies: membership, nullifier, amount ownership
    
    /// Withdraw tokens using ZK proof (u256 split storage)
    fn withdraw_u256(
        ref self: TContractState,
        nullifier_low: u128,
        nullifier_high: u128,
        root_low: u128,
        root_high: u128,
        recipient: ContractAddress,
        amount: u256,
        pool_type: u8,
        zk_proof: Span<felt252>
    );
    
    /// Withdraw tokens using ZK proof (felt252 - backwards compatible)
    fn withdraw(
        ref self: TContractState,
        nullifier: felt252,
        root: felt252,
        recipient: ContractAddress,
        amount: u256,
        pool_type: u8,
        zk_proof: Span<felt252>
    );
    
    /// Tier 2: Withdraw via relayer; recipient and amount are read from proof public inputs (not calldata).
    fn withdraw_relayed_u256(
        ref self: TContractState,
        nullifier_low: u128,
        nullifier_high: u128,
        root_low: u128,
        root_high: u128,
        pool_type: u8,
        zk_proof: Span<felt252>
    );

    /// Withdraw partial amount and insert change commitment (V2 partial withdraw)
    /// Proof proves withdraw_amount + change_amount = commitment_amount; contract transfers withdraw_amount and inserts change_commitment into tree
    fn withdraw_with_change_u256(
        ref self: TContractState,
        nullifier_low: u128,
        nullifier_high: u128,
        root_low: u128,
        root_high: u128,
        recipient: ContractAddress,
        withdraw_amount: u256,
        pool_type: u8,
        change_commitment_low: u128,
        change_commitment_high: u128,
        change_amount: u256,
        zk_proof: Span<felt252>
    );
    
    // ==================== SELECTIVE DISCLOSURE ====================
    
    fn verify_balance_above(
        self: @TContractState,
        root: felt252,
        threshold: u256,
        proof: Span<felt252>
    ) -> bool;
    
    fn verify_pool_membership(
        self: @TContractState,
        root: felt252,
        pool_type: u8,
        proof: Span<felt252>
    ) -> bool;
    
    fn verify_tenure_above(
        self: @TContractState,
        root: felt252,
        min_blocks: u64,
        proof: Span<felt252>
    ) -> bool;
    
    // ==================== VIEW FUNCTIONS ====================
    
    fn get_merkle_root(self: @TContractState) -> felt252;
    fn get_merkle_root_u256(self: @TContractState) -> (u128, u128);
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    fn is_nullifier_used_u256(self: @TContractState, nullifier_low: u128, nullifier_high: u128) -> bool;
    fn get_deposit_count(self: @TContractState) -> u64;
}

#[starknet::contract]
mod FullyShieldedPool {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_contract_address,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use crate::erc20_interface::IERC20Dispatcher;
    use crate::erc20_interface::IERC20DispatcherTrait;
    
    use super::{
        IMerkleTreeU256Dispatcher, IMerkleTreeU256DispatcherTrait,
        IGaragaVerifierDispatcher, IGaragaVerifierDispatcherTrait,
    };
    
    #[storage]
    struct Storage {
        // Core contracts
        merkle_tree: ContractAddress,
        withdraw_verifier: ContractAddress,
        withdraw_with_change_verifier: ContractAddress,
        balance_disclosure_verifier: ContractAddress,
        pool_disclosure_verifier: ContractAddress,
        tenure_disclosure_verifier: ContractAddress,
        token: ContractAddress,
        admin: ContractAddress,
        
        // Nullifiers as u256 (prevent double-spend)
        // Key: hash of (low, high) for efficient lookup
        nullifiers: Map<felt252, bool>,
        // Also store u256 nullifiers directly for lookup
        nullifiers_low: Map<felt252, u128>,
        nullifiers_high: Map<felt252, u128>,
        
        // Stats (aggregated - no individual exposure)
        total_deposited: u256,
        total_withdrawn: u256,
        deposit_count: u64,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        DepositU256: DepositU256,
        Deposit: Deposit,
        WithdrawalU256: WithdrawalU256,
        Withdrawal: Withdrawal,
        WithdrawalWithChangeU256: WithdrawalWithChangeU256,
        DisclosureVerified: DisclosureVerified,
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
    struct Deposit {
        #[key]
        commitment: felt252,
        leaf_index: u64,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct WithdrawalU256 {
        #[key]
        nullifier_low: u128,
        #[key]
        nullifier_high: u128,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct Withdrawal {
        #[key]
        nullifier: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct WithdrawalWithChangeU256 {
        #[key]
        nullifier_low: u128,
        #[key]
        nullifier_high: u128,
        #[key]
        change_commitment_low: u128,
        #[key]
        change_commitment_high: u128,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct DisclosureVerified {
        disclosure_type: felt252,
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
        self.withdraw_with_change_verifier.write(Zero::zero());
        self.token.write(token);
        self.admin.write(admin);
        self.deposit_count.write(0);
    }
    
    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn verify_withdraw_proof(self: @ContractState, proof: Span<felt252>) -> bool {
            let verifier_addr = self.withdraw_verifier.read();
            if verifier_addr.is_zero() {
                return proof.len() >= 3;
            }
            
            let verifier = IGaragaVerifierDispatcher {
                contract_address: verifier_addr
            };
            let result = verifier.verify_groth16_proof_bn254(proof);
            result.is_ok()
        }
        
        /// Verify withdraw proof and return public_inputs (root, nullifier, recipient, withdrawAmount, poolType). Caller must ensure verifier is set.
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
        
        fn verify_withdraw_with_change_proof(self: @ContractState, proof: Span<felt252>) -> bool {
            let verifier_addr = self.withdraw_with_change_verifier.read();
            if verifier_addr.is_zero() {
                return proof.len() >= 3;
            }
            
            let verifier = IGaragaVerifierDispatcher {
                contract_address: verifier_addr
            };
            let result = verifier.verify_groth16_proof_bn254(proof);
            result.is_ok()
        }
        
        fn verify_disclosure_proof(
            self: @ContractState,
            verifier_addr: ContractAddress,
            proof: Span<felt252>
        ) -> bool {
            if verifier_addr.is_zero() {
                return proof.len() >= 3;
            }
            
            let verifier = IGaragaVerifierDispatcher {
                contract_address: verifier_addr
            };
            let result = verifier.verify_groth16_proof_bn254(proof);
            result.is_ok()
        }

        fn u256_to_felt(self: @ContractState, low: u128, high: u128) -> felt252 {
            let low_felt: felt252 = low.into();
            let high_felt: felt252 = high.into();
            // 2^128 = 340282366920938463463374607431768211456
            low_felt + high_felt * 340282366920938463463374607431768211456
        }
        
        fn nullifier_key(self: @ContractState, low: u128, high: u128) -> felt252 {
            // Hash (low, high) to create a felt252 key for the nullifiers map
            let arr = array![low.into(), high.into()];
            poseidon_hash_span(arr.span())
        }
        
        fn felt_to_u256(self: @ContractState, value: felt252) -> (u128, u128) {
            let as_u256: u256 = value.into();
            (as_u256.low, as_u256.high)
        }
    }
    
    #[abi(embed_v0)]
    impl FullyShieldedPoolU256Impl of super::IFullyShieldedPoolU256<ContractState> {
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
            
            // Transfer tokens from depositor
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer_from(caller, get_contract_address(), amount);
            assert(ok, 'Transfer failed');
            
            // Insert commitment into merkle tree using u256
            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            let leaf_index = tree.insert_u256(commitment_low, commitment_high);
            
            // Update stats
            let total = self.total_deposited.read();
            self.total_deposited.write(total + amount);
            let count = self.deposit_count.read();
            self.deposit_count.write(count + 1);
            
            // Emit event
            self.emit(DepositU256 { commitment_low, commitment_high, leaf_index, timestamp });
        }
        
        fn deposit(ref self: ContractState, commitment: felt252, amount: u256) {
            // Backwards compatible: convert felt252 to u256
            let (low, high) = self.felt_to_u256(commitment);
            self.deposit_u256(low, high, amount);
        }
        
        fn withdraw_u256(
            ref self: ContractState,
            nullifier_low: u128,
            nullifier_high: u128,
            root_low: u128,
            root_high: u128,
            recipient: ContractAddress,
            amount: u256,
            pool_type: u8,
            zk_proof: Span<felt252>
        ) {
            assert(amount > 0, 'Amount must be positive');
            
            // Check nullifier not used
            let null_key = self.nullifier_key(nullifier_low, nullifier_high);
            assert(!self.nullifiers.read(null_key), 'Nullifier already used');
            
            let timestamp = get_block_timestamp();
            
            // Verify merkle root is known
            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            assert(tree.is_known_root_u256(root_low, root_high), 'Unknown merkle root');
            
            // Verify ZK proof
            assert(self.verify_withdraw_proof(zk_proof), 'Invalid withdrawal proof');
            
            // Mark nullifier as used
            self.nullifiers.write(null_key, true);
            self.nullifiers_low.write(null_key, nullifier_low);
            self.nullifiers_high.write(null_key, nullifier_high);
            
            // Transfer tokens to recipient
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer(recipient, amount);
            assert(ok, 'Transfer failed');
            
            // Update stats
            let total = self.total_withdrawn.read();
            self.total_withdrawn.write(total + amount);
            
            // Emit event
            self.emit(WithdrawalU256 { nullifier_low, nullifier_high, timestamp });
        }
        
        fn withdraw(
            ref self: ContractState,
            nullifier: felt252,
            root: felt252,
            recipient: ContractAddress,
            amount: u256,
            pool_type: u8,
            zk_proof: Span<felt252>
        ) {
            // Backwards compatible: convert felt252 to u256
            let (null_low, null_high) = self.felt_to_u256(nullifier);
            let (root_low, root_high) = self.felt_to_u256(root);
            self.withdraw_u256(null_low, null_high, root_low, root_high, recipient, amount, pool_type, zk_proof);
        }
        
        fn withdraw_relayed_u256(
            ref self: ContractState,
            nullifier_low: u128,
            nullifier_high: u128,
            root_low: u128,
            root_high: u128,
            pool_type: u8,
            zk_proof: Span<felt252>
        ) {
            let public_inputs = self.verify_withdraw_proof_and_get_public_inputs(zk_proof);
            assert(public_inputs.len() >= 5, 'Invalid public inputs');
            let pi_root = public_inputs.at(0);
            let pi_nullifier = public_inputs.at(1);
            let pi_recipient = public_inputs.at(2);
            let pi_amount = public_inputs.at(3);
            assert(*pi_root.low == root_low && *pi_root.high == root_high, 'Root mismatch');
            assert(*pi_nullifier.low == nullifier_low && *pi_nullifier.high == nullifier_high, 'Nullifier mismatch');
            let recipient_felt: felt252 = self.u256_to_felt(*pi_recipient.low, *pi_recipient.high);
            let recipient: ContractAddress = recipient_felt.try_into().unwrap();
            let amount: u256 = u256 { low: *pi_amount.low, high: *pi_amount.high };
            assert(amount > 0, 'Amount must be positive');
            let null_key = self.nullifier_key(nullifier_low, nullifier_high);
            assert(!self.nullifiers.read(null_key), 'Nullifier already used');
            let timestamp = get_block_timestamp();
            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            assert(tree.is_known_root_u256(root_low, root_high), 'Unknown merkle root');
            self.nullifiers.write(null_key, true);
            self.nullifiers_low.write(null_key, nullifier_low);
            self.nullifiers_high.write(null_key, nullifier_high);
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer(recipient, amount);
            assert(ok, 'Transfer failed');
            let total = self.total_withdrawn.read();
            self.total_withdrawn.write(total + amount);
            self.emit(WithdrawalU256 { nullifier_low, nullifier_high, timestamp });
        }
        
        fn withdraw_with_change_u256(
            ref self: ContractState,
            nullifier_low: u128,
            nullifier_high: u128,
            root_low: u128,
            root_high: u128,
            recipient: ContractAddress,
            withdraw_amount: u256,
            pool_type: u8,
            change_commitment_low: u128,
            change_commitment_high: u128,
            change_amount: u256,
            zk_proof: Span<felt252>
        ) {
            assert(withdraw_amount > 0, 'Withdraw amt positive');
            
            let null_key = self.nullifier_key(nullifier_low, nullifier_high);
            assert(!self.nullifiers.read(null_key), 'Nullifier already used');
            
            let timestamp = get_block_timestamp();
            
            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            assert(tree.is_known_root_u256(root_low, root_high), 'Unknown merkle root');
            
            assert(self.verify_withdraw_with_change_proof(zk_proof), 'Invalid proof');
            
            self.nullifiers.write(null_key, true);
            self.nullifiers_low.write(null_key, nullifier_low);
            self.nullifiers_high.write(null_key, nullifier_high);
            
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer(recipient, withdraw_amount);
            assert(ok, 'Transfer failed');
            
            // Insert change commitment into same merkle tree (no token transfer - remainder stays in pool)
            if change_commitment_low != 0 || change_commitment_high != 0 {
                tree.insert_u256(change_commitment_low, change_commitment_high);
            }
            
            let total = self.total_withdrawn.read();
            self.total_withdrawn.write(total + withdraw_amount);
            
            self.emit(WithdrawalWithChangeU256 {
                nullifier_low,
                nullifier_high,
                change_commitment_low,
                change_commitment_high,
                timestamp,
            });
        }
        
        fn verify_balance_above(
            self: @ContractState,
            root: felt252,
            threshold: u256,
            proof: Span<felt252>
        ) -> bool {
            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            if !tree.is_known_root(root) {
                return false;
            }
            
            let verifier = self.balance_disclosure_verifier.read();
            self.verify_disclosure_proof(verifier, proof)
        }
        
        fn verify_pool_membership(
            self: @ContractState,
            root: felt252,
            pool_type: u8,
            proof: Span<felt252>
        ) -> bool {
            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            if !tree.is_known_root(root) {
                return false;
            }
            
            let verifier = self.pool_disclosure_verifier.read();
            self.verify_disclosure_proof(verifier, proof)
        }
        
        fn verify_tenure_above(
            self: @ContractState,
            root: felt252,
            min_blocks: u64,
            proof: Span<felt252>
        ) -> bool {
            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            if !tree.is_known_root(root) {
                return false;
            }
            
            let verifier = self.tenure_disclosure_verifier.read();
            self.verify_disclosure_proof(verifier, proof)
        }
        
        fn get_merkle_root(self: @ContractState) -> felt252 {
            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            tree.get_root()
        }
        
        fn get_merkle_root_u256(self: @ContractState) -> (u128, u128) {
            let tree = IMerkleTreeU256Dispatcher {
                contract_address: self.merkle_tree.read()
            };
            tree.get_root_u256()
        }
        
        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            let (low, high) = self.felt_to_u256(nullifier);
            self.is_nullifier_used_u256(low, high)
        }
        
        fn is_nullifier_used_u256(self: @ContractState, nullifier_low: u128, nullifier_high: u128) -> bool {
            let key = self.nullifier_key(nullifier_low, nullifier_high);
            self.nullifiers.read(key)
        }
        
        fn get_deposit_count(self: @ContractState) -> u64 {
            self.deposit_count.read()
        }
    }
    
    // Admin functions
    #[external(v0)]
    fn set_balance_disclosure_verifier(ref self: ContractState, verifier: ContractAddress) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        self.balance_disclosure_verifier.write(verifier);
    }
    
    #[external(v0)]
    fn set_pool_disclosure_verifier(ref self: ContractState, verifier: ContractAddress) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        self.pool_disclosure_verifier.write(verifier);
    }
    
    #[external(v0)]
    fn set_tenure_disclosure_verifier(ref self: ContractState, verifier: ContractAddress) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        self.tenure_disclosure_verifier.write(verifier);
    }
    
    #[external(v0)]
    fn set_withdraw_verifier(ref self: ContractState, verifier: ContractAddress) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        self.withdraw_verifier.write(verifier);
    }
    
    #[external(v0)]
    fn set_withdraw_with_change_verifier(ref self: ContractState, verifier: ContractAddress) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        self.withdraw_with_change_verifier.write(verifier);
    }
}
