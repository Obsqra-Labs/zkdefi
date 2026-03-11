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

## 5. References

- Implementation plan Phase 3: `docs/plans/2026-03-10-advanced-l3-and-ezkl-onchain-implementation.md`
- L1 deploy and env: `docs/plans/L1_SEPOLIA_EZKL_VERIFIER.md`
