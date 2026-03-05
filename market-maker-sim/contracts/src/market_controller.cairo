use starknet::ContractAddress;

#[starknet::interface]
pub trait IMarketController<TContractState> {
    fn set_peg(ref self: TContractState, peg_price_x18: u256);
    fn set_bots_enabled(ref self: TContractState, enabled: bool);
    fn mint_synthetic(
        ref self: TContractState, token: ContractAddress, to: ContractAddress, amount: u256,
    );
    fn burn_synthetic(
        ref self: TContractState, token: ContractAddress, from: ContractAddress, amount: u256,
    );
    fn get_state(self: @TContractState) -> (ContractAddress, ContractAddress, u256, bool);
}

#[starknet::contract]
pub mod market_controller {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[starknet::interface]
    trait IToken<TContractState> {
        fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
        fn burn(ref self: TContractState, from: ContractAddress, amount: u256);
    }

    #[storage]
    struct Storage {
        owner: ContractAddress,
        zkdeth: ContractAddress,
        zkdai: ContractAddress,
        peg_price_x18: u256,
        bots_enabled: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        PegUpdated: PegUpdated,
        BotsToggled: BotsToggled,
        SyntheticMinted: SyntheticMinted,
        SyntheticBurned: SyntheticBurned,
    }

    #[derive(Drop, starknet::Event)]
    struct PegUpdated {
        peg_price_x18: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct BotsToggled {
        enabled: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct SyntheticMinted {
        token: ContractAddress,
        to: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct SyntheticBurned {
        token: ContractAddress,
        from: ContractAddress,
        amount: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        zkdeth: ContractAddress,
        zkdai: ContractAddress,
        peg_price_x18: u256,
    ) {
        self.owner.write(owner);
        self.zkdeth.write(zkdeth);
        self.zkdai.write(zkdai);
        self.peg_price_x18.write(peg_price_x18);
        self.bots_enabled.write(true);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
        }
    }

    #[abi(embed_v0)]
    impl MarketControllerImpl of super::IMarketController<ContractState> {
        fn set_peg(ref self: ContractState, peg_price_x18: u256) {
            self.assert_owner();
            self.peg_price_x18.write(peg_price_x18);
            self.emit(Event::PegUpdated(PegUpdated { peg_price_x18 }));
        }

        fn set_bots_enabled(ref self: ContractState, enabled: bool) {
            self.assert_owner();
            self.bots_enabled.write(enabled);
            self.emit(Event::BotsToggled(BotsToggled { enabled }));
        }

        fn mint_synthetic(
            ref self: ContractState, token: ContractAddress, to: ContractAddress, amount: u256,
        ) {
            self.assert_owner();
            let dispatcher = ITokenDispatcher { contract_address: token };
            dispatcher.mint(to, amount);
            self.emit(Event::SyntheticMinted(SyntheticMinted { token, to, amount }));
        }

        fn burn_synthetic(
            ref self: ContractState, token: ContractAddress, from: ContractAddress, amount: u256,
        ) {
            self.assert_owner();
            let dispatcher = ITokenDispatcher { contract_address: token };
            dispatcher.burn(from, amount);
            self.emit(Event::SyntheticBurned(SyntheticBurned { token, from, amount }));
        }

        fn get_state(self: @ContractState) -> (ContractAddress, ContractAddress, u256, bool) {
            (
                self.zkdeth.read(),
                self.zkdai.read(),
                self.peg_price_x18.read(),
                self.bots_enabled.read(),
            )
        }
    }
}
