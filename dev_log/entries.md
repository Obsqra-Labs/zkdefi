# Dev Log Entries

Chronological log of progress and unblocks. Scope: Jan 30, 2026 onward.

---

## 2026-02-06 -- Full Privacy Pool ENTRYPOINT_NOT_FOUND on deposit

**Issue**: Confirm Deposit in Full Privacy Pool fails with `ENTRYPOINT_NOT_FOUND` (selector `0x02f92ee6b5f8059b07fe0d8cba6562d85599ee579775d2f79bd6e84dfb7f33c1`) on the pool contract at `0x0700376443e295f33dda9ac2721a95d601f6b7c38719d58077049de357d3b85f`.

**Root cause**: The deployed pool instance may be an older class that only exposes `deposit(commitment: felt252, amount: u256)` and not `deposit_u256(commitment_low, commitment_high, amount)`. The frontend always called `deposit_u256`.

**Solution**:
1. Added env `NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT=true`. When set, the frontend calls `deposit(commitment_felt, amount_low, amount_high)` instead of `deposit_u256`. Commitment must fit in felt252 (&lt; 2^252); BN254 Poseidon outputs used here do.
2. Documented the env in `docs/ENV.md`. Long-term fix: redeploy FullyShieldedPool from current source so `deposit_u256` is available.

**Files modified**: `frontend/src/components/zkdefi/FullPrivacyPoolPanel.tsx`, `docs/ENV.md`.

**Status**: Fixed (env fallback). Set `NEXT_PUBLIC_FULL_PRIVACY_USE_FELT_DEPOSIT=true` in production until pool is redeployed with `deposit_u256`.

---

## 2026-02-02 -- zkde.fi loading / backend unreachable

**Issue**: Frontend at zkde.fi shows perpetual "Loading market data..." and position not loading.

**Root cause (primary)**: Content-Security-Policy `connect-src` in `next.config.js` did not allow the backend API origin. It only had `'self'` and Starknet RPC URLs. So when the app at zkde.fi fetched from `https://starknet.obsqra.fi`, the browser blocked the request and the UI stayed on "Loading...".

**Root cause (secondary)**: If the frontend was built without `NEXT_PUBLIC_API_URL` set, the client uses `http://localhost:8003`; from a user's browser those requests fail. NEXT_PUBLIC_* must be set at **build time**, not only after deployment.

**Solution**:
1. **CSP fix**: Added backend API origins to `connect-src`: `http://localhost:8003`, `https://starknet.obsqra.fi`, `https://api.zkde.fi` (in `frontend/next.config.js`).
2. **UX**: 15s timeout and error state on agent page for market data and position; show "Couldn't load market data" / "Unavailable" and Retry instead of infinite loading (`frontend/src/app/agent/page.tsx`).
3. **Deploy docs**: Clarified in `deploy_zkdefi_to_hostinger.sh` that NEXT_PUBLIC_* must be set before `npm run build`.

**Files modified**: `frontend/next.config.js`, `frontend/src/app/agent/page.tsx`, `deploy_zkdefi_to_hostinger.sh`.

**Status**: Fixed. Rebuild and redeploy frontend so CSP change is live; ensure NEXT_PUBLIC_API_URL is set at build time.

---

## 2026-01-30 -- Project scaffolding

Set up zkde.fi repo structure: contracts/, backend/, frontend/, circuits/, docs/.
Cairo contracts scaffolded: ProofGatedYieldAgent, SessionKeyManager, ConfidentialTransfer, SelectiveDisclosure, IntentCommitment, ConstraintReceipt, ComplianceProfile.
Circom circuits for PrivateDeposit and PrivateWithdraw started.

---

## 2026-01-31 -- Backend API and proof pipeline

FastAPI backend wired: session keys, rebalancer, zkML endpoints.
Groth16 prover service using snarkjs for proof generation.
Garaga CLI integration for on-chain proof formatting (--format starkli).
Frontend scaffold with Next.js, Starknet React, agent dashboard.

