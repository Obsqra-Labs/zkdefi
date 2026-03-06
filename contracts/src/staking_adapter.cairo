// StakingAdapter: Mock strategy adapter for Starknet native staking.
//
// In production this contract would delegate STRK to a validator and earn
// staking rewards. On Sepolia the adapter uses internal bookkeeping so the
// VaultController rebalancing pipeline can operate end-to-end without a
// live staking delegation.

#[starknet::contract]
mod StakingAdapter {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };

    #[storage]
    struct Storage {
        vault_controller: ContractAddress,
        admin: ContractAddress,
        balance: u256,
        position_counter: felt252,
        apy_bps: u32,
        healthy: bool,
    }

    // ── Events ──────────────────────────────────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Deployed: Deployed,
        Withdrawn: Withdrawn,
        Harvested: Harvested,
    }

    #[derive(Drop, starknet::Event)]
    struct Deployed {
        #[key]
        position_id: felt252,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdrawn {
        #[key]
        position_id: felt252,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Harvested {
        amount: u256,
    }

    // ── Constructor ─────────────────────────────────────────────────────

    #[constructor]
    fn constructor(
        ref self: ContractState,
        vault_controller: ContractAddress,
        admin: ContractAddress,
    ) {
        self.vault_controller.write(vault_controller);
        self.admin.write(admin);
        self.balance.write(0);
        self.position_counter.write(0);
        self.apy_bps.write(280); // 2.8 %
        self.healthy.write(true);
    }

    // ── Access helpers ──────────────────────────────────────────────────

    fn assert_vault_controller(self: @ContractState) {
        assert(
            get_caller_address() == self.vault_controller.read(),
            'only vault controller',
        );
    }

    fn assert_admin(self: @ContractState) {
        assert(get_caller_address() == self.admin.read(), 'only admin');
    }

    // ── Admin setters ───────────────────────────────────────────────────

    #[external(v0)]
    fn set_apy_bps(ref self: ContractState, new_apy_bps: u32) {
        assert_admin(@self);
        self.apy_bps.write(new_apy_bps);
    }

    #[external(v0)]
    fn set_unhealthy(ref self: ContractState, unhealthy: bool) {
        assert_admin(@self);
        self.healthy.write(!unhealthy);
    }

    // ── IStrategyAdapter ────────────────────────────────────────────────

    #[abi(embed_v0)]
    impl StakingAdapterImpl of crate::strategy_adapter::IStrategyAdapter<ContractState> {
        fn deploy(ref self: ContractState, amount: u256, params: Span<felt252>) -> felt252 {
            assert_vault_controller(@self);

            let current = self.balance.read();
            self.balance.write(current + amount);

            let counter = self.position_counter.read();
            let new_counter = counter + 1;
            self.position_counter.write(new_counter);

            self.emit(Deployed { position_id: new_counter, amount });
            new_counter
        }

        fn withdraw(ref self: ContractState, position_id: felt252, amount: u256) -> u256 {
            assert_vault_controller(@self);

            let current = self.balance.read();
            assert(current >= amount, 'insufficient balance');
            self.balance.write(current - amount);

            self.emit(Withdrawn { position_id, amount });
            amount
        }

        fn harvest(ref self: ContractState) -> u256 {
            assert_vault_controller(@self);
            let harvested: u256 = 0;
            self.emit(Harvested { amount: harvested });
            harvested
        }

        fn value_of(self: @ContractState) -> u256 {
            self.balance.read()
        }

        fn current_apy_bps(self: @ContractState) -> u32 {
            self.apy_bps.read()
        }

        fn is_healthy(self: @ContractState) -> bool {
            self.healthy.read()
        }
    }
}
