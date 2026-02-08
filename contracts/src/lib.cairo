mod confidential_transfer;
mod erc20_interface;
mod proof_gated_yield_agent;
mod selective_disclosure;

// Privacy-first autonomous agent contracts
mod zkml_verifier;
mod session_key_manager;
mod constraint_receipt;
mod intent_commitment;
mod compliance_profile;

// v2: Reputation-tiered proving system
mod reputation_registry;
mod allocation_router;
mod tiered_agent_controller;
mod batch_verifier;
mod relayer;

// v3: Unified shielded pools (privacy + optional proof-gating)
mod shielded_pool;

// v4: Full privacy with selective disclosure
mod merkle_tree;
mod fully_shielded_pool;

// Demo/testing contracts
mod mock_fact_registry;

// Obsqra Fact Registry: on-chain persistence for node-verified STARK proofs
mod obsqra_fact_registry;

// v5: Composable zkML Marketplace
mod model_registry;
mod agent_composer;

// v6: ERC-8004 Aligned Registries
mod agent_identity;
mod validation_proof_registry;

// v7: Tiered zkML Brain
mod cairo_perceptron;
