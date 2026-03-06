//! RISC Zero Guest Program: Credit Score Neural Network
//!
//! This program runs inside the zkVM and computes a credit score from
//! private on-chain history data. Only the resulting tier/score is revealed.

#![no_main]

use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};

risc0_zkvm::guest::entry!(main);

/// Chain history input (private)
#[derive(Debug, Deserialize, Default)]
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

/// Credit proof output (public)
#[derive(Debug, Serialize)]
pub struct CreditOutput {
    pub tier: u8,   // 0=AAA, 1=AA, 2=A, 3=B, 4=C
    pub score: u16, // 300-850
}

/// Simple 3-layer neural network for credit scoring
/// Architecture: 12 inputs -> 8 hidden -> 4 hidden -> 1 output
struct NeuralNetwork {
    // Weights layer 1: 12x8
    w1: [[i32; 8]; 12],
    b1: [i32; 8],
    // Weights layer 2: 8x4
    w2: [[i32; 4]; 8],
    b2: [i32; 4],
    // Weights layer 3: 4x1
    w3: [i32; 4],
    b3: i32,
}

impl NeuralNetwork {
    fn new() -> Self {
        // Pre-trained weights (scaled by 1000 for fixed-point)
        NeuralNetwork {
            w1: [
                [120, -80, 150, 40, -30, 90, 60, -20],   // tx_count
                [200, 150, -50, 80, 100, -40, 30, 70],   // volume
                [50, 80, 120, -30, 60, 40, -10, 90],     // first_tx
                [180, 60, 90, 130, -20, 80, 50, -40],    // success
                [-200, -150, -80, -40, -100, -60, -30, -20], // failed
                [100, 120, 80, 60, 90, 40, 70, 30],      // protocols
                [60, 40, 80, 100, 50, 30, 90, -20],      // avg_pos
                [40, 30, 50, 80, -10, 60, 40, 20],       // max_pos
                [-300, -200, -150, -100, -80, -60, -40, -20], // liquidations
                [250, 180, 140, 100, 80, 60, 40, 20],    // repayment
                [100, 80, 120, 60, 40, 90, 30, 50],      // diversity
                [150, 100, 80, 60, 120, 40, 70, 30],     // tenure
            ],
            b1: [100, 80, 60, 40, 120, 50, 30, 70],
            w2: [
                [200, 150, 100, 50],
                [180, 120, 80, 40],
                [160, 100, 60, 30],
                [140, 80, 40, 20],
                [120, 60, 20, 10],
                [100, 40, 80, 60],
                [80, 20, 60, 40],
                [60, 100, 40, 20],
            ],
            b2: [200, 150, 100, 50],
            w3: [400, 300, 200, 100],
            b3: 500,
        }
    }

    fn relu(x: i32) -> i32 {
        if x > 0 { x } else { 0 }
    }

    fn forward(&self, features: &[i32; 12]) -> i32 {
        // Layer 1
        let mut h1 = [0i32; 8];
        for j in 0..8 {
            let mut sum = self.b1[j];
            for i in 0..12 {
                sum += (features[i] * self.w1[i][j]) / 1000;
            }
            h1[j] = Self::relu(sum);
        }

        // Layer 2
        let mut h2 = [0i32; 4];
        for j in 0..4 {
            let mut sum = self.b2[j];
            for i in 0..8 {
                sum += (h1[i] * self.w2[i][j]) / 1000;
            }
            h2[j] = Self::relu(sum);
        }

        // Output layer
        let mut output = self.b3;
        for i in 0..4 {
            output += (h2[i] * self.w3[i]) / 1000;
        }

        output
    }
}

fn normalize_feature(value: u64, max_expected: u64) -> i32 {
    let normalized = if value > max_expected {
        1000
    } else {
        ((value * 1000) / max_expected.max(1)) as i32
    };
    normalized.min(1000)
}

fn main() {
    // Read private inputs (chain histories)
    let eth_history: ChainHistory = env::read();
    let starknet_history: ChainHistory = env::read();

    // Extract and normalize features
    let features: [i32; 12] = [
        normalize_feature(eth_history.transaction_count + starknet_history.transaction_count, 10000),
        normalize_feature(eth_history.total_volume + starknet_history.total_volume, 1_000_000_000),
        normalize_feature(
            (eth_history.first_tx_timestamp.min(starknet_history.first_tx_timestamp.max(1)))
                .saturating_sub(1577836800) / 86400,  // Days since 2020
            2000
        ),
        normalize_feature(eth_history.successful_txns + starknet_history.successful_txns, 10000),
        normalize_feature(eth_history.failed_txns + starknet_history.failed_txns, 1000),
        normalize_feature(eth_history.protocol_count + starknet_history.protocol_count, 50),
        normalize_feature(eth_history.avg_position_size + starknet_history.avg_position_size, 100_000_000),
        normalize_feature(eth_history.max_position_size + starknet_history.max_position_size, 500_000_000),
        normalize_feature(eth_history.liquidation_count + starknet_history.liquidation_count, 10),
        normalize_feature((eth_history.repayment_rate + starknet_history.repayment_rate) / 2, 100),
        normalize_feature((eth_history.diversity_score + starknet_history.diversity_score) / 2, 100),
        normalize_feature(eth_history.tenure_days.max(starknet_history.tenure_days), 2000),
    ];

    // Run neural network inference
    let nn = NeuralNetwork::new();
    let raw_score = nn.forward(&features);

    // Map to credit score range (300-850)
    let score: u16 = ((raw_score.max(0).min(10000) * 550) / 10000 + 300) as u16;

    // Determine tier
    let tier: u8 = if score >= 750 {
        0 // AAA
    } else if score >= 650 {
        1 // AA
    } else if score >= 550 {
        2 // A
    } else if score >= 450 {
        3 // B
    } else {
        4 // C
    };

    // Commit only the public output (tier and score)
    // The input histories remain private
    let output = CreditOutput { tier, score };
    env::commit(&output);
}
