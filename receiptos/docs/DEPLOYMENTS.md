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

Verification reads:

- `get_attester_pubkey()` -> `0x002f8ffcb446d2a062ef18561eb507b08ea01d52d4c594e90cfca47f075cb952`
- `get_admin()` -> `0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d`

Notes:

- Declaration required Starkli `--casm-hash` override due the known compiled class hash mismatch documented elsewhere in this repo.
- Remaining live gate for Phase 2: submit `issue_attested_receipt` on Sepolia and confirm `verify_receipt` end-to-end with a real transaction.