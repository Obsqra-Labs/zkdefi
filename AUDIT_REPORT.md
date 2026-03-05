# zkde.fi Comprehensive Audit Report

**Date**: Generated automatically  
**Scope**: Cairo contracts, ZK circuits, deployment state  
**Network**: Starknet Sepolia testnet

---

## Task 1: Cairo Contract Audit

### 1.1 Build Status

**CRITICAL: Project does not compile.**

`scarb build` fails with:
```
error: /opt/obsqra.starknet/zkdefi/contracts/src/lib.cairo not found
```

**Root cause**: The crate root file `contracts/src/lib.cairo` is missing. Scarb requires this file to declare all contract modules. None of the 28 `.cairo` files are reachable by the compiler.

| Item | Status |
|------|--------|
| Scarb version | 2.14.0 (Cairo 2.14.0, Sierra 1.7.0) |
| Edition | 2024_07 |
| Dependencies | `starknet >= 2.0.0`, `garaga_verifier` (path dep) |
| garaga_verifier dep | Has its own Scarb.toml + lib.cairo ✅ |
| **contracts/src/lib.cairo** | **MISSING** ❌ |
| Build result | **FAIL** |

**Fix**: Create `contracts/src/lib.cairo` with `mod` declarations for all 28 contract files.

---

### 1.2 Contract Inventory (28 files)

#### Core Privacy Layer (6 contracts)

| Contract | File | Lines | Storage | Entrypoints | Status |
|----------|------|-------|---------|-------------|--------|
| ShieldedPool | `contracts/src/shielded_pool.cairo` | 650 | Full layout (admin, token, merkle, verifier, commitments, nullifiers, pool configs) | `#[abi(embed_v0)]` ✅ | **Complete** |
| FullyShieldedPool | `contracts/src/fully_shielded_pool.cairo` | 662 | Full u256 layout (BN254 compat, split-storage commitments, nullifiers) | `#[abi(embed_v0)]` ✅ | **Complete** |
| HashedWithdrawPool | `contracts/src/hashed_withdraw_pool.cairo` | 300 | Full layout (claim hashes, deposits, admin) | `#[abi(embed_v0)]` ✅ | **Complete** |
| MerkleTree | `contracts/src/merkle_tree.cairo` | 432 | Depth-20 incremental tree, 100-root history, u256 split | `#[abi(embed_v0)]` ✅ | **Complete** |
| ConfidentialTransfer | `contracts/src/confidential_transfer.cairo` | 266 | u256 commitments, nullifiers, Garaga verifier ref | `#[abi(embed_v0)]` ✅ | **Complete** |
| Tier2HEscrow | `contracts/src/tier2h_escrow.cairo` | 216 | Admin, pool_d, payout token refs | `#[abi(embed_v0)]` ✅ | **Complete** |

#### Agent/Execution Layer (7 contracts)

| Contract | File | Lines | Status |
|----------|------|-------|--------|
| ProofGatedYieldAgent | `contracts/src/proof_gated_yield_agent.cairo` | 551 | **Complete** — Integrity STARK + Garaga SNARK + session keys + intent commitments |
| SessionKeyManager | `contracts/src/session_key_manager.cairo` | 273 | **Complete** — grant/revoke/validate with proof requirements |
| Relayer | `contracts/src/relayer.cairo` | 445 | **Complete** — Tier-gated private withdrawals, fee management |
| BatchVerifier | `contracts/src/batch_verifier.cairo` | 292 | **Complete** — Optimistic execution with hourly batch proofs, challenge mechanism |
| TieredAgentController | `contracts/src/tiered_agent_controller.cairo` | 470 | **Complete** — Reputation-tier routing (Strict/Standard/Express) |
| AllocationRouter | `contracts/src/allocation_router.cairo` | 313 | **Complete** — JediSwap/Ekubo allocation mixes |
| IntentCommitment | `contracts/src/intent_commitment.cairo` | 267 | **Complete** — Replay-safe, fork-safe intent commitments |

