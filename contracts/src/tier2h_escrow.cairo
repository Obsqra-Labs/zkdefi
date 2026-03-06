// Tier-2H Escrow: verifies claim hash exists in Pool D and pays out to ConfidentialTransfer.
// - No direct recipient transfer; payout is a shielded deposit.
// - Amount remains public in ConfidentialTransfer (current limitation).

use starknet::ContractAddress;

#[starknet::interface]
pub trait IHashedWithdrawPoolU256<TContractState> {
    fn is_claimed_u256(self: @TContractState, claim_low: u128, claim_high: u128) -> bool;
}

#[starknet::interface]
pub trait IConfidentialTransferU256<TContractState> {
    fn private_deposit_u256(
        ref self: TContractState,
        commitment_low: u128,
        commitment_high: u128,
        amount_public: u256,
        proof_calldata: Span<felt252>
    );
}

#[starknet::interface]
pub trait ITier2HEscrowU256<TContractState> {
    fn fund(ref self: TContractState, amount: u256);

    fn payout_claim_u256(
        ref self: TContractState,
        claim_low: u128,
        claim_high: u128,
        amount: u256,
        commitment_low: u128,
        commitment_high: u128,
        proof_calldata: Span<felt252>
    );

    fn is_paid_u256(self: @TContractState, claim_low: u128, claim_high: u128) -> bool;
    fn get_pool(self: @TContractState) -> ContractAddress;
    fn get_token(self: @TContractState) -> ContractAddress;
    fn get_confidential_transfer(self: @TContractState) -> ContractAddress;
    fn get_admin(self: @TContractState) -> ContractAddress;

    fn set_confidential_transfer(ref self: TContractState, addr: ContractAddress);
    fn set_admin(ref self: TContractState, admin: ContractAddress);
}

#[starknet::contract]
mod Tier2HEscrow {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::{
        ContractAddress, get_caller_address, get_contract_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };

    use super::IHashedWithdrawPoolU256Dispatcher;
    use super::IHashedWithdrawPoolU256DispatcherTrait;
    use super::IConfidentialTransferU256Dispatcher;
    use super::IConfidentialTransferU256DispatcherTrait;
    use crate::erc20_interface::IERC20Dispatcher;
    use crate::erc20_interface::IERC20DispatcherTrait;

    #[storage]
    struct Storage {
        pool: ContractAddress,
        token: ContractAddress,
        confidential_transfer: ContractAddress,
        admin: ContractAddress,

        paid: Map<felt252, bool>,
        paid_low: Map<felt252, u128>,
        paid_high: Map<felt252, u128>,

        total_paid: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Funded: Funded,
        ClaimPaid: ClaimPaid,
    }

    #[derive(Drop, starknet::Event)]
    struct Funded {
        #[key]
        from: ContractAddress,
        amount: u256,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct ClaimPaid {
        #[key]
        claim_low: u128,
        #[key]
        claim_high: u128,
        commitment_low: u128,
        commitment_high: u128,
        amount: u256,
        timestamp: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        confidential_transfer: ContractAddress,
        token: ContractAddress,
        admin: ContractAddress
    ) {
        self.pool.write(pool);
        self.confidential_transfer.write(confidential_transfer);
        self.token.write(token);
        self.admin.write(admin);
        self.total_paid.write(0);
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn assert_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Admin only');
        }

        fn claim_key(self: @ContractState, low: u128, high: u128) -> felt252 {
            let arr = array![low.into(), high.into()];
            poseidon_hash_span(arr.span())
        }
    }

    #[abi(embed_v0)]
    impl Tier2HEscrowU256Impl of super::ITier2HEscrowU256<ContractState> {
        fn fund(ref self: ContractState, amount: u256) {
            assert(amount > 0, 'Amount required');
            let caller = get_caller_address();
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.transfer_from(caller, get_contract_address(), amount);
            assert(ok, 'Transfer failed');
            let timestamp = get_block_timestamp();
            self.emit(Funded { from: caller, amount, timestamp });
        }

        fn payout_claim_u256(
            ref self: ContractState,
            claim_low: u128,
            claim_high: u128,
            amount: u256,
            commitment_low: u128,
            commitment_high: u128,
            proof_calldata: Span<felt252>
        ) {
            self.assert_admin();
            assert(amount > 0, 'Amount required');

            let pool_addr = self.pool.read();
            assert(!pool_addr.is_zero(), 'Pool required');
            let pool = IHashedWithdrawPoolU256Dispatcher { contract_address: pool_addr };
            let claimed = pool.is_claimed_u256(claim_low, claim_high);
            assert(claimed, 'Claim not registered');

            let key = self.claim_key(claim_low, claim_high);
            assert(!self.paid.read(key), 'Claim already paid');
            self.paid.write(key, true);
            self.paid_low.write(key, claim_low);
            self.paid_high.write(key, claim_high);

            let conf_addr = self.confidential_transfer.read();
            assert(!conf_addr.is_zero(), 'Conf required');
            let token = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = token.approve(conf_addr, amount);
            assert(ok, 'Approve failed');

            let conf = IConfidentialTransferU256Dispatcher { contract_address: conf_addr };
            conf.private_deposit_u256(commitment_low, commitment_high, amount, proof_calldata);

            let total = self.total_paid.read();
            self.total_paid.write(total + amount);
            let timestamp = get_block_timestamp();
            self.emit(ClaimPaid { claim_low, claim_high, commitment_low, commitment_high, amount, timestamp });
        }

        fn is_paid_u256(self: @ContractState, claim_low: u128, claim_high: u128) -> bool {
            let key = self.claim_key(claim_low, claim_high);
            self.paid.read(key)
        }

        fn get_pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn get_token(self: @ContractState) -> ContractAddress {
            self.token.read()
        }

        fn get_confidential_transfer(self: @ContractState) -> ContractAddress {
            self.confidential_transfer.read()
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        fn set_confidential_transfer(ref self: ContractState, addr: ContractAddress) {
            self.assert_admin();
            self.confidential_transfer.write(addr);
        }

        fn set_admin(ref self: ContractState, admin: ContractAddress) {
            self.assert_admin();
            self.admin.write(admin);
        }
    }
}
