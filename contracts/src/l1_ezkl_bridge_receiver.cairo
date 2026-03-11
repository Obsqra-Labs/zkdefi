// L1 to L2 EZKL Verification Bridge Receiver (Phase 3 Path C).
// Consumes messages from L1 via Starknet core messaging.
// Payload: [model_hash, output_commitment, verified, nonce_low, nonce_high, chain_id_low, chain_id_high].
// Validates from_address == allowed_l1_sender and verified == 1.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IL1EzklBridgeReceiver<TContractState> {
    fn get_verification(
        self: @TContractState,
        model_hash: felt252,
        nonce_low: u128,
        nonce_high: u128,
    ) -> (bool, felt252, u64);
    fn get_allowed_l1_sender(self: @TContractState) -> felt252;
    fn get_admin(self: @TContractState) -> ContractAddress;
    fn set_allowed_l1_sender(ref self: TContractState, l1_address: felt252);
}

#[starknet::contract]
mod L1EzklBridgeReceiver {
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use core::poseidon::poseidon_hash_span;
    use super::IL1EzklBridgeReceiver;

    #[storage]
    struct Storage {
        admin: ContractAddress,
        allowed_l1_sender: felt252,
        verification_output: Map<felt252, felt252>,
        verification_block: Map<felt252, u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        L1VerificationReceived: L1VerificationReceived,
        AllowedL1SenderUpdated: AllowedL1SenderUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct L1VerificationReceived {
        #[key]
        model_hash: felt252,
        output_commitment: felt252,
        nonce_low: u128,
        nonce_high: u128,
        block_timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct AllowedL1SenderUpdated {
        old_sender: felt252,
        new_sender: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, allowed_l1_sender: felt252) {
        self.admin.write(admin);
        self.allowed_l1_sender.write(allowed_l1_sender);
    }

    #[l1_handler]
    fn on_l1_message(
        ref self: ContractState,
        from_address: felt252,
        model_hash: felt252,
        output_commitment: felt252,
        verified: felt252,
        nonce_low: u128,
        nonce_high: u128,
        _chain_id_low: u128,
        _chain_id_high: u128,
    ) {
        assert(self.allowed_l1_sender.read() == from_address, 'UNAUTHORIZED_L1_SENDER');
        assert(verified == 1, 'VERIFIED_MUST_BE_TRUE');

        let key = self._verification_key(model_hash, nonce_low, nonce_high);
        if self.verification_output.read(key) != 0 {
            return;
        }

        let block_ts = get_block_timestamp();
        self.verification_output.write(key, output_commitment);
        self.verification_block.write(key, block_ts);

        self.emit(L1VerificationReceived {
            model_hash,
            output_commitment,
            nonce_low,
            nonce_high,
            block_timestamp: block_ts,
        });
    }

    #[abi(embed_v0)]
    impl L1EzklBridgeReceiverImpl of IL1EzklBridgeReceiver<ContractState> {
        fn get_verification(
            self: @ContractState,
            model_hash: felt252,
            nonce_low: u128,
            nonce_high: u128,
        ) -> (bool, felt252, u64) {
            let key = self._verification_key(model_hash, nonce_low, nonce_high);
            let out = self.verification_output.read(key);
            let block_ts = self.verification_block.read(key);
            (out != 0, out, block_ts)
        }

        fn get_allowed_l1_sender(self: @ContractState) -> felt252 {
            self.allowed_l1_sender.read()
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        fn set_allowed_l1_sender(ref self: ContractState, l1_address: felt252) {
            assert(get_caller_address() == self.admin.read(), 'ONLY_ADMIN');
            let old = self.allowed_l1_sender.read();
            self.allowed_l1_sender.write(l1_address);
            self.emit(AllowedL1SenderUpdated { old_sender: old, new_sender: l1_address });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _verification_key(
            self: @ContractState,
            model_hash: felt252,
            nonce_low: u128,
            nonce_high: u128,
        ) -> felt252 {
            let nonce_low_felt: felt252 = nonce_low.into();
            let nonce_high_felt: felt252 = nonce_high.into();
            poseidon_hash_span(array![model_hash, nonce_low_felt, nonce_high_felt].span())
        }
    }
}
