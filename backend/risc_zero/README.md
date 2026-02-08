# RISC Zero Credit Scoring

ZK-provable credit scoring using a neural network running inside the RISC Zero zkVM.

## Overview

This project generates zero-knowledge proofs for credit scoring that:
- **Keeps chain histories private** - ETH and Starknet transaction data never leaves the user's device
- **Reveals only the tier** - AAA, AA, A, or B (not the raw score)
- **Is verifiable on-chain** - The proof can be verified by a smart contract

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Host Program                            │
│                                                             │
│  1. Receives chain histories (ETH, Starknet)               │
│  2. Passes to RISC Zero zkVM                               │
│  3. Returns proof + public output (tier)                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Guest Program (zkVM)                    │
│                                                             │
│  1. Extracts features from chain histories                 │
│  2. Runs neural network inference (12→24→12→1)             │
│  3. Converts score to tier                                 │
│  4. Commits tier as public output                          │
└─────────────────────────────────────────────────────────────┘
```

## Neural Network Architecture

- **Input Layer**: 12 features extracted from chain histories
  - Transaction volume (log-normalized)
  - Transaction count
  - Success rate
  - Protocol diversity
  - Liquidation penalty
  - Repayment rate
  - Diversity score
  - Tenure (log-normalized)
  - Average position size
  - Max position size
  - Cross-chain activity bonus
  - Consistency factor

- **Hidden Layer 1**: 24 neurons (ReLU activation)
- **Hidden Layer 2**: 12 neurons (ReLU activation)
- **Output Layer**: 1 neuron (credit score 300-850)

## Credit Tiers

| Tier | Score Range | Yield Bonus |
|------|-------------|-------------|
| AAA  | 750-850     | +2.0% APY   |
| AA   | 650-749     | +1.0% APY   |
| A    | 550-649     | +0.5% APY   |
| B    | 300-549     | +0.0% APY   |

## Prerequisites

1. Install RISC Zero toolchain:
```bash
curl -L https://risczero.com/install | bash
rzup
```

2. Verify installation:
```bash
cargo risczero --version
```

## Building

```bash
cd /opt/obsqra.starknet/zkdefi/backend/risc_zero
cargo build --release
```

## Usage

```bash
./target/release/credit-scoring-host \
  '{"transaction_count":100,"total_volume":1000000,...}' \
  '{"transaction_count":50,"total_volume":500000,...}'
```

Output:
```json
{
  "tier": "AA",
  "score": 720,
  "factors": ["High transaction volume", "Cross-chain activity"],
  "proof": "0x...",
  "public_inputs": "0x...",
  "image_id": "0x..."
}
```

## Integration

The Python service at `app/services/risc_zero_credit_service.py` handles:
- Calling the host program
- Parsing the output
- Providing a fallback when RISC Zero is not available

## Privacy Guarantees

- **Private Inputs**: Chain histories (all transaction data)
- **Public Outputs**: Credit tier (AAA/AA/A/B), yield bonus, contributing factors
- **Never Revealed**: Raw credit score, individual transaction details, wallet balances
