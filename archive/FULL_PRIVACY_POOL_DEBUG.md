# Full Privacy Pool - No Wallet Signature Issue

## Problem

User reports that Full Privacy Pool deposit/withdraw complete successfully WITHOUT wallet signature popup, while Shielded Pool works correctly and prompts for signature.

## Code Analysis

Both use **IDENTICAL patterns**:

**ShieldedPoolPanel (WORKS - prompts for signature):**
```typescript
const result = await account.execute([
  { contractAddress: ETH_TOKEN, entrypoint: "approve", calldata: [...] },
  { contractAddress: SHIELDED_POOL_ADDRESS, entrypoint: "private_deposit", calldata: [...] }
]);
```

**FullPrivacyPoolPanel (NO PROMPT - completes without signature):**
```typescript
const result = await account.execute([
  { contractAddress: ETH_TOKEN_ADDRESS, entrypoint: "approve", calldata: [...] },
  { contractAddress: FULLY_SHIELDED_POOL_ADDRESS, entrypoint: "deposit", calldata: [...] }
]);
```

Same pattern, same `account.execute`, same multicall structure. Should both prompt.

## Investigation Steps

### 1. Check Browser Console

Open browser devtools (F12) → Console tab, then try the deposit flow. Look for:

```
=== FULL PRIVACY POOL DEPOSIT ===
About to call account.execute - wallet signature should appear...
Pool address: 0x...
Commitment: 0x...
```

If you see `Transaction submitted: 0x...` immediately after without wallet popup → something is auto-signing.

### 2. Check Transaction Hash

When "deposit completes", click "View on explorer" link. Check:

- **If transaction exists on Starkscan** → wallet DID sign (maybe auto-approved by wallet settings)
- **If transaction NOT found** → fake txHash was set, no real transaction happened

### 3. Check FULLY_SHIELDED_POOL_ADDRESS

In browser console:

```javascript
console.log(process.env.NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS);
```

- If **undefined** → early return triggered at line 97/201, but UI continued (bug)
- If **valid address** → contract address is configured

### 4. Check account object

```javascript
console.log(account);
```

- Should show `{ address: "0x...", execute: [Function], ... }`
- If `account` is undefined or missing `execute` → would fail before reaching account.execute

## Possible Root Causes

### A. Wallet Auto-Approve Enabled

**ArgentX/Braavos** might have "trusted sites" or "auto-approve" for:
- localhost
- Known contracts
- Previously approved multicalls

**Fix:** Check wallet settings → Disable auto-approve or remove zkde.fi from trusted sites

### B. Early Return Bug

If `FULLY_SHIELDED_POOL_ADDRESS` is undefined but the check isn't working:

```typescript
if (!FULLY_SHIELDED_POOL_ADDRESS) return; // Line 97
// But UI continues anyway?
```

This would skip `account.execute` entirely and go straight to `saveCommitment` via the backend `register_commitment` call.

**Test:** Add `console.log` before the early return to see if it's being hit.

### C. Backend Auto-Executing

Unlikely, but check if backend has any logic that submits transactions on behalf of users. Search backend for:

```bash
cd backend
grep -r "account\|execute\|submit.*transaction" --include="*.py"
```

### D. Error Swallowing

If `account.execute` throws but the catch block doesn't handle it properly:

```typescript
try {
  const result = await account.execute([...]);
  // ^^ if this throws...
  setTxHash(result.transaction_hash); // this line never runs
  // but somehow execution continues?
} catch (e) {
  // Should show error toast and return to step 3
}
```

## Diagnostic Test

Add this at the very start of `handleDeposit`:

```typescript
const handleDeposit = async () => {
  console.log("handleDeposit called");
  console.log("account:", account);
  console.log("commitmentData:", commitmentData);
  console.log("FULLY_SHIELDED_POOL_ADDRESS:", FULLY_SHIELDED_POOL_ADDRESS);
  
  if (!account || !commitmentData || !FULLY_SHIELDED_POOL_ADDRESS) {
    console.log("Early return triggered");
    return;
  }
  
  console.log("Calling account.execute...");
  // ... rest of code
}
```

Then test and share console output.

## Expected vs Actual

**Expected:**
1. Click "Confirm Deposit"
2. Console: "About to call account.execute..."
3. **Wallet popup appears** ← SHOULD HAPPEN
4. User approves in wallet
5. Console: "Transaction submitted: 0x..."
6. Success toast with explorer link

**Actual (per user):**
1. Click "Confirm Deposit"
2. No wallet popup
3. Success toast appears
4. Commitment saved to localStorage

This suggests either:
- `account.execute` is being skipped (early return bug)
- `account.execute` is auto-approving (wallet settings)
- Transaction isn't actually happening (fake success)

## Next Steps

1. **Run the diagnostic test above** - add console logs and share output
2. **Check the transaction hash** - does it exist on Starkscan?
3. **Compare with ShieldedPoolPanel** - why does that one prompt but this doesn't?
4. **Check wallet settings** - disable any auto-approve features

Share the console output and we can pinpoint the exact issue.
