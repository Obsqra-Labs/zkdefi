# Credit Scoring (EZKL)

EZKL-compiled credit scoring model for on-chain verification via the ModelBridge pipeline.

## Pipeline

1. Train MLP model on behavioral features
2. Export to ONNX
3. Compile with EZKL → circuit + proving key + verification key
4. Generate Groth16 proof of inference
5. Verify on-chain via Garaga (L3 → L2 settlement)

## Structure

```
credit-scoring/
├── host/       Host-side proving logic
├── methods/    ZK method definitions
└── target/     Build output
```

## Build

```bash
cargo build --release
```

See [ModelBridge spec](../docs/plans/EZKL_TO_PROOF_BRIDGE_SPEC.md) for the full EZKL → on-chain pipeline.
