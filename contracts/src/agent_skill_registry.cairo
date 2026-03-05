// AgentSkillRegistry: On-chain registry of ZK circuit skills for agents
//
// Each "skill" is a ZK circuit (Groth16 proof) that an agent can execute.
// The registry maps skill_id → circuit metadata (verifier, category, cost).
// Agent owners bind skills to their agent NFTs, enabling composable
// identity-bound tools that LLMs can invoke.
//
// Skills are categorized:
//   - agent_skill: Operational (IL predictor, slippage, arb, liquidation, MEV, yield, perf)
//   - agent_identity: Reputation and attestation circuits
//   - ml_scoring: Original 5 ML circuits
//   - merkle_privacy: Merkle proof circuits

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct SkillMetadata {
    pub name: felt252,                    // Human-readable skill name
    pub circuit_hash: felt252,            // Hash of the circuit (r1cs) for integrity
    pub category: felt252,               // 'agent_skill', 'agent_identity', 'ml_scoring', 'merkle_privacy'
    pub verifier_address: ContractAddress, // On-chain verifier contract (or zero for off-chain)
    pub creator: ContractAddress,         // Who registered the skill
    pub fee_bps: u16,                    // Fee in basis points for using this skill
    pub min_reputation_tier: u8,          // Minimum tier to use (0=anyone, 1=Standard, 2=Express)
    pub active: bool,
    pub registered_at: u64,
    pub total_invocations: u64,
    pub success_count: u64,
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct AgentSkillBinding {
    pub agent_id: u256,
    pub skill_id: felt252,
    pub bound_at: u64,
    pub invocation_count: u64,
    pub last_invoked: u64,
    pub enabled: bool,
}

#[starknet::interface]
pub trait IAgentSkillRegistry<TContractState> {
    // Skill management
    fn register_skill(
        ref self: TContractState,
        name: felt252,
        circuit_hash: felt252,
        category: felt252,
        verifier_address: ContractAddress,
        fee_bps: u16,
        min_reputation_tier: u8,
    ) -> felt252;

    fn get_skill(self: @TContractState, skill_id: felt252) -> SkillMetadata;
    fn deactivate_skill(ref self: TContractState, skill_id: felt252);
    fn activate_skill(ref self: TContractState, skill_id: felt252);
    fn update_skill_fee(ref self: TContractState, skill_id: felt252, new_fee_bps: u16);

    // Agent-skill binding
    fn bind_skill_to_agent(ref self: TContractState, agent_id: u256, skill_id: felt252);
    fn unbind_skill_from_agent(ref self: TContractState, agent_id: u256, skill_id: felt252);
    fn get_agent_skills(self: @TContractState, agent_id: u256) -> Array<felt252>;
    fn get_agent_skill_binding(
        self: @TContractState, agent_id: u256, skill_id: felt252
    ) -> AgentSkillBinding;
    fn has_skill(self: @TContractState, agent_id: u256, skill_id: felt252) -> bool;

    // Invocation tracking
    fn record_skill_invocation(
        ref self: TContractState,
        agent_id: u256,
        skill_id: felt252,
        success: bool,
    );

    // Discovery
    fn list_skills_by_category(self: @TContractState, category: felt252) -> Array<felt252>;
    fn get_total_skills(self: @TContractState) -> u32;
    fn get_skill_leaderboard(self: @TContractState, skill_id: felt252) -> Array<u256>;

    // Admin
    fn set_agent_identity_contract(ref self: TContractState, address: ContractAddress);
}

#[starknet::contract]
mod AgentSkillRegistry {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use super::{SkillMetadata, AgentSkillBinding};

    const MAX_SKILLS_PER_AGENT: u8 = 16;
    const MAX_CATEGORY_SKILLS: u32 = 100;
    const MAX_LEADERBOARD: u32 = 20;

    #[storage]
    struct Storage {
        // Skill storage
        skills: Map<felt252, SkillMetadata>,
        skill_exists: Map<felt252, bool>,

        // Category index: category → (index → skill_id)
        category_skills: Map<(felt252, u32), felt252>,
        category_skill_count: Map<felt252, u32>,

        // Agent → skill bindings
        agent_skill_bindings: Map<(u256, felt252), AgentSkillBinding>,
        agent_skill_list: Map<(u256, u8), felt252>,  // agent_id → (slot → skill_id)
        agent_skill_count: Map<u256, u8>,

        // Skill leaderboard: skill_id → (rank → agent_id)
        skill_leaderboard: Map<(felt252, u32), u256>,
        skill_leaderboard_count: Map<felt252, u32>,

        // Global counters
        total_skills: u32,

        // Dependencies
        agent_identity_contract: ContractAddress,

        // Admin
        admin: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        SkillRegistered: SkillRegistered,
        SkillBound: SkillBound,
        SkillUnbound: SkillUnbound,
        SkillInvoked: SkillInvoked,
    }

    #[derive(Drop, starknet::Event)]
    struct SkillRegistered {
        #[key]
        skill_id: felt252,
        name: felt252,
        category: felt252,
        creator: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct SkillBound {
        #[key]
        agent_id: u256,
        #[key]
        skill_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct SkillUnbound {
        #[key]
        agent_id: u256,
        #[key]
        skill_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct SkillInvoked {
        #[key]
        agent_id: u256,
        #[key]
        skill_id: felt252,
        success: bool,
        timestamp: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        self.total_skills.write(0);
    }

    #[abi(embed_v0)]
    impl AgentSkillRegistryImpl of super::IAgentSkillRegistry<ContractState> {
        fn register_skill(
            ref self: ContractState,
            name: felt252,
            circuit_hash: felt252,
            category: felt252,
            verifier_address: ContractAddress,
            fee_bps: u16,
            min_reputation_tier: u8,
        ) -> felt252 {
            let caller = get_caller_address();
            let now = get_block_timestamp();

            // Generate deterministic skill ID from name + circuit_hash
            let mut hash_input = array![name, circuit_hash];
            let skill_id = poseidon_hash_span(hash_input.span());

            assert!(!self.skill_exists.read(skill_id), "Skill already registered");
            assert!(min_reputation_tier <= 2, "Invalid reputation tier");
            assert!(fee_bps <= 10000, "Fee exceeds 100%");

            let metadata = SkillMetadata {
                name,
                circuit_hash,
                category,
                verifier_address,
                creator: caller,
                fee_bps,
                min_reputation_tier,
                active: true,
                registered_at: now,
                total_invocations: 0,
                success_count: 0,
            };

            self.skills.write(skill_id, metadata);
            self.skill_exists.write(skill_id, true);

            // Add to category index
            let cat_count = self.category_skill_count.read(category);
            if cat_count < MAX_CATEGORY_SKILLS {
                self.category_skills.write((category, cat_count), skill_id);
                self.category_skill_count.write(category, cat_count + 1);
            }

            let total = self.total_skills.read();
            self.total_skills.write(total + 1);

            self.emit(SkillRegistered { skill_id, name, category, creator: caller });

            skill_id
        }

        fn get_skill(self: @ContractState, skill_id: felt252) -> SkillMetadata {
            assert!(self.skill_exists.read(skill_id), "Skill not found");
            self.skills.read(skill_id)
        }

        fn deactivate_skill(ref self: ContractState, skill_id: felt252) {
            let caller = get_caller_address();
            let mut meta = self.skills.read(skill_id);
            assert!(meta.creator == caller || caller == self.admin.read(), "Not authorized");
            meta.active = false;
            self.skills.write(skill_id, meta);
        }

        fn activate_skill(ref self: ContractState, skill_id: felt252) {
            let caller = get_caller_address();
            let mut meta = self.skills.read(skill_id);
            assert!(meta.creator == caller || caller == self.admin.read(), "Not authorized");
            meta.active = true;
            self.skills.write(skill_id, meta);
        }

        fn update_skill_fee(ref self: ContractState, skill_id: felt252, new_fee_bps: u16) {
            let caller = get_caller_address();
            let mut meta = self.skills.read(skill_id);
            assert!(meta.creator == caller || caller == self.admin.read(), "Not authorized");
            assert!(new_fee_bps <= 10000, "Fee exceeds 100%");
            meta.fee_bps = new_fee_bps;
            self.skills.write(skill_id, meta);
        }

        fn bind_skill_to_agent(ref self: ContractState, agent_id: u256, skill_id: felt252) {
            let caller = get_caller_address();
            let now = get_block_timestamp();

            assert!(self.skill_exists.read(skill_id), "Skill not found");
            let skill_meta = self.skills.read(skill_id);
            assert!(skill_meta.active, "Skill is deactivated");

            // Check agent doesn't already have this skill
            let binding = self.agent_skill_bindings.read((agent_id, skill_id));
            assert!(!binding.enabled, "Skill already bound");

            let count = self.agent_skill_count.read(agent_id);
            assert!(count < MAX_SKILLS_PER_AGENT, "Max skills reached");

            // Create binding
            let new_binding = AgentSkillBinding {
                agent_id,
                skill_id,
                bound_at: now,
                invocation_count: 0,
                last_invoked: 0,
                enabled: true,
            };
            self.agent_skill_bindings.write((agent_id, skill_id), new_binding);
            self.agent_skill_list.write((agent_id, count), skill_id);
            self.agent_skill_count.write(agent_id, count + 1);

            self.emit(SkillBound { agent_id, skill_id });
        }

        fn unbind_skill_from_agent(ref self: ContractState, agent_id: u256, skill_id: felt252) {
            let caller = get_caller_address();
            let mut binding = self.agent_skill_bindings.read((agent_id, skill_id));
            assert!(binding.enabled, "Skill not bound");

            binding.enabled = false;
            self.agent_skill_bindings.write((agent_id, skill_id), binding);

            self.emit(SkillUnbound { agent_id, skill_id });
        }

        fn get_agent_skills(self: @ContractState, agent_id: u256) -> Array<felt252> {
            let count = self.agent_skill_count.read(agent_id);
            let mut skills: Array<felt252> = ArrayTrait::new();
            let mut i: u8 = 0;
            while i < count {
                let skill_id = self.agent_skill_list.read((agent_id, i));
                let binding = self.agent_skill_bindings.read((agent_id, skill_id));
                if binding.enabled {
                    skills.append(skill_id);
                }
                i += 1;
            };
            skills
        }

        fn get_agent_skill_binding(
            self: @ContractState, agent_id: u256, skill_id: felt252
        ) -> AgentSkillBinding {
            self.agent_skill_bindings.read((agent_id, skill_id))
        }

        fn has_skill(self: @ContractState, agent_id: u256, skill_id: felt252) -> bool {
            let binding = self.agent_skill_bindings.read((agent_id, skill_id));
            binding.enabled
        }

        fn record_skill_invocation(
            ref self: ContractState,
            agent_id: u256,
            skill_id: felt252,
            success: bool,
        ) {
            let now = get_block_timestamp();

            // Update binding
            let mut binding = self.agent_skill_bindings.read((agent_id, skill_id));
            assert!(binding.enabled, "Skill not bound to agent");
            binding.invocation_count += 1;
            binding.last_invoked = now;
            self.agent_skill_bindings.write((agent_id, skill_id), binding);

            // Update global skill stats
            let mut meta = self.skills.read(skill_id);
            meta.total_invocations += 1;
            if success {
                meta.success_count += 1;
            }
            self.skills.write(skill_id, meta);

            self.emit(SkillInvoked { agent_id, skill_id, success, timestamp: now });
        }

        fn list_skills_by_category(self: @ContractState, category: felt252) -> Array<felt252> {
            let count = self.category_skill_count.read(category);
            let mut skills: Array<felt252> = ArrayTrait::new();
            let mut i: u32 = 0;
            while i < count {
                let skill_id = self.category_skills.read((category, i));
                let meta = self.skills.read(skill_id);
                if meta.active {
                    skills.append(skill_id);
                }
                i += 1;
            };
            skills
        }

        fn get_total_skills(self: @ContractState) -> u32 {
            self.total_skills.read()
        }

        fn get_skill_leaderboard(self: @ContractState, skill_id: felt252) -> Array<u256> {
            let count = self.skill_leaderboard_count.read(skill_id);
            let mut leaders: Array<u256> = ArrayTrait::new();
            let mut i: u32 = 0;
            let limit = if count > MAX_LEADERBOARD { MAX_LEADERBOARD } else { count };
            while i < limit {
                leaders.append(self.skill_leaderboard.read((skill_id, i)));
                i += 1;
            };
            leaders
        }

        fn set_agent_identity_contract(ref self: ContractState, address: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == self.admin.read(), "Only admin");
            self.agent_identity_contract.write(address);
        }
    }
}
