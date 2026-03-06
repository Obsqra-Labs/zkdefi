# Before Testing the Frontend

Quick checklist so the frontend works end-to-end (onboarding, agent, pools).

---

## 1. Backend running

```bash
# From repo root
cd backend && source ../.venv_py311/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8003
```

- Or use `start_zkdefi_services.sh`.
- Check: `curl -s http://localhost:8003/health` → `{"status":"ok","service":"zkde.fi"}`.
- Backend uses Alchemy RPC by default (Blast deprecated). Override with `STARKNET_RPC_URL` in `backend/.env` if needed.

---

## 2. Frontend env (`frontend/.env.local`)

Required:

- **`NEXT_PUBLIC_API_URL=http://localhost:8003`** — backend URL (default in code if unset).
- **`NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS`** — deployed ProofGatedYieldAgent. Needed for agent page and onboarding (submit step). Use the same value as `PROOF_GATED_AGENT_ADDRESS` in `backend/.env` if you have it.

Optional (for full flows):

- `NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS`, `NEXT_PUBLIC_MERKLE_TREE_ADDRESS` — Full Privacy pool.
- `NEXT_PUBLIC_SHIELDED_POOL_ADDRESS` / `NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS` — shielded pool.
- `NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS` — disclosure contract.

---

## 3. Start frontend

```bash
cd frontend && npm install && npm run dev
```

- App: **http://localhost:3001** (see `package.json` scripts).

---

## 4. Wallet

- Install a Starknet wallet (e.g. ArgentX, Braavos).
- Switch network to **Starknet Sepolia**.
- Fund with Sepolia ETH/STRK if you will send transactions.

---

## 5. Contract / ObsqraFactRegistry

- For onboarding **“Submit”** to succeed on-chain, ProofGatedYieldAgent must have **fact_registry** set to ObsqraFactRegistry (`0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8`). That is set at **deploy** time. If your agent was deployed earlier with another registry, either redeploy with ObsqraFactRegistry or use an already-updated deployment.
- Frontend does not need the fact registry address in env; it only needs `NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS`.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Backend running on 8003 |
| 2 | `frontend/.env.local`: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS` |
| 3 | `cd frontend && npm run dev` → http://localhost:3001 |
| 4 | Wallet on Starknet Sepolia |
| 5 | ProofGatedYieldAgent deployed with ObsqraFactRegistry (for onboarding submit) |
