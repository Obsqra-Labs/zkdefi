# Contracts (Cairo)

Starknet contracts for zkde.fi: proof-gated execution, fact registry, verifiers, vaults, DAO.

---

## Index (main components)

| Component | Role |
|-----------|------|
| **ProofGatedYieldAgent** | Proof-gated execution; no proof, no execution. |
| **ObsqraFactRegistry** | Registers and checks proof facts (used by reputation verifiers). |
| **ReceiptRegistry** | Audit trail for proof receipts. |
| **DAOConstraintManager** | DAO governance and constraints. |
| **VaultController** | Vault operations. |
| **Reputation verifiers** | Solvency, RiskPassport, TraderPerformance, StrategyIntegrity, ExecutionIntegrity (Cairo wrappers of Garaga verifiers; see [circuits/](../circuits/README.md)). |

---

## Layout

```text
contracts/
├── src/           # Cairo sources (Scarb project)
├── target/        # Build output (gitignored)
└── Scarb.toml     # Scarb config
```

---

## Build & deploy

- **Build:** `scarb build` (from `contracts/`).
- **Test:** `scarb test`.
- Verifier deployment and registration: see [../scripts/README.md](../scripts/README.md) (`register_verifiers.sh`, `deploy_reputation_verifiers.sh` if present).

Contract addresses (Sepolia) are in repo docs and `.env.verifiers`; see [../docs/README.md](../docs/README.md).
