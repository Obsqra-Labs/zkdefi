Session Key Execution (Design Stub)
===================================

Goal: enable non-custodial, delegated execution for `/portfolio` without storing user private keys.

Scope
-----
1. Wallet signs a session key (short-lived) with a strict policy:
   - allowed assets and routes
   - max value per action
   - expiry block / timestamp
   - max swaps per rebalance
2. Server stores the session key + policy hash.
3. Execution gate verifies the policy before using the session key.

Security Requirements
---------------------
1. Expiry must be enforced server-side and on-chain.
2. Policy hash must be bound to the session key signature.
3. Revocation endpoint for immediate key invalidation.
4. Rate limits by wallet and key ID.

MVP Implementation Steps
------------------------
1. API endpoints (implemented):
   - `POST /api/v1/zkdefi/session_keys` (register)
   - `GET /api/v1/zkdefi/session_keys/{address}` (list)
   - `DELETE /api/v1/zkdefi/session_keys/{key_id}` (revoke)
2. Storage in SQLite (implemented).
3. Update execution gate to accept `session_key_id` and use it only when:
   - policy hash matches
   - key unexpired and not revoked
4. Add frontend flow:
   - "Create session key" modal
   - show remaining time and policy bounds
   - "Revoke now" action

Notes
-----
This is intentionally a design stub. Implementation should wait until mainnet v1
swap/rebalance flow is stable and receipts are validated end-to-end.

Current State
-------------
1. Session keys can be registered, listed, and revoked.
2. Execution gate will block if `session_key_id` is supplied and invalid.
3. Session keys are not yet used to sign or submit transactions server-side.
