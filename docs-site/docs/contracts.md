# Smart Contracts

## Deployed Contracts (Starknet Sepolia)

All zkde.fi smart contracts are deployed on **Starknet Sepolia** testnet.

### Core Contracts

#### ProofGatedYieldAgent
The main contract for proof-gated DeFi operations. Verifies proofs via Integrity and executes deposits/withdrawals only when valid.

- **Address:** `0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3)
- **Constructor:** `(fact_registry, token, admin)`

#### SelectiveDisclosure
Contract for registering selective disclosure proofs. Allows users to prove statements about their activity without revealing full transaction history.

- **Address:** `0x00ab6791e84e2d88bf2200c9e1c2fb1caed2eecf5f9ae2989acf1ed3d00a0c77`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x00ab6791e84e2d88bf2200c9e1c2fb1caed2eecf5f9ae2989acf1ed3d00a0c77)
- **Constructor:** `(fact_registry, admin)`

#### ConfidentialTransfer
Contract for private transfers using Garaga Groth16 verifier. Enables confidential transactions on Starknet.

- **Address:** `0x07fdc7c21ab074e7e1afe57edfcb818be183ab49f4bf31f9bf86dd052afefaa4`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x07fdc7c21ab074e7e1afe57edfcb818be183ab49f4bf31f9bf86dd052afefaa4)
- **Constructor:** `(garaga_verifier, token, admin)`

### zkDE Standard Contracts (GATE-1) -- Deployed

**zkDE | Zero-Knowledge Deterministic Engine.** You delegate (session keys, agents); execution is proof-gated and can be ZK. Strong Starknet fit (AA, session keys).

These contracts implement the [GATE-1](/aegis) standard for zkDE-compatible autonomous privacy-preserving agents.

#### ConstraintReceipt
On-chain receipts for auditable agent actions. Every action creates an immutable receipt.

- **Address:** `0x04c8756f9baf927aa6a85e9b725dd854215f82c65bd70076012f02fec8497954`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x04c8756f9baf927aa6a85e9b725dd854215f82c65bd70076012f02fec8497954)

#### SessionKeyManager
Manages delegated session keys for autonomous agent execution with constraints.

- **Address:** `0x01c0edf8ff269921d3840ccb954bbe6790bb21a2c09abcfe83ea14c682931d68`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x01c0edf8ff269921d3840ccb954bbe6790bb21a2c09abcfe83ea14c682931d68)

#### IntentCommitment
Manages replay-safe intent commitments for agent actions.

- **Address:** `0x062027ceceb088ac31aa14fe7e180994a025ccb446c2ed8394001e9275321f70`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x062027ceceb088ac31aa14fe7e180994a025ccb446c2ed8394001e9275321f70)

#### ComplianceProfile
Productized selective disclosure for regulatory compliance.

- **Address:** `0x05aa72977c1984b5c61aee55a185b9caed9e9e42b62f2891d71b4c4cc6b96d93`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x05aa72977c1984b5c61aee55a185b9caed9e9e42b62f2891d71b4c4cc6b96d93)

#### ZkmlVerifier
Verifies zkML proofs (risk score, anomaly detection) via Garaga (Groth16).

- **Address:** `0x037f17cd0e17f2b41d1b68335e0bc715a4c89d03c6118e5f4e98b5c7872c798d`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x037f17cd0e17f2b41d1b68335e0bc715a4c89d03c6118e5f4e98b5c7872c798d)

### Infrastructure Contracts

#### Garaga Groth16 Verifier
Cairo implementation of Groth16 verifier for BN254 curve. Verifies zk-SNARK proofs for confidential transfers and zkML.

- **Address:** `0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37`
- **Class Hash:** `0x04e7a5bbcefcb9e1d7fb2229375df104003f270bd09ec7c44aceb1bce3b39061`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37)

#### Integrity Fact Registry
Starknet's native proof verification registry (SHARP). Used by ProofGatedYieldAgent and SelectiveDisclosure.

- **Address:** `0x4ce7851f00b6c3289674841fd7a1b96b6fd41ed1edc248faccd672c26371b8c`
- **Note:** This is Starknet's system contract, not deployed by zkde.fi

#### ERC20 Test Token (STRK)
Native STRK token used for deposits and transfers on Sepolia testnet.

- **Address:** `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- **Explorer:** [View on Starkscan](https://sepolia.starkscan.co/contract/0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d)

## Contract Summary

| Contract | Address | Status |
|----------|---------|--------|
| ProofGatedYieldAgent | `0x012ebb...562b3` | Deployed |
| SelectiveDisclosure | `0x00ab67...0c77` | Deployed |
| ConfidentialTransfer | `0x07fdc7...faa4` | Deployed |
| GaragaVerifier | `0x06d0cb...d37` | Deployed |
| ConstraintReceipt | `0x04c875...d954` | Deployed |
| SessionKeyManager | `0x01c0ed...1d68` | Deployed |
| IntentCommitment | `0x06202...1f70` | Deployed |
| ComplianceProfile | `0x05aa72...6d93` | Deployed |
| ZkmlVerifier | `0x037f17...798d` | Deployed |

## Contract Interaction

### Using the Web App
The easiest way to interact with zkde.fi contracts is through the web app at [zkde.fi](https://zkde.fi).

### Direct Contract Calls
For advanced users, you can interact directly with the contracts using:

- **Starknet.js:** JavaScript library for Starknet
- **starkli:** CLI tool for contract interaction
- **sncast:** Foundry's CLI tool for Starknet

Example with starkli:
```bash
# Check constraint receipt count
starkli call \
  0x04c8756f9baf927aa6a85e9b725dd854215f82c65bd70076012f02fec8497954 \
  get_total_receipts \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/<YOUR_KEY>

# Check agent fact registry
starkli call \
  0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3 \
  get_fact_registry \
  --rpc https://starknet-sepolia.g.alchemy.com/v2/<YOUR_KEY>
```

## Contract Source Code

All contract source code is available in the [GitHub repository](https://github.com/obsqra-labs/zkdefi):

- **ProofGatedYieldAgent:** `contracts/src/proof_gated_yield_agent.cairo`
- **SelectiveDisclosure:** `contracts/src/selective_disclosure.cairo`
- **ConfidentialTransfer:** `contracts/src/confidential_transfer.cairo`
- **SessionKeyManager:** `contracts/src/session_key_manager.cairo`
- **IntentCommitment:** `contracts/src/intent_commitment.cairo`
- **ComplianceProfile:** `contracts/src/compliance_profile.cairo`
- **ZkmlVerifier:** `contracts/src/zkml_verifier.cairo`
- **ConstraintReceipt:** `contracts/src/constraint_receipt.cairo`

## Development

To build and deploy contracts locally:

```bash
# Install dependencies
scarb build

# Deploy to Sepolia
sncast --network sepolia deploy \
  --contract-name SessionKeyManager \
  --constructor-calldata <fact_registry> <admin>
```

See [SETUP.md](https://github.com/obsqra-labs/zkdefi/blob/main/docs/SETUP.md) for detailed deployment instructions.

## Testnet Information

- **Network:** Starknet Sepolia
- **Chain ID:** `0x534e5f5345504f4c4941` (SN_SEPOLIA)
- **RPC:** `https://starknet-sepolia.g.alchemy.com/v2/<YOUR_KEY>`
- **Faucet:** [Starknet Faucet](https://faucet.goerli.starknet.io/)

## Admin Address

- **Admin:** `0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d`

---

*Last updated: February 2, 2026*

*All 9 contracts deployed and verified on Starknet Sepolia testnet.*