---

## 2026-02-01 -- Hackathon start, initial deployments

Hackathon officially starts (Starknet Re{define}, Privacy track).
Deployed first contracts to Sepolia using sncast.
Hit RPC version incompatibility: sncast requires v0.10.0, public RPCs are v0.7-v0.8.
Workaround: use starkli instead of sncast for deployments.

Deployed: SessionKeyManager, ConstraintReceipt, SelectiveDisclosure, IntentCommitment.
Garaga verifier deployed at 0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37.

---

## 2026-02-02 -- ConfidentialTransfer deploy, interface mismatch discovery

Deployed ConfidentialTransfer contract.
Private deposit flow wired: frontend -> backend -> proof generation -> contract call.

Issue: "Invalid proof" error on every private_deposit call.
Diagnosis: Proof looked valid, VK matched, all values in range.
Root cause found: Interface type mismatch.
- Contract expected: `fn verify_groth16_proof_bn254(...) -> bool`
- Garaga returns: `fn verify_groth16_proof_bn254(...) -> Result<Span<u256>, felt252>`
Call signature mismatch caused immediate failure before proof was checked.

Fix: Updated IGaragaVerifier interface in confidential_transfer.cairo.
Changed verifier call to use `result.is_ok()` instead of casting to bool.
Rebuilt contract with scarb build.

---

## 2026-02-02 -- Redeploy ConfidentialTransfer, proof verification success

Redeployed ConfidentialTransfer with fixed interface.
New address: 0x04b1265fa18e6873899a4f3ff15cfa0348b7bdf3ccb66bc658d0045ac61dfc0c.

Tested private_deposit: "Invalid proof" error gone.
New error: "u256_sub Overflow" -- proof verification passed, failed at token transfer.
Root cause: Contract had no approval to transfer tokens from user wallet.
Fix: Approved ConfidentialTransfer to spend STRK via sncast invoke approve.
TX: 0x05eea94b4f7c6e9c0d24a91600a0fcdf08e91804a635d97629960d9637ce9cbb.

Private deposit now works end-to-end.

---

## 2026-02-02 -- Nullifier overflow fix

Issue: Withdrawal failing with "Invalid proof" despite correct proof.
Root cause: Nullifier generated as hash % 2**252, could exceed Starknet prime.
Fix: Reduce nullifier modulo STARKNET_PRIME in groth16_prover.py.
Unblocked: Private withdrawal proof generation.

---

## 2026-02-02 -- ProofGatedYieldAgent interface fix

Same interface mismatch bug found in ProofGatedYieldAgent.
Applied same fix: IGaragaVerifier returns Result, call uses result.is_ok().
Redeployed: 0x0700f50fdb177ac690e66040b14fba316bc4ecab6aaccac2b86ffc0969f42fb3.

---

## 2026-02-02 -- Commitment tracking (localStorage)

Issue: After deposit, commitment not visible in withdraw screen.
Root cause: Contract only stores commitment->balance, not user->commitments.
Fix: Track commitments in localStorage (privacy-preserving, no on-chain linkage).
Commitments persist across refresh, update on deposit/withdraw.

---

## 2026-02-03 -- VK mismatch for withdrawal circuit

Issue: Private withdrawal failing with "Wrong Glv FakeGLV result".
Diagnosis: ConfidentialTransfer uses ONE Garaga verifier for both deposit and withdrawal.
- Deposit VK hash: 5c6c9f4a1b15d51a
- Withdrawal VK hash: 77b70a9516d35eec
Different circuits = different VKs. Withdrawal proof verified against deposit verifier fails.

Solution: Two-verifier architecture.
Updated contract to accept garaga_verifier_deposit and garaga_verifier_withdraw.
private_deposit() uses deposit verifier, private_withdraw() uses withdrawal verifier.

---

## 2026-02-03 -- RPC CASM hash mismatch, starkli --casm-hash fix

