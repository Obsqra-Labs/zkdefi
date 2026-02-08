// zkML Verifier: Verifies Groth16 proofs from zkML models via Garaga.
// Supports: risk score proofs, anomaly detection proofs.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IGaragaVerifier<TContractState> {
    fn verify_groth16_proof_bn254(
        self: @TContractState,
        proof_calldata: Span<felt252>
    ) -> bool;
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct ZkmlProofRecord {
    pub proof_type: felt252,        // 'risk_score' or 'anomaly'
    pub user: ContractAddress,
    pub commitment_hash: felt252,
    pub is_valid: bool,
    pub timestamp: u64,
}

#[starknet::interface]
pub trait IZkmlVerifier<TContractState> {
    // Verify and store risk score proof
    fn verify_risk_score_proof(
        ref self: TContractState,
        proof_calldata: Span<felt252>,
        commitment_hash: felt252
    ) -> bool;
    
    // Verify and store anomaly detection proof
    fn verify_anomaly_proof(
        ref self: TContractState,
        proof_calldata: Span<felt252>,
        pool_id: felt252,
        commitment_hash: felt252
    ) -> bool;
    
    // Verify combined proofs for rebalancing
    fn verify_combined_proofs(
        ref self: TContractState,
        risk_proof_calldata: Span<felt252>,
        anomaly_proof_calldata: Span<felt252>,
        pool_id: felt252,
        commitment_hash: felt252
    ) -> bool;
    
    // Check if a proof was verified
    fn is_proof_verified(self: @TContractState, commitment_hash: felt252) -> bool;
    
    // Get proof record
    fn get_proof_record(self: @TContractState, commitment_hash: felt252) -> ZkmlProofRecord;
    
    // Get user's proof count
    fn get_user_proof_count(self: @TContractState, user: ContractAddress) -> u64;
    
    // Get Garaga verifier address
    fn get_garaga_verifier(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
mod ZkmlVerifier {
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp,
        storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess,
                  StorageMapReadAccess, StorageMapWriteAccess}
    };
    
    use super::IGaragaVerifierDispatcher;
    use super::IGaragaVerifierDispatcherTrait;
    use super::ZkmlProofRecord;
    
