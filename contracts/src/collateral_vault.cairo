// CollateralVault: On-chain collateral lockup for lending.
//
// Users deposit ERC20 tokens as collateral. Positions can be flexible (core)
// or time-locked (boost) for higher credit-line weight. The LendingPool
// contract can slash collateral on liquidation.

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct CollateralPosition {
    pub user: ContractAddress,
    pub token: ContractAddress,
    pub amount: u256,
    pub locked_until: u64,
    pub pool_tier: felt252,
    pub created_at: u64,
    pub active: bool,
}

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait ICollateralVault<TContractState> {
    fn deposit_collateral(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        pool_tier: felt252,
    ) -> u64;

    fn withdraw_collateral(ref self: TContractState, position_id: u64);

    fn get_position(self: @TContractState, position_id: u64) -> CollateralPosition;

    fn get_user_collateral(self: @TContractState, user: ContractAddress) -> u256;

    fn get_user_collateral_by_token(
        self: @TContractState,
        user: ContractAddress,
        token: ContractAddress,
    ) -> u256;

    fn get_user_position_count(self: @TContractState, user: ContractAddress) -> u64;

    fn get_user_position_at(self: @TContractState, user: ContractAddress, index: u64) -> u64;

    fn is_locked(self: @TContractState, position_id: u64) -> bool;

    fn slash(
        ref self: TContractState,
        user: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
    );

    fn set_lending_pool(ref self: TContractState, lending_pool: ContractAddress);

    fn get_boost_lock_duration(self: @TContractState) -> u64;

    fn set_boost_lock_duration(ref self: TContractState, duration: u64);
}

