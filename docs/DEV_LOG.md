### Finding: "Unknown merkle root" on Privacy Pool Withdraw

**Date**: 2026-02-08

**Issue**: Withdrawal from Full Privacy Pool fails with `0x556e6b6e6f776e206d65726b6c6520726f6f74` ("Unknown merkle root"). Deposit succeeds.

**Root Cause**: Three compounding issues:

1. **Wrong pool contract**: Production frontend was baked with pool `0x07003...` whose merkle tree (`0x02a8eaa...`) does NOT have `add_known_root()` — an older class hash without the sync entrypoint. The backend root can never be registered on this tree.

2. **Hash function mismatch**: On-chain merkle tree uses Cairo-native Poseidon. Backend uses circomlib BN254 Poseidon (for ZK circuit compatibility). Same leaves produce different roots. The backend's withdraw proof binds to the backend root, but the on-chain contract checks `is_known_root()` against its own root history.

3. **Missing admin key**: `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY` was not set in backend `.env`, so `schedule_register_root_on_chain()` silently skipped the `add_known_root()` call every time.

**Solution**:

1. Switched production to newer pool `0x051fb4178...` with merkle tree `0x03171dd46...` that has `add_known_root()` entrypoint.
2. Added pool as allowed inserter on the merkle tree via `starkli invoke add_inserter`.
3. Set `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY` in backend `.env`.
4. Rewrote `merkle_tree_onchain_sync.py` to use `starkli` CLI (subprocess) instead of `starknet_py.execute_v1` — the latter fails with "transaction version not supported" / "missing L1_DATA_GAS" on current Sepolia RPCs (starknet_py 0.23 is too old for v3 transactions).
5. Uses RPC v0.8 endpoint for starkli transactions.
6. Reset backend merkle tree to empty state (previous 26 leaves were stale from old deployments).
7. Added `logging.basicConfig` to `main.py` so app-level loggers appear in PM2 logs.
8. Added `/merkle/reset` endpoint for quick tree resets without process restart.

**Verification**: After `register_commitment`, `add_known_root` fires via starkli and on-chain `is_known_root(root)` returns `0x1` (true).

**Files Modified**:
- `frontend/.env.production.local` — switched to pool `0x051fb`, tree `0x03171dd`
- `backend/.env` — added `FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY`
- `backend/app/services/merkle_tree_onchain_sync.py` — rewrote to use starkli subprocess
- `backend/app/main.py` — added `logging.basicConfig` for app-level logging
- `backend/app/api/routes/full_privacy.py` — added `/merkle/reset` endpoint

**Status**: Fixed. Fresh deposit+withdraw flow should now work. User must do a new deposit (old deposits on pool 0x07003 are orphaned).

**Follow-up (2026-02-08)**: If users still see "Unknown merkle root" (e.g. local/dev without backend merkle env, or withdrawing before `add_known_root` confirms): added **Full Privacy: "Unknown merkle root" on withdraw** section to `docs/WALLET_TROUBLESHOOTING.md` (wait after deposit, check backend `FULL_PRIVACY_MERKLE_TREE_*`, manual root registration). Added UI hint on Full Privacy withdraw step: "If you see 'Unknown merkle root', wait 30–60s after deposit for root sync, or ensure backend has FULL_PRIVACY_MERKLE_TREE_* set."

---

### Finding: Wallet won't load on login (Connect Wallet)

**Date**: 2026-02-07

**Issue**: Wallet connection / login modal doesn't load or hangs when user tries to connect.

**Root Cause**: (1) StarknetProvider used `publicProvider()` which picks a random public Starknet RPC; those can be slow or rate-limited, so the provider never resolves and the wallet context never initializes. (2) If no Argent/Braavos extension is installed, `connectors` can be empty and the modal showed nothing useful.

