//! RISC Zero Credit Scoring Host Program
//! 
//! This program runs on the host and generates ZK proofs for credit scoring.
//! The neural network inference runs inside the RISC Zero guest program.

use methods::{CREDIT_SCORING_ELF, CREDIT_SCORING_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::{Deserialize, Serialize};

/// Credit history data from a chain
#[derive(Debug, Serialize, Deserialize)]
pub struct ChainHistory {
    pub transaction_count: u64,
    pub total_volume: u64,
    pub first_tx_timestamp: u64,
    pub successful_txns: u64,
    pub failed_txns: u64,
    pub protocol_count: u32,
    pub avg_position_size: u64,
    pub max_position_size: u64,
    pub liquidation_count: u32,
    pub repayment_rate: u32, // 0-100
    pub diversity_score: u32, // 0-100
    pub tenure_days: u32,
}

/// Credit scoring result
#[derive(Debug, Serialize, Deserialize)]
pub struct CreditResult {
    pub tier: String, // "AAA", "AA", "A", "B"
    pub score: u32,   // 300-850
    pub factors: Vec<String>,
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    
    if args.len() < 3 {
        eprintln!("Usage: credit-scoring-host <eth_history_json> <starknet_history_json>");
        std::process::exit(1);
    }
    
    // Parse chain histories from command line JSON
    let eth_history: ChainHistory = serde_json::from_str(&args[1])?;
    let starknet_history: ChainHistory = serde_json::from_str(&args[2])?;
    
    // Build the executor environment with private inputs
    let env = ExecutorEnv::builder()
        .write(&eth_history)?
        .write(&starknet_history)?
        .build()?;
    
    // Generate the proof
    let prover = default_prover();
    let prove_info = prover.prove(env, CREDIT_SCORING_ELF)?;
    
    // Extract the receipt (proof)
    let receipt = prove_info.receipt;
    
    // Verify the proof locally
    receipt.verify(CREDIT_SCORING_ID)?;
    
    // Decode the public output (credit tier)
    let output: CreditResult = receipt.journal.decode()?;
    
    // Output result as JSON for the Python service
    let result = serde_json::json!({
        "tier": output.tier,
        "score": output.score,
        "factors": output.factors,
        "proof": hex::encode(bincode::serialize(&receipt)?),
        "public_inputs": hex::encode(receipt.journal.bytes.clone()),
        "image_id": hex::encode(CREDIT_SCORING_ID)
    });
    
    println!("{}", serde_json::to_string(&result)?);
    
    Ok(())
}
