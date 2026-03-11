# Noir EZKL Bridge

Noir circuit that bridges EZKL-style ML outputs into the Garaga HONK verification path. Same semantics as ModelBridge (Circom): prove model identity and output bounds; verify on L2/L3 via Garaga Noir Ultra Starknet HONK (~178M gas).

## Circuit

- **Public inputs:** `expected_model_hash`, `output_lower_bound`, `output_upper_bound`
- **Private input:** `model_output` (single Field; aggregated output for minimal scaffold)
- **Public output:** `1` (is_compliant) when `model_output` is in `[output_lower_bound, output_upper_bound]`

## Build and prove

Requires [Noir](https://noir-lang.org/docs/getting_started/installation/) (`nargo` on PATH). For Garaga HONK verifier generation you also need Barretenberg (`bb`) and Garaga CLI (`pip install garaga==1.0.1`); see Garaga [Noir docs](https://garaga.gitbook.io/garaga/deploy-your-snark-verifier-on-starknet/noir).

```bash
# Compile to ACIR (artifact in target/)
nargo compile

# Execute (run + prove); requires Prover.toml with inputs
nargo execute

# Or prove only (after compile)
nargo prove
```

From repo root, `bash circuits/build_noir_ezkl_bridge.sh` runs `nargo compile` in this package.

To generate the Cairo HONK verifier: `bash circuits/generate_noir_ezkl_bridge_honk_verifier.sh` (requires `bb` and `garaga`).

## Inputs (Prover.toml / Verifier.toml)

Create `Prover.toml` with:

```toml
expected_model_hash = "0x..."
output_lower_bound = "0"
output_upper_bound = "10000"
model_output = "500"
```

`Verifier.toml` should contain the same public values (expected_model_hash, output_lower_bound, output_upper_bound) for verification.

## Garaga HONK verifier

Task 2.2 generates the Cairo HONK verifier with Garaga from this circuit’s artifact/vkey and deploys it on L2/L3. See `circuits/generate_noir_ezkl_bridge_honk_verifier.sh` and parent repo `backend/deploy_verifiers_l3.py`.

## References

- `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md` (Phase 2)
- `archive/ideas/docs/RECURSIVE_EZKL_ROADMAP.md` (Path A)
- `archive/ideas/docs/GARAGA_PROOF_TYPES.md` (noir_ultra_starknet_honk ~178M gas)
