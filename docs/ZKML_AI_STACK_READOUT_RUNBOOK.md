# ZKML + AI Stack Readout Runbook

This runbook gives a single place to:
- seed qualifying data (instead of lowering thresholds),
- retrain the predictive credit model,
- verify ONNX artifacts,
- run composable circuit signals and inspect output.

## 1) Seed More Qualifying Data

```bash
cd /opt/obsqra.starknet/zkdefi/backend
python3 -m scripts.seed_decision_events --address-count 45 --count-per-address 35 --seed 20260304
```

What this does:
- clears prior seeded records (`metadata.seeded=true`),
- reseeds 45 addresses with profile diversity (`prime`, `standard`, `risky`),
- refreshes `user_behavior_stats`.

## 2) Verify Training Eligibility + Label Mix

```bash
cd /opt/obsqra.starknet/zkdefi/backend
python3 - <<'PY'
import asyncio
from collections import Counter
from app.db.decision_store import get_decision_store
from app.ml.creditworthiness.trainer import _heuristic_label

async def main():
    ds = await get_decision_store().get_training_dataset(min_events=10)
    print("users>=10", len(ds))
    print("labels", dict(Counter(_heuristic_label(s) for s in ds)))

asyncio.run(main())
PY
```

## 3) Train Creditworthiness Model + ONNX

```bash
cd /opt/obsqra.starknet/zkdefi/backend
python3 - <<'PY'
import asyncio, json
from app.ml.creditworthiness.trainer import train_model

async def main():
    res = await train_model(min_events=10)
    print(json.dumps(res, indent=2, default=str))

asyncio.run(main())
PY
```

Artifacts are written to:
- `backend/app/data/ezkl_models/creditworthiness/creditworthiness_model.json`
- `backend/app/data/ezkl_models/creditworthiness/creditworthiness.onnx`
- `backend/app/data/ezkl_models/creditworthiness/training_metadata.json`

## 4) Check ONNX Runtime + Discovery Status

```bash
cd /opt/obsqra.starknet/zkdefi/backend
python3 - <<'PY'
import json
from app.services.zkml.circuit_scanner import get_onnx_runtime_status
print(json.dumps(get_onnx_runtime_status(), indent=2))
PY
```

## 5) Unified Stack Readout (API)

Get stack + circuits + ONNX state:

```bash
curl -s http://localhost:8000/api/v1/zkdefi/zkml/readout | jq
```

Run selected circuits in `signal` mode (indicator, not hard gate):

```bash
curl -s -X POST http://localhost:8000/api/v1/zkdefi/zkml/readout/run \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "signal",
    "circuits": ["YieldOptimality", "ImpermanentLossPredictor", "LiquidationRisk"],
    "include_human_summary": true
  }' | jq
```

## 6) Local Function-Based Scan (No HTTP Server Required)

```bash
cd /opt/obsqra.starknet/zkdefi/backend
python3 - <<'PY'
import asyncio, json
from app.services.zkml.circuit_scanner import run_circuit_scan

async def main():
    res = await run_circuit_scan(
        circuits=["YieldOptimality", "ImpermanentLossPredictor"],
        mode="signal",
    )
    print(json.dumps(res, indent=2))

asyncio.run(main())
PY
```

## Notes

- Yield support is represented as composable skills/circuits (for example `YieldOptimality`) and can be run in signal mode.
- Credit model training now handles sparse label slices safely (class remap) and still exports full-class readable outputs.
- This workflow is additive: Cairo + Circom/Groth16 circuits remain, and ONNX/EZKL outputs feed the same composable stack.