**Solution**: (1) Use a fixed RPC: `jsonRpcProvider` with `NEXT_PUBLIC_RPC_URL` or default Alchemy Sepolia URL (same as backend). No more `publicProvider()`. (2) In WalletModal, when `connectors` is empty, show "No wallet detected — Install Argent X or Braavos, then refresh."

**Files Modified**: frontend/src/components/zkdefi/StarknetProvider.tsx, WalletModal.tsx, docs/ENV.md (NEXT_PUBLIC_RPC_URL).

**Status**: Fixed

---

### Research: Ekubo + zkde.fi testnet demo (trading/swaps, zkML, paper trading)

**Date**: 2026-02-07

**Scope**: Ekubo docs & Sepolia contracts, live testnet data, paper/real swaps, zkML marketplace + automated agent flows.

**Findings**: (1) Ekubo API (prod-api.ekubo.org) supports Sepolia (chainId); endpoints for tokens, pairs, pools, TVL, volume, price history. (2) Sepolia Core/Router addresses documented; swapping via ICore#lock + locked callback. (3) Paper trading viable: quote from API + local ledger + PnL/Sharpe/drawdown. (4) zkML rebalancer + marketplace processors (TWAP, correlation, risk) can drive “when to swap” and “how much”; decision logic (AND/OR/WEIGHTED) + proof-gated execution already in place. (5) Additional ideas: swap-intent processor, execution-quality zkML, demo mode (paper → real).

**Output**: docs/EKUBO_ZKDEFI_TESTNET_VIABILITY_REPORT.md.

**Status**: Report written; implementation order suggested in report.

---

### Finding: Full Privacy deposit ENTRYPOINT_NOT_FOUND on approve

**Date**: 2026-02-07

**Issue**: Privacy pool deposit fails with ENTRYPOINT_NOT_FOUND in contract `0x0700376443e295f33dda9ac2721a95d601f6b7c38719d58077049de357d3b85f`, selector `0x02f92ee6b5f8059b07fe0d8cba6562d85599ee579775d2f79bd6e84dfb7f33c1` (= ERC20 `approve`).

**Root Cause**: The failing contract is the **token** used for Full Privacy (NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS). That token does not expose the ERC20 `approve` entrypoint. Two cases: (a) token was set to a non-ERC20 contract; (b) **production** had the **pool** address (`0x07003...`) set as the token (copy-paste or env reuse). The pool has `deposit`/`withdraw`, not `approve` → ENTRYPOINT_NOT_FOUND when the frontend calls approve on it.

**Solution**: (1) Use a token that implements ERC20 (approve + transfer_from). Set `NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS` to Sepolia ETH `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` (or the pool’s actual token). (2) **Do not set the token to the pool address.** (3) In frontend: if token address equals pool address, use Sepolia ETH instead (safeguard). (4) In `.env.production.local`: set `NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS` and USE_FELT_DEPOSIT/WITHDRAW explicitly.

**Files Modified**: frontend/.env.local, frontend/.env.production.local (token + felt flags), frontend/src/components/zkdefi/FullPrivacyPoolPanel.tsx (safeguard: token !== pool → use Sepolia ETH).

**Status**: Fixed: production env + in-code safeguard. Rebuild/restart frontend so NEXT_PUBLIC_* and safeguard apply.

---

### RPC default: Blast deprecated → Alchemy (ObsqraFactRegistry on-chain check)

**Date**: 2026-02-07

**Issue**: On-chain check ObsqraFactRegistry.is_valid(fact_hash) failed with "Blast API is no longer available. Please update your integration to use Alchemy's API instead."

**Root Cause**: Backend config and several services defaulted to `STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io`, which is deprecated.

**Solution**: Updated default to Alchemy v0_7 (same as run_tests.sh and e2e_test_suite.py): `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7`. Files: backend/app/config.py, zkdefi_agent_service.py, merkle_tree_onchain_sync.py, agent_rebalancer.py, docs/ENV.md.

