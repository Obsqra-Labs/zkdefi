# zkde.fi API

**zkde.fi** (by Obsqra Labs) — Starknet Sepolia app for privacy-preserving DeFi (proof-gated execution, selective disclosure, confidential transfers). Open source; lives at [zkde.fi](https://zkde.fi). Base URL: `http://localhost:8003` (or your backend URL). Prefix: `/api/v1/zkdefi`. For privacy implementation choices (Garaga vs MIST.cash), see [FOR_JUDGES.md](FOR_JUDGES.md).

## Endpoints

### POST /api/v1/zkdefi/deposit

Proof-gated deposit: request a constraint proof from obsqra.fi and get calldata for `deposit_with_proof`.

**Request body:**

```json
{
  "user_address": "0x...",
  "protocol_id": 0,
  "amount": "1000000000000000000",
  "max_position": "10000000000000000000",
  "max_daily_yield_bps": 0,
  "min_withdraw_delay_seconds": 0
}
```

**Response:** `{ "proof_hash": "0x...", "amount": ..., "protocol_id": 0, "calldata": { ... } }`

---

### POST /api/v1/zkdefi/withdraw

Returns calldata for `withdraw_with_proof`. Caller must have a valid `proof_hash` (e.g. from a prior proof).

**Request body:**

```json
{
  "user_address": "0x...",
  "protocol_id": 0,
  "amount": "1000000000000000000",
  "proof_hash": "0x..."
}
```

**Response:** `{ "protocol_id": 0, "amount": ..., "proof_hash": "0x...", "calldata": { ... } }`

---

### POST /api/v1/zkdefi/disclosure/generate

Generate a disclosure proof via obsqra.fi.

**Request body:**

```json
{
  "user_address": "0x...",
  "statement_type": "yield_above",
  "threshold": 100,
  "result": "true"
}
```

**Response:** `{ "proof_hash": "0x...", "statement_type": "...", "threshold": ..., "result": "..." }`

---

### GET /api/v1/zkdefi/position/{user_address}

Get on-chain position for a user.

**Query:** `?protocol_id=0` (optional, default 0).

**Response:** `{ "position": "0", "user_address": "0x...", "protocol_id": 0 }` (or error message).

---

### GET /api/v1/zkdefi/constraints/{user_address}

Get on-chain constraints for a user.

**Response:** `{ "max_position": 0, "max_daily_yield_bps": 0, "min_withdraw_delay_seconds": 0 }` (or error).

---

### POST /api/v1/zkdefi/private_deposit

Generate private deposit proof: commitment and proof calldata for `ConfidentialTransfer.private_deposit`. In production, backend runs Circom/Noir prover and Garaga verify-onchain; demo returns placeholder calldata.

**Request body:**

```json
{
  "user_address": "0x...",
  "amount": "1000000000000000000",
  "nonce": 12345
}
```

`nonce` is optional; if omitted, a random nonce is used.

**Response:** `{ "commitment": "0x...", "amount_public": ..., "nonce": ..., "proof_calldata": ["0x...", ...], "message": "..." }`. Use `commitment`, `amount_public`, and `proof_calldata` to call `ConfidentialTransfer.private_deposit(commitment, amount_public, proof_calldata)` on Starknet. For on-chain verification, replace `proof_calldata` with output from Garaga CLI: `garaga verify-onchain --system groth16 --contract-address <GARAGA_VERIFIER_ADDRESS> --vk <path> --proof <path>`.

---

### GET /health

Backend health: `{ "status": "ok", "service": "zkde.fi" }`.
