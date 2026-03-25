#[starknet::interface]
trait IReputationAccumulator<TContractState> {
    fn add_receipt_weight(ref self: TContractState, receipt_id: u64);
    fn get_score(self: @TContractState, user: felt252) -> u128;
}

// Placeholder for v0.1 accumulator. Restrict writes to attester in initial implementation.
