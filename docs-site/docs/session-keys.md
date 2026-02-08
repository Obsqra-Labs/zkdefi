# Session Keys

zkde.fi uses Starknet's native account abstraction for session keys, enabling autonomous agent execution within user-defined constraints.

## Overview

Session keys provide:
- **Delegation** - Agent can act on your behalf
- **Constraints** - Limited by max position, protocols, duration
- **Proof requirement** - Still needs valid proofs to execute
- **Revocation** - Cancel anytime

## Session Key Structure

```cairo
struct SessionConfig {
    session_key: ContractAddress,     // Public key for session
    owner: ContractAddress,           // Account owner
    max_position: u256,               // Max position size allowed
    allowed_protocols: u8,            // Bitmap of allowed protocols
    expiry: u64,                      // Unix timestamp expiry
    is_active: bool,
    created_at: u64,
}
```

### Protocol Bitmap

| Bit | Protocol |
|-----|----------|
| 0 (1) | Pools |
| 1 (2) | Ekubo |
| 2 (4) | JediSwap |

Example: `allowed_protocols = 6` means Ekubo (2) + JediSwap (4).

## Grant Session Key

### API Endpoint

```bash
POST /api/v1/zkdefi/session_keys/grant
```

**Request:**
```json
{
  "owner_address": "0x...",
  "session_key_address": "0x...",
  "max_position": 10000,
  "allowed_protocols": ["pools", "ekubo", "jediswap"],
  "duration_hours": 24
}
```

**Response:**
```json
{
  "session_id": "0x...",
  "calldata": {
    "session_key": "0x...",
    "max_position": "10000",
    "allowed_protocols": 7,
    "duration_seconds": 86400
  },
  "contract_address": "0x...",
  "entrypoint": "grant_session"
}
```

### Contract Call

The frontend uses the calldata to construct a transaction:

```javascript
await wallet.invoke({
  contractAddress: response.contract_address,
  entrypoint: "grant_session",
  calldata: [
    response.calldata.session_key,
    response.calldata.max_position,
    response.calldata.allowed_protocols,
    response.calldata.duration_seconds
  ]
});
```

## Revoke Session Key

### API Endpoint

```bash
POST /api/v1/zkdefi/session_keys/revoke
```

**Request:**
```json
{
  "session_id": "0x...",
  "owner_address": "0x..."
}
```

## List Active Sessions

### API Endpoint

```bash
GET /api/v1/zkdefi/session_keys/list/{owner_address}
```

**Response:**
```json
{
  "owner_address": "0x...",
  "sessions": [
    {
      "session_id": "0x...",
      "session_key": "0x...",
      "max_position": 10000,
      "allowed_protocols": ["pools", "ekubo"],
      "duration_hours": 24,
      "expires_at": "2026-02-03T12:00:00Z",
      "is_active": true,
      "is_expired": false
    }
  ],
  "count": 1,
  "active_count": 1
}
```

## Validate Session

Before executing, the agent validates the session:

### API Endpoint

```bash
POST /api/v1/zkdefi/session_keys/validate
```

**Request:**
```json
{
  "session_id": "0x...",
  "protocol_id": 1,
  "amount": 5000
}
```

**Response:**
```json
{
  "is_valid": true,
  "session_id": "0x...",
  "protocol_name": "ekubo",
  "amount": 5000,
  "remaining_time_seconds": 43200
}
```

## Session + Proof Execution

The `SessionKeyManager` contract validates both session AND proof:

```cairo
fn validate_session_with_proof(
    session_id: felt252,
    proof_hash: felt252,
    protocol_id: u8,
    amount: u256
) -> bool {
    // Check session is active
    // Check session not expired
    // Check protocol allowed
    // Check amount within limit
    // Verify proof via Integrity
    ...
}
```

## Security Considerations

1. **Max Position Limit** - Limits damage per action
2. **Protocol Whitelist** - Only approved protocols
3. **Time Expiry** - Session automatically expires
4. **Proof Requirement** - Valid proof needed for execution
5. **Revocation** - Cancel anytime by owner

## Frontend Component

Use the `SessionKeyManager` component:

```tsx
import { SessionKeyManager } from "@/components/zkdefi/SessionKeyManager";

<SessionKeyManager 
  userAddress={address}
  onSessionGranted={(sessionId) => console.log("Granted:", sessionId)}
/>
```
