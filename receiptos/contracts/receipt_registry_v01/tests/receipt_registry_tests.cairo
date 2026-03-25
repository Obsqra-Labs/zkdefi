use core::ecdsa::check_ecdsa_signature;
use core::result::ResultTrait;
use core::traits::TryInto;
use receipt_registry_v01::receipt_registry::{
    IReceiptRegistryDispatcher, IReceiptRegistryDispatcherTrait,
};
use snforge_std::cheatcodes::contract_class::DeclareResultTrait;
use snforge_std::{ContractClassTrait, declare, start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;

fn admin() -> ContractAddress {
    0x111.try_into().unwrap()
}

fn user() -> ContractAddress {
    0x222.try_into().unwrap()
}

fn other_user() -> ContractAddress {
    0x333.try_into().unwrap()
}

fn attacker() -> ContractAddress {
    0x444.try_into().unwrap()
}

// Produced by TypeScript using starknet@6.11.0:
//   ec.starkCurve.getStarkKey("0x12345")
//   ec.starkCurve.sign("0x12f6c11739eb6a8992e87dfe47d97453d4e0d2845140e3d566154e9e82114f6", "0x12345")
const JS_POLICY_HASH: felt252 = 0x12f6c11739eb6a8992e87dfe47d97453d4e0d2845140e3d566154e9e82114f6;
const JS_PUBLIC_KEY_X: felt252 = 0x2f8ffcb446d2a062ef18561eb507b08ea01d52d4c594e90cfca47f075cb952;
const JS_SIG_R: felt252 = 0x66693e63a92f664a568afab13c7e0899dd26e2a12c9302af145a32097174387;
const JS_SIG_S: felt252 = 0x513136e43c19d9d02a2d9280dfabe8cef2c47acce35c020d92b867ef0e35f66;
const SECOND_JS_SIG_R: felt252 = 0x4ed686d133f97d45fad47ee9a8496b9abd8e1b100697860e9e60f5c45b44155;
const SECOND_JS_SIG_S: felt252 = 0x71db2349c4961f0fd9db74dd93536998ae1b731e5a818ed64cc8c27b9925c9d;
const OTHER_PUBLIC_KEY_X: felt252 = 0x5faecda33ecb07c8fca7dbb191ffe4677c6942a251a32f6051485253c52e129;
const OTHER_SIG_R: felt252 = 0x2fbc730e2fe7f6770d2619ec202a4c0d96a712be5ec2b46f80348d9db197024;
const OTHER_SIG_S: felt252 = 0x0d743e7486032c34a61afd033246c0de14be5437e7a6c80a486496d84ecdf5e;

fn deploy_registry(attester_pubkey: felt252) -> IReceiptRegistryDispatcher {
    let contract = declare("ReceiptRegistry").unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@array![attester_pubkey, admin().into()]).unwrap();
    IReceiptRegistryDispatcher { contract_address }
}

#[test]
fn cross_language_js_signature_verifies_in_cairo() {
    assert(check_ecdsa_signature(JS_POLICY_HASH, JS_PUBLIC_KEY_X, JS_SIG_R, JS_SIG_S), 'JS_SIG_INVALID');
}

#[test]
fn issue_valid_receipt_returns_id_1() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    let receipt_id = registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
    assert(receipt_id == 1, 'EXPECTED_ID_1');
}

#[test]
fn issue_two_valid_receipts_increments_ids() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    let id1 = registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
    let id2 = registry.issue_attested_receipt(0x12345, SECOND_JS_SIG_R, SECOND_JS_SIG_S, 200);
    assert(id1 == 1, 'ID1');
    assert(id2 == 2, 'ID2');
    assert(registry.get_next_receipt_id() == 3, 'NEXT_ID');
}

#[test]
fn verify_receipt_true_after_issue() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    let receipt_id = registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
    assert(registry.verify_receipt(receipt_id), 'RECEIPT_SHOULD_VERIFY');
}

#[test]
fn verify_receipt_false_for_unknown_receipt() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    assert(!registry.verify_receipt(999), 'UNKNOWN_SHOULD_BE_FALSE');
}

#[test]
fn stores_policy_hash_and_weight() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    let receipt_id = registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 987);
    assert(registry.get_receipt_policy_hash(receipt_id) == JS_POLICY_HASH, 'HASH_MISMATCH');
    assert(registry.get_receipt_weight(receipt_id) == 987, 'WEIGHT_MISMATCH');
}

#[test]
fn policy_hash_marked_used_after_issue() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
    assert(registry.is_policy_hash_used(JS_POLICY_HASH), 'POLICY_HASH_NOT_MARKED');
}