#### Identity/Registry Layer (9 contracts)

| Contract | File | Lines | Status |
|----------|------|-------|--------|
| AgentIdentity | `contracts/src/agent_identity.cairo` | 513 | **Complete** — SRC-721 NFT (ERC-8004 alignment) |
| ModelRegistry | `contracts/src/model_registry.cairo` | 200 | **Complete** — zkML model catalog |
| AgentComposer | `contracts/src/agent_composer.cairo` | 280 | **Complete** — AND/OR model composition |
| ReputationRegistry | `contracts/src/reputation_registry.cairo` | 769 | **Complete** — Tiers, collateral, scoring, leaderboard |
| ValidationProofRegistry | `contracts/src/validation_proof_registry.cairo` | 401 | **Complete** — ERC-8004 proof attestation |
| ObsqraFactRegistry | `contracts/src/obsqra_fact_registry.cairo` | 200 | **Complete** — Admin-gated STARK proof registration |
| ComplianceProfile | `contracts/src/compliance_profile.cairo` | 262 | **Complete** — Productized selective disclosure |
| SelectiveDisclosure | `contracts/src/selective_disclosure.cairo` | ~120 | **Complete** — Register/query disclosure proofs |
| ConstraintReceipt | `contracts/src/constraint_receipt.cairo` | ~200 | **Complete** — On-chain auditable receipts |

#### zkML Contracts (2)

| Contract | File | Lines | Status |
|----------|------|-------|--------|
| CairoPerceptron | `contracts/src/cairo_perceptron.cairo` | 279 | **Complete** — On-chain single-layer perceptron |
| ZkmlVerifier | `contracts/src/zkml_verifier.cairo` | 284 | **Complete** — Garaga Groth16 verifier wrapper |

#### Utility/Interface (2)

| Contract | File | Lines | Status |
|----------|------|-------|--------|
| ERC20Interface | `contracts/src/erc20_interface.cairo` | 22 | **Complete** — Standard IERC20 trait |
| MockFactRegistry | `contracts/src/mock_fact_registry.cairo` | ~55 | ⚠️ **DANGER** — Always returns `true` |

#### PLACEHOLDER / Stub Contracts (2) — INCOMPLETE

| Contract | File | Issue | Severity |
|----------|------|-------|----------|
| ConfidentialLpPosition | `contracts/src/confidential_lp_position.cairo` | `_verify_commitment_proof()` at line 195 is a **placeholder** — only checks `proof.len() > 0`, no Garaga call | **HIGH** |
| ProofGatedLpAgent | `contracts/src/proof_gated_lp_agent.cairo` | `_verify_amount_commitment()` and `_verify_zkml_proof()` at lines 366-381 are **placeholders** — emit events only, no verification. `get_user_positions()` returns empty array. | **HIGH** |

---

### 1.3 TODO / FIXME / PLACEHOLDER Markers

| File | Line | Marker | Description |
|------|------|--------|-------------|
| `confidential_lp_position.cairo` | 195 | PLACEHOLDER | `_verify_commitment_proof` — no real verification |
| `proof_gated_lp_agent.cairo` | 366-381 | PLACEHOLDER | `_verify_amount_commitment` + `_verify_zkml_proof` — emit events only |
| `proof_gated_lp_agent.cairo` | ~350 | MVP | `get_user_positions()` returns empty `ArrayTrait::new()` |

---

### 1.4 Access Control Audit

