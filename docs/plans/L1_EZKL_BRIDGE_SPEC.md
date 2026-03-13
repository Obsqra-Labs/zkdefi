# L1→L2 EZKL Verification Bridge — Message Format and Receiver

Spec for Phase 3 (Path C): after verifying an EZKL proof on Ethereum Sepolia, send the result to Starknet via core L1→L2 messaging.

## 1. Message payload (L1 → L2)

Sent from L1 (Sepolia) to the Starknet L1→L2 bridge. Consumed by the **receiver contract** on Starknet (L2 or L3).

| Field | Type | Description |
|-------|------|-------------|
| `model_hash` | bytes32 / felt | Commitment to the verified model (e.g. Poseidon/Keccak hash). |
| `output_commitment` | bytes32 / felt | Commitment to the model output (e.g. hash of output vector). |
| `verified` | bool | Must be `true` (only send after successful L1 verify). |
| `nonce` | uint256 / u256 | Unique nonce for idempotency and polling. |
| `chain_id` | uint256 | L1 chain id (Sepolia = 11155111) for replay protection. |

Encoding on L1 (Solidity) and decoding on Starknet (Cairo) must match. Use fixed-width encoding (e.g. 32 bytes per field) so the Starknet `consume_message` handler can parse deterministically.

## 2. Sender (L1)

- **Option A:** EZKL Solidity verifier contract, after successful `verify()`, calls the Starknet core bridge to send the message to `L1_BRIDGE_RECEIVER_ADDRESS`.
- **Option B:** Separate L1 contract that (1) calls EZKL verifier, (2) on success sends the bridge message with (model_hash, output_commitment, 1, nonce, chain_id).

Only one L1 sender address should be allowed (receiver validates `from_address`).

Current Sepolia deployment (March 11, 2026):
- EZKL verifier: `0xF7b555ca4E54a8c7B9A0DDBFa17341575a852Ab9`
- L1 bridge sender (`L1EzklBridgeSender.sol`): `0x2a1b030f2835cB0ADC4ea271105e96da293853ab`
- Starknet core L1 messaging contract (Sepolia): `0xE2Bb56ee936fd6433DC0F6e7e3b8365C906AA057`
- Receiver selector (`on_l1_message`): `0x035b18ea40fc0fe052a663bca34b1c66f25e888f6d54d0c518b9c68f451c65ea`
- Receiver allowed sender update tx: `0x03cfeac61eaea7010ffbf40b5496333c3064841055b6fc3895ccb2175d8c4f65`

## 3. Receiver (Starknet)

- **Contract:** e.g. `L1EzklBridgeReceiver` or extend existing fact/attestation registry.
- **Entrypoint:** Core L1→L2 messaging: message consumed via `consume_message` (or equivalent in the Starknet L1↔L2 flow).
- **Validation:**
  - Message must come from the known L1 bridge / sender address.
  - `verified` must be true.
  - Optional: check `chain_id` matches Sepolia.
- **Storage / side effect:** Store or emit (model_hash, output_commitment, verified=true, nonce, block_number) so the backend or other contracts can query “is this model_hash verified via L1?”.

## 4. Backend polling

Backend (or zkdefi) can poll L2 state or indexer:

- Input: `model_hash` + `nonce` (from L1 tx receipt or request).
- Query: receiver contract `get_verification(model_hash, nonce)` or event log.
- Output: `verified_on_l2: true` when the message was consumed and stored.

## 5. Receiver ABI / Poll contract (zkdefi)

**Contract:** `L1EzklBridgeReceiver` (`contracts/src/l1_ezkl_bridge_receiver.cairo`).
Current Starknet Sepolia deployment (March 11, 2026):
- Address: `0x02ed07ab9be1d632259f3dd1bbeaf6354c20046b6df8659a30e3e97415b1a220`
- Declare tx: `0x01ecc230ae6aa82e71cfefa71f68c696282540a9c4307e8c0a9f9a25c6d014e8`
- Deploy tx: `0x07025809c24146895a085e0acf89ccc5e731a80114c5f7e70271dbffd8eeef0a`

**View for polling:**

```text
get_verification(model_hash: felt252, nonce_low: u128, nonce_high: u128)
  -> (verified: bool, output_commitment: felt252, block_timestamp: u64)
```

- `verified`: true iff a verification record exists for this (model_hash, nonce).
- `output_commitment`: stored commitment when verified; 0 otherwise.
- `block_timestamp`: L2 block when the L1 message was consumed; 0 if not verified.

**Nonce encoding:** Parent backend uses a single `nonce: int`; pass as `nonce_low = nonce & ((1<<128)-1)`, `nonce_high = nonce >> 128` for u256→(u128,u128).

**Parent backend implementation (status):**

- ✅ `poll_l2_for_verification(model_hash: str, nonce: int)` in parent backend now calls `get_verification` at `L1_BRIDGE_RECEIVER_ADDRESS` via Starknet RPC and returns `verified_on_l2`, `output_commitment`, `block_timestamp`.
- ✅ **GET** `/api/v1/aggregation/l1/verification-status?model_hash=<hex>&nonce=<int>` now returns JSON with `{ "verified_on_l2": bool, "output_commitment": str | null, "block_timestamp": int | null }` (plus compatibility fields).
- ✅ **POST** `/api/v1/aggregation/l1/verify` supports bridge mode:
  - if `L1_EZKL_BRIDGE_SENDER_ADDRESS` is set, backend calls `verifyAndBridge(proof, instances, model_hash, output_commitment)`;
  - request must include `model_hash` and `output_commitment`;
  - response includes `mode: "verify_and_bridge"` or `mode: "l1_verify_only"`;
  - bridge-mode responses now surface the polling token from the preflight call:
    - `used_nonce`
    - `message_hash`
    - `verification_status_query = { model_hash, nonce }`
  - optional inline L2 confirmation is supported with:
    - `wait_for_l2=true`
    - `l2_max_polls`
    - `l2_poll_interval_seconds`
  - when inline confirmation is enabled, the response also includes:
    - `verified_on_l2`
    - `l2_output_commitment`
    - `l2_block_timestamp`
    - `l2_poll_attempts`

Config: `L1_EZKL_VERIFIER_ADDRESS`, `L1_EZKL_BRIDGE_SENDER_ADDRESS`, `L1_BRIDGE_RECEIVER_ADDRESS`, `STARKNET_RPC_URL` (or existing L2 RPC) for contract reads.

## 6. References

- Implementation plan Phase 3: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md`
- L1 deploy and env: `docs/plans/L1_SEPOLIA_EZKL_VERIFIER.md`