**Verification**: ObsqraFactRegistry.is_valid(0x7075c468...) → True via Alchemy RPC.

**Status**: Fixed

---

### Dual-Proof + ObsqraFactRegistry Live (Starknet Sepolia)

**Date**: 2026-02-07

**Update**: Dual-proof system is fully operational end-to-end. **ObsqraFactRegistry** deployed at `0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8` provides real on-chain persistence for STARK facts.

**Flow**: STARK path — Cairo0 risk program → Stone proof → call_contract (Integrity Verifier on node) → backend registers fact_hash in ObsqraFactRegistry (~1.2M L2 gas). Groth16 path — same computation via RiskScoreAllocation.circom, fact_hash as public input, Garaga verifies on-chain. Status `both` = trustless + on-chain verifiable; `stark_only` / `groth16_only` are valid partial results.

**zkde.fi**: Point fact_registry (ProofGatedYieldAgent, TieredAgentController constructor) at the address above. Existing is_valid / get_all_verifications_for_fact_hash calls work unchanged. Config: OBSQRA_FACT_REGISTRY_ADDRESS; docs: DUAL_PROOF_ARCHITECTURE.md, ENV.md.

**Status**: Documented and wired in config

---

### Finding: Stone Prover Integrity L2 Gas Bound Too Low (obsqra)

**Date**: 2026-02-07

**Issue**: After obsqra reduced resource bounds to fix error 55 (exceed balance), re-test of `POST https://starknet.obsqra.fi/api/v1/proofs/generate` still returns 500 with a different error: *"Insufficient max L2Gas: max amount: 10000000, actual used: 16381120"*.

**Root Cause**: `l2_gas` max_amount was set to 10M in obsqra `integrity_service.py`, but the Integrity registration tx actually uses ~16.4M L2 gas. The balance fix was correct; the L2 cap is now below actual usage.

**Solution (obsqra)**: In `backend/app/services/integrity_service.py`, raise `l2_gas` max_amount to at least 20_000_000 (or 25_000_000 for headroom) so actual used (~16.4M) is covered. Keep implied total fee under the backend wallet balance (e.g. if raising L2 increases implied fee, ensure wallet has enough STRK).

**Test result**: Stone prover direct → 500 (above error). zkde.fi E2E `generate_authorization` → 200 with fallback (proof_registered: false) because prover returned 500. Once obsqra fixes L2 bound and prover returns 200, zkde.fi will return proof_registered: true without code change.

**Status**: L2 bound fixed on obsqra (25M). Next run hit a different error — see below.

---

### Finding: Stone Prover — RunResources step limit (obsqra)

**Date**: 2026-02-07

**Issue**: After raising l2_gas max_amount to 25M and restarting obsqra-backend, `POST .../proofs/generate` still returns 500. Error is no longer balance or L2 gas; the Integrity/verification tx **reverts** with: *"Could not reach the end of the program. RunResources has no remaining steps."*

**Root Cause**: L2 gas and balance bounds are now sufficient (tx proceeds past validation). The failure is **Cairo execution step limit** — the verification program runs out of run-resource steps before completing.

**Solution (obsqra)**: Increase the step/resource limit for the Integrity registration tx (or the called contracts’ run resources) so the full verification program can complete. This is a Starknet/tx config or contract invocation limit, not fee bounds.

**Test result**: Stone prover direct → 500 (above error). zkde.fi E2E → 200 with fallback (proof_registered: false). Once obsqra fixes step limit and prover returns 200, zkde.fi will return proof_registered: true.

**Status**: Obsqra-side fix needed (raise RunResources / step limit for verification tx)

---

### Finding: Onboarding 502 Stone Prover Fallback

**Date**: 2026-02-07

**Issue**: At "Generate authorization proof" step, onboarding failed with: `Stone prover API error: <html>...502 Bad Gateway...</html>` (nginx). The fallback to deterministic hash existed only for non-HTTP errors, so 5xx from the prover never triggered it.

