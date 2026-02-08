# First update (obsqra-labs/zkdefi)

This release restores the Full Privacy Pool deposit and withdrawal flow on Starknet Sepolia and prepares the repo for a clean first push.

## Summary

- **Full Privacy Pool:** Deposit and withdraw work end-to-end. The root cause of "Unknown merkle root" (contract `u256_to_felt` hashing bug) was fixed; new MerkleTree and FullyShieldedPool were deployed; backend and frontend were pointed at the new contracts.
- **UI:** Success step after deposit/withdraw now shows links to Starkscan and Voyager so users can confirm transactions on-chain. The commitments list (withdraw tab) updates correctly after a new deposit.
- **Repo:** CHANGELOG added; one-off status/fix markdown files moved to `archive/` (archive is gitignored). No secrets or API keys in tracked files.

## What to do after clone

1. Copy `backend/.env.example` to `backend/.env` and set contract addresses and RPC (see `docs/ENV.md`). Do not commit `.env`.
2. Copy `frontend/.env.example` to `frontend/.env.local` (or `.env.production.local`) and set `NEXT_PUBLIC_*` vars. Do not commit env files with secrets.
3. Install backend deps (`pip install -r backend/requirements.txt` or equivalent) and frontend deps (`npm install` in `frontend/`).
4. Run backend (e.g. `uvicorn app.main:app` from `backend/`) and frontend (`npm run dev` from `frontend/`).

## Contracts (Starknet Sepolia)

- MerkleTree: `0x03659ca95ebe890741ca68dd84945716ca9e40baa6650d81f977466726370947`
- FullyShieldedPool: `0x07fed6973cfc23b031c0476885ec87a401f1006bdc8ba58df2bd8611b38b5ff5`

See `CHANGELOG.md` and `docs/DEV_LOG.md` for the u256_to_felt fix and deployment details.

## Verifying on-chain privacy

After a deposit or withdrawal, open the transaction on Starkscan or Voyager (links are shown on the success step). Confirm:

- **Deposit:** The transaction shows the pool call (e.g. `deposit_u256`) and commitment as u256 (low/high). The depositor address is visible (wallet signed). Balance and pool type are encoded in the commitment and are not readable on-chain.
- **Withdraw:** The transaction shows nullifier, root (u256), recipient, amount, and proof calldata. The specific commitment being spent is not revealed; only that the proof verifies against a known root and the nullifier is unused.
