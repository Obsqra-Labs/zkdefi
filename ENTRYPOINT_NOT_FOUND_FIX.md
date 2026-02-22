# Fix: ENTRYPOINT_NOT_FOUND Error

## Problem

When trying to create a position, you got this error:

```
Transaction execution has failed:
Error in contract (contract address: 0x04ce7851f00b6c3289674841fd7a1b96b6fd41ed1edc248faccd672c26371b8c, ...):
0x454e545259504f494e545f4e4f545f464f554e44 ('ENTRYPOINT_NOT_FOUND').
```

This means the backend API was trying to call a function that **doesn't exist** on the deployed contract.

## Root Cause

The backend was calling:
- ❌ `create_position()` 
- ❌ `create_lp_position()`
- ❌ `create_lp_position_with_proofs()`
- ❌ `mint()`

But the deployed **ProofGatedYieldAgent** contract actually has:
- ✅ `deposit_with_proof()` — The correct function

## Solution

### Updated Endpoints

**OLD (broken):**
```
POST /api/v1/phase4a/lp-position/create
```

**NEW (correct):**
```
POST /api/v1/phase4a/deposit/with-proof
```

### Correct Call Format

```json
{
  "user_address": "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
  "position_size": 100,
  "garaga_proof": "0x1234567890abcdef"
}
```

Returns:
```json
{
  "status": "ready",
  "contract": "ProofGatedYieldAgent",
  "contract_address": "0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3",
  "function": "deposit_with_proof",
  "parameters": {
    "protocol_id": 1,
    "amount": "100000000000000000000",
    "proof_hash": "0x1234567890abcdef"
  }
}
```

## Contract Functions Available

Check available functions:
```bash
curl http://localhost:8003/api/v1/phase4a/functions
```

**Available:**
| Function | Description |
|----------|-------------|
| `deposit_with_proof(protocol_id, amount, proof_hash)` | Deposit with ZK proof |
| `get_position(user, protocol_id)` | Query position |
| `get_constraints(user)` | Query constraints |

**NOT available (removed from v1):**
| Function |
|----------|
| `create_position()` |
| `create_lp_position()` |
| `mint()` |
| `create_lp_position_with_proofs()` |

## Protocol IDs

When calling `deposit_with_proof()`, use:

```
protocol_id = 0  → Pools
protocol_id = 1  → Ekubo 
protocol_id = 2  → JediSwap
```

## Next Steps

1. **Use new endpoint:** `POST /api/v1/phase4a/deposit/with-proof`
2. **Get proof from backend:** Call `POST /api/v1/zkdefi/deposit` to get proof_hash
3. **Call contract:** Your wallet calls `deposit_with_proof(protocol_id, amount, proof_hash)`
4. **Verify proof:** Contract checks Integrity registry
5. **Update ledger:** Tokens move from you → ProofGatedYieldAgent contract

## Contract Details

- **Name:** ProofGatedYieldAgent (deployed)
- **Address:** `0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3`
- **Network:** Starknet Sepolia
- **View on Starkscan:** https://sepolia.starkscan.io/contract/0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3

## Files Changed

- `backend/app/api/routes/phase4a.py`:
  - Updated `/lp-position/create` → `/deposit/with-proof`
  - Added `/functions` endpoint showing available functions
  - Corrected function name from `create_position` → `deposit_with_proof`

---

**Status:** ✅ **FIXED** - Server restarted with corrected endpoints