| Contract | Pattern | Assessment |
|----------|---------|------------|
| shielded_pool | `assert(caller == self.admin.read())` | ✅ Proper |
| fully_shielded_pool | Admin check on `set_garaga_verifier`, `add_known_root` | ✅ Proper |
| hashed_withdraw_pool | Admin check on setters | ✅ Proper |
| merkle_tree | `allowed_inserters` whitelist + admin | ✅ Proper |
| confidential_transfer | Admin check | ✅ Proper |
| tier2h_escrow | `assert_admin()` helper | ✅ Proper |
| session_key_manager | Caller validates as session key owner | ✅ Proper |
| relayer | Admin + registered relayer checks | ✅ Proper |
| obsqra_fact_registry | Registrar-only writes (ONLY_REGISTRAR) | ✅ Proper |
| model_registry | Creator OR admin | ✅ Proper |
| validation_proof_registry | Authorized verifier pattern | ✅ Proper |
| reputation_registry | Admin check | ✅ Proper |
| **batch_verifier** | `queue_action` — **no access control** | ⚠️ **MEDIUM** — Anyone can queue |
| **constraint_receipt** | `create_receipt` — **no access control** | ⚠️ **LOW** — Anyone can create receipts |
| **allocation_router** | `update_market_data`, `deposit_to_pool` — **caller not checked** | ⚠️ **MEDIUM** — May allow unauthorized market data updates |
| **mock_fact_registry** | Always returns `true` | 🔴 **CRITICAL** if used in production |

---

### 1.5 Interface Inconsistencies

| Issue | Location | Severity |
|-------|----------|----------|
| `IGaragaVerifier` returns `bool` | `zkml_verifier.cairo` | **MEDIUM** — Garaga verifiers actually return `Result<Span<u256>, felt252>` |
| Duplicated `#[starknet::interface]` attribute | `tiered_agent_controller.cairo` ~line 41 | **LOW** — May cause compile warning |
| `LegacyMap` usage | `confidential_lp_position.cairo` | **LOW** — Should use `Map` (modern API) |
| `Array` in storage | `proof_gated_lp_agent.cairo` | **HIGH** — `Array<T>` cannot be stored in Starknet storage directly |

---

## Task 2: Circuit Audit

### 2.1 Circuit Inventory (13 circuits)

All circuits use `pragma circom 2.1.6` and include `circomlib` (Poseidon BN254).

#### Core Privacy Circuits

| Circuit | File | Signals | Public Inputs | Status |
|---------|------|---------|--------------|--------|
| FullPrivacyWithdraw | `circuits/FullPrivacyWithdraw.circom` | 168 lines | root, nullifierHash, recipient, withdrawAmount, poolType | **Complete** — Merkle membership + nullifier + amount + pool match |
| FullPrivacyWithdrawHashed | `circuits/FullPrivacyWithdrawHashed.circom` | 175 lines | root, nullifierHash, claimHash, withdrawAmount, poolType | **Complete** — + claimHash = Poseidon(recipient, amount, salt) for Tier-2H |
| FullPrivacyWithdrawWithChange | `circuits/FullPrivacyWithdrawWithChange.circom` | 166 lines | root, nullifierHash, recipient, withdrawAmount, changeCommitment, poolType | **Complete** — V2 partial withdraw with change |
| PrivateDeposit | `circuits/PrivateDeposit.circom` | ~40 lines | commitment | **Complete** — commitment = Poseidon(amount, nonce) |
| PrivateWithdraw | `circuits/PrivateWithdraw.circom` | ~60 lines | commitment, nullifierHash | **Complete** — Commitment + nullifier derivation |

#### Selective Disclosure Circuits

| Circuit | File | Public Inputs | Status |
|---------|------|--------------|--------|
| BalanceAboveThreshold | `circuits/BalanceAboveThreshold.circom` | root, threshold | **Complete** — Merkle proof + balance > threshold (20-level tree) |
| PoolMembership | `circuits/PoolMembership.circom` | root, claimedPool | **Complete** — Merkle proof + poolType == claimedPool |
| TenureAboveThreshold | `circuits/TenureAboveThreshold.circom` | root, minBlocks, currentBlock | **Complete** — Merkle proof + (currentBlock - creationBlock) >= minBlocks |

#### Risk/ML Circuits

