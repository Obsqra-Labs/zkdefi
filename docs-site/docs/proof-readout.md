# Live Proof Readout

This page exists for one purpose: get you to **[zkde.fi/test](https://zkde.fi/test)** with enough context to understand what you're looking at.

Every technical claim in these docs — every contract address, every proof lane, every privacy primitive — is verifiable at that endpoint.

## What zkde.fi/test Shows

The test endpoint runs a full backend showcase that exercises the entire proof pipeline and reports pass/fail status for each claim. It validates **14 independent claims** across:

### ModelBridge Dual-Lane Proving
- EZKL model inference → Groth16 proof generation
- ModelBridge circuit verification via Garaga on Starknet Sepolia
- ModelBridgeHeavy lane with heavier artifact payloads
- STARK integrity lane via Stone prover
- Noir HONK bridge lane
- Native KZG strict lane with bundle injection

### AI Advisory Flow
- zkML risk scoring and anomaly detection
- 13-circuit screening bundle execution
- Pool safety analysis with proof receipts
- Agent skill registration and performance tracking

### Privacy and Settlement
- Full privacy pool commitment and withdrawal proof generation
- Nullifier and Merkle proof verification
- Privacy tier enforcement (strict / standard / express)
- Madara L3 fact registration

### On-Chain Verification
- Contract state reads from deployed verifiers
- Receipt registry lookups
- Reputation tier and FICO-pack proof status

## Live Transaction Evidence

These are real verified transactions on Starknet Sepolia. Click through to Voyager to inspect the proof data independently.

| Lane | Verifier | Tx Hash |
|---|---|---|
| ModelBridge (Groth16/Garaga) | `groth16_garaga` | [0x2c8ea...679b](https://sepolia.voyager.online/tx/0x2c8ea7551f965f4c73292cd3d00745d088b5572c7154bf6b3746c9f66a0679b) |
| ModelBridgeHeavy (Groth16/Garaga) | `groth16_garaga` | [0x49226...b59c](https://sepolia.voyager.online/tx/0x49226ffb495953f1a981020ebb61e8ac462410b750ac672dd21d3f0a8f5b59c) |
| Heavy STARK Reputation | `stark_integrity` | [0x7249f...739d](https://sepolia.voyager.online/tx/0x7249f4a0dc41f12dd5249f4e7284c0f4d392ec69740396d1de4e0f83126739d) |
| Noir HONK Bridge | `noir_honk` | [0x55f1d...3475](https://sepolia.voyager.online/tx/0x55f1d6cf06ed5e2deaf90c86479c2f03b27ed631478447d14af808f33963475) |
| Native KZG Strict | `native_kzg` | [0x5c9e2...5f42](https://sepolia.voyager.online/tx/0x5c9e21abd2119600421872f0baad9988ea7082eec54bacea8657649a8cf5f42) |

## Core Verification Contracts

| Contract | Network | Address |
|---|---|---|
| ModelBridge Verifier | Starknet Sepolia | [0x037c4...626f](https://sepolia.voyager.online/contract/0x037c42e8734271aca0c3c1bdf1746d9ccc098ddfd5ee211c94bbb8786fa4626f) |
| ZkmlVerifier (ModelBridge-capable) | Starknet Sepolia | [0x068ab...8923](https://sepolia.voyager.online/contract/0x068abd64a4a78172a5ee15a30bbe614257d62482f07d3ff7fdb72da5aad08923) |
| GaragaVerifier (BN254) | Starknet Sepolia | [0x06d0c...6d37](https://sepolia.voyager.online/contract/0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37) |
| Halo2Verifier (EZKL KZG) | Ethereum Sepolia | [0xF7b55...2Ab9](https://sepolia.etherscan.io/address/0xF7b555ca4E54a8c7B9A0DDBFa17341575a852Ab9) |
| ObsqraFactRegistry | Starknet Sepolia | [0x02009...faa3](https://sepolia.voyager.online/contract/0x02009ab87f581a0a92f65906ce84664a5cfcb86f7266651f48a04fac3c62faa3) |

## How To Read The Report

The report at [zkde.fi/test](https://zkde.fi/test) shows:

1. **Claim name** — what is being tested (e.g., "ModelBridge dual-lane proof with on-chain verification")
2. **Status** — PASS or FAIL, with timing data
3. **Evidence** — transaction hashes, contract addresses, API response excerpts, proof artifacts
4. **Chain** — which network the verification happened on

A fully passing report (14/14) means the entire proof pipeline — from EZKL inference through Garaga verification through Madara settlement — is operational at the time of the run.

## Programmatic Access

The same data is available as JSON:

```
GET https://zkde.fi/test?format=json
```

Or run the showcase script directly:

```bash
python3 scripts/hackathon_backend_showcase.py \
  --base-url http://127.0.0.1:8003 \
  --emit-report --emit-report-force --judge-mode
```

This generates `artifacts/hackathon_showcase/latest.html` and `latest.json`.

---

**Every claim in this submission and these docs is verifiable at [zkde.fi/test](https://zkde.fi/test).**

Next: [The Primitive](/intro) | [Proof Pipeline](/proof-pipeline) | [Deployed Contracts](/contracts)
