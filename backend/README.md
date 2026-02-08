# zkde.fi Backend

Backend for **zkde.fi by Obsqra Labs** — FastAPI app (port 8003). Calls obsqra.fi proving API as external black box. Open source; app lives at zkde.fi.

## Endpoints

- `POST /api/v1/zkdefi/deposit` - Proof-gated deposit (returns calldata)
- `POST /api/v1/zkdefi/withdraw` - Proof-gated withdrawal (returns calldata)
- `POST /api/v1/zkdefi/disclosure/generate` - Generate disclosure proof
- `GET /api/v1/zkdefi/position/{user_address}` - Get positions
- `GET /api/v1/zkdefi/constraints/{user_address}` - Get constraints
- `POST /api/v1/zkdefi/private_deposit` - Generate private deposit proof (Garaga)

## Run

```bash
pip install -r requirements.txt
export PORT=8003
uvicorn app.main:app --host 0.0.0.0 --port 8003
```

Set `.env` with `STARKNET_RPC_URL`, `OBSQRA_PROVER_API_URL`, `OBSQRA_API_KEY`, and deployed contract addresses.
