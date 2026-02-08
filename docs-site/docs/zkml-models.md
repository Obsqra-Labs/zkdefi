# zkML Models

zkde.fi uses two privacy-preserving machine learning models to gate agent decisions. Both models generate Groth16 proofs verified on-chain via Garaga.

## Overview

| Model | Purpose | Input (Private) | Output (Public) |
|-------|---------|-----------------|-----------------|
| Risk Score | Portfolio risk assessment | Features, weights | Proof that score ≤ threshold |
| Anomaly Detector | Pool/protocol safety | Pool data, analysis | Proof that no anomaly detected |

## Risk Score Model

### Circuit: `RiskScore.circom`

Evaluates portfolio risk from 8 features and proves the score is within acceptable bounds **without revealing the actual score**.

#### Features (Private)
1. `total_balance` - Scaled balance value
2. `position_concentration` - % in largest position (0-100)
3. `protocol_diversity` - Inverse of protocol count
4. `volatility_exposure` - Exposure to volatile assets (0-100)
5. `liquidity_depth` - Available liquidity (0-100)
6. `time_in_position` - Days in current position
7. `recent_drawdown` - Recent loss % (0-100)
8. `correlation_risk` - Cross-asset correlation (0-100)

#### Model (Private)
```
risk_score = Σ(feature_i × weight_i) + bias
```

#### Proof Output (Public)
- `is_compliant`: Boolean (1 if risk_score ≤ threshold)
- `commitment_hash`: Binding to user/action

#### Privacy Guarantees
- Actual risk score is **never revealed**
- Portfolio features stay **private**
- Model weights are **private**
- Only compliance status is **public**

### API Endpoint

```bash
POST /api/v1/zkdefi/zkml/risk_score
```

**Request:**
```json
{
  "user_address": "0x...",
  "portfolio_features": [50, 30, 20, 20, 50, 30, 10, 20],
  "threshold": 30
}
```

**Response:**
```json
{
  "proof_type": "risk_score",
  "is_compliant": true,
  "threshold": 30,
  "commitment_hash": "0x...",
  "proof_calldata": ["0x...", "0x...", ...]
}
```

## Anomaly Detector Model

### Circuit: `AnomalyDetector.circom`

Analyzes pool/protocol safety from 6 risk factors and proves the pool is safe **without revealing the analysis details**.

#### Risk Factors (Private)
1. `tvl_volatility` - TVL volatility (0-1000)
2. `liquidity_concentration` - % held by top providers (0-100)
3. `price_impact_score` - Price impact of trades (0-1000)
4. `deployer_age_days` - Days since contract deployment
5. `volume_anomaly` - Deviation from normal volume (0-1000)
6. `contract_risk_score` - Static analysis score (0-100)

#### Model (Private)
```
For each factor:
  if factor > threshold: penalty += weight
  
anomaly_flag = 1 if total_penalty ≥ max_anomaly_score else 0
```

#### Proof Output (Public)
- `is_safe`: Boolean (1 if anomaly_flag == 0)
- `anomaly_flag`: 0 (safe) or 1 (anomaly)
- `commitment_hash`: Binding to pool/user

#### Privacy Guarantees
- Pool analysis details are **never revealed**
- Detection logic stays **private**
- Individual risk factors stay **private**
- Only safety status is **public**

### API Endpoint

```bash
POST /api/v1/zkdefi/zkml/anomaly
```

**Request:**
```json
{
  "user_address": "0x...",
  "pool_id": "ekubo_eth_usdc",
  "tvl_volatility": 200,
  "liquidity_concentration": 40,
  "price_impact_score": 150,
  "deployer_age_days": 365,
  "volume_anomaly": 100,
  "contract_risk_score": 20
}
```

**Response:**
```json
{
  "proof_type": "anomaly_detection",
  "pool_id": "ekubo_eth_usdc",
  "is_safe": true,
  "anomaly_flag": 0,
  "commitment_hash": "0x...",
  "proof_calldata": ["0x...", "0x...", ...]
}
```

## Combined Proofs

For rebalancing, both models are run together.

### API Endpoint

```bash
POST /api/v1/zkdefi/zkml/combined
```

**Request:**
```json
{
  "user_address": "0x...",
  "pool_id": "ekubo_eth_usdc",
  "portfolio_features": [50, 30, 20, 20, 50, 30, 10, 20],
  "risk_threshold": 30
}
```

**Response:**
```json
{
  "can_proceed": true,
  "commitment_hash": "0x...",
  "risk_proof": { ... },
  "anomaly_proof": { ... },
  "combined_calldata": {
    "risk_calldata": [...],
    "anomaly_calldata": [...]
  }
}
```

## On-Chain Verification

Both proofs are verified on-chain using the `ZkmlVerifier` contract:

```cairo
fn verify_combined_proofs(
    risk_proof_calldata: Span<felt252>,
    anomaly_proof_calldata: Span<felt252>,
    pool_id: felt252,
    commitment_hash: felt252
) -> bool
```

The contract calls Garaga's `verify_groth16_proof_bn254` function for each proof.

## Extending the Models

To add new features or change the model:

1. Update the circuit (`circuits/*.circom`)
2. Run trusted setup (`snarkjs groth16 setup`)
3. Generate verification key
4. Deploy updated verifier contract
5. Update backend service

Note: Changing the model requires a new trusted setup ceremony.
