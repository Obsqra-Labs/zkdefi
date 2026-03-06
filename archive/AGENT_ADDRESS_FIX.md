# Proof-Gated Agent Address Fix

## Problem

User tried to deposit to pools after generating a proof but got error:
```
"Proof gating agent address not configured"
```

Despite having an active session, the transaction was blocked.

---

## Root Cause

Frontend was missing `NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS` environment variable.

**In `ProtocolPanel.tsx`:**
```typescript
const AGENT_ADDRESS = process.env.NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS || "";

// Error check:
toastError(AGENT_ADDRESS ? "Connect wallet to sign." : "Proof-gated agent address not configured.");
```

The backend had the address, but the frontend didn't, so the UI blocked the transaction.

---

## The Fix

**Added to `frontend/.env.local`:**
```bash
NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS=0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3
```

This is the **ProofGatedYieldAgent** contract that handles:
- Proof-gated deposits
- Constraint verification
- Session key delegation
- Position management

---

## Complete Frontend Configuration

```bash
NEXT_PUBLIC_API_URL=https://zkde.fi
NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS=0x04b1265fa18e6873899a4f3ff15cfa0348b7bdf3ccb66bc658d0045ac61dfc0c
NEXT_PUBLIC_GARAGA_VERIFIER_ADDRESS=0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37
NEXT_PUBLIC_ERC20_TOKEN_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS=0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3
```

---

## Status

✅ **FIXED** - Frontend rebuilt and restarted with agent address configured

---

## Test Now

**Refresh the page:** https://zkde.fi/agent

Try the proof-gated pool deposit again:
1. Click "Proof-Gated Deposit" button
2. Enter amount
3. Generate proof
4. Sign transaction

Should work now! The error should be gone. ✅

---

## What This Feature Does

The **Proof-Gated Agent** enables:

### 1. Constraint-Based Deposits
```cairo
deposit_with_constraints(
  amount,
  max_position,
  max_daily_yield,
  min_withdraw_delay
)
```

### 2. Proof Verification
Before deposit executes:
- Verify constraints are met
- Check proof validity
- Register on-chain receipt

### 3. Session Keys
- Delegate actions to agent
- Time-limited permissions
- Revocable access

### 4. Private Execution
- Agent calculates optimal allocation
- Proofs hide strategy details
- On-chain verification only

---

## Architecture

```
User → ProofGatedAgent
  ↓
Constraint Check (on-chain)
  ↓
Integrity Proof Verification
  ↓
Deposit to Protocol
  ↓
Session Key Grant (optional)
  ↓
Agent can rebalance within constraints
```

---

## Related Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| ProofGatedAgent | `0x012ebbd...` | Main agent logic |
| ConfidentialTransfer | `0x04b1265...` | Private transfers |
| GaragaVerifier | `0x06d0cb7...` | Groth16 verification |
| ERC20 Token | `0x04718f5...` | STRK testnet |

---

## Files Changed

- `frontend/.env.local` - Added `NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS`
- Frontend rebuilt and restarted

---

**Ready to test proof-gated deposits!** 🎯
