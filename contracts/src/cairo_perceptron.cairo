// Cairo Perceptron: Tier 0 on-chain zkML brain
// 
// A single-layer perceptron that executes directly on-chain as a quick gatekeeper
// before expensive Groth16/STARK proofs. Blocks obviously bad actions immediately.
//
// Features:
// - ~10k gas execution
// - No external prover needed
// - Pre-trained weights stored on-chain
// - Configurable thresholds per model

use starknet::ContractAddress;

#[starknet::interface]
pub trait ICairoPerceptron<TContractState> {
    /// Run the perceptron with given inputs
    /// Returns true if the weighted sum exceeds threshold (action allowed)
    fn predict(
        self: @TContractState,
        inputs: Span<felt252>
    ) -> bool;
    
    /// Get the current model parameters
    fn get_model_params(self: @TContractState) -> (Span<felt252>, felt252, felt252);
    
    /// Update model weights (admin only)
    fn update_weights(
        ref self: TContractState,
        weights: Span<felt252>,
        bias: felt252,
        threshold: felt252
    );
    
    /// Set the model name/description
    fn set_model_name(ref self: TContractState, name: felt252);
    
    /// Get model name
    fn get_model_name(self: @TContractState) -> felt252;
    
    /// Get expected input count
    fn get_input_count(self: @TContractState) -> u32;
}

#[starknet::contract]
mod CairoPerceptron {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{StoragePointerReadAccess, StoragePointerWriteAccess,
                  Vec, VecTrait, MutableVecTrait}
    };
    
    const MAX_INPUTS: u32 = 8;  // Maximum 8 input features
    
    #[storage]
    struct Storage {
        // Model parameters
        weights: Vec<felt252>,
        bias: felt252,
        threshold: felt252,
        input_count: u32,
        
        // Metadata
        model_name: felt252,
        admin: ContractAddress,
        
        // Stats
        total_predictions: u64,
        total_passes: u64,
        total_fails: u64,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Prediction: Prediction,
        WeightsUpdated: WeightsUpdated,
    }
    
    #[derive(Drop, starknet::Event)]
    struct Prediction {
        #[key]
        caller: ContractAddress,
        result: bool,
        weighted_sum: felt252,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct WeightsUpdated {
        #[key]
        admin: ContractAddress,
        input_count: u32,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        initial_weights: Span<felt252>,
        initial_bias: felt252,
        initial_threshold: felt252,
        model_name: felt252
    ) {
        self.admin.write(admin);
        self.bias.write(initial_bias);
        self.threshold.write(initial_threshold);
        self.model_name.write(model_name);
        self.total_predictions.write(0);
        self.total_passes.write(0);
        self.total_fails.write(0);
        
        // Store weights
        let weight_count = initial_weights.len();
        assert(weight_count <= MAX_INPUTS, 'Too many weights');
        self.input_count.write(weight_count);
        
        let mut i: u32 = 0;
        loop {
            if i >= weight_count {
                break;
            }
            self.weights.append().write(*initial_weights.at(i));
            i += 1;
        };
    }
    
    #[abi(embed_v0)]
    impl CairoPerceptronImpl of super::ICairoPerceptron<ContractState> {
        fn predict(
            self: @ContractState,
            inputs: Span<felt252>
        ) -> bool {
            let expected_count = self.input_count.read();
            assert(inputs.len() == expected_count, 'Input count mismatch');
            
            // Compute weighted sum: sum(inputs[i] * weights[i]) + bias
            let mut weighted_sum: felt252 = self.bias.read();
            let mut i: u32 = 0;
            
            loop {
                if i >= expected_count {
                    break;
                }
                let input = *inputs.at(i);
                let weight = self.weights.at(i.into()).read();
                weighted_sum = weighted_sum + (input * weight);
                i += 1;
            };
            
            // Compare against threshold
            let threshold = self.threshold.read();
            
            // Convert to u256 for comparison (felt252 doesn't have PartialOrd)
            let sum_u256: u256 = weighted_sum.into();
            let threshold_u256: u256 = threshold.into();
            sum_u256 > threshold_u256
        }
        
        fn get_model_params(self: @ContractState) -> (Span<felt252>, felt252, felt252) {
            let count = self.input_count.read();
            let mut weights_arr: Array<felt252> = array![];
            
            let mut i: u32 = 0;
            loop {
                if i >= count {
                    break;
                }
                weights_arr.append(self.weights.at(i.into()).read());
                i += 1;
            };
            
            (weights_arr.span(), self.bias.read(), self.threshold.read())
        }
        
        fn update_weights(
            ref self: ContractState,
            weights: Span<felt252>,
            bias: felt252,
            threshold: felt252
        ) {
            assert(get_caller_address() == self.admin.read(), 'Only admin');
            
            let weight_count = weights.len();
            assert(weight_count <= MAX_INPUTS, 'Too many weights');
            
            // Clear existing weights and add new ones
            // Note: Vec doesn't have clear(), so we need to handle this differently
            // For simplicity, we just overwrite existing slots
            let old_count = self.input_count.read();
            
            let mut i: u32 = 0;
            loop {
                if i >= weight_count {
                    break;
                }
                if i < old_count {
                    // Overwrite existing slot
                    self.weights.at(i.into()).write(*weights.at(i));
                } else {
                    // Append new slot
                    self.weights.append().write(*weights.at(i));
                }
                i += 1;
            };
            
            self.input_count.write(weight_count);
            self.bias.write(bias);
            self.threshold.write(threshold);
            
            self.emit(WeightsUpdated {
                admin: get_caller_address(),
                input_count: weight_count,
                timestamp: get_block_timestamp(),
            });
        }
        
        fn set_model_name(ref self: ContractState, name: felt252) {
            assert(get_caller_address() == self.admin.read(), 'Only admin');
            self.model_name.write(name);
        }
        
        fn get_model_name(self: @ContractState) -> felt252 {
            self.model_name.read()
        }
        
        fn get_input_count(self: @ContractState) -> u32 {
            self.input_count.read()
        }
    }
    
    // External function to get stats
    #[external(v0)]
    fn get_stats(self: @ContractState) -> (u64, u64, u64) {
        (self.total_predictions.read(), self.total_passes.read(), self.total_fails.read())
    }
    
    // Predict with event emission (for tracking)
    #[external(v0)]
    fn predict_and_log(ref self: ContractState, inputs: Span<felt252>) -> bool {
        let result = self.predict(inputs);
        
        // Update stats
        let total = self.total_predictions.read();
        self.total_predictions.write(total + 1);
        
        if result {
            let passes = self.total_passes.read();
            self.total_passes.write(passes + 1);
        } else {
            let fails = self.total_fails.read();
            self.total_fails.write(fails + 1);
        }
        
        // Compute weighted sum for event
        let mut weighted_sum: felt252 = self.bias.read();
        let expected_count = self.input_count.read();
        let mut i: u32 = 0;
        loop {
            if i >= expected_count {
                break;
            }
            let input = *inputs.at(i);
            let weight = self.weights.at(i.into()).read();
            weighted_sum = weighted_sum + (input * weight);
            i += 1;
        };
        
        self.emit(Prediction {
            caller: get_caller_address(),
            result,
            weighted_sum,
            timestamp: get_block_timestamp(),
        });
        
        result
    }
}
