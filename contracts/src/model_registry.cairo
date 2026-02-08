// ModelRegistry: On-chain catalog of zkML models for composable agents
use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct Model {
    id: felt252,
    name: felt252,
    model_type: felt252,        // 'groth16', 'risc_zero', 'stark'
    verifier_address: ContractAddress,
    creator: ContractAddress,
    fee_bps: u16,               // Fee in basis points (100 = 1%)
    active: bool,
}

#[starknet::interface]
pub trait IModelRegistry<TContractState> {
    fn register_model(
        ref self: TContractState,
        name: felt252,
        model_type: felt252,
        verifier_address: ContractAddress,
        fee_bps: u16
    ) -> felt252;
    
    fn get_model(self: @TContractState, model_id: felt252) -> Model;
    fn get_model_count(self: @TContractState) -> u32;
    fn is_model_active(self: @TContractState, model_id: felt252) -> bool;
    fn deactivate_model(ref self: TContractState, model_id: felt252);
    fn activate_model(ref self: TContractState, model_id: felt252);
    fn get_models_by_type(self: @TContractState, model_type: felt252) -> Array<felt252>;
}

#[starknet::contract]
mod ModelRegistry {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    use core::poseidon::poseidon_hash_span;
    use super::Model;

    #[storage]
    struct Storage {
        models: Map<felt252, Model>,
        model_ids: Map<u32, felt252>,
        model_count: u32,
        models_by_type: Map<(felt252, u32), felt252>,
        model_type_count: Map<felt252, u32>,
        admin: ContractAddress,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ModelRegistered: ModelRegistered,
        ModelDeactivated: ModelDeactivated,
        ModelActivated: ModelActivated,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ModelRegistered {
        #[key]
        model_id: felt252,
        name: felt252,
        model_type: felt252,
        creator: ContractAddress,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ModelDeactivated {
        #[key]
        model_id: felt252,
    }
    
    #[derive(Drop, starknet::Event)]
    struct ModelActivated {
        #[key]
        model_id: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        self.model_count.write(0);
    }

    #[abi(embed_v0)]
    impl ModelRegistryImpl of super::IModelRegistry<ContractState> {
        fn register_model(
            ref self: ContractState,
            name: felt252,
            model_type: felt252,
            verifier_address: ContractAddress,
            fee_bps: u16
        ) -> felt252 {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Generate unique model ID
            let id_input: Array<felt252> = array![
                name,
                model_type,
                caller.into(),
                timestamp.into()
            ];
            let model_id = poseidon_hash_span(id_input.span());
            
            // Store model
            let model = Model {
                id: model_id,
                name,
                model_type,
                verifier_address,
                creator: caller,
                fee_bps,
                active: true,
            };
            self.models.write(model_id, model);
            
            // Add to list
            let count = self.model_count.read();
            self.model_ids.write(count, model_id);
            self.model_count.write(count + 1);
            
            // Add to type index
            let type_count = self.model_type_count.read(model_type);
            self.models_by_type.write((model_type, type_count), model_id);
            self.model_type_count.write(model_type, type_count + 1);
            
            self.emit(ModelRegistered {
                model_id,
                name,
                model_type,
                creator: caller,
            });
            
            model_id
        }
        
        fn get_model(self: @ContractState, model_id: felt252) -> Model {
            self.models.read(model_id)
        }
        
        fn get_model_count(self: @ContractState) -> u32 {
            self.model_count.read()
        }
        
        fn is_model_active(self: @ContractState, model_id: felt252) -> bool {
            self.models.read(model_id).active
        }
        
        fn deactivate_model(ref self: ContractState, model_id: felt252) {
            let caller = get_caller_address();
            let mut model = self.models.read(model_id);
            
            // Only creator or admin can deactivate
            assert(caller == model.creator || caller == self.admin.read(), 'Not authorized');
            
            model.active = false;
            self.models.write(model_id, model);
            
            self.emit(ModelDeactivated { model_id });
        }
        
        fn activate_model(ref self: ContractState, model_id: felt252) {
            let caller = get_caller_address();
            let mut model = self.models.read(model_id);
            
            assert(caller == model.creator || caller == self.admin.read(), 'Not authorized');
            
            model.active = true;
            self.models.write(model_id, model);
            
            self.emit(ModelActivated { model_id });
        }
        
        fn get_models_by_type(self: @ContractState, model_type: felt252) -> Array<felt252> {
            let count = self.model_type_count.read(model_type);
            let mut models: Array<felt252> = ArrayTrait::new();
            let mut i: u32 = 0;
            loop {
                if i >= count {
                    break;
                }
                models.append(self.models_by_type.read((model_type, i)));
                i += 1;
            };
            models
        }
    }
}
