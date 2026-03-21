# Noir EZKL Bridge V2

Versioned Path A circuit for the stronger Noir/HONK bridge semantics.

This package exists because changing the existing `noir_ezkl_bridge` package in
place would invalidate the currently deployed verifier. V2 lets the stronger
bridge semantics be compiled, benchmarked, and deployed on a new verifier lane
without breaking the live Path A receipt flow.

## What V2 adds

Compared with `circuits/noir_ezkl_bridge/`, V2 also binds:

- `timestamp` as a public input
- `ezkl_proof_hash` as a public commitment input
- `model_weights_hash == expected_model_hash`
- eight bounded outputs instead of one aggregated output scalar

## Inputs

Public:

- `expected_model_hash`
- `output_lower_bound`
- `output_upper_bound`
- `timestamp`
- `ezkl_proof_hash`

Private:

- `model_output[8]`
- `model_weights_hash`

Public output:

- `1` when all constraints pass

## Build

```bash
bash circuits/build_noir_ezkl_bridge_v2.sh
```

## Generate Garaga verifier

```bash
bash circuits/generate_noir_ezkl_bridge_v2_honk_verifier.sh
```

## Current status

V2 is a versioned upgrade path. It is not wired into the live `NoirEzklBridge`
verification lane yet because that would require a new HONK verifier deployment
and parent routing update.
