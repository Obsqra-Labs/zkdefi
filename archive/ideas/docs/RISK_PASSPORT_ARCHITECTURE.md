# Risk Passport: Architecture and Privacy Engine

**obsqra.xyz** | zkde.fi  
**Updated:** 2026-03-03

---

## What the Risk Passport is

The Risk Passport is a composable privacy primitive that aggregates a user's on-chain reputation, credit history, and proof receipts into a single verifiable artifact. It answers one question for any counterparty: *"Does this entity meet my trust threshold?"* -- without revealing the entity's identity, transaction history, or exact scores.

It is not a dashboard. It is a protocol-level trust interface consumed by smart contracts, lending pools, cross-protocol attestation verifiers, and privacy-preserving UIs.

---

## Profile / Identity integration (user-facing)

The public Profile surface (`/profile`) is the first consumer of the passport in user UX:

- `tab=trust` displays trust posture and receipt-linked confidence context.
- `tab=reputation` exposes tier/collateral trajectory and lending readiness.
- reputation-based lending consumes passport-derived credit posture plus attestation flows for borrow eligibility.

This matters because lending should be interpreted by users as a trust-mediated capability, not as an isolated panel detached from profile context.

---

## Data architecture

### Sources (read-only aggregation)

The passport composes from five independent subsystems. It creates no data of its own.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         RISK PASSPORT                                │
│                                                                      │
│   composite_score : 0-100      letter_rating : A/B/C/D              │
│   credit_tier     : AAA-C      credit_score  : 300-850              │
│   proof_receipts  : [{...}]    aggregation_sources : [{...}]        │
│   chain_id        : felt252    attestation_hash : sha256             │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ Reputation   │  │ Identity     │  │ Receipt Service            │  │
│  │ Registry     │  │ (RISC Zero)  │  │ (proof timeline)           │  │
│  │              │  │              │  │                            │  │
│  │ tier: 0/1/2  │  │ credit_tier  │  │ risk_score proofs          │  │
│  │ tenure_days  │  │ credit_score │  │ anomaly detection proofs   │  │
│  │ volume_eth   │  │ commitment   │  │ pool_safety proofs         │  │
│  │ collateral   │  │              │  │ rebalance proofs           │  │
│  │ txn_count    │  │              │  │ credit_attestation proofs  │  │
│  └──────┬───────┘  └──────┬───────┘  │ lending_repay proofs       │  │
│         │                 │          │ policy_compile proofs       │  │
│         │                 │          └─────────────┬──────────────┘  │
│         ▼                 ▼                        ▼                 │
│  on-chain contract   zkVM binary           JSON persistence         │
│  (ReputationRegistry  (credit-scoring-     + on-chain via           │
│   0x0428...)          host via RISC Zero)   ValidationProofRegistry  │
│                                             (0x02e2...)             │
└──────────────────────────────────────────────────────────────────────┘
```

### Composite score formula

```
composite = tier * 30
           + min(tenure_days / 10, 20)
           + min(total_volume_eth * 2, 25)
           + min(collateral_eth * 10, 25)
```

Range: 0-100. Letter: A >= 80, B >= 60, C >= 40, D < 40.

### Credit line formula

```
collateral_line = collateral_eth * 0.80           (LTV)
unsecured_cap   = tier_w * letter_w * credit_w * 5.0 ETH
                  * cross_chain_multiplier