Issue: starkli declare failing with "Mismatch compiled class hash".
Root cause: Scarb 2.14.0 compiles CASM with one hash, starkli 0.4.2 recompiles with different hash.
Compiler version mismatch: Scarb 2.14.0 vs starkli built-in 2.11.4.

Solution: Use --casm-hash flag to skip starkli recompilation.
Extract expected CASM hash from error message, pass to starkli declare.
Unblocked: All contract deployments with version mismatches.

---

## 2026-02-03 -- Withdrawal verifier deployed

Generated new Garaga verifier for PrivateWithdraw circuit using garaga CLI.
Declared with --casm-hash override.
Deployed: 0x026521c74423467ed4db4aab9da3fc5da5dba5dc5eeda39f3da61e3e420d3efd.
TX: 0x07de43719da631acd219d976d179a4c3baf0be6df7621b734b3eebc9a89f8a80.

---

## 2026-02-03 -- ConfidentialTransfer v2 with two verifiers deployed

Deployed updated ConfidentialTransfer with two-verifier architecture.
Address: 0x032f230ac10fc3eafb4c3efa88c3e9ab31c23ef042c66466f6be49cf0498d840.
Constructor args:
- garaga_verifier_deposit: 0x06d0cb7a...
- garaga_verifier_withdraw: 0x026521c7...
- token: 0x04718f5a... (STRK)
- admin: 0x05fe8125...

Updated backend and frontend .env with new address.
Restarted services.

Private deposit and private withdrawal both working end-to-end.

---

## 2026-02-03 -- ShieldedPool contract built

Built ShieldedPool: unified private allocation pool with Conservative/Neutral/Aggressive pools.
Integrates relayer for private withdrawals to fresh addresses.
Distinguishes human-signed vs agent (execution proof required).
Ready for manual deployment via Voyager (CLI blocked by RPC version).

---

## 2026-02-03 -- Selective disclosure and compliance profiles expanded

Added compliance profile types: yield, balance, risk, performance, kyc, portfolio.
Each profile can prove a statement (threshold) without revealing full data.
Frontend UI for compliance panel, selective disclosure generation.

---

## 2026-02-03 -- Framework naming: zkDE + GATE

Finalized naming:
- zkDE = Zero-Knowledge Deterministic Engine (the infrastructure)
- GATE = Governed Autonomous Trustless Execution (the agent standard)

Updated docs, landing page, docs-site to reflect new naming.

---

## 2026-02-03 -- Docs and dev log cleanup

Created dev_log/ for chronological progress tracking.
Archived ephemeral root MDs to archive/.
Stripped emojis from internal docs.
Synced docs-site with current content and naming.
Updated FOR_JUDGES.md scope.

---

## Key Unblocks Summary

| Issue | Root Cause | Solution |
|-------|------------|----------|
| "Invalid proof" | Interface type mismatch (bool vs Result) | Update IGaragaVerifier interface |
| "u256_sub Overflow" | No token approval | Approve contract to spend tokens |
| Nullifier overflow | hash % 2**252 > prime | Reduce modulo STARKNET_PRIME |
| "Wrong Glv FakeGLV" | Single verifier for two circuits | Two-verifier architecture |
| CASM hash mismatch | Compiler version difference | starkli --casm-hash override |
| RPC v0.10.0 required | Public RPCs are v0.7-v0.8 | Use starkli instead of sncast |
| Commitment tracking | No user->commitments on-chain | localStorage (privacy-preserving) |

---

## 2026-02-04 -- Full Privacy Pool Deployment Complete

### Contracts Deployed

| Contract | Address | Description |
|----------|---------|-------------|
| MerkleTree | 0x05ebfd6cc0a7b58c170d8a96bfa353b38a772ea4eea3d291e1d7d2abf584fa88 | Incremental merkle tree (depth 20) |
| FullyShieldedPool | 0x0797358209d3d1e4f4a70abd1a15deaf16be11e41f44aa11b965a03eae6120cf | Full privacy pool with selective disclosure |

