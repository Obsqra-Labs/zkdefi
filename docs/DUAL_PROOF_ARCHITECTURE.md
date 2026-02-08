# Dual-Proof Architecture (zkde.fi)

**Status:** Fully operational on Starknet Sepolia. ObsqraFactRegistry provides on-chain persistence for STARK facts.

Full spec: **Obsqra parent repo** — `docs/DUAL_PROOF_ARCHITECTURE.md` (when zkdefi is under obsqra.starknet: `../../docs/DUAL_PROOF_ARCHITECTURE.md`).

---

## What zkde.fi contracts need

**Point `fact_registry` storage at ObsqraFactRegistry:**

| Contract / usage | Address (Starknet Sepolia) |
|------------------|----------------------------|
| **ObsqraFactRegistry** | `0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8` |

- **ProofGatedYieldAgent** — constructor `fact_registry` argument: use the address above.
- **TieredAgentController** — constructor `fact_registry` argument: use the address above.
- **ShieldedPool** / any contract that takes a fact registry: same address.

Existing `is_valid(fact_hash)` and `get_all_verifications_for_fact_hash(fact_hash)` calls work unchanged; ObsqraFactRegistry implements both interfaces.

---

## How it works (summary)

1. **STARK path:** Cairo0 risk program runs → Stone generates proof → backend runs **call_contract** against Integrity Verifier on the Starknet node (cryptographic verification, no tx step limit) → backend registers **fact_hash** in **ObsqraFactRegistry** via a cheap invoke (~1.2M L2 gas). Trustless verification (no trusted setup) with on-chain state.

2. **Groth16 path:** Same computation via RiskScoreAllocation.circom (202 constraints) → snarkjs Groth16 proof with STARK **fact_hash** as public input → Garaga verifies on-chain within the 10M step limit. On-chain verifiability; trusted setup neutralized by STARK binding.

3. **Status:** `both` = trustless + on-chain verifiable. `stark_only` and `groth16_only` are valid partial results.

**Trust model:** Same as Atlantic/Herodotus (admin-gated fact registration after verification), with the guarantee that the STARK proof is cryptographically verified by the Starknet node via **call_contract**, not only by obsqra infrastructure.

---

## Config (zkde.fi)

- **Backend:** `OBSQRA_FACT_REGISTRY_ADDRESS` (default: address above). Used for reference and any backend logic that needs the registry address.
- **Deployment:** When deploying ProofGatedYieldAgent or TieredAgentController, pass `OBSQRA_FACT_REGISTRY_ADDRESS` as the `fact_registry` constructor argument.

See [ENV.md](ENV.md) for full env vars.
