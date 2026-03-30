#[starknet::interface]
pub trait IReceiptArchive<TContractState> {
    fn anchor_cid(ref self: TContractState, receipt_id: u64, cid_hash: felt252);
    fn get_cid_anchor(self: @TContractState, receipt_id: u64) -> felt252;
    fn get_admin(self: @TContractState) -> starknet::ContractAddress;
}

#[starknet::contract]
pub mod ReceiptArchive {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        cid_anchors: Map<u64, felt252>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CidAnchored: CidAnchored,
    }

    #[derive(Drop, starknet::Event)]
    struct CidAnchored {
        #[key]
        receipt_id: u64,
        #[key]
        cid_hash: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
    }

    #[abi(embed_v0)]
    impl ReceiptArchiveImpl of super::IReceiptArchive<ContractState> {
        fn anchor_cid(ref self: ContractState, receipt_id: u64, cid_hash: felt252) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');
            assert(receipt_id > 0, 'INVALID_RECEIPT_ID');
            assert(cid_hash != 0, 'ZERO_CID_HASH');

            let current = self.cid_anchors.entry(receipt_id).read();
            assert(current == 0 || current == cid_hash, 'CID_ALREADY_ANCHORED');

            self.cid_anchors.entry(receipt_id).write(cid_hash);
            self.emit(CidAnchored { receipt_id, cid_hash });
        }

        fn get_cid_anchor(self: @ContractState, receipt_id: u64) -> felt252 {
            self.cid_anchors.entry(receipt_id).read()
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }
    }
}
