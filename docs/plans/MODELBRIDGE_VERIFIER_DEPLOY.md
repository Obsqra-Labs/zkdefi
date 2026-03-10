# ModelBridge verifier: L3 + Starknet deployment

Deploy the **ModelBridge** Garaga verifier so that ModelBridge Groth16 proofs can be verified on-chain on **L3 (Madara)** and on **Starknet (L2)**.

## Prerequisites

- ModelBridge circuit built: `bash circuits/build_model_bridge.sh`
- ModelBridge Garaga verifier generated: `bash circuits/generate_model_bridge_verifier.sh`
- Scarb/Starkli (or sncast) and RPC for Starknet Sepolia
- Access to L3 (Madara) and parent obsqra API for L3 registration

---

## Current deployment snapshot (2026-03-10)

- Starknet Sepolia ModelBridge verifier class hash:
  `0x04745a6bcd5a3306d7ed2eac2a5f5a53f66cfd7afee4c7a7d1d18cb5574257f8`
- Starknet Sepolia ModelBridge verifier address:
  `0x037c42e8734271aca0c3c1bdf1746d9ccc098ddfd5ee211c94bbb8786fa4626f`
- Saved locally in `.model_bridge_verifier.deployed`.

If your ZkmlVerifier (new 3-arg version) is already deployed with `model_bridge_verifier = 0`,
set it now as admin:

```bash
starkli invoke <ZKML_VERIFIER_ADDRESS> set_model_bridge_verifier \
  0x037c42e8734271aca0c3c1bdf1746d9ccc098ddfd5ee211c94bbb8786fa4626f \
  --rpc <STARKNET_RPC_URL> \
  --account <STARKLI_ACCOUNT> \
  --keystore <STARKLI_KEYSTORE>
```

---

## 1. Generate the verifier (once)

From repo root:

```bash
# Circuit + vkey (if not already done)
bash circuits/build_model_bridge.sh

# Garaga verifier Cairo project
bash circuits/generate_model_bridge_verifier.sh
```

Artifacts:

- `circuits/contracts/src/garaga_verifier_model_bridge/` — Scarb project
- `.../target/dev/garaga_verifier_model_bridge_Groth16VerifierBN254.contract_class.json` (or similar) — contract class for deployment

---

## 2. Deploy on Starknet (L2)

**One-command deploy (from repo root):**

```bash
STARKNET_KEYSTORE_PASSWORD=<your-secret> bash scripts/deploy_model_bridge_verifier.sh
```

The script auto-uses the CASM hash from the Scarb-built compiled artifact. If the RPC returns a **CASM mismatch** (different compiler version), re-run with the hash from the error:

```bash
MODEL_BRIDGE_CASM_HASH=0x<expected_from_error> STARKNET_KEYSTORE_PASSWORD=<secret> bash scripts/deploy_model_bridge_verifier.sh
```

**Sepolia (Alchemy v2) expected CASM hash** (as of 2026-03-10): `0x213d2e92a84b25c0d35fcdea698e6cca594dc9f7cc6484e441ac133550fe589`. If you see `InvalidTransactionNonce`, wait 30–60s and retry.

This declares and deploys the ModelBridge verifier, then writes `.model_bridge_verifier.deployed` with `MODEL_BRIDGE_VERIFIER_ADDRESS`. If the keystore or password is missing, the script prints instructions and exits without failing.

The **ZkmlVerifier** contract now has a dedicated `model_bridge_verifier` slot. You can either deploy a **new** ZkmlVerifier with both verifiers, or **set** the ModelBridge verifier on an existing ZkmlVerifier.

### Option A: New ZkmlVerifier (fresh deploy)

1. **Deploy the ModelBridge verifier** (same pattern as other Garaga verifiers):

   ```bash
   cd circuits/contracts/src/garaga_verifier_model_bridge
   scarb build
   # Declare + deploy (starkli or sncast), e.g.:
   starkli declare target/dev/garaga_verifier_model_bridge_*.contract_class.json --rpc <RPC>
   starkli deploy <CLASS_HASH> --rpc <RPC>
   # → MODEL_BRIDGE_VERIFIER_ADDRESS
   ```

2. **Deploy ZkmlVerifier** with constructor:

   `constructor(garaga_verifier, admin, model_bridge_verifier)`

   - `garaga_verifier`: existing Garaga verifier (e.g. for RiskScore / Anomaly)
   - `admin`: admin address
   - `model_bridge_verifier`: the ModelBridge verifier address from step 1 (or `0` to set later)

   Example (starkli):

   ```bash
   starkli deploy <ZKML_VERIFIER_CLASS_HASH> \
     <GARAGA_VERIFIER> <ADMIN> <MODEL_BRIDGE_VERIFIER> \
     --rpc <RPC>
   ```

### Option B: Existing ZkmlVerifier (upgrade)

