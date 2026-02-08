// AgentIdentity: SRC-721 NFT contract for discoverable agent identity
// 
// Aligns with ERC-8004's Identity Registry concept:
// - Each agent gets a unique NFT representing its identity
// - Links to Universal Identity Commitment for cross-chain identity
// - Stores agent metadata (models, reputation tier, owner)
// - Enables discovery and trust verification

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct AgentMetadata {
    pub owner: ContractAddress,
    pub name: felt252,
    pub created_at: u64,
    pub identity_commitment: felt252,  // Links to Universal Identity
    pub reputation_tier: u8,           // 0=Strict, 1=Standard, 2=Express
    pub model_count: u8,
    pub active: bool,
    pub last_execution: u64,
    pub total_executions: u64,
}

#[starknet::interface]
pub trait IAgentIdentity<TContractState> {
    // SRC-721 core functions
    fn balance_of(self: @TContractState, owner: ContractAddress) -> u256;
    fn owner_of(self: @TContractState, token_id: u256) -> ContractAddress;
    fn get_approved(self: @TContractState, token_id: u256) -> ContractAddress;
    fn is_approved_for_all(self: @TContractState, owner: ContractAddress, operator: ContractAddress) -> bool;
    
    fn approve(ref self: TContractState, to: ContractAddress, token_id: u256);
    fn set_approval_for_all(ref self: TContractState, operator: ContractAddress, approved: bool);
    fn transfer_from(ref self: TContractState, from: ContractAddress, to: ContractAddress, token_id: u256);
    
    // Agent-specific functions
    fn mint_agent(
        ref self: TContractState, 
        name: felt252, 
        identity_commitment: felt252,
        model_ids: Span<felt252>
    ) -> u256;
    
    fn get_agent_metadata(self: @TContractState, token_id: u256) -> AgentMetadata;
    fn get_agent_models(self: @TContractState, token_id: u256) -> Array<felt252>;
    fn update_reputation(ref self: TContractState, token_id: u256, new_tier: u8);
    fn record_execution(ref self: TContractState, token_id: u256);
    fn deactivate_agent(ref self: TContractState, token_id: u256);
    fn activate_agent(ref self: TContractState, token_id: u256);
    
    // Discovery functions (ERC-8004 alignment)
    fn get_agents_by_owner(self: @TContractState, owner: ContractAddress) -> Array<u256>;
    fn get_agents_by_tier(self: @TContractState, tier: u8) -> Array<u256>;
    fn get_total_agents(self: @TContractState) -> u256;
    fn get_agent_by_commitment(self: @TContractState, commitment: felt252) -> u256;
    
    // Metadata
    fn name(self: @TContractState) -> felt252;
    fn symbol(self: @TContractState) -> felt252;
    fn token_uri(self: @TContractState, token_id: u256) -> felt252;
}

#[starknet::contract]
mod AgentIdentity {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::poseidon::poseidon_hash_span;
    use core::num::traits::Zero;
    use super::AgentMetadata;

    const MAX_MODELS_PER_AGENT: u8 = 10;

    #[storage]
    struct Storage {
        // SRC-721 storage
        owners: Map<u256, ContractAddress>,
        balances: Map<ContractAddress, u256>,
        token_approvals: Map<u256, ContractAddress>,
        operator_approvals: Map<(ContractAddress, ContractAddress), bool>,
        
        // Agent metadata
        agent_metadata: Map<u256, AgentMetadata>,
        agent_models: Map<(u256, u8), felt252>,
        
        // Indexes for discovery
        owner_tokens: Map<(ContractAddress, u256), u256>,
        owner_token_count: Map<ContractAddress, u256>,
        tier_agents: Map<(u8, u256), u256>,
        tier_agent_count: Map<u8, u256>,
        commitment_to_token: Map<felt252, u256>,
        
        // Counters
        next_token_id: u256,
        total_supply: u256,
        
