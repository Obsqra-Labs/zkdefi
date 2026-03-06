// Incremental Merkle Tree (Tornado Cash style) with u256 Split Storage
// - Fixed depth (20 levels = 1M commitments)
// - Stores leaves as u256 (low, high) for BN254 Poseidon compatibility
// - O(log n) insertion and proof verification
// - Historical roots for async verification
//
// IMPORTANT: BN254 Poseidon outputs can exceed felt252, so we use u256.
// Leaves are stored as (low: u128, high: u128) pairs.
// Contract still uses Cairo's native Poseidon for internal hashing, but
// accepts/returns u256 values for circuit compatibility.

use starknet::ContractAddress;
use core::poseidon::poseidon_hash_span;

const TREE_DEPTH: u8 = 20;
const ROOT_HISTORY_SIZE: u64 = 100;

// Zero values for empty subtrees (precomputed)
// zero[0] = 0
// zero[i] = poseidon(zero[i-1], zero[i-1])
fn get_zero_value(level: u8) -> felt252 {
    // Precomputed zero values for each level
    // In production, these should be computed once and hardcoded
    if level == 0 {
        0
    } else {
        // For simplicity, using a deterministic value based on level
        // In production: poseidon(get_zero_value(level-1), get_zero_value(level-1))
        level.into()
    }
}

#[starknet::interface]
pub trait IMerkleTreeU256<TContractState> {
    /// Insert a new leaf (as u256: low, high) into the tree, returns the leaf index
    fn insert_u256(ref self: TContractState, leaf_low: u128, leaf_high: u128) -> u64;
    
    /// Insert using felt252 (for backwards compatibility - wraps to u256)
    fn insert(ref self: TContractState, leaf: felt252) -> u64;
    
    /// Get the current merkle root as u256 (low, high)
    fn get_root_u256(self: @TContractState) -> (u128, u128);
    
    /// Get the current merkle root as felt252 (for backwards compatibility)
    fn get_root(self: @TContractState) -> felt252;
    
    /// Get the last root (for backwards compatibility)
    fn get_last_root(self: @TContractState) -> felt252;
    
    /// Check if a root is known (within history) - u256 version
    fn is_known_root_u256(self: @TContractState, root_low: u128, root_high: u128) -> bool;
    
    /// Check if a root is known (within history) - felt252 version
    fn is_known_root(self: @TContractState, root: felt252) -> bool;
    
    /// Verify a merkle proof with u256 values
    fn verify_proof_u256(
        self: @TContractState,
        leaf_low: u128,
        leaf_high: u128,
        path_elements_low: Span<u128>,
        path_elements_high: Span<u128>,
        path_indices: Span<u8>,
        root_low: u128,
        root_high: u128
    ) -> bool;
    
    /// Verify a merkle proof (felt252 version for backwards compatibility)
    fn verify_proof(
        self: @TContractState,
        leaf: felt252,
        path_elements: Span<felt252>,
        path_indices: Span<u8>,
        root: felt252
    ) -> bool;
    
    /// Get the next insertion index
    fn get_next_index(self: @TContractState) -> u64;
    
    /// Get tree depth
    fn get_depth(self: @TContractState) -> u8;
    
    /// Get leaf at index as u256
    fn get_leaf_u256(self: @TContractState, index: u64) -> (u128, u128);
}

#[starknet::contract]
mod MerkleTree {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::poseidon::poseidon_hash_span;
    use super::{TREE_DEPTH, ROOT_HISTORY_SIZE, get_zero_value};
    
    #[storage]
    struct Storage {
        // Filled subtrees at each level (for incremental updates)
        // Using felt252 for internal hashing
        filled_subtrees: Map<u8, felt252>,
        
        // Historical roots for async verification
        roots: Map<u64, felt252>,
        current_root_index: u64,
        
        // Next leaf index
        next_index: u64,
        
        // Store leaves as u256 (low, high) for BN254 compatibility
        leaves_low: Map<u64, u128>,
        leaves_high: Map<u64, u128>,
        
        // Admin
        admin: ContractAddress,
        
        // Allowed inserters (e.g., the shielded pool contract)
        allowed_inserters: Map<ContractAddress, bool>,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        LeafInserted: LeafInserted,
        LeafInsertedU256: LeafInsertedU256,
    }
    