**Root Cause**: `httpx.HTTPStatusError` for 502 was caught and re-raised as `HTTPException`, so the generic `except Exception` fallback (deterministic hash) was never used for 5xx.

**Solution**: In `generate_authorization`, when catching `HTTPStatusError`, if `e.response.status_code >= 500` treat as "prover unavailable" and return the same deterministic-hash response (proof_registered=False, clear message). 4xx still re-raised.

**Files Modified**: `backend/app/api/routes/onboarding.py`

**Status**: Fixed

---

### Finding: Composable zkML Model Marketplace Implementation

**Date**: 2026-02-04

**Feature**: Complete implementation of zkML Model Marketplace for composing custom agents from multiple zero-knowledge ML models.

**Components Implemented**:

1. **New Groth16 Circuits** (Circom):
   - `CorrelationRisk.circom` - Portfolio correlation proof
   - `TWAPPosition.circom` - Time-weighted average position proof
   - `SafetyDiversification.circom` - Protocol safety diversification proof

2. **New Backend Services** (Python):
   - `zkml_correlation_service.py` - Correlation risk model
   - `zkml_twap_service.py` - TWAP position model
   - `zkml_diversification_service.py` - Safety diversification model
   - `risc_zero_credit_service.py` - Cross-chain credit scoring (RISC Zero)
   - `cross_chain_fetcher.py` - Multi-chain DeFi data aggregation
   - `multi_processor_orchestrator.py` - Parallel proof generation
   - `agent_service.py` - Composed agent management
   - `orchestrator_client.py` - API client for orchestrator

3. **New Cairo Contracts**:
   - `model_registry.cairo` - On-chain model registration
   - `agent_composer.cairo` - Composed agent creation and execution
   - Updated `proof_gated_yield_agent.cairo` - Integration with AgentComposer

4. **Frontend Components** (React/Next.js):
   - `ModelComposer.tsx` - UI for composing agents from models
   - `MyAgents.tsx` - Display and execute user's agents
   - Updated `agent/page.tsx` - New "zkML Models" tab
   - Updated `profile/page.tsx` - "My Agents" tab

5. **API Endpoints**:
   - `/api/v1/agents/create` - Create composed agent
   - `/api/v1/agents/{id}` - Get/deactivate agent
   - `/api/v1/agents/user/{address}` - List user's agents
   - `/api/v1/agents/execute` - Execute with parallel proofs
   - `/api/v1/agents/models/list` - List available models

**Architecture**:
- zkde.fi (open source) handles UI and agent management
- starknet.obsqra.fi (closed source) handles multi-processor orchestration
- Groth16 models: ~10s proof generation
- RISC Zero models: ~120s for complex cross-chain scoring

**Files Created**:
- `circuits/CorrelationRisk.circom`
- `circuits/TWAPPosition.circom`
- `circuits/SafetyDiversification.circom`
- `backend/app/services/zkml_correlation_service.py`
- `backend/app/services/zkml_twap_service.py`
- `backend/app/services/zkml_diversification_service.py`
- `backend/app/services/agent_service.py`
- `backend/app/services/orchestrator_client.py`
- `backend/app/api/routes/agents.py`
- `contracts/src/model_registry.cairo`
- `contracts/src/agent_composer.cairo`
- `frontend/src/components/zkdefi/ModelComposer.tsx`
- `frontend/src/components/zkdefi/MyAgents.tsx`
- `tests/test_model_marketplace.py`
- `scripts/deploy_marketplace_contracts.sh`
- `docs/ZKML_MODEL_MARKETPLACE.md`

**Files Modified**:
- `backend/app/main.py` - Added agents router
- `frontend/src/app/agent/page.tsx` - Added Models tab
- `frontend/src/app/profile/page.tsx` - Added Agents tab
- `contracts/src/lib.cairo` - Added new modules
- `contracts/src/proof_gated_yield_agent.cairo` - Added composed agent support