| Circuit | File | Public Inputs | Status |
|---------|------|--------------|--------|
| RiskScore | `circuits/RiskScore.circom` | threshold, scale, user_address, commitment_hash | **Complete** — Weighted sum risk model, score ≤ threshold |
| AnomalyDetector | `circuits/AnomalyDetector.circom` | thresholds[], scale, user_address, commitment_hash | **Complete** — Multi-factor anomaly scoring |
| SafetyDiversification | `circuits/SafetyDiversification.circom` | safety_scores[6], threshold, scale, user_address, commitment_hash | **Complete** — HHI-adjusted safety diversification across 6 protocols |
| CorrelationRisk | `circuits/CorrelationRisk.circom` | threshold, scale, user_address, commitment_hash | **Complete** — Weighted correlation matrix for 5 assets, prevents fake diversification |
| TWAPPosition | `circuits/TWAPPosition.circom` | threshold, scale, user_address, commitment_hash | **Complete** — 7-day TWAP position ≤ threshold |

---

### 2.2 Build Artifacts

All 13 circuits have compiled artifacts in `circuits/build/`:

| Circuit | zkey | WASM | vkey | Notes |
|---------|------|------|------|-------|
| FullPrivacyWithdraw | 5.2M ✅ | 2.4M ✅ | 4K ✅ | Also has `_NEW`, `_fresh` variant vkeys |
| FullPrivacyWithdrawHashed | 5.4M ✅ | 2.8M ✅ | 4K ✅ | |
| FullPrivacyWithdrawWithChange | 5.4M ✅ | 2.4M ✅ | 4K ✅ | |
| PrivateDeposit | 364K ✅ | 1.7M ✅ | 4K ✅ | |
| PrivateWithdraw | 612K ✅ | 1.7M ✅ | 4K ✅ | |
| BalanceAboveThreshold | 5.0M ✅ | 2.4M ✅ | 4K ✅ | |
| PoolMembership | 4.9M ✅ | 2.4M ✅ | 4K ✅ | |
| TenureAboveThreshold | 5.0M ✅ | 2.4M ✅ | 4K ✅ | |
| RiskScore | 120K ✅ | 40K ✅ | ❌ **MISSING** | No vkey JSON |
| AnomalyDetector | 252K ✅ | 44K ✅ | ❌ **MISSING** | No vkey JSON |
| SafetyDiversification | 196K ✅ | 44K ✅ | 8K ✅ | |
| CorrelationRisk | 224K ✅ | 44K ✅ | 4K ✅ | |
| TWAPPosition | 216K ✅ | 44K ✅ | 4K ✅ | |

**Issues**:
- **RiskScore** and **AnomalyDetector** are missing verification keys — cannot generate Garaga verifier contracts or verify proofs on-chain for these two circuits.

### 2.3 Garaga Verifier Contracts

Located in `contracts/src/garaga_verifier/` and `circuits/contracts/src/`:

| Verifier | Location | For Circuit |
|----------|----------|-------------|
| garaga_verifier (original) | `contracts/src/garaga_verifier/` | FullPrivacyWithdraw (original) |
| garaga_verifier_new | `circuits/contracts/src/` | FullPrivacyWithdraw (updated) |
| garaga_fullprivacy_new | `circuits/contracts/src/` | FullPrivacyWithdraw (another variant) |
| garaga_verifier_withdraw | `circuits/contracts/src/` | FullPrivacyWithdraw |
| garaga_verifier_withdraw_hashed | `circuits/contracts/src/` | FullPrivacyWithdrawHashed |
| garaga_verifier_with_change | `circuits/contracts/src/` | FullPrivacyWithdrawWithChange |
| garaga_verifier_diversification | `circuits/contracts/src/` | SafetyDiversification |
| garaga_verifier_correlation | `circuits/contracts/src/` | CorrelationRisk |
| garaga_verifier_twap | `circuits/contracts/src/` | TWAPPosition |

