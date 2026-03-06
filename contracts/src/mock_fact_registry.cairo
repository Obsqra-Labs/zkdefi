// Mock Fact Registry for demo/hackathon purposes
// Always returns valid for any fact_hash

#[derive(Drop, Copy, Serde)]
pub struct VerificationListElement {
    verification_hash: felt252,
    security_bits: u128,
    verifier_config: felt252,
}

#[starknet::interface]
pub trait IMockFactRegistry<TContractState> {
    fn get_all_verifications_for_fact_hash(
        self: @TContractState,
        fact_hash: felt252
    ) -> Array<VerificationListElement>;
    fn is_valid(self: @TContractState, fact_hash: felt252) -> bool;
}

#[starknet::contract]
mod MockFactRegistry {
    use super::VerificationListElement;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl MockFactRegistryImpl of super::IMockFactRegistry<ContractState> {
        fn get_all_verifications_for_fact_hash(
            self: @ContractState,
            fact_hash: felt252
        ) -> Array<VerificationListElement> {
            // Always return one valid verification for any fact_hash
            let mut result = array![];
            result.append(VerificationListElement {
                verification_hash: fact_hash,
                security_bits: 80,
                verifier_config: 0x1,
            });
            result
        }

        fn is_valid(self: @ContractState, fact_hash: felt252) -> bool {
            // Always return true for demo
            true
        }
    }
}
