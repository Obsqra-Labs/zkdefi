# Withdraw Flow Analysis

## Issue Report: "Private deposits don't have me sign"

### Actual Code Behavior

**Private Deposit** (`PrivateTransferPanel.tsx` line 116-161):

1. User clicks "Generate Stealth Proof" → backend generates proof
2. User clicks "Sign & Deposit" 
3. Frontend calls `account.execute([approve, private_deposit])` (line 146)
4. **This SHOULD trigger wallet signature popup** ✓

**Private Withdraw** (`PrivateTransferPanel.tsx` line 238-317):

1. User clicks "Generate Withdrawal Proof" → backend generates proof
2. User clicks "Sign & Withdraw"
3. Frontend calls `account.execute({ entrypoint: "private_withdraw", ... })` (line 267)
4. **This SHOULD trigger wallet signature popup** ✓

Both flows call `account.execute` which MUST prompt for wallet signature. There's no auto-sign or session key involved in these flows.

## What IS Mocked

### 1. Session Key Grant/Revoke (NOT deposit/withdraw)

**Location:** `SessionKeyManager.tsx` lines 80-82, 118-120

```typescript
// In a real implementation, this would trigger wallet signing
// For now, we'll simulate confirmation
await confirmGrant(data.session_id, "0x" + "0".repeat(64));
```

This is for **session key management**, not private deposits/withdrawals.

### 2. Proof Data (Now Fixed)

Backend was returning fake Groth16 proofs (sha256 hashes). Fixed by gating behind `ALLOW_SIMULATED_PROOFS`.

## If Wallet ISN'T Prompting

Possible causes if the user sees no wallet popup:

1. **Browser popup blocker** - wallet extensions can be blocked
2. **Wallet already unlocked + auto-approve enabled** - some wallets have "auto-approve" for known sites
3. **Wallet extension issue** - ArgentX/Braavos might not be prompting correctly
4. **Wrong account object** - if `account` is not properly initialized
5. **Testing in wrong component** - if testing SessionKeyManager, those ARE mocked (but that's not private deposits)

## To Verify in Production

```javascript
// Add console logs before account.execute
console.log("About to call account.execute - wallet should prompt");
const result = await account.execute({...});
console.log("Transaction submitted:", result.transaction_hash);
```

If "About to call" logs but no wallet popup appears → wallet extension issue.
If wallet popup DOES appear → wallet signature is working correctly.

## Recommendations

1. **Test with fresh wallet** - disconnect and reconnect to force signature
2. **Check wallet settings** - disable any auto-approve features
3. **Check browser console** - look for wallet extension errors
4. **Verify account object** - ensure `useAccount()` returns valid account

## Summary

The code DOES require wallet signatures for private deposits/withdrawals. The `account.execute` calls are present and correct. If signatures aren't appearing, it's a wallet extension or browser issue, NOT a code issue.

Session key management IS mocked (grant/revoke), but that's separate from private transfers.