    #[storage]
    struct Storage {
        garaga_verifier: ContractAddress,
        proof_records: Map<felt252, ZkmlProofRecord>,
        verified_proofs: Map<felt252, bool>,
        user_proof_count: Map<ContractAddress, u64>,
        user_proofs: Map<(ContractAddress, u64), felt252>,
        admin: ContractAddress,
    }
    
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        RiskScoreVerified: RiskScoreVerified,
        AnomalyProofVerified: AnomalyProofVerified,
        CombinedProofsVerified: CombinedProofsVerified,
    }
    
    #[derive(Drop, starknet::Event)]
    struct RiskScoreVerified {
        #[key]
        user: ContractAddress,
        commitment_hash: felt252,
        is_compliant: bool,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct AnomalyProofVerified {
        #[key]
        user: ContractAddress,
        #[key]
        pool_id: felt252,
        commitment_hash: felt252,
        is_safe: bool,
        timestamp: u64,
    }
    
    #[derive(Drop, starknet::Event)]
    struct CombinedProofsVerified {
        #[key]
        user: ContractAddress,
        #[key]
        pool_id: felt252,
        commitment_hash: felt252,
        can_proceed: bool,
        timestamp: u64,
    }
    
    #[constructor]
    fn constructor(
        ref self: ContractState,
        garaga_verifier: ContractAddress,
        admin: ContractAddress
    ) {
        self.garaga_verifier.write(garaga_verifier);
        self.admin.write(admin);
    }
    
    #[abi(embed_v0)]
    impl ZkmlVerifierImpl of super::IZkmlVerifier<ContractState> {
        fn verify_risk_score_proof(
            ref self: ContractState,
            proof_calldata: Span<felt252>,
            commitment_hash: felt252
        ) -> bool {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Call Garaga verifier
            let garaga = IGaragaVerifierDispatcher {
                contract_address: self.garaga_verifier.read()
            };
            let is_valid = garaga.verify_groth16_proof_bn254(proof_calldata);
            
            // Store proof record
            let record = ZkmlProofRecord {
                proof_type: 'risk_score',
                user: caller,
                commitment_hash,
                is_valid,
                timestamp,
            };
            self.proof_records.write(commitment_hash, record);
            self.verified_proofs.write(commitment_hash, is_valid);
            
            // Track user proofs
            let count = self.user_proof_count.read(caller);
            self.user_proofs.write((caller, count), commitment_hash);
            self.user_proof_count.write(caller, count + 1);
            
            // Emit event
            self.emit(RiskScoreVerified {
                user: caller,
                commitment_hash,
                is_compliant: is_valid,
                timestamp,
            });
            
            is_valid
        }
        
        fn verify_anomaly_proof(
            ref self: ContractState,
            proof_calldata: Span<felt252>,
            pool_id: felt252,
            commitment_hash: felt252
        ) -> bool {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Call Garaga verifier
            let garaga = IGaragaVerifierDispatcher {
                contract_address: self.garaga_verifier.read()
            };
            let is_valid = garaga.verify_groth16_proof_bn254(proof_calldata);
            
            // Store proof record
            let record = ZkmlProofRecord {
                proof_type: 'anomaly',
                user: caller,
                commitment_hash,
                is_valid,
                timestamp,
            };
            self.proof_records.write(commitment_hash, record);
            self.verified_proofs.write(commitment_hash, is_valid);
            
            // Track user proofs
            let count = self.user_proof_count.read(caller);
            self.user_proofs.write((caller, count), commitment_hash);
            self.user_proof_count.write(caller, count + 1);
            
            // Emit event
            self.emit(AnomalyProofVerified {
                user: caller,
                pool_id,
                commitment_hash,
                is_safe: is_valid,
                timestamp,
            });
            
            is_valid
        }
        
        fn verify_combined_proofs(
            ref self: ContractState,
            risk_proof_calldata: Span<felt252>,
            anomaly_proof_calldata: Span<felt252>,
            pool_id: felt252,
            commitment_hash: felt252
        ) -> bool {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Call Garaga verifier for both proofs
            let garaga = IGaragaVerifierDispatcher {
                contract_address: self.garaga_verifier.read()
            };
            
            let risk_valid = garaga.verify_groth16_proof_bn254(risk_proof_calldata);
            let anomaly_valid = garaga.verify_groth16_proof_bn254(anomaly_proof_calldata);
            
            let can_proceed = risk_valid && anomaly_valid;
            
            // Store combined proof record
            let record = ZkmlProofRecord {
                proof_type: 'combined',
                user: caller,
                commitment_hash,
                is_valid: can_proceed,
                timestamp,
            };
            self.proof_records.write(commitment_hash, record);
            self.verified_proofs.write(commitment_hash, can_proceed);
            
            // Track user proofs
            let count = self.user_proof_count.read(caller);
            self.user_proofs.write((caller, count), commitment_hash);
            self.user_proof_count.write(caller, count + 1);
            
            // Emit event
            self.emit(CombinedProofsVerified {
                user: caller,
                pool_id,
                commitment_hash,
                can_proceed,
                timestamp,
            });
            
            can_proceed
        }
        
        fn is_proof_verified(self: @ContractState, commitment_hash: felt252) -> bool {
            self.verified_proofs.read(commitment_hash)
        }
        
        fn get_proof_record(self: @ContractState, commitment_hash: felt252) -> ZkmlProofRecord {
            self.proof_records.read(commitment_hash)
        }
        
        fn get_user_proof_count(self: @ContractState, user: ContractAddress) -> u64 {
            self.user_proof_count.read(user)
        }
        
        fn get_garaga_verifier(self: @ContractState) -> ContractAddress {
            self.garaga_verifier.read()
        }
    }
}
