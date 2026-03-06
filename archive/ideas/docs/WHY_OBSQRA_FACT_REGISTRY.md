# Why ObsqraFactRegistry Instead of Herodotus/Integrity's Fact Registry

We **do** use **Herodotus Integrity** for STARK proof **verification**. We use our own **ObsqraFactRegistry** only for **on-chain persistence** of the fact hash, because writing directly to Integrity's fact registry is currently impossible on Starknet.

---

## What we use Integrity for

- **Integrity Verifier contract** — We call it for every proof. The backend runs **`call_contract`** (read-only) against Integrity's `verify_proof_full_and_register_fact`. The node executes the full STARK verifier and returns the **fact_hash**. That is real cryptographic verification; we are using Herodotus/Integrity's verifier.

---

## Why we can't write to Integrity's fact registry today

To **register** a fact in Integrity's own fact registry, you would **invoke** the same function: `verify_proof_full_and_register_fact`. That invoke runs the full STARK verifier **inside the transaction**.

- **Starknet's invoke step limit** (as of v0.14.1) is **~10M steps** per transaction.
- **Integrity's verification program uses more than 10M steps** — even Integrity's own canonical example proofs exceed this limit.
- So the invoke **reverts** with: *"Could not reach the end of the program. RunResources has no remaining steps."*

Documented in:

- `backend/app/services/integrity_service.py` — docstring on `register_calldata_and_get_fact`
- `docs/DEV_LOG.md` — "Stone Prover — RunResources step limit"

The Integrity team tests verification **locally** (runner), where there is no such limit. On public Starknet Sepolia, **zero** `FactRegistered` events exist on the public Integrity FactRegistry for this reason.

---

## What ObsqraFactRegistry does

After we get the **fact_hash** from Integrity via `call_contract` (node-verified), we need somewhere on-chain that contracts can call **`is_valid(fact_hash)`**. We can't persist that in Integrity's registry by invoking it (step limit), so we:

1. **Verify** — Integrity verifier via `call_contract` (no step limit for simulation). ✅ Cryptographically valid.
2. **Persist** — Invoke **ObsqraFactRegistry.register_fact(fact_hash)**. That contract only stores the fact hash (a few felts + event), ~1.2M L2 gas, well under the step limit.

So **ObsqraFactRegistry** is a **lightweight mirror**: same `is_valid(fact_hash)` / `get_all_verifications_for_fact_hash` interface that ProofGatedYieldAgent and other contracts expect, but populated only with facts that the node has already verified via Integrity.

---

## Trust model

Same as Atlantic/Herodotus Satellite (admin-gated fact registration after verification):

- The backend only registers a fact_hash **after** the Starknet node has cryptographically verified the proof via Integrity's verifier (`call_contract`).
- We do not register unverified facts. The “trust” is: verification is done by the node running Integrity's code; we only persist the result.

When Starknet's protocol raises the invoke step limit (or Integrity optimizes the verifier to fit 10M steps), we can optionally **also** invoke Integrity's own `verify_proof_full_and_register_fact` so facts appear in Herodotus's registry; the code already attempts that and will succeed when the limit allows it.

---

## Summary

| Question | Answer |
|----------|--------|
| Are we using Integrity? | **Yes** — for verification (call_contract to Integrity Verifier). |
| Why not use Integrity's fact registry for persistence? | **Invoke step limit (10M).** Integrity's verifier exceeds it; the invoke would always revert. |
| Why ObsqraFactRegistry? | **Persistence only.** Lightweight contract that stores node-verified fact hashes so contracts can call `is_valid(fact_hash)` today. |
| When can we use Integrity's registry? | When the protocol step limit increases or Integrity's verifier fits within it; we already try the invoke and will use it automatically when it succeeds. |

See also: [DUAL_PROOF_ARCHITECTURE.md](DUAL_PROOF_ARCHITECTURE.md), [DEV_LOG.md](DEV_LOG.md) (RunResources step limit), and `backend/app/services/integrity_service.py` (`register_calldata_and_get_fact`).

---

## How our method compares to Herodotus / Integrity

**Yes — Herodotus use Integrity's fact registry.** Their flow is:

- **Verification + persistence** both go through the **same** Integrity FactRegistry contract.
- **Monolith path:** One invoke to `verify_proof_full_and_register_fact` when the proof fits in a single transaction (step limit + calldata). The verifier runs and the fact is stored in **Integrity's** FactRegistry.
- **Split path:** When a proof exceeds single-tx limits, they use **split verification**: multiple transactions (`verify_proof_initial`, `verify_proof_step`, `verify_proof_final` or similar), each under the step limit. The fact is still registered in **the same** Integrity FactRegistry. This is documented in their docs and supported by the integrity-calldata-generator (split calldata + multi-tx sending).

