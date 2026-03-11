pub mod agent_composer;
pub mod agent_identity;
pub mod agent_performance_store;
pub mod agent_skill_registry;
pub mod allocation_router;
pub mod batch_verifier;
pub mod cairo_perceptron;
pub mod collateral_vault;
pub mod compliance_profile;
// pub mod confidential_lp_position; // scarb 2.14 assignment syntax migration pending
pub mod confidential_transfer;
pub mod constraint_receipt;
pub mod receipt_registry;
pub mod dao_constraint_manager;
pub mod ekubo_lp_adapter;
pub mod erc20_interface;
pub mod fully_shielded_pool;
pub mod hashed_withdraw_pool;
pub mod intent_commitment;
pub mod l1_ezkl_bridge_receiver;
pub mod lending_adapter;
pub mod lending_pool;
pub mod merkle_tree;
pub mod mock_fact_registry;
pub mod model_registry;
pub mod obsqra_fact_registry;
// pub mod proof_gated_lp_agent; // scarb 2.14 assignment syntax migration pending
pub mod proof_gated_yield_agent;
pub mod relayer;
pub mod reputation_registry;
pub mod selective_disclosure;
pub mod session_key_manager;
// pub mod shielded_pool; // scarb 2.14 assignment syntax migration pending
pub mod staking_adapter;
pub mod strk_btc;
pub mod strategy_adapter;
pub mod tier2h_escrow;
pub mod tiered_agent_controller;
pub mod validation_proof_registry;
pub mod vault_controller;
pub mod zkml_verifier;

// Garaga verifiers for reputation circuits
pub mod verifiers {
    pub mod ExecutionIntegrityVerifier;
    pub mod RiskPassportTierVerifier;
    pub mod SolvencyProofVerifier;
    pub mod StrategyIntegrityVerifier;
    pub mod TraderPerformanceVerifier;
}
