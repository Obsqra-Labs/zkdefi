#[starknet::interface]
pub trait IReceiptRegistry<TContractState> {
    fn issue_attested_receipt(
        ref self: TContractState,
        policy_hash: felt252,
        sig_r: felt252,
        sig_s: felt252,
        weight: u128
    ) -> u64;
    fn consume_receipt(ref self: TContractState, receipt_id: u64, nullifier: felt252);
    fn verify_receipt(self: @TContractState, receipt_id: u64) -> bool;
    fn upgrade(ref self: TContractState, new_attester_pubkey: felt252);
    fn get_admin(self: @TContractState) -> starknet::ContractAddress;
    fn get_attester_pubkey(self: @TContractState) -> felt252;
    fn get_receipt_policy_hash(self: @TContractState, receipt_id: u64) -> felt252;
    fn get_receipt_weight(self: @TContractState, receipt_id: u64) -> u128;
    fn get_receipt_nullifier(self: @TContractState, receipt_id: u64) -> felt252;
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    fn is_policy_hash_used(self: @TContractState, policy_hash: felt252) -> bool;
    fn get_next_receipt_id(self: @TContractState) -> u64;
}

#[starknet::contract]
pub mod ReceiptRegistry {
    use core::ecdsa::check_ecdsa_signature;
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        attester_pubkey: felt252,
        next_receipt_id: u64,
        receipt_exists: Map<u64, bool>,
        receipt_policy_hash: Map<u64, felt252>,
        receipt_weight: Map<u64, u128>,
        receipt_consumed: Map<u64, bool>,
        receipt_nullifier: Map<u64, felt252>,
        used_nullifiers: Map<felt252, bool>,
        used_policy_hashes: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ReceiptIssued: ReceiptIssued,
        ReceiptConsumed: ReceiptConsumed,
        AttesterUpgraded: AttesterUpgraded,
    }

    #[derive(Drop, starknet::Event)]
    struct ReceiptIssued {
        #[key]
        receipt_id: u64,
        #[key]
        policy_hash: felt252,
        weight: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct ReceiptConsumed {
        #[key]
        receipt_id: u64,
        #[key]
        nullifier: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct AttesterUpgraded {
        old_attester_pubkey: felt252,
        new_attester_pubkey: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, attester_pubkey: felt252, admin: ContractAddress) {
        assert(attester_pubkey != 0, 'ZERO_ATTESTER');
        self.attester_pubkey.write(attester_pubkey);
        self.admin.write(admin);
        self.next_receipt_id.write(1);
    }

    #[abi(embed_v0)]
    impl ReceiptRegistryImpl of super::IReceiptRegistry<ContractState> {
        fn issue_attested_receipt(
            ref self: ContractState,
            policy_hash: felt252,
            sig_r: felt252,
            sig_s: felt252,
            weight: u128,
        ) -> u64 {
            assert(policy_hash != 0, 'ZERO_POLICY_HASH');
            assert(weight > 0, 'ZERO_WEIGHT');
            assert(!self.used_policy_hashes.entry(policy_hash).read(), 'POLICY_HASH_REPLAY');

            let attester_pubkey = self.attester_pubkey.read();
            assert(check_ecdsa_signature(policy_hash, attester_pubkey, sig_r, sig_s), 'INVALID_SIGNATURE');

            let receipt_id = self.next_receipt_id.read();
            self.next_receipt_id.write(receipt_id + 1);
            self.receipt_exists.entry(receipt_id).write(true);
            self.receipt_policy_hash.entry(receipt_id).write(policy_hash);
            self.receipt_weight.entry(receipt_id).write(weight);
            self.receipt_consumed.entry(receipt_id).write(false);
            self.receipt_nullifier.entry(receipt_id).write(0);
            self.used_policy_hashes.entry(policy_hash).write(true);

            self.emit(ReceiptIssued { receipt_id, policy_hash, weight });
            receipt_id
        }

        fn consume_receipt(ref self: ContractState, receipt_id: u64, nullifier: felt252) {
            assert(self.receipt_exists.entry(receipt_id).read(), 'UNKNOWN_RECEIPT');
            assert(!self.receipt_consumed.entry(receipt_id).read(), 'RECEIPT_ALREADY_CONSUMED');
            assert(nullifier != 0, 'ZERO_NULLIFIER');
            assert(!self.used_nullifiers.entry(nullifier).read(), 'NULLIFIER_ALREADY_USED');

            self.receipt_consumed.entry(receipt_id).write(true);
            self.receipt_nullifier.entry(receipt_id).write(nullifier);
            self.used_nullifiers.entry(nullifier).write(true);

            self.emit(ReceiptConsumed { receipt_id, nullifier });
        }

        fn verify_receipt(self: @ContractState, receipt_id: u64) -> bool {
            self.receipt_exists.entry(receipt_id).read() && !self.receipt_consumed.entry(receipt_id).read()
        }

        fn upgrade(ref self: ContractState, new_attester_pubkey: felt252) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');
            assert(new_attester_pubkey != 0, 'ZERO_ATTESTER');

            let old_attester_pubkey = self.attester_pubkey.read();
            self.attester_pubkey.write(new_attester_pubkey);
            self.emit(AttesterUpgraded { old_attester_pubkey, new_attester_pubkey });
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        fn get_attester_pubkey(self: @ContractState) -> felt252 {
            self.attester_pubkey.read()
        }

        fn get_receipt_policy_hash(self: @ContractState, receipt_id: u64) -> felt252 {
            self.receipt_policy_hash.entry(receipt_id).read()
        }

        fn get_receipt_weight(self: @ContractState, receipt_id: u64) -> u128 {
            self.receipt_weight.entry(receipt_id).read()
        }

        fn get_receipt_nullifier(self: @ContractState, receipt_id: u64) -> felt252 {
            self.receipt_nullifier.entry(receipt_id).read()
        }

        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.used_nullifiers.entry(nullifier).read()
        }

        fn is_policy_hash_used(self: @ContractState, policy_hash: felt252) -> bool {
            self.used_policy_hashes.entry(policy_hash).read()
        }

        fn get_next_receipt_id(self: @ContractState) -> u64 {
            self.next_receipt_id.read()
        }
    }
}
