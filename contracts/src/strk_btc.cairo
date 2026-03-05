use starknet::ContractAddress;

#[starknet::interface]
pub trait IStrkBTC<TContractState> {
    fn name(self: @TContractState) -> felt252;
    fn symbol(self: @TContractState) -> felt252;
    fn decimals(self: @TContractState) -> u8;
    fn total_supply(self: @TContractState) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
}

#[starknet::contract]
mod StrkBTC {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        Map, StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess,
    };
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        name: felt252,
        symbol: felt252,
        decimals: u8,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Transfer: Transfer,
        Approval: Approval,
    }

    #[derive(Drop, starknet::Event)]
    struct Transfer {
        #[key]
        from: ContractAddress,
        #[key]
        to: ContractAddress,
        value: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Approval {
        #[key]
        owner: ContractAddress,
        #[key]
        spender: ContractAddress,
        value: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, initial_supply: u256) {
        self.name.write('strkBTC');
        self.symbol.write('strkBTC');
        self.decimals.write(18);
        self.owner.write(owner);
        self.total_supply.write(initial_supply);
        self.balances.write(owner, initial_supply);

        self.emit(Transfer {
            from: Zero::zero(),
            to: owner,
            value: initial_supply,
        });
    }

    #[abi(embed_v0)]
    impl StrkBTCImpl of super::IStrkBTC<ContractState> {
        fn name(self: @ContractState) -> felt252 {
            self.name.read()
        }

        fn symbol(self: @ContractState) -> felt252 {
            self.symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState,
            owner: ContractAddress,
            spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let caller = get_caller_address();
            self._transfer(caller, recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.read((sender, caller));
            assert(current_allowance >= amount, 'insufficient allowance');
            self.allowances.write((sender, caller), current_allowance - amount);
            self._transfer(sender, recipient, amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let caller = get_caller_address();
            self.allowances.write((caller, spender), amount);
            self.emit(Approval { owner: caller, spender, value: amount });
            true
        }

        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), 'only owner can mint');
            let supply = self.total_supply.read();
            self.total_supply.write(supply + amount);
            let balance = self.balances.read(to);
            self.balances.write(to, balance + amount);
            self.emit(Transfer { from: Zero::zero(), to, value: amount });
        }
    }

    #[abi(per_item)]
    #[generate_trait]
    impl StrkBTCCamelImpl of StrkBTCCamelTrait {
        #[external(v0)]
        fn totalSupply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        #[external(v0)]
        fn balanceOf(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        #[external(v0)]
        fn transferFrom(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.read((sender, caller));
            assert(current_allowance >= amount, 'insufficient allowance');
            self.allowances.write((sender, caller), current_allowance - amount);
            self._transfer(sender, recipient, amount);
            true
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _transfer(
            ref self: ContractState,
            from: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) {
            let from_balance = self.balances.read(from);
            assert(from_balance >= amount, 'insufficient balance');
            self.balances.write(from, from_balance - amount);
            let to_balance = self.balances.read(to);
            self.balances.write(to, to_balance + amount);
            self.emit(Transfer { from, to, value: amount });
        }
    }
}