        // Admin
        admin: ContractAddress,
        reputation_registry: ContractAddress,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Transfer: Transfer,
        Approval: Approval,
        ApprovalForAll: ApprovalForAll,
        AgentMinted: AgentMinted,
        AgentUpdated: AgentUpdated,
        ExecutionRecorded: ExecutionRecorded,
    }
    
    #[derive(Drop, starknet::Event)]
    struct Transfer {
        #[key]
        from: ContractAddress,
        #[key]
        to: ContractAddress,
        #[key]
        token_id: u256,
    }
    
    #[derive(Drop, starknet::Event)]
    struct Approval {
        #[key]
        owner: ContractAddress,
        #[key]
        approved: ContractAddress,
        #[key]
        token_id: u256,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ApprovalForAll {
        #[key]
        owner: ContractAddress,
        #[key]
        operator: ContractAddress,
        approved: bool,
    }
    
    #[derive(Drop, starknet::Event)]
    struct AgentMinted {
        #[key]
        token_id: u256,
        #[key]
        owner: ContractAddress,
        name: felt252,
        identity_commitment: felt252,
        model_count: u8,
    }
    
    #[derive(Drop, starknet::Event)]
    struct AgentUpdated {
        #[key]
        token_id: u256,
        reputation_tier: u8,
        active: bool,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ExecutionRecorded {
        #[key]
        token_id: u256,
        timestamp: u64,
        total_executions: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, 
        admin: ContractAddress,
        reputation_registry: ContractAddress
    ) {
        self.admin.write(admin);
        self.reputation_registry.write(reputation_registry);
        self.next_token_id.write(1);
        self.total_supply.write(0);
    }

    #[abi(embed_v0)]
    impl AgentIdentityImpl of super::IAgentIdentity<ContractState> {
        // ===== SRC-721 Core =====
        
        fn balance_of(self: @ContractState, owner: ContractAddress) -> u256 {
            self.balances.read(owner)
        }
        
        fn owner_of(self: @ContractState, token_id: u256) -> ContractAddress {
            let owner = self.owners.read(token_id);
            assert(owner.is_non_zero(), 'Token does not exist');
            owner
        }
        
        fn get_approved(self: @ContractState, token_id: u256) -> ContractAddress {
            self.token_approvals.read(token_id)
        }
        
        fn is_approved_for_all(
            self: @ContractState, 
            owner: ContractAddress, 
            operator: ContractAddress
        ) -> bool {
            self.operator_approvals.read((owner, operator))
        }
        
        fn approve(ref self: ContractState, to: ContractAddress, token_id: u256) {
            let owner = self.owners.read(token_id);
            let caller = get_caller_address();
            
            assert(owner.is_non_zero(), 'Token does not exist');
            assert(
                caller == owner || self.operator_approvals.read((owner, caller)),
                'Not authorized'
            );
            
            self.token_approvals.write(token_id, to);
            self.emit(Approval { owner, approved: to, token_id });
        }
        
        fn set_approval_for_all(
            ref self: ContractState, 
            operator: ContractAddress, 
            approved: bool
        ) {
            let caller = get_caller_address();
            self.operator_approvals.write((caller, operator), approved);
            self.emit(ApprovalForAll { owner: caller, operator, approved });
        }
        
        fn transfer_from(
            ref self: ContractState, 
            from: ContractAddress, 
            to: ContractAddress, 
            token_id: u256
        ) {
            let caller = get_caller_address();
            let owner = self.owners.read(token_id);
            
            assert(owner.is_non_zero(), 'Token does not exist');
            assert(from == owner, 'Not the owner');
            assert(
                caller == owner 
                    || self.token_approvals.read(token_id) == caller
                    || self.operator_approvals.read((owner, caller)),
                'Not authorized'
            );
            
            // Clear approval
            self.token_approvals.write(token_id, starknet::contract_address_const::<0>());
            
            // Update balances
            self.balances.write(from, self.balances.read(from) - 1);
            self.balances.write(to, self.balances.read(to) + 1);
            
            // Transfer ownership
            self.owners.write(token_id, to);
            
            // Update metadata
            let mut metadata = self.agent_metadata.read(token_id);
            metadata.owner = to;
            self.agent_metadata.write(token_id, metadata);
            
            // Update owner index
            let to_count = self.owner_token_count.read(to);
            self.owner_tokens.write((to, to_count), token_id);
            self.owner_token_count.write(to, to_count + 1);
            
            self.emit(Transfer { from, to, token_id });
        }
        
