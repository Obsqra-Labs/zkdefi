# L1 Ethereum Sepolia — EZKL Solidity Verifier

Phase 3 (Path C): verify EZKL (KZG) proofs on **Ethereum Sepolia**, then bridge result to Starknet via L1→L2.

## 0. Getting Sepolia ETH (testnet)

You need Sepolia ETH to deploy the EZKL verifier and to send verification transactions. Faucets (use any that work for you):

| Faucet | Notes |
|--------|--------|
| [Alchemy Sepolia Faucet](https://sepoliafaucet.com/) | ~0.1 ETH/day; may require a little mainnet ETH and tx history |
| [QuickNode Sepolia](https://faucet.quicknode.com/ethereum/sepolia) | Drip every 12h; may require X/Twitter |
| [Tatum Sepolia](https://tatum.io/faucets/sepolia) | ~0.002 ETH/24h; Tatum signup |
| [faucet.free](https://faucet.free/) | Up to ~0.65 ETH/24h; 0xNAME addresses |

**What the ETH is for:** Deploying the EZKL Solidity verifier to Sepolia; paying gas for each `verify(...)` call when the backend submits proofs. Once you have a deployer address funded, set `L1_SEPOLIA_RPC` and deploy; then set `L1_EZKL_VERIFIER_ADDRESS` and (when the bridge is implemented) `L1_BRIDGE_RECEIVER_ADDRESS`.

## 1. EZKL Solidity verifier

EZKL can export a Solidity verifier (BN254 KZG). EVM precompiles for pairing (~130k gas).

- Generate: use EZKL CLI/toolchain to export verifier (e.g. `ezkl export_verifier -k model.vk -o EZKLVerifier.sol`).
- Compile with Foundry or Hardhat to get an artifact JSON (bytecode + abi).
- Deploy to **Ethereum Sepolia** using the keystore (see §1.1 and §1.2 below). Record contract address and set `L1_EZKL_VERIFIER_ADDRESS`.

### 1.1 Create L1 keystore from mnemonic (one-time)

From repo root, with the throw-away mnemonic and a password set in env (do not commit):

```bash
L1_SEPOLIA_MNEMONIC="word1 word2 ..." L1_SEPOLIA_KEYSTORE_PASSWORD=your_secret python scripts/l1_sepolia_keystore_from_mnemonic.py
```

This writes `backend/.l1-sepolia-keystore.json` (gitignored). The script prints the deployer address; fund it with Sepolia ETH from a faucet.

### 1.2 Deploy EZKL verifier using the keystore

Set `L1_SEPOLIA_RPC` and `L1_SEPOLIA_KEYSTORE_PASSWORD`, then run:

```bash
L1_SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com L1_SEPOLIA_KEYSTORE_PASSWORD=your_secret python scripts/deploy_ezkl_verifier_l1_sepolia.py --artifact path/to/EZKLVerifier.json
```

Optional: `--constructor-args '[]'` (default), `--keystore path/to/keystore.json` (default: `backend/.l1-sepolia-keystore.json`). The script prints the deployed contract address; set `L1_EZKL_VERIFIER_ADDRESS` in backend env to that value.

### 1.3 One-shot script (keystore + generate + compile + deploy)

From repo root, with `L1_SEPOLIA_MNEMONIC`, `L1_SEPOLIA_KEYSTORE_PASSWORD`, and `L1_SEPOLIA_RPC` set:

```bash
python3 scripts/l1_sepolia_ezkl_verifier_one_shot.py
```

This creates the keystore (if missing), generates `contracts/l1_ezkl/EZKLVerifier.sol` from the creditworthiness EZKL model, runs `forge build` in `contracts/l1_ezkl`. If compilation fails with "stack too deep" (common with EZKL Halo2 verifiers), compile manually (e.g. Remix with optimizer + via-ir) or use a smaller EZKL model; place bytecode+abi at `contracts/l1_ezkl/EZKLVerifier_artifact.json` and re-run the script to deploy, or run `deploy_ezkl_verifier_l1_sepolia.py --artifact contracts/l1_ezkl/EZKLVerifier_artifact.json` after compiling.

## 2. Environment variables (parent backend)

| Variable | Description |
|----------|-------------|
| `L1_SEPOLIA_RPC` | Ethereum Sepolia RPC URL |
| `L1_EZKL_VERIFIER_ADDRESS` | EZKL Solidity verifier on Sepolia |
| `L1_BRIDGE_RECEIVER_ADDRESS` | Starknet contract that receives L1→L2 messages |
| `L1_SEPOLIA_MNEMONIC` | (Optional) BIP39 mnemonic for the Sepolia deployer/signer. **Never commit.** Use only for a testnet throw-away account. |
| `L1_SEPOLIA_KEYSTORE_PASSWORD` | Password for the L1 keystore (deploy script and future l1_ezkl_bridge_service). **Never commit.** |

Unset = L1 bridge flow disabled. Keep `L1_SEPOLIA_MNEMONIC` and `L1_SEPOLIA_KEYSTORE_PASSWORD` only in local `.env` (gitignored); do not add to `.env.example`.

**Reference transaction (Sepolia):** `0xaf32c1bec546520d9d55d6199666f617c0bfaec72915fc88163157e1b7338e59` — [view on Sepolia Etherscan](https://sepolia.etherscan.io/tx/0xaf32c1bec546520d9d55d6199666f617c0bfaec72915fc88163157e1b7338e59)

**Current keystore deployer (testnet):** `0x286573Ccf1Ca01D97a41Dc16Fed01c8e0a0b2337` — fund this address with Sepolia ETH if needed; use with `L1_SEPOLIA_KEYSTORE_PASSWORD` for deploy and L1 verify.

**Deployed EZKL verifier (Sepolia):** `0xF7b555ca4E54a8c7B9A0DDBFa17341575a852Ab9` — [view on Sepolia Etherscan](https://sepolia.etherscan.io/address/0xF7b555ca4E54a8c7B9A0DDBFa17341575a852Ab9). Set `L1_EZKL_VERIFIER_ADDRESS` to this in backend env.

### 2.5 Stack-limit workaround (one-shot build gate)

Large generated Halo2/EZKL verifiers can fail with:
- `Yul exception ... too deep in the stack`

Use the one-shot helper in this repo:

```bash
bash contracts/l1_ezkl/build_halo2_verifier.sh
```

What it does:
1. Tries normal `forge build` in `contracts/l1_ezkl`.
2. If that fails, retries with `FOUNDRY_VIA_IR=false` and `solc 0.8.24`.
3. Verifies `contracts/l1_ezkl/out/EZKLVerifier.sol/Halo2Verifier.json` exists.

Deploy rule:
- Run L1 deploy only when the artifact exists.
- If artifact still cannot be produced in this environment, compile elsewhere (or use a smaller model verifier), then copy the artifact back before deploy.

## 3. Next steps (Phase 3 after verifier is deployed)

With `L1_EZKL_VERIFIER_ADDRESS` and `L1_SEPOLIA_RPC` set in the **parent backend**:

1. **Wire L1 submit (Task 3.3)** — In parent repo: implement `l1_ezkl_bridge_service.submit_ezkl_proof_to_l1(proof_hex, public_inputs)` to load the L1 keystore (or use `L1_SEPOLIA_MNEMONIC`/private key), build calldata for the verifier’s `verifyProof(proof, instances)`, and send a transaction via web3 to the Sepolia verifier. Return L1 tx hash. Optional API: `POST /api/v1/aggregation/l1/verify` with proof payload; return tx hash and status.
   - **Status (March 11, 2026): done in parent backend.** `submit_ezkl_proof_to_l1` now signs/sends `verifyProof` txs (private key or keystore), supports `proof_hex` and legacy calldata packing, and returns tx hash.

2. **L1→L2 receiver (Task 3.2)** — Implement Starknet contract that receives L1→L2 messages (core messaging), validates sender, and stores/emits (model_hash, output_commitment, verified=true, nonce). Deploy on Starknet Sepolia; set `L1_BRIDGE_RECEIVER_ADDRESS`. Option A: extend EZKL verifier or add an L1 contract that, after verify, sends the bridge message. See `L1_EZKL_BRIDGE_SPEC.md`.

3. **Poll L2 (Task 3.4)** — In `l1_ezkl_bridge_service`: add `poll_l2_for_verification(model_hash, nonce)` that queries the Starknet receiver contract (or indexer) and returns verified=true when the message is consumed. Expose via API (e.g. `GET /aggregation/l1/verification-status?model_hash=&nonce=`).

4. **Docs and optional ProofMode (Task 3.5)** — Update implementation plan and `RECURSIVE_EZKL_ROADMAP.md` Path C status; optionally add ProofMode `L1_BRIDGE` and route certification/audit flows to L1 verify.

## 4. L1→L2 flow

1. Backend submits EZKL proof to L1 verifier on Sepolia.
2. On success, L1 sends message to Starknet bridge: (model_hash, output_commitment, verified=true, nonce).
3. Starknet receiver consumes message and updates proof record.

See `L1_EZKL_BRIDGE_SPEC.md` for message format.

## 5. References

- Plan: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md` Phase 3
- Roadmap: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path C