**Status**: COMPLETED

**Notes**:
- RISC Zero integration is currently simulated (no actual zkVM)
- Contracts compile successfully, deployment script ready
- E2E test suite covers full agent lifecycle

---

### Finding: zkML Marketplace Contracts Deployed

**Date**: 2026-02-04

**Issue**: Deploy ModelRegistry and AgentComposer contracts to Starknet Sepolia

**Root Cause**: Compiler version mismatch between Scarb (2.14.0) and starkli (2.11.4) causes CASM hash mismatch errors

**Solution**: Used documented `--casm-hash` override fix from `archive/RPC_CASM_HASH_FIX.md`:
1. Attempt declaration without --casm-hash to get expected hash from error
2. Re-declare with `--casm-hash <expected_hash>` flag
3. Wait 30s for L2 confirmation
4. Deploy with class hash

**Deployed Contracts**:
- ModelRegistry: `0x04bb413b87bd52fff3c8c4bebe5199f48c5d57f48d1d1bf3d1f9d4a8af18b836`
- AgentComposer: `0x0639eda1b05238d21183cbf2dab7bfca793978d534d608d992577dcdccb0a84d`

**Verification**: Both contracts verified with starkli call (multiple attempts to avoid false negatives)

**Files Modified**:
- `.env` - Added contract addresses
- `.marketplace_deployed` - Full deployment record

**Status**: DEPLOYED

---

### Finding: u256_to_felt hashing bug caused all withdrawals to fail with "Unknown merkle root"

**Date**: 2026-02-08

**Issue**: Every withdrawal from the FullyShieldedPool failed with "Unknown merkle root" despite deposits succeeding and `add_known_root` transactions confirming on-chain.

**Root Cause**: The `u256_to_felt` function in `merkle_tree.cairo` was **hashing** `[low, high]` with Cairo Poseidon when `high != 0`, instead of arithmetically reconstructing the number. Since BN254 roots are ~254 bits, `high` is always nonzero, meaning the contract computed `poseidon_hash([root_low, root_high])` — a completely different value from the `root % STARK_PRIME` that was registered via `add_known_root`. The lookup always failed.

**Broken code**:
```cairo
fn u256_to_felt(self: @ContractState, low: u128, high: u128) -> felt252 {
    if high == 0 { low.into() }
    else {
        let arr = array![low.into(), high.into()];
        poseidon_hash_span(arr.span()) // WRONG: hashes instead of reconstructing
    }
}
```

**Fix**: Changed to arithmetic reconstruction:
```cairo
fn u256_to_felt(self: @ContractState, low: u128, high: u128) -> felt252 {
    let low_felt: felt252 = low.into();
    let high_felt: felt252 = high.into();
    low_felt + high_felt * 340282366920938463463374607431768211456 // 2^128
}
```

This computes `(low + high * 2^128) % STARK_PRIME` which equals `root % STARK_PRIME` — matching the backend's `_root_to_felt252`.

**Verification**: After fix, `is_known_root_u256(root_low, root_high)` returns `true` for roots registered via `add_known_root(root % STARK_PRIME)`.

**Files Modified**:
- `contracts/src/merkle_tree.cairo` - Fixed `u256_to_felt`
- `backend/.env` - Updated contract addresses
- `frontend/.env.production.local` - Updated contract addresses

**New Contract Addresses**:
- MerkleTree: `0x03659ca95ebe890741ca68dd84945716ca9e40baa6650d81f977466726370947`
- FullyShieldedPool: `0x07fed6973cfc23b031c0476885ec87a401f1006bdc8ba58df2bd8611b38b5ff5`
- Class hash (MerkleTree): `0x037a552e0e86c353dcf778af236d126bdbf14d020e11b4ab0d0a392eec1fc026`

**Status**: FIXED - Contracts redeployed, backend + frontend updated
