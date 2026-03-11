# Circuits

Garaga (Circom/BN254) circuits and generated verifiers used by zkde.fi for reputation proofs and full-privacy flows.

---

## Index

| Artifact | Purpose |
|----------|---------|
| **SolvencyProofVerifier** | Verifies solvency proof (assets ≥ liabilities). |
| **RiskPassportTierVerifier** | Verifies risk tier proof. |
| **TraderPerformanceProofVerifier** | Verifies trader performance proof. |
| **StrategyIntegrityVerifier** | Verifies strategy constraint proof. |
| **ExecutionIntegrityVerifier** | Verifies execution integrity proof. |
| **ModelBridge / ModelBridgeHeavy** | Bridges zkML outputs into Groth16-verified policy gates (8-output + 16-output lanes). |
| **full_privacy_*** / private_*** | Deposit/withdraw proofs for full-privacy pool. |

Verifier packages live under `build/` (e.g. `build/SolvencyProofVerifier/`) with Cairo output for Starknet deployment. VKeys: `*_vkey.json` in `build/`.

---

## Layout

```text
circuits/
├── build/                    # Built verifiers and vkeys
│   ├── SolvencyProofVerifier/
│   ├── RiskPassportTierVerifier/
│   ├── TraderPerformanceProofVerifier/
│   ├── StrategyIntegrityVerifier/
│   ├── ExecutionIntegrityVerifier/
│   ├── *_vkey.json
│   └── full_privacy_* / private_*
├── contracts/                # Circom source (and Scarb if present)
├── examples/
└── ...
```

---

## Backend integration

The backend builds circuit inputs and runs proofs via `backend/app/services/zkml/circuit_scanner.py` (Garaga). Reputation proof endpoints (`POST /api/v1/zkdefi/reputation/proof/*`) use the five verifiers above; verifier addresses are in `.env.verifiers` and registered with ObsqraFactRegistry (see [scripts/](../scripts/README.md)).

---

## Build (high level)

- Circom circuits are compiled to Groth16 verifiers; output is used to generate Cairo verifier contracts (e.g. Garaga tooling).
- Scarb/Cairo toolchain may live under `contracts/` or a dedicated path; see repo docs or `circuits/contracts` for Scarb config.
- Native KZG lane (Path B): build Cairo verifier package with `bash circuits/generate_ezkl_kzg_verifier.sh` (artifacts under `circuits/contracts/src/ezkl_kzg_verifier/target/dev`).
- ModelBridgeHeavy lane: `bash circuits/build_model_bridge_heavy.sh` then `bash circuits/generate_model_bridge_heavy_verifier.sh` (artifacts under `circuits/contracts/src/garaga_verifier_model_bridge_heavy/target/dev`).
