#[starknet::interface]
pub trait IReceiptArchive<TContractState> {
    fn anchor_cid(ref self: TContractState, receipt_id: u64, cid_hash: felt252);
    fn get_cid_anchor(self: @TContractState, receipt_id: u64) -> felt252;
    fn get_admin(self: @TContractState) -> starknet::ContractAddress;
    fn upgrade_class(ref self: TContractState, new_class_hash: starknet::ClassHash);
}

#[starknet::contract]
pub mod ReceiptArchive {
    use starknet::ContractAddress;
    use starknet::ClassHash;
    use starknet::get_caller_address;
    use starknet::SyscallResultTrait;
    use starknet::syscalls::replace_class_syscall;
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
        ClassUpgraded: ClassUpgraded,
    }

    #[derive(Drop, starknet::Event)]
    struct CidAnchored {
        #[key]
        receipt_id: u64,
        #[key]
        cid_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct ClassUpgraded {
        new_class_hash: ClassHash,
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

        fn upgrade_class(ref self: ContractState, new_class_hash: ClassHash) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'ONLY_ADMIN');
            replace_class_syscall(new_class_hash).unwrap_syscall();
            self.emit(ClassUpgraded { new_class_hash });
        }
    }
}