#[test]
#[should_panic(expected: ('ZERO_POLICY_HASH',))]
fn zero_policy_hash_rejected() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    registry.issue_attested_receipt(0, JS_SIG_R, JS_SIG_S, 100);
}

#[test]
#[should_panic(expected: ('ZERO_WEIGHT',))]
fn zero_weight_rejected() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 0);
}

#[test]
#[should_panic(expected: ('INVALID_SIGNATURE',))]
fn invalid_signature_rejected() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R + 1, JS_SIG_S, 100);
}

#[test]
#[should_panic(expected: ('POLICY_HASH_REPLAY',))]
fn duplicate_policy_hash_rejected() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
    registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
}

#[test]
fn consume_receipt_marks_it_invalid() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    let receipt_id = registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
    registry.consume_receipt(receipt_id, 0xabc);
    assert(!registry.verify_receipt(receipt_id), 'CONSUMED_SHOULD_BE_FALSE');
    assert(registry.get_receipt_nullifier(receipt_id) == 0xabc, 'NULLIFIER_STORED');
    assert(registry.is_nullifier_used(0xabc), 'NULLIFIER_USED');
}

#[test]
#[should_panic(expected: ('UNKNOWN_RECEIPT',))]
fn consume_unknown_receipt_rejected() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    registry.consume_receipt(999, 0xabc);
}

#[test]
#[should_panic(expected: ('RECEIPT_ALREADY_CONSUMED',))]
fn consume_same_receipt_twice_rejected() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    let receipt_id = registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
    registry.consume_receipt(receipt_id, 0xabc);
    registry.consume_receipt(receipt_id, 0xdef);
}

#[test]
#[should_panic(expected: ('ZERO_NULLIFIER',))]
fn zero_nullifier_rejected() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    let receipt_id = registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
    registry.consume_receipt(receipt_id, 0);
}

#[test]
#[should_panic(expected: ('NULLIFIER_ALREADY_USED',))]
fn nullifier_reuse_rejected() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    let first = registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
    let second = registry.issue_attested_receipt(0x12345, SECOND_JS_SIG_R, SECOND_JS_SIG_S, 100);
    registry.consume_receipt(first, 0xaaa);
    registry.consume_receipt(second, 0xaaa);
}

#[test]
fn get_admin_and_attester_match_constructor() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    assert(registry.get_admin() == admin(), 'ADMIN_MISMATCH');
    assert(registry.get_attester_pubkey() == JS_PUBLIC_KEY_X, 'ATTESTER_MISMATCH');
}

#[test]
fn admin_can_upgrade_attester_key() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    start_cheat_caller_address(registry.contract_address, admin());
    registry.upgrade(OTHER_PUBLIC_KEY_X);
    stop_cheat_caller_address(registry.contract_address);
    assert(registry.get_attester_pubkey() == OTHER_PUBLIC_KEY_X, 'UPGRADE_FAILED');
}

#[test]
#[should_panic(expected: ('ONLY_ADMIN',))]
fn non_admin_cannot_upgrade_attester_key() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    start_cheat_caller_address(registry.contract_address, attacker());
    registry.upgrade(OTHER_PUBLIC_KEY_X);
}

#[test]
#[should_panic(expected: ('ZERO_ATTESTER',))]
fn admin_cannot_upgrade_to_zero_attester() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    start_cheat_caller_address(registry.contract_address, admin());
    registry.upgrade(0);
}

#[test]
#[should_panic(expected: ('INVALID_SIGNATURE',))]
fn old_signature_invalid_after_upgrade() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    start_cheat_caller_address(registry.contract_address, admin());
    registry.upgrade(OTHER_PUBLIC_KEY_X);
    stop_cheat_caller_address(registry.contract_address);
    registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 100);
}

#[test]
fn new_signature_valid_after_upgrade() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    start_cheat_caller_address(registry.contract_address, admin());
    registry.upgrade(OTHER_PUBLIC_KEY_X);
    stop_cheat_caller_address(registry.contract_address);
    let receipt_id = registry.issue_attested_receipt(0x98765, OTHER_SIG_R, OTHER_SIG_S, 50);
    assert(receipt_id == 1, 'UPGRADED_SIG_SHOULD_WORK');
}

#[test]
fn different_valid_signatures_can_issue_multiple_receipts() {
    let registry = deploy_registry(JS_PUBLIC_KEY_X);
    let first = registry.issue_attested_receipt(JS_POLICY_HASH, JS_SIG_R, JS_SIG_S, 10);
    let second = registry.issue_attested_receipt(0x12345, SECOND_JS_SIG_R, SECOND_JS_SIG_S, 20);
    assert(first == 1, 'FIRST_ID');
    assert(second == 2, 'SECOND_ID');
}