    #[derive(Drop, starknet::Event)]
    struct LeafInserted {
        #[key]
        leaf: felt252,
        index: u64,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct LeafInsertedU256 {
        #[key]
        leaf_low: u128,
        #[key]
        leaf_high: u128,
        index: u64,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        self.allowed_inserters.write(admin, true);
        self.next_index.write(0);
        self.current_root_index.write(0);
        
        // Initialize filled_subtrees with zero values
        let mut i: u8 = 0;
        loop {
            if i >= TREE_DEPTH {
                break;
            }
            self.filled_subtrees.write(i, get_zero_value(i));
            i += 1;
        };
        
        // Set initial root (empty tree)
        let initial_root = self.compute_empty_root();
        self.roots.write(0, initial_root);
    }
    
    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn compute_empty_root(self: @ContractState) -> felt252 {
            // Compute root of empty tree
            let mut current = get_zero_value(0);
            let mut i: u8 = 0;
            loop {
                if i >= TREE_DEPTH {
                    break;
                }
                let arr = array![current, current];
                current = poseidon_hash_span(arr.span());
                i += 1;
            };
            current
        }
        
        fn hash_left_right(self: @ContractState, left: felt252, right: felt252) -> felt252 {
            let arr = array![left, right];
            poseidon_hash_span(arr.span())
        }
        
        fn u256_to_felt(self: @ContractState, low: u128, high: u128) -> felt252 {
            // Reconstruct the number: value = low + high * 2^128
            // felt252 arithmetic automatically reduces mod STARK_PRIME
            // This is consistent with the backend's _root_to_felt252(root) = root % STARK_PRIME
            let low_felt: felt252 = low.into();
            let high_felt: felt252 = high.into();
            // 2^128 = 340282366920938463463374607431768211456
            low_felt + high_felt * 340282366920938463463374607431768211456
        }
        
        fn felt_to_u256(self: @ContractState, value: felt252) -> (u128, u128) {
            // Convert felt252 to u256 (low, high)
            // felt252 always fits in 252 bits, so high will be small
            let as_u256: u256 = value.into();
            (as_u256.low, as_u256.high)
        }
    }
    
    #[abi(embed_v0)]
    impl MerkleTreeU256Impl of super::IMerkleTreeU256<ContractState> {
        fn insert_u256(ref self: ContractState, leaf_low: u128, leaf_high: u128) -> u64 {
            let caller = get_caller_address();
            assert(self.allowed_inserters.read(caller), 'Not authorized to insert');
            
            let current_index = self.next_index.read();
            assert(current_index < 1048576, 'Tree is full'); // 2^20
            
            // Store the original u256 leaf
            self.leaves_low.write(current_index, leaf_low);
            self.leaves_high.write(current_index, leaf_high);
            
            // Convert to felt252 for internal tree operations
            let leaf_felt = self.u256_to_felt(leaf_low, leaf_high);
            
            let mut current_hash = leaf_felt;
            let mut current_idx = current_index;
            let mut level: u8 = 0;
            
            loop {
                if level >= TREE_DEPTH {
                    break;
                }
                
                let (left, right) = if current_idx % 2 == 0 {
                    // Current is left child
                    self.filled_subtrees.write(level, current_hash);
                    (current_hash, get_zero_value(level))
                } else {
                    // Current is right child
                    (self.filled_subtrees.read(level), current_hash)
                };
                
                current_hash = self.hash_left_right(left, right);
                current_idx = current_idx / 2;
                level += 1;
            };
            
            // Update root history
            let new_root_index = (self.current_root_index.read() + 1) % ROOT_HISTORY_SIZE;
            self.current_root_index.write(new_root_index);
            self.roots.write(new_root_index, current_hash);
            
            // Increment next index
            self.next_index.write(current_index + 1);
            
            self.emit(LeafInsertedU256 {
                leaf_low,
                leaf_high,
                index: current_index,
                timestamp: get_block_timestamp(),
            });
            
            current_index
        }
        
        fn insert(ref self: ContractState, leaf: felt252) -> u64 {
            // Backwards compatible: convert felt252 to u256
            let (low, high) = self.felt_to_u256(leaf);
            self.insert_u256(low, high)
        }
        
        fn get_root_u256(self: @ContractState) -> (u128, u128) {
            let root = self.get_root();
            self.felt_to_u256(root)
        }
        
        fn get_root(self: @ContractState) -> felt252 {
            let current_idx = self.current_root_index.read();
            self.roots.read(current_idx)
        }
        
        fn get_last_root(self: @ContractState) -> felt252 {
            self.get_root()
        }
        
