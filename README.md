# zkde.fi

**Proof-gated DeFi execution on Starknet mainnet.**

Live at **[zkde.fi](https://zkde.fi)** · Built by [Obsqra Labs](https://obsqra.xyz)

---

## What is this?

zkde.fi is a proof-gated portfolio execution engine on Starknet. Every trade — swap or rebalance — passes through a constraint gate scored by ZKML models before it touches the chain. Execution receipts are bundled, stored on IPFS via Storacha, and anchored on-chain through a two-contract receipt system.

The platform runs on **Starknet mainnet** with real tokens, real Ekubo swaps, and real IPFS storage.

**Supported tokens:** ETH, STRK, USDC, WBTC

---

## How It Works

```
User wallet (Argent/Braavos)
        │
        ▼
┌─────────────────────────┐
│   Portfolio Dashboard    │  ← pick swap / rebalance / autopilot
│   (Next.js 14 + React)  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Execution Gate (API)  │  ← risk scoring, constraint checks
│   EZKL + OpenAI models  │     fee guard, slippage guard, etc.
│   Groth16 via Garaga    │
└───────────┬─────────────┘
            │
    ┌───────┴───────┐
    ▼               ▼
┌────────┐   ┌──────────┐
│ Ekubo  │   │  MIST    │  ← optional privacy wrap
│  Swap  │   │ Chamber  │     (deposit → ZK proof → withdraw → swap)
└───┬────┘   └────┬─────┘
    │             │
    └──────┬──────┘
           ▼
┌─────────────────────────┐
│  Receipt Vault           │
│  Storacha IPFS + on-chain│  ← gold tier: CID anchored on-chain
│  ReceiptArchive contract │     bronze tier: IPFS only
└──────────────────────────┘
```

### Three workflow modes

| Mode | How it works |
|------|-------------|
| **Manual** | You set every parameter. Gate scores the route. You sign. |
| **Assisted** | ZKML recommends the optimal trade. You review and approve. |
| **Automated** | Session key + policy. Agent executes within your constraints. |

---

## Mainnet Contracts

All contracts are deployed on **Starknet mainnet** (`SN_MAIN`).

| Contract | Address | Purpose |
|----------|---------|---------|
| **ReceiptRegistry** | [`0x048bfcab6cde939483a9a1f71ecadb1839bd4df9ae4d8fd3f4723fed0c8d4aac`](https://voyager.online/contract/0x048bfcab6cde939483a9a1f71ecadb1839bd4df9ae4d8fd3f4723fed0c8d4aac) | On-chain receipt storage |
| **ReceiptArchive** | [`0x0092494273b46b26d5c7684d41e2fc5c15a3b24a56507e410f1b8ee33c3dabda`](https://voyager.online/contract/0x0092494273b46b26d5c7684d41e2fc5c15a3b24a56507e410f1b8ee33c3dabda) | CID anchoring (Poseidon hash of IPFS CID) |
| **MIST Chamber** | [`0x06f8dcc500131b6be6b33f4534ec6d33df33e61083ec2b051555d52e75654444`](https://voyager.online/contract/0x06f8dcc500131b6be6b33f4534ec6d33df33e61083ec2b051555d52e75654444) | Privacy deposits/withdrawals via ZK proof (MIST.cash) |

### Protocol integrations (mainnet)

| Protocol | Address |
|----------|---------|
| Ekubo Core | `0x0280d63e837e70ebdee7f7f2b314c6f24b4bbe6dd59dbfcc5038d07cdbe2e0f2` |
| StarkGate ETH Bridge | `0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82` |

---

## IPFS Integration

Every execution produces a **portable receipt bundle** — a JSON document containing the gate results, proof hashes, and execution metadata. These are stored via [Storacha](https://storacha.network) (w3up):

1. Backend serializes the receipt bundle with `canonicalize_bundle_json()`
2. Uploads via `@storacha/client` SDK → returns a CID
3. **Gold tier** (high-value actions): Poseidon hash of the CID is anchored on-chain via `ReceiptArchive.anchor_cid()`
4. **Bronze tier** (standard actions): IPFS-only, no gas cost

Receipt bundles are viewable at `https://<cid>.ipfs.storacha.link/receipt-bundle.json`.

The frontend Receipt Vault page shows IPFS links, Voyager transaction links, and verification status for each receipt.

---

## Proof Systems

**Try the full ZKML proof pipeline in production:** [zkde.fi/test](https://zkde.fi/test)

| System | What it proves | Where |
|--------|---------------|-------|
| **EZKL** | ML model inference (credit scoring, anomaly detection, yield forecast) | Backend → Groth16 proof |
| **Garaga** | On-chain Groth16 verification | Starknet contracts |
| **MIST.cash** | Private deposit/withdrawal (Poseidon hashing, Merkle trees, Groth16) | Client-side WASM |
| **Execution Gate** | Constraint satisfaction (fee efficiency, slippage, portfolio limits) | Backend scoring |

### On-chain verification contracts (Sepolia testnet)

| Contract | Address |
|----------|---------|
| ZkmlVerifier | `0x068abd64a4a78172a5ee15a30bbe614257d62482f07d3ff7fdb72da5aad08923` |
| GaragaVerifier | `0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37` |
| ObsqraFactRegistry | `0x02009ab87f581a0a92f65906ce84664a5cfcb86f7266651f48a04fac3c62faa3` |
| Halo2Verifier (Ethereum Sepolia) | `0xF7b555ca4E54a8c7B9A0DDBFa17341575a852Ab9` |

---

## Privacy

When private mode is enabled, swaps are routed through the **MIST.cash Chamber**:

1. Deposit input tokens into the Chamber (approve + deposit, one wallet signature)
2. Wait for Merkle tree update (~12s)
3. Generate a Groth16 ZK proof client-side (Poseidon hashing via Go-compiled WASM)
4. Withdraw from Chamber + execute swap in a single multicall

This breaks the on-chain link between source funds and the swap transaction.

**Privacy-supported tokens:** ETH, STRK, USDC. WBTC is supported for swaps and rebalancing but does not yet support MIST.cash privacy wrapping.

---

## Repository Structure

```
zkdefi/
├── frontend/          Next.js 14 app (zkde.fi)
├── backend/           FastAPI (Python 3.12) — execution gate, receipt vault, proofs
├── contracts/         Cairo smart contracts
├── circuits/          Noir circuits, EZKL model artifacts
├── receiptos/         Receipt infrastructure (Storacha upload, attester, passport)
├── scripts/           Deploy and utility scripts
├── docs/              Architecture and specs
├── credit-scoring/    EZKL credit scoring model
├── monitoring/        Prometheus + Grafana dashboards
├── tests/             Integration tests
└── market-maker-sim/  Ekubo market simulation
```

---

## Running Locally

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # configure RPC, Storacha keys, etc.
uvicorn app.main:app --port 8003

# Frontend
cd frontend
npm install
cp .env.example .env.local    # configure API URL, contract addresses
npm run dev                   # http://localhost:3001
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, Tailwind CSS, starknet-react |
| Backend | FastAPI, Python 3.12 |
| Proofs | EZKL (zkML), Garaga (Groth16), MIST.cash SDK (Poseidon/Groth16 WASM) |
| Contracts | Cairo (Scarb), Starknet mainnet |
| Storage | Storacha (IPFS), on-chain CID anchoring |
| DEX | Ekubo (mainnet), AVNU aggregator |

---

## License

Apache-2.0 — see [LICENSE](LICENSE).
