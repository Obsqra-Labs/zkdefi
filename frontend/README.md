# Frontend (zkde.fi)

Next.js app for the full zkde.fi product surface: private vault, pools, ledger, swaps, lending, LP, staking, risk passport, governance, and agent dashboard. Runs on port 3001 by default.

---

## Run

```bash
cd frontend
npm install
# .env.local: NEXT_PUBLIC_API_URL=http://localhost:8003, NEXT_PUBLIC_RPC_URL=…
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

---

## App structure (index)

| Route | Purpose |
|-------|---------|
| `/` | Landing |
| `/products` | **Product surface map** — all products with status (BUILT / READY / ADAPTER) and deep links |
| `/products/private-vault` | Shielded vault, policy-gated capital |
| `/products/privacy-pools` | Tiered commitment/nullifier pools |
| `/products/dark-ledger` | Private internal settlement |
| `/products/private-swaps` | Swaps with private intent and constraints |
| `/products/private-lending` | Supply/borrow, proof-backed eligibility |
| `/products/private-lp-yield` | LP and yield with privacy and risk checks |
| `/products/private-staking` | Staking integrated with vault privacy |
| `/products/risk-passport` | Portable trust and risk attestations |
| `/products/private-governance` | Private voting and proposals (ZK) |
| `/products/adapters` | Composable adapter layer |
| `/products/portable-risk-profile` | Portable risk profile product |
| `/agent` | **Launch app** — dashboard, vault execution, rebalancer, agent controls |
| `/profile` | Profile, **Credit & Reputation Hub** (tiers, FICO pack proofs) |
| `/governance` | DAO proposals and voting |
| `/proofs` | Proofs surface |
| `/mvp` | Risk → recommend → deploy flow |
| `/docs`, `/docs/developers` | Docs and developer content |

---

## Directory layout

```text
src/
├── app/                    # App router pages
│   ├── page.tsx            # Landing
│   ├── agent/              # Dashboard (vault, rebalancer, agent)
│   ├── profile/            # Profile + Reputation tab
│   ├── mvp/                # MVP flow
│   ├── governance/         # DAO
│   ├── products/           # Product pages (private-vault, privacy-pools, dark-ledger, …)
│   └── ...
├── components/
│   ├── marketing/          # SiteHeader, ProductPageFrame, product nav
│   └── zkdefi/             # Shared UI
│       ├── credit/         # CreditReputationHub, FicoPackProofPanel, TierCard, …
│       ├── vault/          # VaultSurface, …
│       ├── surfaces/       # BrainSurfaceContainer, …
│       └── ...
└── lib/                    # API client, utils
```

---

## Credit & Reputation Hub (technical notes)

- **Profile → Reputation** tab uses `CreditReputationHub`, which composes:
  - `CreditOverviewPanel`, `TierCard`, `FicoPackProofPanel` (FICO pack: solvency, risk-passport, performance, strategy-integrity, execution-integrity)
  - `ProofGenomeCard` per proof type; “Edit inputs” opens JSON modal; “Generate Proof” calls `POST /api/v1/zkdefi/reputation/proof/{type}`.
- Proof status from `GET /api/v1/zkdefi/reputation/proofs/{address}`; tier upgrade via `POST …/reputation/upgrade-tier`.
- API base from `@/lib/api/client` (`NEXT_PUBLIC_API_URL`).