        fn is_known_root_u256(self: @ContractState, root_low: u128, root_high: u128) -> bool {
            let root = self.u256_to_felt(root_low, root_high);
            self.is_known_root(root)
        }
        
        fn is_known_root(self: @ContractState, root: felt252) -> bool {
            if root == 0 {
                return false;
            }
            
            let current_idx = self.current_root_index.read();
            let mut i: u64 = 0;
            
            loop {
                if i >= ROOT_HISTORY_SIZE {
                    break false;
                }
                
                let idx = if current_idx >= i {
                    current_idx - i
                } else {
                    ROOT_HISTORY_SIZE - i + current_idx
                };
                
                if self.roots.read(idx) == root {
                    break true;
                }
                
                i += 1;
            }
        }
        
        fn verify_proof_u256(
            self: @ContractState,
            leaf_low: u128,
            leaf_high: u128,
            path_elements_low: Span<u128>,
            path_elements_high: Span<u128>,
            path_indices: Span<u8>,
            root_low: u128,
            root_high: u128
        ) -> bool {
            assert(path_elements_low.len() == TREE_DEPTH.into(), 'Invalid path length');
            assert(path_elements_high.len() == TREE_DEPTH.into(), 'Invalid path high length');
            assert(path_indices.len() == TREE_DEPTH.into(), 'Invalid indices length');
            
            // Convert leaf and root to felt
            let leaf = self.u256_to_felt(leaf_low, leaf_high);
            let root = self.u256_to_felt(root_low, root_high);
            
            let mut current_hash = leaf;
            let mut i: u32 = 0;
            
            loop {
                if i >= TREE_DEPTH.into() {
                    break;
                }
                
                let sibling = self.u256_to_felt(*path_elements_low.at(i), *path_elements_high.at(i));
                let is_right = *path_indices.at(i);
                
                current_hash = if is_right == 0 {
                    // Current node is left child
                    self.hash_left_right(current_hash, sibling)
                } else {
                    // Current node is right child
                    self.hash_left_right(sibling, current_hash)
                };
                
                i += 1;
            };
            
            current_hash == root && self.is_known_root(root)
        }
        
        fn verify_proof(
            self: @ContractState,
            leaf: felt252,
            path_elements: Span<felt252>,
            path_indices: Span<u8>,
            root: felt252
        ) -> bool {
            assert(path_elements.len() == TREE_DEPTH.into(), 'Invalid path length');
            assert(path_indices.len() == TREE_DEPTH.into(), 'Invalid indices length');
            
            let mut current_hash = leaf;
            let mut i: u32 = 0;
            
            loop {
                if i >= TREE_DEPTH.into() {
                    break;
                }
                
                let sibling = *path_elements.at(i);
                let is_right = *path_indices.at(i);
                
                current_hash = if is_right == 0 {
                    // Current node is left child
                    self.hash_left_right(current_hash, sibling)
                } else {
                    // Current node is right child
                    self.hash_left_right(sibling, current_hash)
                };
                
                i += 1;
            };
            
            current_hash == root && self.is_known_root(root)
        }
        
        fn get_next_index(self: @ContractState) -> u64 {
            self.next_index.read()
        }
        
        fn get_depth(self: @ContractState) -> u8 {
            TREE_DEPTH
        }
        
        fn get_leaf_u256(self: @ContractState, index: u64) -> (u128, u128) {
            (self.leaves_low.read(index), self.leaves_high.read(index))
        }
    }
    
    // Admin functions
    #[external(v0)]
    fn add_inserter(ref self: ContractState, inserter: ContractAddress) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        self.allowed_inserters.write(inserter, true);
    }

    #[external(v0)]
    fn remove_inserter(ref self: ContractState, inserter: ContractAddress) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        self.allowed_inserters.write(inserter, false);
    }

    /// Register an external root so withdrawals with off-chain merkle proofs (e.g. BN254 Poseidon backend) can be accepted.
    /// Only admin. Call this after the backend adds a commitment to its tree so the pool accepts that root.
    #[external(v0)]
    fn add_known_root(ref self: ContractState, root: felt252) {
        assert(get_caller_address() == self.admin.read(), 'Only admin');
        assert(root != 0, 'Root cannot be zero');
        let new_root_index = (self.current_root_index.read() + 1) % ROOT_HISTORY_SIZE;
        self.current_root_index.write(new_root_index);
        self.roots.write(new_root_index, root);
    }
}