total_line      = min(collateral_line + unsecured_cap, 50 ETH)
rate_bps        = max(800 - tier_discount - letter_discount, 100)
```

Weights:
- Tier: Strict=0, Standard=0.5, Express=1.0
- Letter: A=1.0, B=0.6, C=0.3, D=0
- Credit: AAA=1.5, AA=1.2, A=1.0, B=0.5, C=0.2
- Cross-chain: 1.0 + 0.1 * linked_address_count (capped at 1.5)

---

## Circuit engine: how proofs are generated

zkde.fi runs 16 compiled Circom circuits and 1 RISC Zero zkVM binary. Each produces a Groth16 proof verified on-chain via Garaga BN254 verifiers deployed on Starknet.

### Circuit inventory

| Circuit | Private inputs | Public outputs | Purpose |
|---------|---------------|----------------|---------|
| **CreditEligibility** | credit_score, collateral_wei, blinding | eligible (1/0), min_credit_score, min_collateral, commitment_hash | Prove lending eligibility without revealing score or collateral |
| **RiskScore** | 8 portfolio features | risk_score >= threshold | Prove portfolio meets risk threshold |
| **AnomalyDetector** | 6 pool factors | anomaly flag | Prove pool safety for autonomous agent decisions |
| **CorrelationRisk** | position correlations | diversification_ok | Prove correlation risk below threshold |
| **TWAPPosition** | price history | twap_valid | Prove TWAP position validity |
| **SafetyDiversification** | allocation weights | diversified | Prove portfolio diversification |
| **BalanceAboveThreshold** | balance | balance >= min | Selective disclosure: balance above threshold |
| **PoolMembership** | member_index, merkle_path | is_member | Prove membership in privacy pool without revealing position |
| **PrivateDeposit** | amount, nonce, balance | commitment | Privacy-preserving deposit into shielded pool |
| **PrivateWithdraw** | amount, nonce, balance, secret | nullifier | Privacy-preserving withdrawal with double-spend prevention |
| **FullPrivacyWithdraw** | balance, nonce, merkle_proof, recipient | nullifier, merkle_root | Full privacy withdrawal from Merkle tree pool |
| **FullPrivacyWithdrawWithChange** | balance, withdraw_amount, merkle_proof | nullifier, new_commitment, merkle_root | Partial withdrawal with change commitment |
| **FullPrivacyWithdrawHashed** | same + hash preimage | hashed nullifier | Hashed variant for additional privacy |
| **TenureAboveThreshold** | tenure_days | tenure >= min | Prove minimum tenure for tier upgrade |

### RISC Zero circuit (zkVM)

| Binary | Inputs | Output | Purpose |
|--------|--------|--------|---------|
| **credit-scoring-host** | 12 chain history features (ETH + Starknet) | credit_tier (AAA/AA/A/B/C), credit_score (300-850) | Neural network inference inside zkVM; proves cross-chain credit score without revealing any transaction history |

### Proof generation pipeline

```
User action (borrow, deposit, rebalance, disclosure)
         │
         ▼
   ┌─────────────────────────┐
   │    Backend Service       │
   │  (lending_service.py,    │
   │   zkml_risk_service.py,  │
   │   groth16_prover.py,     │
   │   credit_eligibility_    │
   │   proof_service.py)      │
   └────────┬────────────────┘
            │
   ┌────────▼────────────────┐
   │  1. Compute private     │
   │     inputs from user    │
   │     state + on-chain    │
   │     data                │
   │                         │
   │  2. Write input.json    │
   │                         │
   │  3. Generate witness    │
   │     (node + wasm)       │
   │                         │
   │  4. Generate proof      │
   │     (snarkjs groth16    │
   │      fullprove)         │
   │                         │
   │  5. Verify locally      │
   │     (snarkjs verify)    │
   │                         │
   │  6. Format calldata     │
   │     (Garaga SDK)        │
   └────────┬────────────────┘
            │
   ┌────────▼────────────────┐
   │  Return to frontend:    │
   │  - proof (JSON)         │
   │  - public_signals       │
   │  - calldata (Garaga)    │
   │  - verified (bool)      │
   │  - commitment_hash      │
   └────────┬────────────────┘
            │
   ┌────────▼────────────────┐
   │  Frontend: user signs   │
   │  tx with proof_calldata │
   │  → Starknet contract    │
   │  → Garaga verifier      │
   │  → contract logic       │
   └─────────────────────────┘
```

### On-chain verification flow

```
Starknet Transaction
         │
         ▼
   ┌──────────────────┐
   │  Target Contract  │
   │  (LendingPool,    │
   │   FullyShielded   │
   │   Pool, etc.)     │
   └────────┬─────────┘
            │ calls
   ┌────────▼─────────┐
   │  Garaga Groth16   │
   │  Verifier         │
   │  (BN254 curve)    │
   │                   │
   │  verify_groth16   │
   │  _proof_bn254()   │
   └────────┬─────────┘
            │ returns bool
   ┌────────▼─────────┐
   │  Contract stores  │
   │  fact_hash in     │
   │  ValidationProof  │
   │  Registry         │
   │  (0x02e2...)      │
   └──────────────────┘
