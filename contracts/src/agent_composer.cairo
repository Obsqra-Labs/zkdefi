// AgentComposer: Compose multiple zkML models into custom agents
use starknet::ContractAddress;

#[derive(Drop, Copy, Serde)]
pub enum DecisionLogic {
    AND,    // All models must pass
    OR,     // At least one model must pass
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct ComposedAgent {
    id: felt252,
    owner: ContractAddress,
    name: felt252,
    decision_logic: u8,     // 0 = AND, 1 = OR
    model_count: u8,
    active: bool,
    created_at: u64,
}

#[starknet::interface]
pub trait IAgentComposer<TContractState> {
    fn create_agent(
        ref self: TContractState,
        name: felt252,
        model_ids: Span<felt252>,
        decision_logic: u8
    ) -> felt252;
    
    fn get_agent(self: @TContractState, agent_id: felt252) -> ComposedAgent;
    fn get_agent_models(self: @TContractState, agent_id: felt252) -> Array<felt252>;
    
    fn execute_agent(
        self: @TContractState,
        agent_id: felt252,
        proof_results: Span<bool>
    ) -> bool;
    
    fn deactivate_agent(ref self: TContractState, agent_id: felt252);
    fn get_user_agents(self: @TContractState, user: ContractAddress) -> Array<felt252>;
}

#[starknet::interface]
pub trait IModelRegistry<TContractState> {
    fn is_model_active(self: @TContractState, model_id: felt252) -> bool;
}

#[starknet::contract]
mod AgentComposer {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::poseidon::poseidon_hash_span;
    use super::{ComposedAgent, IModelRegistryDispatcher, IModelRegistryDispatcherTrait};

    const MAX_MODELS_PER_AGENT: u8 = 10;

    #[storage]
    struct Storage {
        model_registry: ContractAddress,
        agents: Map<felt252, ComposedAgent>,
        agent_models: Map<(felt252, u8), felt252>,
        user_agents: Map<(ContractAddress, u32), felt252>,
        user_agent_count: Map<ContractAddress, u32>,
        admin: ContractAddress,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        AgentCreated: AgentCreated,
        AgentExecuted: AgentExecuted,
        AgentDeactivated: AgentDeactivated,
    }
    
    #[derive(Drop, starknet::Event)]
    struct AgentCreated {
        #[key]
        agent_id: felt252,
        #[key]
        owner: ContractAddress,
        name: felt252,
        model_count: u8,
    }
    
    #[derive(Drop, starknet::Event)]
    struct AgentExecuted {
        #[key]
        agent_id: felt252,
        passed: bool,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct AgentDeactivated {
        #[key]
        agent_id: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        model_registry: ContractAddress,
        admin: ContractAddress
    ) {
        self.model_registry.write(model_registry);
        self.admin.write(admin);
    }

    #[abi(embed_v0)]
    impl AgentComposerImpl of super::IAgentComposer<ContractState> {
        fn create_agent(
            ref self: ContractState,
            name: felt252,
            model_ids: Span<felt252>,
            decision_logic: u8
        ) -> felt252 {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            let model_count: u8 = model_ids.len().try_into().unwrap();
            
            assert(model_count > 0, 'At least 1 model required');
            assert(model_count <= MAX_MODELS_PER_AGENT, 'Too many models');
            assert(decision_logic <= 1, 'Invalid decision logic');
            
            // Verify all models exist and are active
            let registry = IModelRegistryDispatcher {
                contract_address: self.model_registry.read()
            };
            
            let mut i: u32 = 0;
            loop {
                if i >= model_ids.len() {
                    break;
                }
                let model_id = *model_ids.at(i);
                assert(registry.is_model_active(model_id), 'Model not active');
                i += 1;
            };
            
            // Generate unique agent ID
            let id_input: Array<felt252> = array![
                name,
                caller.into(),
                timestamp.into()
            ];
            let agent_id = poseidon_hash_span(id_input.span());
            
            // Store agent
            let agent = ComposedAgent {
                id: agent_id,
                owner: caller,
                name,
                decision_logic,
                model_count,
                active: true,
                created_at: timestamp,
            };
            self.agents.write(agent_id, agent);
            
            // Store model IDs
            let mut j: u8 = 0;
            loop {
                if j >= model_count {
                    break;
                }
                self.agent_models.write((agent_id, j), *model_ids.at(j.into()));
                j += 1;
            };
            
            // Add to user's agents
            let user_count = self.user_agent_count.read(caller);
            self.user_agents.write((caller, user_count), agent_id);
            self.user_agent_count.write(caller, user_count + 1);
            
            self.emit(AgentCreated {
                agent_id,
                owner: caller,
                name,
                model_count,
            });
            
            agent_id
        }
        
        fn get_agent(self: @ContractState, agent_id: felt252) -> ComposedAgent {
            self.agents.read(agent_id)
        }
        
        fn get_agent_models(self: @ContractState, agent_id: felt252) -> Array<felt252> {
            let agent = self.agents.read(agent_id);
            let mut models: Array<felt252> = ArrayTrait::new();
            let mut i: u8 = 0;
            loop {
                if i >= agent.model_count {
                    break;
                }
                models.append(self.agent_models.read((agent_id, i)));
                i += 1;
            };
            models
        }
        
        fn execute_agent(
            self: @ContractState,
            agent_id: felt252,
            proof_results: Span<bool>
        ) -> bool {
            let agent = self.agents.read(agent_id);
            assert(agent.active, 'Agent not active');
            
            let model_count: u32 = agent.model_count.into();
            assert(proof_results.len() == model_count, 'Wrong number of proofs');
            
            // Evaluate decision logic
            let passed = if agent.decision_logic == 0 {
                // AND logic: all must pass
                let mut all_pass = true;
                let mut i: u32 = 0;
                loop {
                    if i >= proof_results.len() {
                        break;
                    }
                    if !*proof_results.at(i) {
                        all_pass = false;
                        break;
                    }
                    i += 1;
                };
                all_pass
            } else {
                // OR logic: at least one must pass
                let mut any_pass = false;
                let mut i: u32 = 0;
                loop {
                    if i >= proof_results.len() {
                        break;
                    }
                    if *proof_results.at(i) {
                        any_pass = true;
                        break;
                    }
                    i += 1;
                };
                any_pass
            };
            
            passed
        }
        
        fn deactivate_agent(ref self: ContractState, agent_id: felt252) {
            let caller = get_caller_address();
            let mut agent = self.agents.read(agent_id);
            
            assert(caller == agent.owner || caller == self.admin.read(), 'Not authorized');
            
            agent.active = false;
            self.agents.write(agent_id, agent);
            
            self.emit(AgentDeactivated { agent_id });
        }
        
        fn get_user_agents(self: @ContractState, user: ContractAddress) -> Array<felt252> {
            let count = self.user_agent_count.read(user);
            let mut agents: Array<felt252> = ArrayTrait::new();
            let mut i: u32 = 0;
            loop {
                if i >= count {
                    break;
                }
                agents.append(self.user_agents.read((user, i)));
                i += 1;
            };
            agents
        }
    }
}