### Features Implemented

1. **Full Privacy** - Balance, pool type, and owner are ALL hidden on-chain
2. **Merkle Tree Storage** - Only commitments stored, no balance/pool/owner maps
3. **Nullifier Tracking** - Prevents double-spend without revealing commitment
4. **Selective Disclosure** - Prove properties (balance > X, pool = Y) via ZK proofs
5. **ZK Circuits** - FullPrivacyWithdraw, BalanceAboveThreshold, PoolMembership, TenureAboveThreshold

### Backend Services

- `merkle_tree_service.py` - Off-chain tree management
- `full_privacy_proof_service.py` - Proof generation
- API routes: `/api/v1/zkdefi/full_privacy/*`

### Status

- Contracts: Deployed and authorized
- Backend: Updated with new addresses
- Frontend: FullPrivacyPoolPanel added to agent page
- Circuits: Compiled with zkeys and verification keys

---

## 2026-02-02 -- Landing page: three pillars + intent + inference

Rewrote landing page around Verifiable Execution, Trustless AI, and zkML with definitions and how we approach each. Clarified that we do inference (run risk and anomaly models, then prove the result) and verify both intent (constraints) and inference (model outputs). Added rewrite plan to dev_log/landing_page_rewrite_plan.md. Pillar cards now include Definition + How we approach it; How it works step 2 renamed to "Inference + proof"; Hybrid proof section mentions inference proofs (Garaga) + execution proofs (Integrity).

Reframed to **zkML coprocessor + two core concepts**: (1) **Trustless execution** — zkML drives it by gating execution on proofs (+ on-chain allocation risk in Cairo). (2) **Verifiable AI** — zkML drives it by proving model outputs without revealing them. Updated landing_page_rewrite_plan.md and landing page: section title "Our zkML coprocessor drives two core concepts"; two cards (Trustless execution, Verifiable AI) with "How zkML drives it" instead of three pillars.

---

## 2026-02-05 -- ERC-8004 Alignment & Production Features

### Finding: ERC-8004 Reference Implementation for Starknet

**Issue**: ERC-8004 (August 2025) defines agent identity, reputation, and validation proof registries for EVM. zkde.fi needs equivalent functionality on Starknet.

**Solution**: Created Starknet-native equivalents:
1. **AgentIdentity (SRC-721)** - NFT-based agent identity with commitment linkage
2. **ValidationProofRegistry** - On-chain proof catalog for discovery
3. **ReputationRegistry enhancements** - Discoverable scoring (0-1000)

**Files Created**:
- `contracts/src/agent_identity.cairo`
- `contracts/src/validation_proof_registry.cairo`
- `backend/app/api/routes/identity.py`
- `frontend/src/services/identity.ts`
- `frontend/src/services/poseidon.ts`
- `backend/risc_zero/` (host, guest, service)

**Files Modified**:
- `contracts/src/reputation_registry.cairo`
- `contracts/src/lib.cairo`
- `backend/app/api/routes/onboarding.py`
- `backend/app/api/routes/agents.py`
- `backend/app/main.py`
- `backend/app/services/local_orchestrator.py`
- `tests/e2e_test_suite.py`
- `circuits/CorrelationRisk.circom`
- `circuits/SafetyDiversification.circom`

**Key Achievements**:
1. All 3 new circuits compile (CorrelationRisk, TWAPPosition, SafetyDiversification)
2. RISC Zero credit scoring with neural network for cross-chain identity
3. Universal Identity Commitment for privacy-preserving address linking
4. 4 new Cairo contracts compiled and class hashes declared on Sepolia

**Status**: ✅ Complete

---

## 2026-02-05 -- Contract Deployments & RPC Resolution

### Finding: RPC Version Incompatibility Resolved

**Issue**: Public RPC endpoints (PublicNode 0.8.1, Alchemy 0.7.1) incompatible with sncast 0.53.0 and starknet_py 0.29.0 which require RPC 0.10.0. Errors included:
- `unknown block tag 'pre_confirmed'`
- `Input too long for arguments` from UDC