**Missing Garaga verifiers** (no vkey → cannot generate):
- RiskScore
- AnomalyDetector
- BalanceAboveThreshold (has vkey but no verifier contract found)
- PoolMembership (has vkey but no verifier contract found)
- TenureAboveThreshold (has vkey but no verifier contract found)
- PrivateDeposit (has vkey but no verifier contract found)
- PrivateWithdraw (has vkey but separate verifier deployed at `0x06f7...ef16`)

### 2.4 Circom Design Notes

- **Commitment scheme**: `Poseidon(5)` — `hash(userSecret, amount, poolType, nonce, blinding)` — consistent across all Merkle-based circuits
- **Nullifier derivation**: `Poseidon(2)` — `hash(userSecret, nonce)` — standard Tornado Cash pattern
- **Tree depth**: 20 levels across all circuits (supports ~1M leaves)
- **TenureAboveThreshold** uses a different commitment scheme: `Poseidon(userSecret, amount, poolType, nonce, creationBlock)` — **incompatible** with the standard commitment scheme used by other circuits. A deposit in the standard pool cannot prove tenure without re-commitment.

---

## Task 3: Deployment State

### 3.1 Deployed Contracts on Starknet Sepolia

#### Confirmed Live (from `backend/.env` + `frontend/.env.local` + `DEPLOYMENT_STATUS.md`)

| Contract | Address | Source |
|----------|---------|--------|
| MerkleTree | `0x03659ca95ebe890741ca68dd84945716ca9e40baa6650d81f977466726370947` | backend/.env, frontend/.env.local |
| FullyShieldedPool (v2) | `0x03dde5617d362a6f9202cd3955b4508e2bd6b1c5d35250153beeb6237c811559` | backend/.env, frontend/.env.local |
| HashedWithdrawPool | `0x0258703c803d133f9759e37071cf3da03670566be48e2e77b81d18439d7917fe` | backend/.env, frontend/.env.local |
| ProofGatedYieldAgent | `0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3` | backend/.env |
| ConfidentialTransfer | `0x07fdc7c21ab074e7e1afe57edfcb818be183ab49f4bf31f9bf86dd052afefaa4` | backend/.env, frontend/.env.local |
| SessionKeyManager | `0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3` | backend/.env |
| CairoPerceptron | `0x0016c2c38a5938a430627458e1b9394ccdef5f9684715776a2fd29d1e35e57a4` | frontend/.env.local |
| ModelRegistry | `0x06ab2595007be01ffb7e51bd28339f870be36402eed9034b109fd479e7469adc` | DEPLOYMENT_STATUS.md |
| AgentComposer | `0x0639eda1b05238d21183cbf2dab7bfca793978d534d608d992577dcdccb0a84d` | DEPLOYMENT_STATUS.md |
| AgentIdentity | `0x06b2ed4153d620f5558086de5afff8a5bb0de76720deb26c8a037cb347aff80a` | DEPLOYMENT_STATUS.md |
| ValidationProofRegistry | `0x02e2b175026aa2f9cf804d84a92076fcf9c29149bb009305f26d4be74ae03492` | DEPLOYMENT_STATUS.md |
| ReputationRegistry | `0x0428700cc719df6ef6104123f6a326dde0f4f42f7e41f941473338bc31f9ccff` | DEPLOYMENT_STATUS.md |

#### Garaga Verifier Contracts (deployed)

| Verifier | Address | Source |
|----------|---------|--------|
| PrivateDeposit Verifier | `0x034994599b29514e053e9f55eb7c4b988ae63078a0ac0c5466d38f997759e99d` | frontend/.env.local |
| PrivateWithdraw Verifier | `0x06f7439af5e4ed0b7838922068eca38353406184f7806bd11cb4bb363961ef16` | frontend/.env.local |
| FullPrivacyWithdraw Verifier | `0x07890b8387a71e1df9a37793e995cc5ac4bb055fa67c292ff296bdb0705352a1` | frontend/.env.local |

