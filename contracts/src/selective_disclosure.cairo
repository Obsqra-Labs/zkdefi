// Selective disclosure: register and query disclosure proofs (statement_type, threshold, result, proof_hash).
use starknet::ContractAddress;
use starknet::get_caller_address;

#[starknet::interface]
pub trait IFactRegistry<TContractState> {
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct DisclosureRecord {
    pub statement_type: felt252,
    pub threshold: u256,
    pub result: felt252,
    pub proof_hash: felt252,
    pub user: ContractAddress,
    pub timestamp: u64,
}

#[starknet::interface]
pub trait ISelectiveDisclosure<TContractState> {
    fn register_disclosure(
        ref self: TContractState,
        statement_type: felt252,
        threshold: u256,
        result: felt252,
        proof_hash: felt252
    );
    fn get_disclosure(self: @TContractState, record_id: felt252) -> DisclosureRecord;
    fn get_user_disclosure_count(self: @TContractState, user: ContractAddress) -> u64;
    fn get_user_disclosure_at(
        self: @TContractState,
        user: ContractAddress,
        index: u64
    ) -> felt252;
}

#[starknet::contract]
mod SelectiveDisclosure {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };

    use super::IFactRegistryDispatcher;
    use super::IFactRegistryDispatcherTrait;
    use super::DisclosureRecord;

    #[storage]
    struct Storage {
        fact_registry: ContractAddress,
        records: Map<felt252, DisclosureRecord>,
        user_record_count: Map<ContractAddress, u64>,
        user_record_at: Map<(ContractAddress, u64), felt252>,
        next_id: u64,
        admin: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, fact_registry: ContractAddress, admin: ContractAddress) {
        self.fact_registry.write(fact_registry);
        self.admin.write(admin);
        self.next_id.write(1);
    }

    #[abi(embed_v0)]
    impl SelectiveDisclosureImpl of super::ISelectiveDisclosure<ContractState> {
        fn register_disclosure(
            ref self: ContractState,
            statement_type: felt252,
            threshold: u256,
            result: felt252,
            proof_hash: felt252
        ) {
            let registry = IFactRegistryDispatcher { contract_address: self.fact_registry.read() };
            assert(registry.is_valid(proof_hash), 'Invalid proof');

            let caller = get_caller_address();
            let id = self.next_id.read();
            self.next_id.write(id + 1);
            let record_id = id.into();

            let record = DisclosureRecord {
                statement_type,
                threshold,
                result,
                proof_hash,
                user: caller,
                timestamp: get_block_timestamp(),
            };
            self.records.write(record_id, record);

            let count = self.user_record_count.read(caller);
            self.user_record_at.write((caller, count), record_id);
            self.user_record_count.write(caller, count + 1);
        }

        fn get_disclosure(self: @ContractState, record_id: felt252) -> DisclosureRecord {
            self.records.read(record_id)
        }

        fn get_user_disclosure_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_record_count.read(user)
        }

        fn get_user_disclosure_at(
            self: @ContractState,
            user: ContractAddress,
            index: u64
        ) -> felt252 {
            self.user_record_at.read((user, index))
        }
    }
}
