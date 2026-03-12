# Receipts as primitive — product strategy

**Summary:** Lead with **Obsqra = verifiable action receipts**; zkDeFi = first consumer. The brutal take is right: the primitive exists in code but isn’t sharp enough to be adoptable infrastructure. This doc records the reframe, the gap, and the next step.

**zk OS context:** In our full stack (Obsqra + zkdefi), the receipt layer is **zkSyslog** — one of three pillars: **zkRAG** (proven index), **zkGraph** (attested intelligence), **zkSyslog** (provable receipts). Everything in the data pipeline stems from those three; capital/zkDeFi is one flavor of the zk OS. See [ZK_OS_REFrame.md](ZK_OS_REFrame.md).

---

## 1. Architecture narrative (agreed)

| Primitive        | First app   |
|------------------|-------------|
| Chainlink        | price feeds |
| The Graph        | subgraphs   |
| EigenLayer       | AVSs       |
| **Obsqra receipts** | **zkDeFi** |

So: **Obsqra (receipts) → zkDeFi (showcase)**. zkDeFi is the flagship consumer, not the product name.

---

## 2. Core loop (already built)

```
action → proof → receipt → persist → query
```

We have it. The shift is **center of gravity**, not new build.

---

## 3. Where we are today (gap)

**Schema:** Two creation paths and a fat table.

- `create_receipt(user_address, constraints_hash, proof_hash, action_type, ...)` — constraint/execution receipts.
- `append_proof_receipt(user_address, proof_type, threshold_or_model, result, fact_hash, ...)` — proof-oriented receipts.

So “receipt” today is **two shapes** and many columns (receipt_id, user_address, action_type, proof_type, constraints_hash, proof_hash, fact_hash, result, snapshot_hash, tx_hash, model_hash, pool_id, metadata, on_chain, timestamp, …). That’s powerful for internal use but **not a single, well-defined primitive**.

**API:**

- **Record:** `POST /receipts` exists and calls `create_receipt`, but the body is execution-shaped (transactionHash, userAddress, constraintsHash, proofHash, action, …), not the minimal canonical shape. No `POST /receipts/record` with a single receipt contract.
- **Verify:** We have `GET mc/receipts/{receipt_id}` (forensic) and `GET /receipts/on-chain/{address}`. We do **not** have a clear `GET /receipts/{id}/verify` that returns “valid / on-chain / invalid”.
- **Reputation:** We have `GET /reputation/user/{address}`, risk_passport, risk_profile. We do **not** have a single `GET /reputation/{actor}` that returns a small, stable shape (e.g. `actions`, `verified_success`, `risk_score` or equivalent).

So: the **primitive is implemented but not exposed as a sharp, adoptable surface**. The strategist’s point stands: infrastructure wins when the **object** is well-defined (Ethereum = tx, IPFS = content hash, Chainlink = oracle answer). Right now “receipt” is still “whatever we persist from vault/zkml/rebalancer/ledger.”

---

## 4. Target primitive (canonical receipt)

One well-defined object:

```text
receipt = {
  actor,    // who
  action,   // what (e.g. vault_rebalance, pool_safety_check)
  proof,    // proof_hash or fact_hash or proof_type + commitment
  result,   // success | fail | constraint_fail | …
  timestamp
}
```

Everything else (pool_id, vault_id, amount, metadata) can be **optional extensions** or inside a single `metadata` blob, but the **core contract** for “one receipt” is those five. Both `create_receipt` and `append_proof_receipt` can be mapped into this shape; new internal code and external SDK should write to this contract.

---

## 5. Target API wedge (developer surface)

| Operation      | Method + path                  | Purpose |
|----------------|--------------------------------|--------|
| Record receipt | `POST /receipts/record`        | Body: canonical receipt (actor, action, proof, result, timestamp). Returns receipt_id. |
| Verify receipt | `GET /receipts/{id}/verify`    | Returns valid / on_chain / invalid (and optionally fact_hash, tx_hash). |
| Get reputation | `GET /reputation/{actor}`      | Returns e.g. `{ actions, verified_success, risk_score }` (or current equivalent). |

Existing routes can stay for backward compatibility; the **primitive** is this surface. SDK/CLI and docs lead with these three.

---

## 6. Positioning (agreed)

- **Do say:** “Proof-backed action history.” “Verifiable action ledger for agents and protocols.” “Obsqra records proof-backed action receipts so agents and protocols can build verifiable reputation.”
- **Don’t lead with:** “AI reputation system” (crowded and vague).

---

## 7. Real test

A primitive is real when a **third party** can plug in:

```text
agent → receipts (record_action) → reputation → capital allocation
```

So: one canonical receipt shape, one record API, one verify API, one reputation API. Then “Obsqra Receipts SDK” or “zkReceipt Engine” is just a thin client over these.

---

## 8. Stack narrative (agreed)

```text
Obsqra        = verifiable receipts (primitive)  ← zkSyslog
StarkForge    = proof verification (layer)
zkDeFi        = execution environment (first app)
```

Each layer has a clear role. zkDeFi is the demo that eats our own receipt dogfood.

**Within the zk OS:** zkSyslog (receipts) sits alongside zkRAG (proven index) and zkGraph (attested queries). Record/verify/reputation is the **zkSyslog** API surface.

---

## 9. Next step (concrete)

1. **Define the canonical receipt** in code: one type/schema (e.g. Pydantic) with required `actor`, `action`, `proof`, `result`, `timestamp`; optional `metadata`. Map both `create_receipt` and `append_proof_receipt` to write this shape (or a view of it).
2. **Add the three routes** (or alias existing ones):
   - `POST /receipts/record` — accepts canonical receipt; returns receipt_id.
   - `GET /receipts/{id}/verify` — returns verification status (and optionally fact_hash/tx_hash).
   - `GET /reputation/{actor}` — returns a small, stable summary (actions count, verified_success, risk_score or equivalent).
3. **Document** “Obsqra receipts” as the primitive and zkDeFi as the first consumer (README, docs, one-pager).

After that, “record_action / verify_receipt / get_reputation” is the real developer entry point, and the brutal take is fully reflected in the product surface.