#### NOT Deployed

| Contract | Evidence |
|----------|----------|
| ShieldedPool (v1) | No address in any env file |
| ConfidentialLpPosition | No address found |
| ProofGatedLpAgent | No address found |
| Relayer (contract) | Relayer ADDRESS = deployer wallet, not a dedicated relayer contract |
| BatchVerifier | No address found |
| TieredAgentController | No address found |
| AllocationRouter | No address found |
| IntentCommitment | No address found |
| ObsqraFactRegistry | No address found |
| ComplianceProfile | No address found |
| SelectiveDisclosure | No address found |
| ConstraintReceipt | No address found |
| ZkmlVerifier | No address found |
| Tier2HEscrow | No address found |
| MockFactRegistry | No address found |
| HashedWithdraw Garaga Verifier | No deployed address |
| WithChange Garaga Verifier | No deployed address |
| Diversification/Correlation/TWAP Verifiers | No deployed addresses |

#### Address Collision Alert

⚠️ `SESSION_KEY_MANAGER_ADDRESS` and `PROOF_GATED_AGENT_ADDRESS` share the **same address** (`0x012ebb...62b3`). This is either:
- An error in .env configuration, or
- The same contract instance serving dual purposes (unlikely given different ABIs)

### 3.2 Deployment Config Files

| File | Contents | Status |
|------|----------|--------|
| `contracts/.marketplace_deployment.json` | ModelRegistry, AgentIdentity, ValidationProofRegistry all `address: null` | ❌ **Stale** — DEPLOYMENT_STATUS.md shows these ARE deployed |
| `contracts/deployed_u256_addresses.json` | merkle_tree: null, fully_shielded_pool: null, confidential_transfer: null | ❌ **Stale** — backend/.env has real addresses |
| `contracts/.new_deployments.env` | Empty file | ❌ Not maintained |
| `contracts/DEPLOYMENT_STATUS.md` | 5 contracts confirmed deployed | ✅ Most up-to-date source |

### 3.3 Deploy Scripts

| Script | Purpose |
|--------|---------|
| `contracts/deploy_confidential.py` | Deploy confidential transfer |
| `contracts/deploy_fixed_confidential_transfer.py` | Fixed deploy for CT |
| `contracts/deploy_garaga_verifier.sh` | Deploy Garaga verifier contract |
| `contracts/deploy_marketplace.py` | Deploy ERC-8004 marketplace contracts |
| `contracts/deploy_new_contracts.py` | Deploy new contract set |
| `contracts/deploy_u256_contracts.py` | Deploy u256-compatible contracts |
| `contracts/deploy_via_invoke.py` | Alternative deploy method |
| `contracts/deploy_with_starknet_py.py` | starknet.py based deploy |
| `contracts/deploy_withdrawal_verifier.py` | Deploy withdrawal verifier |
| `contracts/manual_deploy_verifiers.py` | Manual verifier deployment |
| `deploy_production.sh` | Production deployment orchestrator |
| `deploy_funded_positions.py` | Deploy funded LP positions |
| `deploy_real_lp_positions.py` | Deploy real LP positions |
| `deploy_vault_contracts.py` | Deploy vault contracts |
| `deploy_withdrawal_verifier.sh` | Shell wrapper for verifier deploy |
| `deploy_zkdefi_to_hostinger.sh` | Deploy frontend to Hostinger |

### 3.4 RPC Configuration

From `DEPLOYMENT_STATUS.md` and `snfoundry.toml`:
- **Primary RPC**: `https://api.cartridge.gg/x/starknet/sepolia` (RPC spec 0.9.0)
- **Deployer account**: `deployer` profile in snfoundry.toml
- **Deployer address**: `0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d`

### 3.5 Token Configuration

