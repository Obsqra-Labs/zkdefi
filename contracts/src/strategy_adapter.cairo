#[starknet::interface]
pub trait IStrategyAdapter<TContractState> {
    /// Deploy capital into this strategy. Returns a position identifier.
    fn deploy(ref self: TContractState, amount: u256, params: Span<felt252>) -> felt252;
    /// Withdraw capital from a position. Returns the amount actually withdrawn.
    fn withdraw(ref self: TContractState, position_id: felt252, amount: u256) -> u256;
    /// Harvest accrued yield. Returns the harvested amount.
    fn harvest(ref self: TContractState) -> u256;
    /// Current total value held by this adapter.
    fn value_of(self: @TContractState) -> u256;
    /// Current estimated APY in basis points (10000 = 100%).
    fn current_apy_bps(self: @TContractState) -> u32;
    /// Whether the underlying protocol is healthy and accepting deposits.
    fn is_healthy(self: @TContractState) -> bool;
}
