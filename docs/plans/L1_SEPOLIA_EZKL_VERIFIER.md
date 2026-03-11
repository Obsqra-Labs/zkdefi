# L1 Ethereum Sepolia — EZKL Solidity Verifier

Phase 3 (Path C): verify EZKL (KZG) proofs on **Ethereum Sepolia**, then bridge result to Starknet via L1→L2.

## 1. EZKL Solidity verifier

EZKL can export a Solidity verifier (BN254 KZG). EVM precompiles for pairing (~130k gas).

- Generate: use EZKL CLI/toolchain to export verifier (e.g. `ezkl export_verifier -k model.vk -o EZKLVerifier.sol`).
- Deploy to **Ethereum Sepolia** via Foundry/Hardhat/Remix. Record contract address.

## 2. Environment variables (parent backend)

| Variable | Description |
|----------|-------------|
| `L1_SEPOLIA_RPC` | Ethereum Sepolia RPC URL |
| `L1_EZKL_VERIFIER_ADDRESS` | EZKL Solidity verifier on Sepolia |
| `L1_BRIDGE_RECEIVER_ADDRESS` | Starknet contract that receives L1→L2 messages |

Unset = L1 bridge flow disabled.

## 3. L1→L2 flow

1. Backend submits EZKL proof to L1 verifier on Sepolia.
2. On success, L1 sends message to Starknet bridge: (model_hash, output_commitment, verified=true, nonce).
3. Starknet receiver consumes message and updates proof record.

See `L1_EZKL_BRIDGE_SPEC.md` for message format.

## 4. References

- Plan: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md` Phase 3
- Roadmap: `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` Path C
