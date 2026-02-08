# zkde.fi by Obsqra Labs – Hackathon Submission Checklist

Manual steps to finish before DoraHacks: record demo video and submit using the details below.

## Demo flow (steps to reproduce for judges)

1. **Connect wallet** — Starknet Sepolia (e.g. ArgentX / Braavos).
2. **Proof-gated deposit (hero):** Open **Pools** → Set amount and optional max position → Click **Deposit with proof** → Wait for "Proof ready" → Click **Sign & deposit** → Confirm in wallet → Success; tx hash links to Starkscan.
3. **Selective disclosure:** In the right panel **Compliance / Disclosure** → Set statement type, threshold, result → **Generate disclosure proof** → Click **Register on-chain** → Confirm in wallet → Success; tx hash links to Starkscan.
4. **Private tab (optional):** Open **Private** → Set amount → **Generate private deposit** → **Sign & submit** (confidential flow; Garaga on Sepolia; mainnet path is MIST.cash).

Ensure backend is running (`NEXT_PUBLIC_API_URL`), and frontend env has `NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS` and `NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS` for one-click Sign & deposit and Register on-chain.

## Demo video (Phase 6)

- [ ] Record 3-minute demo video (use script below)
- [ ] Show Pools full flow (connect → set constraints → deposit with proof → Sign & deposit → success)
- [ ] Show selective disclosure (generate proof → register on-chain → success)
- [ ] Optionally: Private tab (Garaga on Sepolia; mainnet MIST.cash)

### Video script / talking points (~3 min)

**1. Set the scene (30–45 s)**  
DeFi today forces full transparency or opaque custody. We want privacy-preserving execution and the ability to prove compliance without revealing everything. zkde.fi does that on Starknet with proof-gated execution and selective disclosure.

**2. Demo (1.5–2 min)**  
- Connect wallet (Starknet Sepolia).  
- **Delegate to agent:** Set constraints (max position, allowed protocols) → **Grant session key** → wallet signature (one-time). Agent now authorized.  
- **Agent operates:** Open **Pools** → agent allocates across protocols (Jedi/Ekubo/Pools) → **Deposit with proof** → show "Proof ready" then **Sign & deposit** → success and tx hash (Starkscan). Agent's intent was hidden; execution is verified.  
- **Compliance** panel → "Prove agent followed constraints" → generate disclosure proof → **Register on-chain** → success. Proved compliance without revealing agent strategy.  
- Optionally: **Private** tab → agent holds confidential positions (commitment-based, Garaga on Sepolia; MIST on mainnet).

**3. Wrap (30 s)**  
This is a privacy-preserving autonomous agent: session keys for delegation, proof-gating for verification, confidential positions, selective disclosure for compliance. Built on Starknet's native AA; uses Integrity for proof verification. zkde.fi by Obsqra Labs — autonomous agents with privacy.

## DoraHacks submission

- [ ] Project name: **zkde.fi by Obsqra Labs**
- [ ] Demo URL: https://zkde.fi
- [ ] Repo: https://github.com/obsqra-labs/zkdefi (open source)
- [ ] Track: **Privacy**
- [ ] Branding: zkde.fi by Obsqra Labs — live at zkde.fi, open source

## Pre-submission checks

- [ ] Contracts deployed and verified on Starknet Sepolia
- [ ] Backend runs on port 8003, frontend on 3001
- [ ] Reverse proxy: serve app at zkde.fi; proxy `/api/v1/zkdefi` to backend (see [SETUP.md](SETUP.md))
- [ ] `.env` set with `OBSQRA_PROVER_API_URL`, `OBSQRA_API_KEY`, contract addresses
