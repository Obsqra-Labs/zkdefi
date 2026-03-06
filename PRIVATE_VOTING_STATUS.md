# Private Voting Circuit Status

**Circuit**: `private_vote.circom`  
**Status**: Circuit built (`circuits/build/private_vote_final.zkey` exists)

## Build

- Phase 2 (Powers of Tau) completed successfully for this project.
- `private_vote_final.zkey` present as of 2026-03-05.

## API

- **DAO proposal creation**: `POST /api/v1/dao/proposals` — working (currently mock response; on-chain integration TODO).
- **DAO voting**: `POST /api/v1/dao/vote/generate_proof` — generates vote proof; cast via `cast_vote_with_proof` when wired to DAOConstraintManager.
- **Emergency controls**: `emergency_pause` / `emergency_unpause` on DAOConstraintManager — no ZK required.

## Integration

- DAOConstraintManager deployed (Phase 10): `0x0101bd9710017c0870077dcf03bf6fe68a955d9f9b9922ed5d673afed7497fc2`
- Full on-chain proposal creation and vote recording still TODO in backend (see `dao_governance.py`).