**Our method vs Herodotus:**

| Aspect | Herodotus / Integrity | Us (Obsqra) |
|--------|------------------------|-------------|
| **Verifier** | Integrity STARK verifier | Same — we call Integrity's verifier |
| **Verification** | Invoke(s) to Integrity (monolith or split) | **call_contract** (read-only) to Integrity → get fact_hash |
| **Persistence** | **Integrity's FactRegistry** (same contract) | **ObsqraFactRegistry** (our contract) |
| **Why different?** | They keep verification under the step limit (split so each tx &lt; 10M steps) | For our proofs/layout, even **split** verification exceeded 10M (e.g. `verify_proof_initial` alone &gt; 10M in our tests). We never successfully invoke Integrity for persistence; we only simulate via call_contract and persist the fact_hash ourselves. |

So we use the **same cryptographic verification** (Integrity's verifier on the node) but a **different persistence layer** (our registry) because we cannot complete any invoke path to Integrity's FactRegistry today — neither monolith nor the split path we tried stayed under the protocol step limit. When the limit increases or Integrity's verifier is optimized so that either monolith or split fits, we could switch to writing to Integrity's FactRegistry as well (or instead); the code already attempts the invoke when possible.

---

## Why they can do it and we can't (yet)

**1. Proof size and layout**

- **They** target proof shapes and layouts (e.g. small layout, minimal n_steps like 512) that are known to fit in one invoke, or split into chunks that each stay under 10M steps. Their docs and examples are built around these “fits on-chain” combinations.
- **We** use a **risk program** (Cairo 0, recursive layout, 4096+ steps) that produces a proof whose **verification** exceeds 10M steps — so even a single `verify_proof_full_and_register_fact` invoke doesn’t fit. When we tried **small** layout we had to change builtins (ecdsa vs bitwise); after that fix, the small verifier for our proof **still** exceeded 10M. So our current **program + layout + proof size** was never in the “fits on-chain” envelope.

**2. Split verification**

- **They** provide a **split** verifier (e.g. `verify_proof_initial` / `verify_proof_step` / `verify_proof_final`) and a calldata generator that produces split calldata. For proofs that don’t fit in one tx, each **phase** is intended to stay under the step limit so the fact can still be registered in Integrity’s FactRegistry.
- **We** tried the same split path (integrity-calldata-generator, split calldata). In our tests, **even the first phase** (`verify_proof_initial`) exceeded 10M steps. So with our proof/layout/verifier build, no single invoke in the split flow fit the limit — we never got to the point where we could complete the multi-tx sequence and register in Integrity’s registry.

**3. Verifier build and layout alignment**

- **They** control which verifier preset/layout is deployed and documented (e.g. recursive + monolith, or small + split). Their “verify for $0.04” / L3 story assumes a verifier + proof combo that fits.
- **We** use the **public** Integrity verifier on Sepolia (same contract they document). We didn’t deploy a custom verifier; we use whatever layout/preset that contract expects. Our proof may be a bad match for that verifier’s step usage (e.g. recursive verification is heavier, or our serialization triggers a heavier path).

**4. What would need to change for us to do it like them**

- **Option A — Shrink our proof so verification fits:** Use a **minimal** Cairo program + layout (e.g. small, n_steps ≤ 512) that matches Integrity’s small/split examples, and ensure builtins and serialization match. Then either monolith or split might fit; we could then invoke Integrity and register in their FactRegistry.
- **Option B — Use their split flow end-to-end:** Confirm with Integrity/Herodotus which exact proof format, layout, and split calldata they use for on-chain registration on Sepolia. Align our Stone output and calldata generator with that so **each** split phase is under 10M, then run the same multi-tx flow they document.
- **Option C — Wait for the chain:** If Starknet raises the invoke step limit (e.g. 0.15+), or Integrity ships a verifier that fits in 10M, our current proof might start fitting without changing our program; we already attempt the invoke and would then register in Integrity’s FactRegistry automatically.

So: **they can do it** because they (and their users) use proof/layout/split combinations that are designed to stay under the step limit. **We can’t yet** because our current risk proof + verifier path exceeds that limit in every invoke we tried (including the first phase of split). We’re not missing the same verifier — we’re missing a **proof/flow that fits in the same on-chain budget**.
