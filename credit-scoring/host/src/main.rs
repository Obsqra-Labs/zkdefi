//! RISC Zero Host: Credit Scoring Proof Generator
//!
//! Generates ZK proofs of credit scores from private chain history data.
//! Usage: credit-scoring-host <eth_history_json> <starknet_history_json>
//! Output: JSON with tier, score, proof, and image_id

use methods::{CREDIT_SCORER_ELF, CREDIT_SCORER_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::{Deserialize, Serialize};
use std::env;

/// Chain history input (must match guest program)
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ChainHistory {
    pub transaction_count: u64,
    pub total_volume: u64,
    pub first_tx_timestamp: u64,
    pub successful_txns: u64,
    pub failed_txns: u64,
    pub protocol_count: u64,
    pub avg_position_size: u64,
    pub max_position_size: u64,
    pub liquidation_count: u64,
    pub repayment_rate: u64,
    pub diversity_score: u64,
    pub tenure_days: u64,
}

/// Credit proof output (must match guest program)
#[derive(Debug, Deserialize)]
pub struct CreditOutput {
    pub tier: u8,
    pub score: u16,
}

/// JSON output format
#[derive(Debug, Serialize)]
pub struct ProofOutput {
    pub tier: String,
    pub score: u16,
    pub factors: Vec<String>,
    pub proof: String,
    pub public_inputs: String,
    pub image_id: String,
}

fn tier_to_string(tier: u8) -> String {
    match tier {
        0 => "AAA".to_string(),
        1 => "AA".to_string(),
        2 => "A".to_string(),
        3 => "B".to_string(),
        _ => "C".to_string(),
    }
}

fn determine_factors(eth: &ChainHistory, starknet: &ChainHistory, score: u16) -> Vec<String> {
    let mut factors = Vec::new();

    // Cross-chain activity
    if eth.transaction_count > 0 && starknet.transaction_count > 0 {
        factors.push("cross_chain_activity".to_string());
    }

    // High volume
    let total_volume = eth.total_volume + starknet.total_volume;
    if total_volume > 100_000_000 {
        factors.push("high_transaction_volume".to_string());
    }

    // Protocol diversity
    let total_protocols = eth.protocol_count + starknet.protocol_count;
    if total_protocols > 5 {
        factors.push("protocol_diversity".to_string());
    }

    // Tenure
    let max_tenure = eth.tenure_days.max(starknet.tenure_days);
    if max_tenure > 365 {
        factors.push("long_tenure".to_string());
    } else if max_tenure < 30 {
        factors.push("limited_history".to_string());
    }

    // Repayment
    let avg_repayment = (eth.repayment_rate + starknet.repayment_rate) / 2;
    if avg_repayment >= 95 {
        factors.push("excellent_repayment".to_string());
    }

    // Liquidations
    if eth.liquidation_count + starknet.liquidation_count > 0 {
        factors.push("liquidation_history".to_string());
    }

    // Success rate
    let total_success = eth.successful_txns + starknet.successful_txns;
    let total_failed = eth.failed_txns + starknet.failed_txns;
    if total_success + total_failed > 0 {
        let rate = (total_success * 100) / (total_success + total_failed);
        if rate >= 95 {
            factors.push("excellent_success_rate".to_string());
        }
    }

    if factors.is_empty() {
        factors.push("standard_profile".to_string());
    }

    factors
}

fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::filter::EnvFilter::from_default_env())
        .init();

    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        eprintln!("Usage: {} <eth_history_json> <starknet_history_json>", args[0]);
        std::process::exit(1);
    }

    // Parse input JSON
    let eth_history: ChainHistory = serde_json::from_str(&args[1])
        .unwrap_or_else(|e| {
            eprintln!("Failed to parse ETH history: {}", e);
            ChainHistory::default()
        });

    let starknet_history: ChainHistory = serde_json::from_str(&args[2])
        .unwrap_or_else(|e| {
            eprintln!("Failed to parse Starknet history: {}", e);
            ChainHistory::default()
        });

    // Build executor environment with inputs
    let env = ExecutorEnv::builder()
        .write(&eth_history)
        .unwrap()
        .write(&starknet_history)
        .unwrap()
        .build()
        .unwrap();

    // Get prover and generate proof
    let prover = default_prover();
    let prove_info = prover.prove(env, CREDIT_SCORER_ELF)
        .expect("Proof generation failed");

    let receipt = prove_info.receipt;

    // Decode journal output
    let output: CreditOutput = receipt.journal.decode()
        .expect("Failed to decode output");

    // Verify the receipt
    receipt.verify(CREDIT_SCORER_ID)
        .expect("Proof verification failed");

    // Serialize proof to hex
    let proof_bytes = bincode::serialize(&receipt)
        .expect("Failed to serialize receipt");
    let proof_hex = hex::encode(&proof_bytes);

    // Get public inputs (journal)
    let journal_hex = hex::encode(&receipt.journal.bytes);

    // Get image ID (convert [u32; 8] to bytes)
    let image_id_bytes: Vec<u8> = CREDIT_SCORER_ID
        .iter()
        .flat_map(|x| x.to_le_bytes())
        .collect();
    let image_id_hex = hex::encode(&image_id_bytes);

    // Determine factors
    let factors = determine_factors(&eth_history, &starknet_history, output.score);

    // Build output
    let result = ProofOutput {
        tier: tier_to_string(output.tier),
        score: output.score,
        factors,
        proof: proof_hex,
        public_inputs: journal_hex,
        image_id: image_id_hex,
    };

    // Print JSON output
    println!("{}", serde_json::to_string(&result).unwrap());
}