        // ===== Agent Functions =====
        
        fn mint_agent(
            ref self: ContractState, 
            name: felt252, 
            identity_commitment: felt252,
            model_ids: Span<felt252>
        ) -> u256 {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            let model_count: u8 = model_ids.len().try_into().unwrap();
            
            assert(model_count <= MAX_MODELS_PER_AGENT, 'Too many models');
            
            // Generate token ID
            let token_id = self.next_token_id.read();
            self.next_token_id.write(token_id + 1);
            
            // Mint token
            self.owners.write(token_id, caller);
            self.balances.write(caller, self.balances.read(caller) + 1);
            self.total_supply.write(self.total_supply.read() + 1);
            
            // Store metadata
            let metadata = AgentMetadata {
                owner: caller,
                name,
                created_at: timestamp,
                identity_commitment,
                reputation_tier: 0,  // Start at Strict
                model_count,
                active: true,
                last_execution: 0,
                total_executions: 0,
            };
            self.agent_metadata.write(token_id, metadata);
            
            // Store model IDs
            let mut i: u8 = 0;
            loop {
                if i >= model_count {
                    break;
                }
                self.agent_models.write((token_id, i), *model_ids.at(i.into()));
                i += 1;
            };
            
            // Update indexes
            let owner_count = self.owner_token_count.read(caller);
            self.owner_tokens.write((caller, owner_count), token_id);
            self.owner_token_count.write(caller, owner_count + 1);
            
            let tier_count = self.tier_agent_count.read(0);
            self.tier_agents.write((0, tier_count), token_id);
            self.tier_agent_count.write(0, tier_count + 1);
            
            self.commitment_to_token.write(identity_commitment, token_id);
            
            self.emit(Transfer { 
                from: starknet::contract_address_const::<0>(), 
                to: caller, 
                token_id 
            });
            self.emit(AgentMinted {
                token_id,
                owner: caller,
                name,
                identity_commitment,
                model_count,
            });
            
            token_id
        }
        
        fn get_agent_metadata(self: @ContractState, token_id: u256) -> AgentMetadata {
            let metadata = self.agent_metadata.read(token_id);
            assert(metadata.owner.is_non_zero(), 'Agent does not exist');
            metadata
        }
        
        fn get_agent_models(self: @ContractState, token_id: u256) -> Array<felt252> {
            let metadata = self.agent_metadata.read(token_id);
            let mut models: Array<felt252> = ArrayTrait::new();
            let mut i: u8 = 0;
            loop {
                if i >= metadata.model_count {
                    break;
                }
                models.append(self.agent_models.read((token_id, i)));
                i += 1;
            };
            models
        }
        
        fn update_reputation(ref self: ContractState, token_id: u256, new_tier: u8) {
            let caller = get_caller_address();
            let admin = self.admin.read();
            let reputation_registry = self.reputation_registry.read();
            
            assert(
                caller == admin || caller == reputation_registry,
                'Not authorized'
            );
            
            let mut metadata = self.agent_metadata.read(token_id);
            assert(metadata.owner.is_non_zero(), 'Agent does not exist');
            
            let old_tier = metadata.reputation_tier;
            metadata.reputation_tier = new_tier;
            self.agent_metadata.write(token_id, metadata);
            
            // Update tier index
            let new_tier_count = self.tier_agent_count.read(new_tier);
            self.tier_agents.write((new_tier, new_tier_count), token_id);
            self.tier_agent_count.write(new_tier, new_tier_count + 1);
            
            self.emit(AgentUpdated { 
                token_id, 
                reputation_tier: new_tier, 
                active: metadata.active 
            });
        }
        
