# Proof Flows: Private Transfer, Shielded, Full Privacy, zkML

This doc describes how privacy proof flows fit together, what unlocks what, and deposit/withdraw semantics so one flow is not broken while fixing another.

**Smoke testing:** Use the **Full Privacy** (merkle tree) flow; Private Transfer and Shielded Pool have not been the recent focus. Ensure the frontend Full Privacy panel honors the backend flow that succeeds (deposit → register_commitment → withdraw with stored merkle proof).

## Flows overview

| Flow | Contract | Circuits | Backend service | Unlocks |
|------|----------|----------|-----------------|--------|
| **Private Transfer** | ConfidentialTransfer | PrivateDeposit, PrivateWithdraw | Groth16Prover | Confidential balances, private send |
| **Shielded Pool** | ShieldedPool or ConfidentialTransfer | Same: PrivateDeposit, PrivateWithdraw | Groth16Prover | Pool deposits/withdrawals with privacy |
| **Full Privacy** | FullyShieldedPool | FullPrivacyWithdraw | full_privacy_proof_service | Full privacy pool withdraw (merkle membership) |
| **zkML / AI rebalancing** | Proof-gated agent | RiskScore, AnomalyDetector | proof_pipeline, zkml_risk_service, zkml_anomaly_service | Proof-gated rebalancing |
| **Onboarding** | ProofGatedYieldAgent, AgentIdentity, ValidationProofRegistry | None (STARK/obsqra) | onboarding routes | Agent initialization |

## Private Transfer vs Shielded Pool

- **Private Transfer** (`/api/v1/zkdefi/private_deposit`, `private_withdraw`) and **Shielded Pool** (`/api/v1/zkdefi/shielded_deposit`, `shielded_withdraw`) share the **same circuits** (PrivateDeposit.circom, PrivateWithdraw.circom) and the same **Groth16Prover**. No merkle tree; only commitment_balance and nullifiers on-chain.
- Shielded deposit/withdraw are wrappers that call `Groth16Prover.generate_private_deposit_proof` and `generate_private_withdraw_proof`. Fixing circuits/build and commitment in the prover fixes both flows.

## Full Privacy (separate) — flow to use for smoke testing

- **Full Privacy** uses FullPrivacyWithdraw.circom and a **merkle tree** (backend BN254 tree + on-chain add_known_root sync). It does **not** use PrivateDeposit/PrivateWithdraw. No change to Private Transfer or Shielded when fixing Full Privacy, and vice versa.
- **Backend flow (working):** (1) `POST /full_privacy/deposit/generate_commitment` → returns commitment, user_secret, amount, pool_type, nonce, blinding. (2) User submits on-chain deposit. (3) `POST /full_privacy/deposit/register_commitment` with commitment → returns leaf_index, merkle_root, **path_elements**, **path_indices**. (4) `POST /full_privacy/withdraw/generate_proof` with user_secret, amount, pool_type, nonce, blinding, withdraw_amount, recipient, leaf_index, and **optionally merkle_root, path_elements, path_indices** (stored proof from registration).
- **Frontend must match:** Save **path_elements** and **path_indices** from the register_commitment response (not just leaf_index and merkle_root). When calling withdraw/generate_proof, send **merkle_root, path_elements, path_indices** from the saved commitment when present. The backend uses this stored proof to bypass `get_merkle_proof` (which cannot reliably reconstruct proofs for the incremental tree). Without sending the stored proof, withdraw can fail with "Commitment not found in merkle tree" or invalid proof.

## Deposit / withdraw semantics (Private Transfer and Shielded)

- **PrivateDeposit.circom**: commitment = Poseidon(amount, nonce); public outputs: commitment, amount_public. The backend must return the **circuit’s** commitment (first public output), not a formula; see groth16_prover (commitment from public.json).
- **PrivateWithdraw.circom**: Verifies commitment_public === Poseidon(balance, nonce). So the value passed as `balance` in the withdraw input must be the **same** value that was used to form the commitment at deposit. For a single full deposit that value is `amount`; for partial or multi-deposit flows the backend must pass the correct “balance” that matches the commitment.
- **Consistency**: Deposit returns **raw BN254** commitment (Poseidon output) so withdraw proof constraint holds; optional `commitment_felt` = commitment % STARK_PRIME for contract use. Withdraw must be called with the same (commitment, amount, nonce); withdraw circuit’s `balance` must match the amount used to form the commitment (e.g. original deposit amount).
- **Frontend requirements**: For **Private Transfer**, the frontend must use `commitment_felt` (not raw `commitment`) for contract calldata to `private_deposit` and `private_withdraw`, since the contract expects felt252. Store `nonce` from the deposit response and send it in the withdraw request so the same nonce is used in the withdraw circuit. For **Shielded Pool**, store `nonce` from the deposit response and send `balance` (and `nonce` when present) when calling `shielded_withdraw` so partial withdraws use the correct committed balance.

## zkML and rebalancer dependency on circuits/build

- **proof_pipeline** combines risk + anomaly proofs; **agent_rebalancer** uses session keys and proof_pipeline. Both depend on **circuits/build** (RiskScore_js, RiskScore_final.zkey, AnomalyDetector_js, etc.).
- Building **PrivateDeposit/PrivateWithdraw** in circuits/build does not break zkML; they live under the same `circuits/build` directory. A single build script can produce privacy circuits and (optionally) zkML circuits; see circuits/README.md and `build_private_circuits.sh`.

## Session keys and AI

- **Session keys** authorize the agent; the rebalancer combines session key + proof_pipeline (risk + anomaly). Ensuring circuits/build exists and RiskScore/Anomaly are built keeps rebalancing working; private_deposit/withdraw fix is independent of session keys.

## Milestones (from privacy proofs fix)

- **M1: Circuits build** — circuits/build has PrivateDeposit_js, PrivateWithdraw_js, both .zkey and both vk files → private_deposit/private_withdraw can run.
- **M2: Commitment from circuit** — Backend returns commitment from circuit public output → on-chain deposit and withdraw match verifier.
- **M3: Garaga calldata** — format_proof_for_garaga succeeds (Docker zkdefi-garaga:latest or local garaga) → proof_calldata accepted by Garaga verifier.
- **M4: E2E strict** — Private deposit/withdraw and format/simulation tests pass with real proofs (simulated=False).

See [ARCHITECTURE.md](ARCHITECTURE.md) and [circuits/README.md](../circuits/README.md) for build and Garaga formatter details.
