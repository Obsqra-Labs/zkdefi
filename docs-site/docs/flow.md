# How it works (user flow)

High-level flow — no API or implementation details.

## 1. Connect and set constraints

- Connect your Starknet wallet (e.g. ArgentX, Braavos) on [zkde.fi](https://zkde.fi).
- Set your constraints: e.g. max position size, allowed protocols (Pools, Ekubo, JediSwap). Optionally use session keys so the agent can act within these limits without signing every time.

## 2. Proof-gated deposit

- Open **Pools** (or another protocol tab).
- Enter amount and optional max position.
- Click **Deposit with proof**. The app requests a constraint proof from the backend (which calls the Obsqra prover). When the proof is ready, you see **Proof ready**.
- Click **Sign & deposit**. Your wallet signs the transaction that calls the ProofGatedYieldAgent contract with the proof. The contract checks the proof against Integrity; if valid, the deposit executes. You get a tx hash and a link to the explorer.

## 3. Selective disclosure (compliance)

- In the **Compliance / Disclosure** panel, set the statement type, threshold, and result you want to prove.
- Click **Generate disclosure proof**. When ready, click **Register on-chain**. Your wallet signs; the SelectiveDisclosure contract stores the proof. You’ve proved a statement without revealing your full history.

## 4. Private deposit (optional)

- Open the **Private** tab.
- Enter the amount. Click **Generate private deposit**. The app creates a commitment and proof calldata (Garaga).
- Click **Sign & submit**. Your wallet signs the ConfidentialTransfer.private_deposit transaction. Amounts and balances stay confidential; only commitments are visible on-chain.

Next: [Innovation](/innovation)
