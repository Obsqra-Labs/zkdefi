use starknet::ContractAddress;

#[starknet::interface]
pub trait IZkdToken<TContractState> {
    fn name(self: @TContractState) -> felt252;
    fn symbol(self: @TContractState) -> felt252;
    fn decimals(self: @TContractState) -> u8;
    fn total_supply(self: @TContractState) -> u256;
    fn balance_of(self: @TContractState, owner: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, to: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, from: ContractAddress, to: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
    fn burn(ref self: TContractState, from: ContractAddress, amount: u256);
}

// CamelCase interface for Ekubo/DeFi compatibility
#[starknet::interface]
pub trait IZkdTokenCamel<TContractState> {
    fn totalSupply(self: @TContractState) -> u256;
    fn balanceOf(self: @TContractState, account: ContractAddress) -> u256;
    fn transferFrom(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::contract]
pub mod zkd_token {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess, StorageMapWriteAccess, Map};

    #[storage]
    struct Storage {
        owner: ContractAddress,
        token_name: felt252,
        token_symbol: felt252,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        total_supply: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Transfer: Transfer,
        Approval: Approval,
        Mint: Mint,
        Burn: Burn,
    }

    #[derive(Drop, starknet::Event)]
    struct Transfer {
        from: ContractAddress,
        to: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Approval {
        owner: ContractAddress,
        spender: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Mint {
        to: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Burn {
        from: ContractAddress,
        amount: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        token_name: felt252,
        token_symbol: felt252,
    ) {
        self.owner.write(owner);
        self.token_name.write(token_name);
        self.token_symbol.write(token_symbol);
        self.total_supply.write(0);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_owner(self: @ContractState) {
            let caller = get_caller_address();
            let owner = self.owner.read();
            assert(caller == owner, 'NOT_OWNER');
        }
    }

    #[abi(embed_v0)]
    impl ZkdTokenImpl of super::IZkdToken<ContractState> {
        fn name(self: @ContractState) -> felt252 {
            self.token_name.read()
        }

        fn symbol(self: @ContractState) -> felt252 {
            self.token_symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            18_u8
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, owner: ContractAddress) -> u256 {
            self.balances.read(owner)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, to: ContractAddress, amount: u256) -> bool {
            let from = get_caller_address();
            let from_balance = self.balances.read(from);
            assert(from_balance >= amount, 'INSUFFICIENT_BAL');
            self.balances.write(from, from_balance - amount);
            let to_balance = self.balances.read(to);
            self.balances.write(to, to_balance + amount);
            self.emit(Event::Transfer(Transfer { from, to, amount }));
            true
        }

        fn transfer_from(
            ref self: ContractState,
            from: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.read((from, caller));
            assert(current_allowance >= amount, 'INSUFFICIENT_ALLOWANCE');
            self.allowances.write((from, caller), current_allowance - amount);

            let from_balance = self.balances.read(from);
            assert(from_balance >= amount, 'INSUFFICIENT_BAL');
            self.balances.write(from, from_balance - amount);
            let to_balance = self.balances.read(to);
            self.balances.write(to, to_balance + amount);
            self.emit(Event::Transfer(Transfer { from, to, amount }));
            true
        }

        fn approve(
            ref self: ContractState, spender: ContractAddress, amount: u256,
        ) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            self.emit(Event::Approval(Approval { owner, spender, amount }));
            true
        }

        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.assert_owner();
            let bal = self.balances.read(to);
            self.balances.write(to, bal + amount);
            let supply = self.total_supply.read();
            self.total_supply.write(supply + amount);
            self.emit(Event::Mint(Mint { to, amount }));
        }

        fn burn(ref self: ContractState, from: ContractAddress, amount: u256) {
            self.assert_owner();
            let bal = self.balances.read(from);
            assert(bal >= amount, 'BURN_EXCEEDS_BAL');
            self.balances.write(from, bal - amount);
            let supply = self.total_supply.read();
            self.total_supply.write(supply - amount);
            self.emit(Event::Burn(Burn { from, amount }));
        }
    }

    // CamelCase aliases required by Ekubo and other DeFi protocols
    #[abi(embed_v0)]
    impl ZkdTokenCamelImpl of super::IZkdTokenCamel<ContractState> {
        fn totalSupply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balanceOf(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn transferFrom(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.read((sender, caller));
            assert(current_allowance >= amount, 'INSUFFICIENT_ALLOWANCE');
            self.allowances.write((sender, caller), current_allowance - amount);

            let from_balance = self.balances.read(sender);
            assert(from_balance >= amount, 'INSUFFICIENT_BAL');
            self.balances.write(sender, from_balance - amount);
            let to_balance = self.balances.read(recipient);
            self.balances.write(recipient, to_balance + amount);
            self.emit(Event::Transfer(Transfer { from: sender, to: recipient, amount }));
            true
        }
    }
}