```

---

## Portability: how the passport travels

### W3C Verifiable Credential format

The attestation API returns a portable JSON-LD credential when `?format=vc` is passed:

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://obsqra.xyz/credentials/v1"
  ],
  "type": ["VerifiableCredential", "CreditAttestation"],
  "issuer": "did:starknet:obsqra",
  "credentialSubject": {
    "id": "did:starknet:<commitment_or_stark_id>",
    "creditLine": {
      "total_wei": "40000000000000000000",
      "unsecured_wei": "3000000000000000000",
      "rate_bps": 450
    },
    "letter_rating": "B",
    "composite_score": 72,
    "sources": ["reputation", "identity", "proof_receipts"],
    "chain_id": "0x534e5f5345504f4c4941"
  },
  "proof": {
    "type": "Groth16Bn254",
    "verificationMethod": "0x02e2...ValidationProofRegistry",
    "proofValue": "<attestation_hash>"
  },
  "issuanceDate": "2026-03-03T...",
  "expirationDate": "2026-03-10T..."
}
```

### ERC-8004 portable identity shape

The Risk Profile API returns an ERC-8004 identity projection when `?format=erc8004` is passed:

```json
{
  "identity_card": {
    "agent_name": "zkdefi_agent",
    "reputation_score": 72,
    "privacy_tier": "Standard",
    "tier": 1,
    "letter_rating": "B",
    "credit_tier": "AA",
    "credit_score": 720
  },
  "reputation": {
    "tier": 1,
    "tier_name": "Standard",
    "tenure_days": 45,
    "successful_txns": 23,
    "collateral_eth": 5.0,
    "total_volume_eth": 12.3
  },
  "validations": {
    "has_agent": true,
    "fact_hash": "0x...",
    "identity_commitment": "0x..."
  },
  "session_summary": {
    "active_count": 2,
    "count": 5
  },
  "disclosure_summary": {
    "profile_count": 3
  }
}
```

### Cross-chain attestation relay (designed, not yet deployed)

```
Starknet                              Ethereum L1
┌──────────────────┐                  ┌──────────────────┐
│  ValidationProof │                  │  L1 Attestation  │
│  Registry        │  ──message──►    │  Mirror          │
│  (attestation_   │  (Starknet      │  (verifies       │
│   hash stored)   │   messaging)     │   message +      │
│                  │                  │   stores hash)   │
└──────────────────┘                  └──────────────────┘
```

When Starknet-to-L1 messaging is used, the attestation_hash is relayed to an L1 registry. EVM protocols can then call `has_attestation(hash) -> bool` to verify "this user has credit on zkde.fi" without needing to interact with Starknet directly.

---

## Privacy model

### What is revealed vs. hidden

| Data | Revealed | Hidden |
|------|----------|--------|
| Composite score | Only if user shares passport | Exact formula inputs |
| Letter rating | Only thresholds (e.g. "letter >= B") | Underlying score |
| Credit tier | Only via selective disclosure or attestation | Raw chain history (12 features) |
| Credit score | Never in default flow | Always private inside RISC Zero zkVM |
| Collateral amount | Only via CreditEligibility proof ("collateral >= X") | Exact amount |
| Transaction history | Never | Aggregated into tier/tenure/volume |
| Address | Only with explicit sharing | Commitment-based identity default |
| Pool positions | Never without proof | Hidden behind shielded pool commitments |

### Selective disclosure layers

1. **Circuit-level** -- CreditEligibility proves "score >= 500 AND collateral >= 2 ETH" without revealing either value. The commitment_hash (Poseidon of score, collateral, blinding) binds the proof to the user's actual values without exposing them.

2. **Contract-level** -- SelectiveDisclosure contract stores statements of the form `(statement_type, threshold, result, proof_hash)`. A verifier can check "user has a disclosure of type balance_above with threshold 10 ETH" without learning the actual balance.

3. **Attestation-level** -- Credit attestations contain `letter_min`, `composite_min`, and `total_line_wei` but not the underlying reputation data. The attestation_hash is registered on ValidationProofRegistry so third parties can verify it exists without calling back to obsqra.

4. **Credential-level** -- W3C VC format includes only the subject's commitment (or Stark ID), credit line parameters, and the proof verification method. No transaction history, no address unless the user binds their Stark ID.

### Commitment architecture

