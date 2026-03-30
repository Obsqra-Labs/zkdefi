use core::traits::TryInto;
use receipt_archive_v01::receipt_archive::{
    IReceiptArchiveDispatcher, IReceiptArchiveDispatcherTrait,
};
use snforge_std::cheatcodes::contract_class::DeclareResultTrait;
use snforge_std::{ContractClassTrait, declare, start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;

fn admin() -> ContractAddress {
    0x111.try_into().unwrap()
}

fn attacker() -> ContractAddress {
    0x222.try_into().unwrap()
}

fn deploy_archive() -> IReceiptArchiveDispatcher {
    let contract = declare("ReceiptArchive").unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@array![admin().into()]).unwrap();
    IReceiptArchiveDispatcher { contract_address }
}

#[test]
fn stores_anchor_for_receipt() {
    let archive = deploy_archive();
    start_cheat_caller_address(archive.contract_address, admin());
    archive.anchor_cid(1, 0x123);
    stop_cheat_caller_address(archive.contract_address);
    assert(archive.get_cid_anchor(1) == 0x123, 'ANCHOR_MISMATCH');
}

#[test]
fn admin_matches_constructor() {
    let archive = deploy_archive();
    assert(archive.get_admin() == admin(), 'ADMIN_MISMATCH');
}

#[test]
fn same_anchor_can_be_replayed_idempotently() {
    let archive = deploy_archive();
    start_cheat_caller_address(archive.contract_address, admin());
    archive.anchor_cid(7, 0xabc);
    archive.anchor_cid(7, 0xabc);
    stop_cheat_caller_address(archive.contract_address);
    assert(archive.get_cid_anchor(7) == 0xabc, 'EXPECTED_IDEMPOTENT_ANCHOR');
}

#[test]
#[should_panic(expected: ('ONLY_ADMIN',))]
fn non_admin_cannot_anchor() {
    let archive = deploy_archive();
    start_cheat_caller_address(archive.contract_address, attacker());
    archive.anchor_cid(1, 0x123);
}

#[test]
#[should_panic(expected: ('INVALID_RECEIPT_ID',))]
fn zero_receipt_id_rejected() {
    let archive = deploy_archive();
    start_cheat_caller_address(archive.contract_address, admin());
    archive.anchor_cid(0, 0x123);
}

#[test]
#[should_panic(expected: ('ZERO_CID_HASH',))]
fn zero_cid_hash_rejected() {
    let archive = deploy_archive();
    start_cheat_caller_address(archive.contract_address, admin());
    archive.anchor_cid(1, 0);
}

#[test]
#[should_panic(expected: ('CID_ALREADY_ANCHORED',))]
fn different_anchor_for_same_receipt_is_rejected() {
    let archive = deploy_archive();
    start_cheat_caller_address(archive.contract_address, admin());
    archive.anchor_cid(1, 0x123);
    archive.anchor_cid(1, 0x456);
}
