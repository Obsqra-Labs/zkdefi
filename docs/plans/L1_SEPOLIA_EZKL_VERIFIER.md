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

## 3. L1→L2 flow

1. Backend submits EZKL proof to L1 verifier on Sepolia.
2. On success, L1 sends message to Starknet bridge: (model_hash, output_commitment, verified=true, nonce).
3. Starknet receiver consumes message and updates proof record.

See `L1_EZKL_BRIDGE_SPEC.md` for message format.

## 4. References

- Plan: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md` Phase 3
- Roadmap: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path C