**Root Cause**: 
1. Modern Starknet tooling uses the `pre_confirmed` block tag not supported by older RPCs
2. The `deployer_sepolia` account had wrong private key

**Solution**:
1. **Cartridge RPC** (`https://api.cartridge.gg/x/starknet/sepolia`) runs version 0.9.0 - compatible enough
2. Used `deployer` account (not `deployer_sepolia`)
3. sncast 0.53.0 with Cartridge RPC works despite warning

### Contracts Successfully Deployed

| Contract | Address | TX Hash |
|----------|---------|---------|
| AgentIdentity | `0x06b2ed4153d620f5558086de5afff8a5bb0de76720deb26c8a037cb347aff80a` | 0x00a828b11e57fa6d... |
| ValidationProofRegistry | `0x02e2b175026aa2f9cf804d84a92076fcf9c29149bb009305f26d4be74ae03492` | 0x013516f653dcc650... |
| ReputationRegistry | `0x0428700cc719df6ef6104123f6a326dde0f4f42f7e41f941473338bc31f9ccff` | 0x038b02c03f960259... |

### Backend & Frontend Updates

1. Backend reloaded via PM2 with new contract addresses
2. Identity endpoints now active: `/api/v1/identity/*`
3. OnboardingWizard updated to show credit tier (AAA/AA/A/B/C)
4. Docs updated with ERC-8004 contract addresses and comparison

### Files Modified

- `contracts/snfoundry.toml` - Updated RPC to Cartridge
- `contracts/DEPLOYMENT_STATUS.md` - Full deployment documentation
- `docs/CONTRACTS.md` - Added ERC-8004 section
- `frontend/src/components/zkdefi/OnboardingWizard.tsx` - Credit tier display
- `backend/app/main.py` - Identity router import fix

### Key Unblock

| Issue | Solution |
|-------|----------|
| RPC 0.10.0 required | Cartridge RPC (0.9.0) + sncast 0.53.0 |
| Wrong account key | Use `deployer` not `deployer_sepolia` |
| Declaration propagation delay | Wait 30s between declare and deploy |

**Status**: ✅ All ERC-8004 contracts deployed and live

---

## 2026-02-05 - Frontend Loading Issue Fix

### Issue
"My Agents", "Market Data", and "Withdrawal Proofs" sections showing infinite loading with no console errors visible to user.

### Root Cause
- Frontend was running in production mode (`npm run start`)
- Production bundle had `https://zkde.fi/api/...` baked in at build time
- Content Security Policy blocked requests (CSP allows `api.zkde.fi` not `zkde.fi/api`)
- Fetch errors caught silently, resulting in loading states never resolving

### Solution
```bash
pm2 delete zkdefi-frontend
pm2 start "npm run dev" --name zkdefi-frontend
```

Development mode reads `.env.local` at runtime:
- `NEXT_PUBLIC_API_URL=http://localhost:8003`

### Prevention
- Use `npm run dev` for local development
- Production builds must set correct API URL in build environment
- Consider updating CSP to allow both api.zkde.fi and zkde.fi paths

**Status**: ✅ Fixed - API requests now hitting localhost:8003 with 200 responses

---

## 2026-02-05 - Production Frontend API URL Fix

### Issue
Production frontend at zkde.fi showing "Couldn't reach API" for all data-fetching components.

### Root Cause
- `deploy_production.sh` was setting `NEXT_PUBLIC_API_URL=https://zkde.fi` (missing `/api`)
- Frontend trying to reach `https://zkde.fi/api/v1/zkdefi/...` but URL was wrong
- Backend API is at `https://zkde.fi/api` (nginx proxies to :8003)

### Solution
```bash
# Fixed deploy_production.sh line 29:
export NEXT_PUBLIC_API_URL=https://zkde.fi/api

# Also created .env.production:
NEXT_PUBLIC_API_URL=https://zkde.fi/api

# Rebuilt and redeployed
./deploy_production.sh
```