```
User identity:
  identity_commitment = Poseidon(address, secret, nonce)
     │
     ├── Stored in AgentIdentity NFT (on-chain, SRC-721)
     ├── Referenced by attestations (subject = commitment)
     └── Used in privacy pools (Merkle tree membership)

Credit commitment:
  credit_commitment = Poseidon(credit_score, collateral_wei, blinding)
     │
     ├── Public input to CreditEligibility circuit
     ├── Binds proof to actual private values
     └── Third party cannot reverse the hash to learn score/collateral
```

---

## Receipt reconciliation

The `useReceiptAggregator` hook merges two receipt sources:

1. **Backend timeline** -- `GET /history/timeline/{address}` (internal events, deployments, swaps)
2. **On-chain receipts** -- `GET /receipts/on-chain/{address}` (proof receipts with tx_hash, fact_hash)

Each receipt gets a reconciliation status:

| Status | Meaning |
|--------|---------|
| `confirmed` | Seen on both chain and backend; data matches |
| `pending` | Backend only; chain confirmation not yet indexed |
| `on-chain` | Chain only; backend not yet aware |
| `diverged` | Both exist but data doesn't match |

This gives the passport a verifiable audit trail: any proof receipt can be independently checked on Starkscan/Voyager via its tx_hash, and its fact_hash can be verified against the ValidationProofRegistry.

---

## API surface

### Risk Passport

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/risk_passport/user/{address}` | GET | Full passport: composite, letter, tier, credit, receipts, aggregation_sources, chain_id |
| `/risk_passport/user/{address}/attestation` | POST | Issue credit attestation (add `?format=vc` for W3C shape) |
| `/risk_passport/user/{address}/attestations` | GET | List all attestations |
| `/risk_passport/user/{address}/attestation/register` | POST | Build calldata for on-chain attestation registration |
| `/risk_passport/pool/{pool_id}` | GET | Pool passport: health_score, factors, safety, proof_receipts |

### Risk Profile (composed bundle)

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/risk_profile/{address}` | GET | Full bundle: reputation + passport + onboarding + linked + compliance + sessions |
| `/risk_profile/{address}?format=erc8004` | GET | ERC-8004 portable identity projection |

