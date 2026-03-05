use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct Proposal {
    pub id: u256,
    pub proposer: ContractAddress,
    pub proposal_type: felt252,
    pub target: ContractAddress,
    pub new_value: u256,
    pub votes_for: u256,
    pub votes_against: u256,
    pub total_votes: u256,
    pub created_at: u64,
    pub voting_ends_at: u64,
    pub executed: bool,
    pub passed: bool,
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct MultisigConfig {
    pub threshold: u8,
    pub total_signers: u8,
}

#[starknet::interface]
pub trait IDAOConstraintManager<TContractState> {
    fn create_proposal(
        ref self: TContractState,
        proposal_type: felt252,
        target: ContractAddress,
        new_value: u256,
        vote_duration_seconds: u64,
    ) -> u256;
    
    fn cast_vote_with_proof(
        ref self: TContractState,
        proposal_id: u256,
        vote_proof: Span<felt252>,
        nullifier: felt252,
    );
    
    fn tally_votes(ref self: TContractState, proposal_id: u256);
    fn execute_proposal(ref self: TContractState, proposal_id: u256);
    
    fn emergency_pause(ref self: TContractState, target: ContractAddress);
    fn emergency_unpause(ref self: TContractState, target: ContractAddress);
    fn add_multisig_signer(ref self: TContractState, signer: ContractAddress);
    fn remove_multisig_signer(ref self: TContractState, signer: ContractAddress);
    
    fn get_proposal(self: @TContractState, proposal_id: u256) -> Proposal;
    fn get_voting_power(self: @TContractState, user: ContractAddress) -> u256;
    fn is_multisig_signer(self: @TContractState, signer: ContractAddress) -> bool;
    fn get_proposal_count(self: @TContractState) -> u256;
    fn is_nullifier_spent(self: @TContractState, proposal_id: u256, nullifier: felt252) -> bool;
}

#[starknet::contract]
mod DAOConstraintManager {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_tx_info,
        contract_address_const,
    };
    use starknet::storage::{
        Map, StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess,
    };
    use core::poseidon::poseidon_hash_span;
    use super::{Proposal, MultisigConfig};

    #[storage]
    struct Storage {
        proposals: Map<u256, Proposal>,
        proposal_count: u256,
        nullifiers_spent: Map<(u256, felt252), bool>,
        voting_power: Map<ContractAddress, u256>,
        multisig_signers: Map<ContractAddress, bool>,
        multisig_signatures: Map<(ContractAddress, felt252), bool>,
        multisig_config: MultisigConfig,
        admin: ContractAddress,
        vault_controller: ContractAddress,
        voting_verifier: ContractAddress,
        min_proposal_voting_power: u256,
        quorum_bps: u16,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ProposalCreated: ProposalCreated,
        VoteCast: VoteCast,
        ProposalTallied: ProposalTallied,
        ProposalExecuted: ProposalExecuted,
        EmergencyPause: EmergencyPause,
        EmergencyUnpause: EmergencyUnpause,
        MultisigSignerAdded: MultisigSignerAdded,
        MultisigSignerRemoved: MultisigSignerRemoved,
    }

    #[derive(Drop, starknet::Event)]
    struct ProposalCreated {
        #[key]
        pub proposal_id: u256,
        pub proposer: ContractAddress,
        pub proposal_type: felt252,
        pub target: ContractAddress,
        pub new_value: u256,
        pub voting_ends_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct VoteCast {
        #[key]
        pub proposal_id: u256,
        #[key]
        pub nullifier: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct ProposalTallied {
        #[key]
        pub proposal_id: u256,
        pub votes_for: u256,
        pub votes_against: u256,
        pub passed: bool,
    }

    #[derive(Drop, starknet::Event)]
    struct ProposalExecuted {
        #[key]
        pub proposal_id: u256,
        pub executor: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct EmergencyPause {
        #[key]
        pub target: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct EmergencyUnpause {
        #[key]
        pub target: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct MultisigSignerAdded {
        #[key]
        pub signer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct MultisigSignerRemoved {
        #[key]
        pub signer: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        vault_controller: ContractAddress,
        voting_verifier: ContractAddress,
        min_proposal_voting_power: u256,
        quorum_bps: u16,
    ) {
        self.admin.write(admin);
        self.vault_controller.write(vault_controller);
        self.voting_verifier.write(voting_verifier);
        self.min_proposal_voting_power.write(min_proposal_voting_power);
        self.quorum_bps.write(quorum_bps);
        
        self.multisig_config.threshold.write(5);
        self.multisig_config.total_signers.write(7);
        self.proposal_count.write(0);
    }

    fn assert_admin(self: @ContractState) {
        assert(get_caller_address() == self.admin.read(), 'only admin');
    }

    fn assert_multisig_threshold(self: @ContractState, action_hash: felt252) {
        let caller = get_caller_address();
        assert(self.multisig_signers.read(caller), 'caller not multisig signer');
    }

    #[abi(embed_v0)]
    impl DAOConstraintManagerImpl of super::IDAOConstraintManager<ContractState> {
        fn create_proposal(
            ref self: ContractState,
            proposal_type: felt252,
            target: ContractAddress,
            new_value: u256,
            vote_duration_seconds: u64,
        ) -> u256 {
            let proposer = get_caller_address();
            let proposer_vp = self.voting_power.read(proposer);
            let min_vp = self.min_proposal_voting_power.read();
            assert(proposer_vp >= min_vp, 'insufficient voting power');

            let proposal_id = self.proposal_count.read() + 1;
            self.proposal_count.write(proposal_id);

            let now = get_block_timestamp();
            let voting_ends_at = now + vote_duration_seconds;

            let proposal = Proposal {
                id: proposal_id,
                proposer,
                proposal_type,
                target,
                new_value,
                votes_for: 0,
                votes_against: 0,
                total_votes: 0,
                created_at: now,
                voting_ends_at,
                executed: false,
                passed: false,
            };

            self.proposals.write(proposal_id, proposal);

            self.emit(ProposalCreated {
                proposal_id,
                proposer,
                proposal_type,
                target,
                new_value,
                voting_ends_at,
            });

            proposal_id
        }

        fn cast_vote_with_proof(
            ref self: ContractState,
            proposal_id: u256,
            vote_proof: Span<felt252>,
            nullifier: felt252,
        ) {
            let mut proposal = self.proposals.read(proposal_id);
            assert(proposal.id != 0, 'proposal not found');
            
            let now = get_block_timestamp();
            assert(now <= proposal.voting_ends_at, 'voting period ended');
            assert(!proposal.executed, 'proposal already executed');

            assert(!self.nullifiers_spent.read((proposal_id, nullifier)), 'already voted');

            let vote_value_felt = *vote_proof.at(vote_proof.len() - 1);
            let vote_value: u256 = vote_value_felt.into();

            proposal.total_votes = proposal.total_votes + vote_value;
            
            self.nullifiers_spent.write((proposal_id, nullifier), true);
            self.proposals.write(proposal_id, proposal);

            self.emit(VoteCast {
                proposal_id,
                nullifier,
            });
        }

        fn tally_votes(ref self: ContractState, proposal_id: u256) {
            let mut proposal = self.proposals.read(proposal_id);
            assert(proposal.id != 0, 'proposal not found');
            
            let now = get_block_timestamp();
            assert(now > proposal.voting_ends_at, 'voting still active');
            assert(!proposal.executed, 'already tallied');

            let quorum_bps = self.quorum_bps.read();
            let total_vp_required = (proposal.total_votes * quorum_bps.into()) / 10000;
            
            let votes_for = proposal.votes_for;
            let votes_against = proposal.votes_against;
            let total_cast = votes_for + votes_against;

            let quorum_met = total_cast >= total_vp_required;
            let majority_for = votes_for > votes_against;
            
            proposal.passed = quorum_met && majority_for;
            self.proposals.write(proposal_id, proposal);

            self.emit(ProposalTallied {
                proposal_id,
                votes_for,
                votes_against,
                passed: proposal.passed,
            });
        }

        fn execute_proposal(ref self: ContractState, proposal_id: u256) {
            let mut proposal = self.proposals.read(proposal_id);
            assert(proposal.id != 0, 'proposal not found');
            assert(proposal.passed, 'proposal did not pass');
            assert(!proposal.executed, 'already executed');

            let now = get_block_timestamp();
            assert(now > proposal.voting_ends_at, 'voting still active');

            match proposal.proposal_type {
                0 => {
                    self._execute_adapter_limit_change(proposal.target, proposal.new_value);
                },
                _ => {},
            }

            proposal.executed = true;
            self.proposals.write(proposal_id, proposal);

            self.emit(ProposalExecuted {
                proposal_id,
                executor: get_caller_address(),
            });
        }

        fn emergency_pause(ref self: ContractState, target: ContractAddress) {
            let action_hash = poseidon_hash_span(
                array![target.into(), 'pause'.into()].span()
            );
            
            assert_multisig_threshold(@self, action_hash);

            self.emit(EmergencyPause {
                target,
            });
        }

        fn emergency_unpause(ref self: ContractState, target: ContractAddress) {
            let action_hash = poseidon_hash_span(
                array![target.into(), 'unpause'.into()].span()
            );
            
            assert_multisig_threshold(@self, action_hash);

            self.emit(EmergencyUnpause {
                target,
            });
        }

        fn add_multisig_signer(ref self: ContractState, signer: ContractAddress) {
            assert_admin(@self);
            self.multisig_signers.write(signer, true);
            
            let mut config = self.multisig_config.read();
            config.total_signers += 1;
            self.multisig_config.write(config);

            self.emit(MultisigSignerAdded { signer });
        }

        fn remove_multisig_signer(ref self: ContractState, signer: ContractAddress) {
            assert_admin(@self);
            self.multisig_signers.write(signer, false);
            
            let mut config = self.multisig_config.read();
            if config.total_signers > 0 {
                config.total_signers -= 1;
            }
            self.multisig_config.write(config);

            self.emit(MultisigSignerRemoved { signer });
        }

        fn get_proposal(self: @ContractState, proposal_id: u256) -> Proposal {
            self.proposals.read(proposal_id)
        }

        fn get_voting_power(self: @ContractState, user: ContractAddress) -> u256 {
            self.voting_power.read(user)
        }

        fn is_multisig_signer(self: @ContractState, signer: ContractAddress) -> bool {
            self.multisig_signers.read(signer)
        }

        fn get_proposal_count(self: @ContractState) -> u256 {
            self.proposal_count.read()
        }

        fn is_nullifier_spent(self: @ContractState, proposal_id: u256, nullifier: felt252) -> bool {
            self.nullifiers_spent.read((proposal_id, nullifier))
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn _execute_adapter_limit_change(
            ref self: ContractState,
            adapter: ContractAddress,
            new_limit_bps: u256,
        ) {
        }
    }
}
