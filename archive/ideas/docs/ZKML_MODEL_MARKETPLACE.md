# zkML Model Marketplace

Compose custom agents by combining multiple zero-knowledge machine learning models. Each model generates a cryptographic proof that verifies computations without revealing private data.

## Overview

The zkML Model Marketplace allows users to:

1. **Select Models**: Choose from available zkML models (Groth16 and RISC Zero)
2. **Compose Agents**: Combine multiple models with decision logic (AND/OR)
3. **Execute**: Generate proofs in parallel via the multi-processor orchestrator
4. **Verify**: Submit execution proofs on-chain for trustless verification

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        zkde.fi                              │
│  ┌───────────────┐    ┌───────────────┐    ┌────────────┐  │
│  │ ModelComposer │ -> │ AgentService  │ -> │  MyAgents  │  │
│  │  (Frontend)   │    │  (Backend)    │    │ (Frontend) │  │
│  └───────────────┘    └───────┬───────┘    └────────────┘  │
└──────────────────────────────│──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   starknet.obsqra.fi                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Multi-Processor Orchestrator               │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐   │  │
│  │  │  Groth16    │ │   Groth16   │ │  RISC Zero   │   │  │
│  │  │ RiskScore   │ │ Correlation │ │ CreditScore  │   │  │
│  │  └─────────────┘ └─────────────┘ └──────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                       Starknet                              │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │ModelRegistry │  │ AgentComposer │  │ FactRegistry    │  │
│  └──────────────┘  └───────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Available Models

### Groth16 Models (Fast, Compact Proofs)

| Model | Description | Proof Time |
|-------|-------------|------------|
| **Risk Scoring** | zkML risk assessment from portfolio features | ~10s |
| **Correlation Risk** | Proves portfolio correlation below threshold | ~10s |
| **TWAP Position** | Proves 7-day time-weighted average within limits | ~10s |
| **Safety Diversification** | Proves diversification across safety-rated protocols | ~10s |
| **Anomaly Detection** | Detects suspicious activity patterns | ~10s |

### RISC Zero Models (Complex Computations)

| Model | Description | Proof Time |
|-------|-------------|------------|
| **Credit Scoring** | Cross-chain reputation using neural network inference | ~120s |

## Usage

### Creating a Composed Agent

```typescript
const response = await fetch('/api/v1/agents/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_address: '0x...',
    name: 'My Risk Agent',
    processors: ['risk_scoring', 'correlation_risk', 'twap_position'],
    decision_logic: { type: 'AND' }  // All models must pass
  })
});

const agent = await response.json();
// { id: 'abc123', name: 'My Risk Agent', processors: [...], active: true }
```

### Executing an Agent

```typescript
const response = await fetch('/api/v1/agents/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent_id: 'abc123',
    user_address: '0x...',
    portfolio: {
      positions: { ETH: 50, USDC: 30, STRK: 20 },
      daily_history: [1000, 1100, 1050, 1200, 1150, 1300, 1250],
      protocol_allocations: { jediswap: 40, ekubo: 35, nostra: 25 }
    },
    constraints: {
      max_risk_score: 70,
      max_correlation: 60,
      max_twap: 5000
    }
  })
});

const result = await response.json();
// {
//   should_execute: true,
//   proofs: [
//     { processor: 'risk_scoring', passed: true, duration_ms: 523 },
//     { processor: 'correlation_risk', passed: true, duration_ms: 487 },
//     { processor: 'twap_position', passed: true, duration_ms: 501 }
//   ],
//   execution_proof: '0x...',
//   calldata: ['3', '1', '1', '1', '0x...']
// }
```

### Decision Logic

- **AND**: Agent executes only if ALL selected models pass
- **OR**: Agent executes if ANY selected model passes

## Smart Contracts

### ModelRegistry

Registers and manages available zkML models.

```cairo
#[starknet::interface]
pub trait IModelRegistry<TContractState> {
    fn register_model(
        ref self: TContractState,
        name: felt252,
        model_type: felt252,
        verifier_address: ContractAddress
    ) -> u64;
    fn get_model(self: @TContractState, model_id: u64) -> Model;
    fn get_models_by_type(self: @TContractState, model_type: felt252) -> Array<u64>;
}
```

### AgentComposer

Composes multiple models into custom agents.

```cairo
#[starknet::interface]
pub trait IAgentComposer<TContractState> {
    fn create_agent(
        ref self: TContractState,
        name: felt252,
        model_ids: Span<u64>,
        decision_logic: felt252
    ) -> u64;
    fn execute_agent(
        ref self: TContractState,
        agent_id: u64,
        proof_results: Span<bool>,
        execution_proof_hash: felt252
    ) -> bool;
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/agents/models/list` | GET | List available models |
| `/api/v1/agents/create` | POST | Create composed agent |
| `/api/v1/agents/{id}` | GET | Get agent details |
| `/api/v1/agents/user/{address}` | GET | Get user's agents |
| `/api/v1/agents/execute` | POST | Execute agent |
| `/api/v1/agents/{id}` | DELETE | Deactivate agent |

## Cross-Chain Credit Scoring (RISC Zero)

The Credit Scoring model aggregates DeFi activity across multiple chains:

1. **Data Aggregation**: Fetches TVL, transaction counts, protocols used from:
   - Starknet
   - Ethereum
   - Arbitrum
   - Optimism
   - Polygon
   - Base

2. **Score Computation**: Weighted scoring based on:
   - DeFi Activity (25%): Volume and frequency
   - Protocol Diversity (20%): Unique protocols used
   - Historical Behavior (30%): Liquidations, failures, age
   - Cross-Chain Presence (25%): Active chain count

3. **RISC Zero Proof**: Generates zkVM proof that score computation is correct

## Running Tests

```bash
# Run E2E tests
cd /opt/obsqra.starknet/zkdefi
python tests/test_model_marketplace.py

# Or with pytest
pytest tests/test_model_marketplace.py -v
```

## Deployment

```bash
# Build and deploy contracts
cd /opt/obsqra.starknet/zkdefi
./scripts/deploy_marketplace_contracts.sh
```

## Future Roadmap

- [ ] Real RISC Zero zkVM integration (currently simulated)
- [ ] Additional Groth16 models (volatility, liquidity depth)
- [ ] Model staking and rewards
- [ ] Community model submissions
- [ ] On-chain model verification registry
- [ ] Gas-optimized batch verification