        fn record_execution(ref self: ContractState, token_id: u256) {
            let caller = get_caller_address();
            let mut metadata = self.agent_metadata.read(token_id);
            
            assert(metadata.owner.is_non_zero(), 'Agent does not exist');
            assert(metadata.active, 'Agent not active');
            
            // Only owner or approved operators can record executions
            let owner = self.owners.read(token_id);
            assert(
                caller == owner 
                    || self.token_approvals.read(token_id) == caller
                    || self.operator_approvals.read((owner, caller)),
                'Not authorized'
            );
            
            let timestamp = get_block_timestamp();
            metadata.last_execution = timestamp;
            metadata.total_executions = metadata.total_executions + 1;
            self.agent_metadata.write(token_id, metadata);
            
            self.emit(ExecutionRecorded { 
                token_id, 
                timestamp, 
                total_executions: metadata.total_executions 
            });
        }
        
        fn deactivate_agent(ref self: ContractState, token_id: u256) {
            let caller = get_caller_address();
            let mut metadata = self.agent_metadata.read(token_id);
            
            assert(metadata.owner.is_non_zero(), 'Agent does not exist');
            assert(caller == metadata.owner || caller == self.admin.read(), 'Not authorized');
            
            metadata.active = false;
            self.agent_metadata.write(token_id, metadata);
            
            self.emit(AgentUpdated { 
                token_id, 
                reputation_tier: metadata.reputation_tier, 
                active: false 
            });
        }
        
        fn activate_agent(ref self: ContractState, token_id: u256) {
            let caller = get_caller_address();
            let mut metadata = self.agent_metadata.read(token_id);
            
            assert(metadata.owner.is_non_zero(), 'Agent does not exist');
            assert(caller == metadata.owner || caller == self.admin.read(), 'Not authorized');
            
            metadata.active = true;
            self.agent_metadata.write(token_id, metadata);
            
            self.emit(AgentUpdated { 
                token_id, 
                reputation_tier: metadata.reputation_tier, 
                active: true 
            });
        }
        
        // ===== Discovery Functions =====
        
        fn get_agents_by_owner(self: @ContractState, owner: ContractAddress) -> Array<u256> {
            let count = self.owner_token_count.read(owner);
            let mut agents: Array<u256> = ArrayTrait::new();
            let mut i: u256 = 0;
            loop {
                if i >= count {
                    break;
                }
                agents.append(self.owner_tokens.read((owner, i)));
                i += 1;
            };
            agents
        }
        
        fn get_agents_by_tier(self: @ContractState, tier: u8) -> Array<u256> {
            let count = self.tier_agent_count.read(tier);
            let mut agents: Array<u256> = ArrayTrait::new();
            let mut i: u256 = 0;
            loop {
                if i >= count {
                    break;
                }
                agents.append(self.tier_agents.read((tier, i)));
                i += 1;
            };
            agents
        }
        
        fn get_total_agents(self: @ContractState) -> u256 {
            self.total_supply.read()
        }
        
        fn get_agent_by_commitment(self: @ContractState, commitment: felt252) -> u256 {
            self.commitment_to_token.read(commitment)
        }
        
        // ===== Metadata =====
        
        fn name(self: @ContractState) -> felt252 {
            'zkde.fi Agent Identity'
        }
        
        fn symbol(self: @ContractState) -> felt252 {
            'ZKAGENT'
        }
        
        fn token_uri(self: @ContractState, token_id: u256) -> felt252 {
            // In production, return IPFS URI or on-chain metadata
            'https://zkde.fi/agent/'
        }
    }
}
