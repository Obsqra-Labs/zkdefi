# ReceiptOS v0.1

ReceiptOS is an isolated pilot inside the main `zkdefi` repository.

Scope for v0.1:
- Six Starknet reputation signals
- Attester policy hash + signature flow
- New Cairo registry contract (`receipt_registry_v01`)
- Passport claim surface for Sepolia pilot

Out of scope for v0.1:
- L3/Madara features
- zkML/Garaga integration
- Global score or percentile ranking
- Multi-chain expansion

## Layout

- `indexer/`: TypeScript Starknet indexer for vector computation
- `attester/`: policy hash + signer + submission logic
- `contracts/receipt_registry_v01/`: Cairo 2.15 receipt registry
- `passport/`: frontend surface for vector + claim flow
- `config/`: verified addresses, selectors, and class hashes
- `docs/`: execution checklists, blockers, and pilot notes
- `integration/`: package for external protocol integrations

## Working Rules

- Gate-driven execution only: no step proceeds without gate pass.
- Mainnet facts first: verify address + selector + sample tx before coding signal logic.
- Keep this project isolated from existing `backend/` and `frontend/` until Sepolia E2E passes.