- **STRK token** (Sepolia): `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- **ETH token** (Sepolia): `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7`

---

## Summary of Critical Findings

### 🔴 CRITICAL

| # | Finding | Impact |
|---|---------|--------|
| C1 | **`contracts/src/lib.cairo` is missing** — entire project cannot compile | Build is broken; no sierra/casm artifacts can be produced |
| C2 | **`mock_fact_registry.cairo` always returns true** | Any contract using this as its fact registry accepts fabricated proofs |
| C3 | **`confidential_lp_position.cairo` placeholder verification** | LP position commitments are unverified — funds could be claimed without valid proofs |
| C4 | **`proof_gated_lp_agent.cairo` placeholder verification** | zkML and amount commitment proofs are not checked — agents execute without verification |

### 🟠 HIGH

| # | Finding | Impact |
|---|---------|--------|
| H1 | **RiskScore + AnomalyDetector missing vkeys** | Cannot generate on-chain verifiers for these two circuits |
| H2 | **`proof_gated_lp_agent.cairo` stores `Array<T>` in storage** | Will fail at runtime — Array cannot be in Starknet storage |
| H3 | **SESSION_KEY_MANAGER and PROOF_GATED_AGENT share same address** | Configuration error — one address cannot serve both ABIs |
| H4 | **16 of 28 contracts have no deployed address** | Over half the contracts exist only as source code |
| H5 | **Deployment config files are stale** | `.marketplace_deployment.json` and `deployed_u256_addresses.json` show null for contracts that are actually deployed |

### 🟡 MEDIUM

| # | Finding | Impact |
|---|---------|--------|
| M1 | **`batch_verifier.queue_action` has no access control** | Anyone can queue actions for batch execution |
| M2 | **`allocation_router.update_market_data` may lack admin check** | Unauthorized market data manipulation risk |
| M3 | **`zkml_verifier.cairo` IGaragaVerifier interface mismatch** | Returns `bool` but Garaga returns `Result<Span<u256>, felt252>` |
| M4 | **TenureAboveThreshold uses incompatible commitment scheme** | Uses `creationBlock` instead of `blinding` — deposits from standard pool can't prove tenure |
| M5 | **Multiple FullPrivacyWithdraw vkey variants exist** | `_NEW`, `_fresh` variants — unclear which is canonical; risk of proof/verifier mismatch |

### 🟢 LOW

| # | Finding | Impact |
|---|---------|--------|
| L1 | `confidential_lp_position.cairo` uses `LegacyMap` | Should migrate to `Map` |
| L2 | `tiered_agent_controller.cairo` duplicated interface attribute | May cause compile warnings |
| L3 | `constraint_receipt.create_receipt` has no access control | Anyone can create receipts (may be intentional) |
| L4 | No Garaga verifiers for BalanceAboveThreshold, PoolMembership, TenureAboveThreshold | Selective disclosure circuits have vkeys but no on-chain verifiers generated |

---

## Recommendations (Priority Order)

1. **Create `contracts/src/lib.cairo`** declaring all 28 modules — unblocks compilation
2. **Wire real Garaga verification** into `confidential_lp_position` and `proof_gated_lp_agent` — replace placeholders
3. **Remove or isolate `mock_fact_registry`** — ensure no production contract references it
4. **Generate missing vkeys** for RiskScore and AnomalyDetector circuits
5. **Fix the address collision** between SESSION_KEY_MANAGER and PROOF_GATED_AGENT
6. **Update stale deployment config files** to reflect actual deployed addresses
7. **Add access control** to `batch_verifier.queue_action` and `allocation_router.update_market_data`
8. **Fix `Array<T>` storage** in `proof_gated_lp_agent` — use `Map<u32, T>` + counter pattern
9. **Align TenureAboveThreshold commitment scheme** with standard commitment or document the separate deposit flow
10. **Generate and deploy Garaga verifiers** for selective disclosure circuits (BalanceAboveThreshold, PoolMembership, TenureAboveThreshold)
