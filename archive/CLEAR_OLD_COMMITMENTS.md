# Clear Old Full Privacy Pool Commitments

The backend merkle tree was reset to fix the sync issue. Old commitments in browser localStorage are now invalid and will fail with "Assert Failed" errors.

## Clear Old Data

Open browser console (F12) on zkde.fi and run:

```javascript
// Get your wallet address first
const address = "YOUR_WALLET_ADDRESS_HERE"; // e.g., "0x05fe81..."

// Clear old Full Privacy Pool commitments
localStorage.removeItem(`zkdefi_fullprivacy_${address}`);

// Verify it's cleared
console.log("Commitments cleared:", localStorage.getItem(`zkdefi_fullprivacy_${address}`));

// Reload the page
location.reload();
```

## Why This Is Needed

- Backend merkle tree was reset (now 0 leaves, empty root)
- Old commitments have merkle proofs from the OLD tree state
- Circuit fails because merkle proof doesn't verify against current root
- Fresh deposits will work correctly

## Test Fresh Deposit

After clearing:
1. Generate new commitment
2. Confirm deposit (wallet will popup)
3. After confirmation, commitment will be registered in NEW merkle tree
4. Withdrawal will work with the NEW merkle proof