If ZkmlVerifier is already deployed with the **old** 2-arg constructor, you must **re-deploy** ZkmlVerifier (constructor now has 3 args) and migrate, OR use a **proxy/upgrade** pattern if you have one.

If you have a **new** ZkmlVerifier already deployed with 3-arg constructor and `model_bridge_verifier = 0`:

1. Deploy the ModelBridge verifier (as in Option A step 1).
2. Call on ZkmlVerifier (as admin):

   ```text
   set_model_bridge_verifier(MODEL_BRIDGE_VERIFIER_ADDRESS)
   ```

   (Starkli: `starkli invoke <ZKML_VERIFIER> set_model_bridge_verifier <MODEL_BRIDGE_VERIFIER> --rpc <RPC>`.)

**Note:** The previously deployed ZkmlVerifier at `0x037f17cd0e17f2b41d1b68335e0bc715a4c89d03c6118e5f4e98b5c7872c798d` was built from an older class that does **not** expose `set_model_bridge_verifier` or `verify_model_bridge_proof`. A **new** ZkmlVerifier was deployed with the ModelBridge verifier set in the constructor:

- **New ZkmlVerifier (ModelBridge-capable):** `0x068abd64a4a78172a5ee15a30bbe614257d62482f07d3ff7fdb72da5aad08923`  
  (Class hash: `0x00f9c1bd17a2c6bc58ca76a146399151fdf677514e7c6630eb8694b7687aa066`)

Use this address for backend/env and any flow that calls `verify_model_bridge_proof`. Risk/anomaly verification can still use the same contract (it uses `garaga_verifier` for those).

---

## 3. Deploy on L3 (Madara)

L3 verification is done by the **parent obsqra stack** (`/opt/obsqra.starknet/backend`): the zkdefi backend sends proof + calldata to the parent API, which submits to L3. The parent must know which **verifier contract** on L3 to use for `circuit_name="ModelBridge"`.

**Parent backend (obsqra) changes (done):**
- `L3_MODEL_BRIDGE_VERIFIER_ADDRESS` added to `app/config.py`.
- `L3VerificationService` routes `circuit_name="ModelBridge"` to the ModelBridge verifier when `L3_MODEL_BRIDGE_VERIFIER_ADDRESS` is set; otherwise falls back to the default Garaga verifier.
- Proving path `groth16_model_bridge` and health probe field `model_bridge_verifier_deployed` exposed.

**What you need to do:**

1. **Deploy the ModelBridge verifier on L3** (one-command from parent backend):
   - Generate the verifier in zkdefi (if not already done):
     ```bash
     cd /opt/obsqra.starknet/zkdefi && bash circuits/generate_model_bridge_verifier.sh
     ```
   - From the **parent backend**, run the L3 verifier deploy script (it deploys Garaga + Integrity + ModelBridge when artifacts exist):
     ```bash
     cd /opt/obsqra.starknet/backend
     MADARA_APPCHAIN_RPC=<your_l3_rpc> MADARA_WALLET_ADDRESS=0x... MADARA_WALLET_PRIVATE_KEY=0x... python3 deploy_verifiers_l3.py
     ```
   - Or with defaults (local Madara at 127.0.0.1:9944): `python3 deploy_verifiers_l3.py`
   - The script prints `.env` lines; copy `L3_MODEL_BRIDGE_VERIFIER_ADDRESS=...` when ModelBridge is deployed.

2. **Set the address in the parent backend**
   - In the obsqra backend `.env` (or environment) set:
     - `L3_MODEL_BRIDGE_VERIFIER_ADDRESS=<l3_model_bridge_verifier_address>`
   - Restart the parent API so L3 verification uses the new config.

After that, when zkdefi calls `generate_ml_proofs(..., execution_chain="l3")` and the pipeline produces a real ModelBridge proof, the parent will verify it on L3 with the ModelBridge verifier and return `verified_on_chain: true` when the proof is valid.

**Starknet (L2):** ModelBridge verification is live using the new ZkmlVerifier at `0x068abd64a4a78172a5ee15a30bbe614257d62482f07d3ff7fdb72da5aad08923` (see `.zkml_verifier_model_bridge.deployed`). Point backend/e2e to this address when calling `verify_model_bridge_proof`.

---

## 4. Summary

| Step | Action |
|------|--------|
| 1 | `build_model_bridge.sh` → circuit + vkey |
| 2 | `generate_model_bridge_verifier.sh` → Garaga verifier Cairo project |
| 3a | Deploy ModelBridge verifier on **Starknet**; set on ZkmlVerifier via constructor or `set_model_bridge_verifier` |
| 3b | Deploy same ModelBridge verifier on **L3**; register `ModelBridge` → verifier address in parent API |

Once both are done, ModelBridge proofs can be verified on-chain on L3 and on Starknet.