#[starknet::contract]
mod CollateralVault {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        contract_address_const,
    };
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use core::num::traits::Zero;

    use super::{CollateralPosition, IERC20Dispatcher, IERC20DispatcherTrait};

    const CORE_TIER: felt252 = 'core';
    const BOOST_TIER: felt252 = 'boost';
    const DEFAULT_BOOST_LOCK_SECONDS: u64 = 604800; // 7 days

    #[storage]
    struct Storage {
        admin: ContractAddress,
        lending_pool: ContractAddress,
        boost_lock_duration: u64,
        next_position_id: u64,
        positions: Map<u64, CollateralPosition>,
        user_total_collateral: Map<ContractAddress, u256>,
        user_token_collateral: Map<(ContractAddress, ContractAddress), u256>,
        user_position_count: Map<ContractAddress, u64>,
        user_positions: Map<(ContractAddress, u64), u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CollateralDeposited: CollateralDeposited,
        CollateralWithdrawn: CollateralWithdrawn,
        CollateralSlashed: CollateralSlashed,
    }

    #[derive(Drop, starknet::Event)]
    struct CollateralDeposited {
        #[key]
        user: ContractAddress,
        position_id: u64,
        token: ContractAddress,
        amount: u256,
        pool_tier: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct CollateralWithdrawn {
        #[key]
        user: ContractAddress,
        position_id: u64,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct CollateralSlashed {
        #[key]
        user: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        self.boost_lock_duration.write(DEFAULT_BOOST_LOCK_SECONDS);
        self.next_position_id.write(1);
        self.lending_pool.write(contract_address_const::<0>());
    }

    #[abi(embed_v0)]
    impl CollateralVaultImpl of super::ICollateralVault<ContractState> {
        fn deposit_collateral(
            ref self: ContractState,
            token: ContractAddress,
            amount: u256,
            pool_tier: felt252,
        ) -> u64 {
            assert(amount > 0, 'amount must be > 0');
            assert(
                pool_tier == CORE_TIER || pool_tier == BOOST_TIER,
                'invalid pool tier',
            );

            let caller = get_caller_address();
            let now = get_block_timestamp();

            let erc20 = IERC20Dispatcher { contract_address: token };
            let ok = erc20.transfer_from(caller, starknet::get_contract_address(), amount);
            assert(ok, 'transfer_from failed');

            let locked_until = if pool_tier == BOOST_TIER {
                now + self.boost_lock_duration.read()
            } else {
                0_u64
            };

            let pos_id = self.next_position_id.read();
            self.next_position_id.write(pos_id + 1);

            let position = CollateralPosition {
                user: caller,
                token,
                amount,
                locked_until,
                pool_tier,
                created_at: now,
                active: true,
            };
            self.positions.write(pos_id, position);

            let prev_total = self.user_total_collateral.read(caller);
            self.user_total_collateral.write(caller, prev_total + amount);

            let prev_token = self.user_token_collateral.read((caller, token));
            self.user_token_collateral.write((caller, token), prev_token + amount);

            let count = self.user_position_count.read(caller);
            self.user_positions.write((caller, count), pos_id);
            self.user_position_count.write(caller, count + 1);

            self.emit(CollateralDeposited {
                user: caller,
                position_id: pos_id,
                token,
                amount,
                pool_tier,
            });

            pos_id
        }

        fn withdraw_collateral(ref self: ContractState, position_id: u64) {
            let pos = self.positions.read(position_id);
            let caller = get_caller_address();
            assert(pos.user == caller, 'not owner');
            assert(pos.active, 'position inactive');

            let now = get_block_timestamp();
            if pos.locked_until > 0 {
                assert(now >= pos.locked_until, 'still locked');
            }

            let erc20 = IERC20Dispatcher { contract_address: pos.token };
            let ok = erc20.transfer(caller, pos.amount);
            assert(ok, 'transfer failed');

            let mut updated = pos;
            updated.active = false;
            self.positions.write(position_id, updated);

            let prev_total = self.user_total_collateral.read(caller);
            if prev_total >= pos.amount {
                self.user_total_collateral.write(caller, prev_total - pos.amount);
            } else {
                self.user_total_collateral.write(caller, 0);
            }

            let prev_token = self.user_token_collateral.read((caller, pos.token));
            if prev_token >= pos.amount {
                self.user_token_collateral.write((caller, pos.token), prev_token - pos.amount);
            } else {
                self.user_token_collateral.write((caller, pos.token), 0);
            }

            self.emit(CollateralWithdrawn {
                user: caller,
                position_id,
                amount: pos.amount,
            });
        }

        fn get_position(self: @ContractState, position_id: u64) -> CollateralPosition {
            self.positions.read(position_id)
        }

        fn get_user_collateral(self: @ContractState, user: ContractAddress) -> u256 {
            self.user_total_collateral.read(user)
        }

        fn get_user_collateral_by_token(
            self: @ContractState,
            user: ContractAddress,
            token: ContractAddress,
        ) -> u256 {
            self.user_token_collateral.read((user, token))
        }

        fn get_user_position_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_position_count.read(user)
        }

        fn get_user_position_at(
            self: @ContractState,
            user: ContractAddress,
            index: u64,
        ) -> u64 {
            self.user_positions.read((user, index))
        }

        fn is_locked(self: @ContractState, position_id: u64) -> bool {
            let pos = self.positions.read(position_id);
            if !pos.active {
                return false;
            }
            if pos.locked_until == 0 {
                return false;
            }
            get_block_timestamp() < pos.locked_until
        }

        fn slash(
            ref self: ContractState,
            user: ContractAddress,
            amount: u256,
            recipient: ContractAddress,
        ) {
            let caller = get_caller_address();
            let lp = self.lending_pool.read();
            let adm = self.admin.read();
            assert(caller == lp || caller == adm, 'unauthorized slash');

            let total = self.user_total_collateral.read(user);
            let slash_amount = if amount > total { total } else { amount };
            assert(slash_amount > 0, 'nothing to slash');

            self.user_total_collateral.write(user, total - slash_amount);

            let count = self.user_position_count.read(user);
            let mut remaining = slash_amount;
            let mut i: u64 = 0;
            while i < count && remaining > 0 {
                let pid = self.user_positions.read((user, i));
                let pos = self.positions.read(pid);
                if pos.active && pos.amount > 0 {
                    if pos.amount <= remaining {
                        remaining -= pos.amount;
                        let mut p = pos;
                        p.active = false;
                        self.positions.write(pid, p);

                        let pt = self.user_token_collateral.read((user, pos.token));
                        if pt >= pos.amount {
                            self.user_token_collateral.write((user, pos.token), pt - pos.amount);
                        }

                        let erc20 = IERC20Dispatcher { contract_address: pos.token };
                        erc20.transfer(recipient, pos.amount);
                    } else {
                        let mut p = pos;
                        p.amount -= remaining;
                        self.positions.write(pid, p);

                        let pt = self.user_token_collateral.read((user, pos.token));
                        if pt >= remaining {
                            self.user_token_collateral.write((user, pos.token), pt - remaining);
                        }

                        let erc20 = IERC20Dispatcher { contract_address: pos.token };
                        erc20.transfer(recipient, remaining);
                        remaining = 0;
                    }
                }
                i += 1;
            };

            self.emit(CollateralSlashed {
                user,
                amount: slash_amount,
                recipient,
            });
        }

        fn set_lending_pool(ref self: ContractState, lending_pool: ContractAddress) {
            assert(get_caller_address() == self.admin.read(), 'admin only');
            self.lending_pool.write(lending_pool);
        }

        fn get_boost_lock_duration(self: @ContractState) -> u64 {
            self.boost_lock_duration.read()
        }

        fn set_boost_lock_duration(ref self: ContractState, duration: u64) {
            assert(get_caller_address() == self.admin.read(), 'admin only');
            self.boost_lock_duration.write(duration);
        }
    }
}