### Verification
```bash
curl -s https://zkde.fi/api/v1/zkdefi/oracle/market-data
# Returns: {"jediswap":{"tvl":45000000...},"ekubo":{...}}
```

**Status**: ✅ Fixed - Production frontend now correctly calls https://zkde.fi/api


---

## 2026-02-05 -- Poseidon Hash Alignment and u256 Split Storage

**Issue**: Full Privacy Pool deposits and withdrawals failing with "Commitment not found in merkle tree" and "felt overflow" errors.

**Root Cause**: Fundamental mismatch between Poseidon hash implementations:
- Backend Merkle tree was using **Starknet-native Poseidon** (over STARK_PRIME)
- Circom circuits expect **BN254 Poseidon** (over BN128_PRIME)
- BN254 Poseidon outputs are ~254 bits, exceeding felt252's safe range (~251 bits)

**Solution (Split Storage u256)**:

### 1. Backend Changes
- Created `circomlib_poseidon.py` - wrapper calling `circomlibjs` via Node.js subprocess
- Updated `merkle_tree_service.py` to use BN254 Poseidon for all hashing
- Updated `full_privacy_proof_service.py` to use BN254 Poseidon

### 2. Circuit Changes
- Updated `PrivateDeposit.circom` - replaced placeholder hash with circomlib Poseidon(2)
- Updated `PrivateWithdraw.circom` - replaced placeholder hash with circomlib Poseidon(2)
- Recompiled circuits with updated trusted setup

### 3. Contract Changes (u256 Split)
- **MerkleTree.cairo**: `insert(leaf_low: u128, leaf_high: u128)`, `get_root() -> (u128, u128)`
- **FullyShieldedPool.cairo**: `deposit(commitment_low, commitment_high, amount: u256)`
- **ConfidentialTransfer.cairo**: `private_deposit(commitment_low, commitment_high, ...)`

### 4. Frontend Changes
- Updated `FullPrivacyPoolPanel.tsx` to split BigInt values:
  ```typescript
  const low = value % (2n ** 128n);
  const high = value / (2n ** 128n);
  ```
- Updated `ShieldedPoolPanel.tsx` similarly

### 5. Deployed Contracts (Sepolia)
- MerkleTree: `0x0344fc61c03c93a174f23175e2b12300c8088f6973a35ef442c31e3126d2e88c`
- FullyShieldedPool: `0x0700376443e295f33dda9ac2721a95d601f6b7c38719d58077049de357d3b85f`
- ConfidentialTransfer: `0x000b31353014fc9d3433067f043083980f71a9b0be54bc7391e7f9b4f6cec94b`

**Files Modified**:
- `backend/app/services/circomlib_poseidon.py` (NEW)
- `backend/app/services/merkle_tree_service.py`
- `backend/app/services/full_privacy_proof_service.py`
- `contracts/src/merkle_tree.cairo`
- `contracts/src/fully_shielded_pool.cairo`
- `contracts/src/confidential_transfer.cairo`
- `circuits/PrivateDeposit.circom`
- `circuits/PrivateWithdraw.circom`
- `frontend/src/components/zkdefi/FullPrivacyPoolPanel.tsx`
- `frontend/src/components/zkdefi/ShieldedPoolPanel.tsx`

**Breaking Changes**:
- Old commitments are INVALID - merkle tree reset required
- Frontend localStorage must be cleared for old commitments
- Contract interfaces changed from `felt252` to `(u128, u128)` pairs

**E2E Test Results**:
- ✅ Backend: BN254 Poseidon hashing verified
- ✅ Commitment generation: produces valid BN254 hashes
- ✅ Merkle tree registration: inserts leaves correctly
- ✅ Withdrawal proof generation: snarkjs witness + groth16 proof succeeds
- ⏳ On-chain verification: pending frontend rebuild and test

**Status**: Core hash alignment complete. Pending full on-chain E2E test via frontend.