### Receipt indexer

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/receipts/on-chain/{address}` | GET | Proof receipts with tx_hash, fact_hash, proof_type for reconciliation |

---

## Contracts (deployed on Sepolia)

| Contract | Address | Role in passport |
|----------|---------|-----------------|
| ReputationRegistry | `0x0428700cc719df6ef6104123f6a326dde0f4f42f7e41f941473338bc31f9ccff` | Source: tier, collateral, tenure, volume |
| ValidationProofRegistry | `0x02e2faab2cad8ecdde5e991798673ddcc08983b872304a66e5f99fbd3aface23` | Stores attestation_hash and fact_hash for on-chain verification |
| AgentIdentity | `0x06b2...` | SRC-721 identity NFT; binds commitment to agent |
| CollateralVault | `0x012bcb63919e2207abe9a397463839b387b09e347900640a5a775c95c1cbd8cd` | Multi-token collateral with lock tiers |
| LendingPool | `0x05ba14536eca827e292bf633c2963abc048f0160a8a3efea6a71ca07d0bb3e64` | Consumes attestations for borrow eligibility |
| CreditEligibility Verifier | `0x037de8d03eb90ab8fffb8a2d2469b48f1a801c25920152943379ee2117d23f0e` | Garaga BN254 Groth16 verifier for credit proofs |
| SelectiveDisclosure | Source ready | Stores selective disclosure statements |

---

## What remains to build

### Integration gaps (concrete)

| Gap | Impact | Effort |
|-----|--------|--------|
| CreditEligibility Garaga verifier not deployed | Cannot verify credit proofs on-chain; borrow_with_proof path incomplete | Run `generate_credit_eligibility_verifier.sh` then deploy |
| CollateralVault not deployed on Sepolia | Staking still uses backend-only storage; lending collateral not on-chain | `sncast deploy` with compiled class hash |
| LendingPool not deployed on Sepolia | Lending is backend-simulated; no on-chain borrow/supply/liquidate | Deploy after CollateralVault + CreditEligibility verifier |
| SelectiveDisclosure not deployed | Disclosure statements are backend-only; no on-chain selective reveal | `sncast deploy` |
| Receipt service not indexed from on-chain events | `/receipts/on-chain` returns backend receipts, not actual Starknet event logs | Build Starknet event indexer for ValidationProofRegistry events |
| `record_transaction` not called from vault/deploy paths | Lending activity does not automatically build reputation | Wire into vault_execute, lending_service after confirmed repay/supply |

### Profile integration (frontend)

| Gap | Impact |
|-----|--------|
| Profile Trust tab shows raw passport data; no "shareable attestation" export button | User cannot share a minimal trust proof with a third party |
| No visual circuit proof explorer | User cannot see which circuits produced their proofs or verify them |
| Staking panel still shows legacy mock pool names (core_emerald, boost_violet) in some paths | Confusing; should reflect CollateralVault positions once deployed |
| Credit line visualization is text-only | Should show collateral vs. unsecured breakdown, rate curve |
| No Stark ID resolution in attestation display | Attestations show raw address instead of alice.stark |

### Protocol-level (future phases)

| Item | Description |
|------|-------------|
| Multi-asset lending pools | Current LendingPool contract handles single-asset; extend to ETH/STRK/USDC pools |
| Interest rate model | Fixed rate from credit line; no dynamic utilization-based curve yet |
| Autonomous liquidation agent | Health factor monitoring runs in backend; should run as autonomous agent with session keys |
| Cross-chain attestation relay | L1 mirror contract for EVM protocols to verify Starknet attestations |
| Reputation decay | No time-decay on reputation; a user who was active 6 months ago still has full score |
| Pool passport federation | Pool passports are local; should be queryable cross-protocol |
| Proof aggregation | Multiple proofs per action (risk + anomaly + credit) should batch into one on-chain verification |

---

## File map

```
backend/
  app/
    api/
      risk_passport.py          ← Passport API: GET/POST user passport, attestations
      risk_profile.py           ← Composed bundle: 6 slices into one response
      routes/
        receipts.py             ← Receipt indexer: on-chain receipt reconciliation
        lending.py              ← Lending API: pool stats, borrow, supply, repay
        collateral.py           ← Collateral API: deposit, withdraw, positions
        identity.py             ← Identity: commitment lookup, credit-proof trigger
        stark_id.py             ← Stark ID binding: .stark name resolution
    services/
      attestation_service.py    ← Issue + store credit attestations
      credit_line_service.py    ← Credit line formula: collateral + reputation
      credit_eligibility_proof_service.py  ← Groth16 proof for CreditEligibility
      risc_zero_credit_service.py         ← RISC Zero zkVM credit scoring
      groth16_prover.py         ← Groth16 proofs for deposit/withdraw
      receipt_service.py        ← Append-only proof receipt store
      lending_service.py        ← Pool stats, health factor, calldata builders
      collateral_service.py     ← CollateralVault calldata + position reads
      proof_pipeline.py         ← Unified proof coordination + caching

circuits/
  CreditEligibility.circom     ← Credit eligibility ZK circuit
  RiskScore.circom             ← zkML risk scoring
  AnomalyDetector.circom       ← Pool anomaly detection
  FullPrivacyWithdraw*.circom  ← Privacy pool withdrawal variants
  PrivateDeposit.circom        ← Shielded deposit
  PrivateWithdraw.circom       ← Shielded withdrawal
  build/                       ← Compiled artifacts (wasm, r1cs, zkey, vkey)

contracts/src/
  lending_pool.cairo           ← On-chain lending (borrow, supply, liquidate)
  collateral_vault.cairo       ← Multi-token collateral with lock tiers
  reputation_registry.cairo    ← Tier + collateral + reputation scoring
  validation_proof_registry.cairo  ← Proof attestation registry
  selective_disclosure.cairo   ← On-chain selective disclosure statements
  agent_identity.cairo         ← SRC-721 identity NFT
  session_key_manager.cairo    ← Session key delegation with protocol bitmap
  garaga_verifier/             ← Garaga BN254 Groth16 verifier

frontend/src/
  hooks/
    useProfile.ts              ← Risk Profile bundle fetcher
    useReceiptAggregator.ts    ← Dual-source receipt reconciliation
    useStarkId.ts              ← .stark name resolution
  app/
    profile/page.tsx           ← Profile: Trust, Reputation, Compliance, Connections
  components/zkdefi/
    LendingPanel.tsx            ← Lending UI: credit line, pool stats, borrow/supply
    SessionKeyManager.tsx       ← Session key management with lending protocol
  lib/api/
    lending.ts                 ← Lending API client
```
