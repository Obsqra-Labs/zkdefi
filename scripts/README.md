# Scripts

Operational and deployment scripts for zkde.fi.

---

## Index

| Script | Purpose |
|--------|---------|
| **hackathon_backend_showcase.py** | Terminal-first demo runner for hackathon judging: validates proofs, agent execution, privacy commitment flow, policy controls, receipts, on-chain/RPC checks, AI advisory + badge screening flow, and writes a local HTML/JSON report with Voyager links. |
| **register_verifiers.sh** | Register reputation verifiers (Solvency, RiskPassport, TraderPerformance, StrategyIntegrity, ExecutionIntegrity) with ObsqraFactRegistry. Uses `.env.verifiers`. |
| **deploy_reputation_verifiers.sh** | Deploy Garaga verifiers to Starknet (if present). |
| **test_dao_proposal.sh** | End-to-end test: create DAO proposal, cast vote (`POST /api/v1/dao/vote/cast`). |
| **test_emergency_controls.sh** | Test emergency pause/unpause DAO; requires RPC and keystore. |
| **smoke_test_reputation_proofs.sh** | Smoke test all 5 reputation proof endpoints. Usage: `./scripts/smoke_test_reputation_proofs.sh [BASE_URL]` (default `http://127.0.0.1:8003`). Uses `test_data/*_test.json`. |
| **import_grafana_dashboard.sh** | Import the reputation Grafana dashboard via API. Set `GRAFANA_URL` and `GRAFANA_API_KEY` (or `GRAFANA_USER`/`GRAFANA_PASSWORD`). |
| **rewrite_history_single_commit.sh** | (Maintainer) Rewrite repo to a single commit; used for history squash. |

Run from repo root. Ensure backend is up for smoke tests; for deploy/register scripts, Starknet RPC and keystore must be configured.

### Hackathon showcase quick start

```bash
python3 scripts/hackathon_backend_showcase.py
```

Optional flags:

- `--base-url http://127.0.0.1:8003`
- `--wallet 0x...`
- `--skip-onchain` (useful if RPC is flaky/offline)
- `--judge-mode` (compact terminal output for live judging)
- `--strict-bridge` (requires strict `200` ModelBridge + dual-lane evidence; no transient pass)
- `--artifact-dir artifacts/hackathon_showcase`

### Hackathon showcase artifacts

Each run writes timestamped and latest report files:

- `artifacts/hackathon_showcase/showcase-YYYYMMDD-HHMMSS.html`
- `artifacts/hackathon_showcase/showcase-YYYYMMDD-HHMMSS.json`
- `artifacts/hackathon_showcase/latest.html`
- `artifacts/hackathon_showcase/latest.json`

The HTML report includes:

- Tabbed + subtabbed readout for judges (`Overview`, `ModelBridge`, `AI + Badges`, `Privacy + Voting`, `Infra + On-chain`) with wrapped tables for long hashes/errors
- Core claim matrix and step-by-step terminal evidence
- Dedicated **ModelBridge + ModelBridgeHeavy live L3 receipt** sections: proof hash, calldata size, lane mode, tx link (if emitted), and retry timeline
- Dedicated **StarkHeavyReputation (Stone -> L3)** section: heavy STARK proof hash/fact hash, L3 mode, and tx/error evidence
- Open-source ModelBridge deep dive: bridge artifacts, STARK/SNARK proving lanes, uniqueness unlock matrix, and ecosystem comparison
- Recursive EZKL path status panel (Phase 2/3/4): Path A Noir HONK completion signals, Path C L1 bridge sender/receiver wiring (`verifyAndBridge` + poll), Path B native KZG routing signals, plus env readiness and next actions
- Voyager links for deployed contracts/classes and receipt tx hashes (when present)
- Deep circuit inventory (`31` first-party Circom circuits) with artifact readiness
- AI + marketplace snapshot: opportunities, advisory calls, strategy badge screening
- AI circuit-skills evidence: per-opportunity zkML skill passes/fails, recommendation rationale, and proof receipt trail ("I used skill X" -> receipt endpoint)
- Privacy rails demo: shielded/nullifier/hash/relayer withdraw + Madara L3 settlement probes
- Private governance/lending backend probes (proposal/vote path + lending policy/call-data flows)
- Private prediction market primitive (forecaster): commit/reveal, scoring receipt, explainability snapshot
- Generated LLM + circuit-skill config packs (conservative/balanced/aggressive)
