#[starknet::interface]
trait IReceiptRegistry<TContractState> {
    fn issue_attested_receipt(
        ref self: TContractState,
        policy_hash: felt252,
        sig_r: felt252,
        sig_s: felt252,
        weight: u128
    ) -> u64;
    fn consume_receipt(ref self: TContractState, receipt_id: u64, nullifier: felt252);
    fn verify_receipt(self: @TContractState, receipt_id: u64) -> bool;
}

// Placeholder contract body for scaffolding only.
// Implement storage, ecdsa verification, and admin upgrade logic in Phase 2.
