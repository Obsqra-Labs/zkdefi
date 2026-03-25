# ReceiptOS Deployments

## Starknet Sepolia

### ReceiptRegistry v0.1

- Date: 2026-03-25
- Network: Starknet Sepolia
- RPC: https://starknet-sepolia.g.alchemy.com/v2/EvhYN6geLrdvbYHVRgPJ7
- Class hash: 0x003bdfbf296fae72ee64af20ff0a11b9a13113bbeed2bbf193baa208a0d10c12
- Declare tx: 0x02cc891b06d4364f2446ce0d2360713ae8e6fb8bca58517f28e11dc5e3833a67
- Contract address: 0x0544ef8cbf8bf1ac7987bc0d2bb211434d515fbe10bab65f36e0f761c79bbdff
- Deploy tx: 0x037cff7f4b89a0304c74327e249451754a104e04b52ba989a3f879927c510874
- Admin: 0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
- Attester pubkey: 0x2f8ffcb446d2a062ef18561eb507b08ea01d52d4c594e90cfca47f075cb952

Verification reads (post-deploy):

- `get_attester_pubkey()` -> `0x002f8ffcb446d2a062ef18561eb507b08ea01d52d4c594e90cfca47f075cb952`
- `get_admin()` -> `0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d`

### Phase 2.6 — Live E2E issuance + verify

- Date: 2026-03-25
- Issued receipt ID 1 via `issue_attested_receipt`
- Issue tx: `0x0111dea9b11048e000bcdc583bbeae1e5646ac5ad5f8f9f457f7fc6799f2b2c6`
- Policy hash: `0x12f6c11739eb6a8992e87dfe47d97453d4e0d2845140e3d566154e9e82114f6`
- Sig r: `0x66693e63a92f664a568afab13c7e0899dd26e2a12c9302af145a32097174387`
- Sig s: `0x513136e43c19d9d02a2d9280dfabe8cef2c47acce35c020d92b867ef0e35f66`
- Weight: `100`
- Fee paid: ~0.07 STRK (v3 transaction)

Verification reads (post-issuance):

- `verify_receipt(1)` -> `0x1` (true) ✅
- `get_next_receipt_id()` -> `0x2` (counter incremented) ✅
- `is_policy_hash_used(0x12f6c...)` -> `0x1` (replay protected) ✅

Notes:

- Declaration required Starkli `--casm-hash` override due the known compiled class hash mismatch documented elsewhere in this repo.
- Phase 2 live E2E gate complete: JS sign → on-chain ECDSA verify → receipt issued → verify_receipt confirmed.