// Receipt Registry: On-chain storage for execution receipts with proof hashes
// Every vault operation (deposit, withdraw, allocate) creates an immutable receipt

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct Receipt {
    pub user: ContractAddress,
    pub action_type: felt252,      // 'deposit', 'withdraw', 'allocate', 'rebalance'
    pub amount: u256,
    pub proof_hash: felt252,       // STARK proof hash from Fact Registry
    pub timestamp: u64,
    pub tx_hash: felt252,
}

#[starknet::interface]
pub trait IReceiptRegistry<TContractState> {
    // Write
    fn create_receipt(
        ref self: TContractState,
        user: ContractAddress,
        action_type: felt252,
        amount: u256,
        proof_hash: felt252,
        tx_hash: felt252,
    ) -> felt252;  // Returns receipt_id
    
    // Read
    fn get_receipt(self: @TContractState, receipt_id: felt252) -> Receipt;
    fn get_user_receipt_count(self: @TContractState, user: ContractAddress) -> u64;
    fn get_user_receipt_at_index(
        self: @TContractState,
        user: ContractAddress,
        index: u64
    ) -> felt252;
    fn get_total_receipt_count(self: @TContractState) -> u64;
    
    // Admin
    fn get_admin(self: @TContractState) -> ContractAddress;
    fn set_authorized_caller(ref self: TContractState, caller: ContractAddress, authorized: bool);
    fn is_authorized_caller(self: @TContractState, caller: ContractAddress) -> bool;
}

#[starknet::contract]
mod ReceiptRegistry {
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp, get_tx_info};
    use starknet::storage::{
        Map, StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess,
    };
    use core::poseidon::poseidon_hash_span;
    use super::Receipt;

    #[storage]
    struct Storage {
        receipts: Map<felt252, Receipt>,  // receipt_id => Receipt
        user_receipt_count: Map<ContractAddress, u64>,
        user_receipts: Map<(ContractAddress, u64), felt252>,  // (user, index) => receipt_id
        total_receipt_count: u64,
        admin: ContractAddress,
        authorized_callers: Map<ContractAddress, bool>,  // VaultController, etc.
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ReceiptCreated: ReceiptCreated,
        AuthorizedCallerUpdated: AuthorizedCallerUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct ReceiptCreated {
        #[key]
        receipt_id: felt252,
        #[key]
        user: ContractAddress,
        action_type: felt252,
        proof_hash: felt252,
        amount: u256,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct AuthorizedCallerUpdated {
        #[key]
        caller: ContractAddress,
        authorized: bool,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
    ) {
        self.admin.write(admin);
        self.total_receipt_count.write(0);
        
        // Admin is authorized by default
        self.authorized_callers.write(admin, true);
    }

    fn assert_authorized(self: @ContractState) {
        let caller = get_caller_address();
        assert(
            self.authorized_callers.read(caller) || caller == self.admin.read(),
            'Caller not authorized'
        );
    }

    #[abi(embed_v0)]
    impl ReceiptRegistryImpl of super::IReceiptRegistry<ContractState> {
        fn create_receipt(
            ref self: ContractState,
            user: ContractAddress,
            action_type: felt252,
            amount: u256,
            proof_hash: felt252,
            tx_hash: felt252,
        ) -> felt252 {
            // Only authorized contracts (VaultController, etc.) can create receipts
            assert_authorized(@self);
            
            let timestamp = get_block_timestamp();
            
            // Generate unique receipt_id = Poseidon(user, action_type, proof_hash, timestamp, tx_hash)
            let receipt_id = poseidon_hash_span(
                array![
                    user.into(),
                    action_type,
                    proof_hash,
                    timestamp.into(),
                    tx_hash,
                    amount.low.into(),
                    amount.high.into(),
                ].span()
            );
            
            // Create receipt
            let receipt = Receipt {
                user,
                action_type,
                amount,
                proof_hash,
                timestamp,
                tx_hash,
            };
            
            self.receipts.write(receipt_id, receipt);
            
            // Index for user queries
            let user_count = self.user_receipt_count.read(user);
            self.user_receipts.write((user, user_count), receipt_id);
            self.user_receipt_count.write(user, user_count + 1);
            
            // Increment total count
            let total = self.total_receipt_count.read();
            self.total_receipt_count.write(total + 1);
            
            // Emit event
            self.emit(ReceiptCreated {
                receipt_id,
                user,
                action_type,
                proof_hash,
                amount,
                timestamp,
            });
            
            receipt_id
        }
        
        fn get_receipt(self: @ContractState, receipt_id: felt252) -> Receipt {
            self.receipts.read(receipt_id)
        }
        
        fn get_user_receipt_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_receipt_count.read(user)
        }
        
        fn get_user_receipt_at_index(
            self: @ContractState,
            user: ContractAddress,
            index: u64
        ) -> felt252 {
            self.user_receipts.read((user, index))
        }
        
        fn get_total_receipt_count(self: @ContractState) -> u64 {
            self.total_receipt_count.read()
        }
        
        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }
        
        fn set_authorized_caller(
            ref self: ContractState,
            caller: ContractAddress,
            authorized: bool,
        ) {
            // Only admin can authorize callers
            assert(get_caller_address() == self.admin.read(), 'Only admin');
            
            self.authorized_callers.write(caller, authorized);
            
            self.emit(AuthorizedCallerUpdated {
                caller,
                authorized,
            });
        }
        
        fn is_authorized_caller(self: @ContractState, caller: ContractAddress) -> bool {
            self.authorized_callers.read(caller)
        }
    }
}
