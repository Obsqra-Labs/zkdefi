# Clear Browser Cache - AGGRESSIVE FIX

You're still calling OLD contract because browser cached JavaScript.

## SOLUTION 1: Clear localStorage + Hard Refresh

Open browser console (F12) and run:
```javascript
// Clear ALL zkde.fi data
localStorage.clear();
sessionStorage.clear();
location.reload(true);
```

Then **HARD REFRESH**:
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`

## SOLUTION 2: Clear Browser Cache Completely

### Chrome/Edge
1. Press `Ctrl + Shift + Delete` (Windows) or `Cmd + Shift + Delete` (Mac)
2. Select "Cached images and files"
3. Time range: "All time"
4. Click "Clear data"
5. Close ALL tabs with zkde.fi
6. Reopen https://zkde.fi

### Firefox
1. Press `Ctrl + Shift + Delete` (Windows) or `Cmd + Shift + Delete` (Mac)
2. Select "Cache"
3. Time range: "Everything"
4. Click "Clear Now"
5. Close ALL tabs with zkde.fi
6. Reopen https://zkde.fi

### Safari
1. Safari → Preferences → Privacy
2. Click "Manage Website Data"
3. Find zkde.fi and click "Remove"
4. Or click "Remove All"
5. Close ALL tabs with zkde.fi
6. Reopen https://zkde.fi

## SOLUTION 3: Incognito/Private Mode (EASIEST)

1. Open NEW incognito/private window
2. Go to https://zkde.fi
3. Connect wallet
4. Try deposit

## VERIFY IT WORKED

After clearing cache, open Console (F12) and check:

```javascript
// Should show NEW address
console.log(process.env.NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS);
// ✅ Should be: 0x04b1265fa18e6873899a4f3ff15cfa0348b7bdf3ccb66bc658d0045ac61dfc0c

// NOT OLD address:
// ❌ Should NOT be: 0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
```

## ABOUT YOUR OLD DEPOSITS

**Q: Do I need to clear deposits from old contract?**

**A: No, but you can't use them with the NEW contract.**

Your old deposits are on the OLD contract (`0x05fe8...`). They're stuck there unless you deploy a recovery script. 

For now: **Start fresh with NEW contract**

1. Clear browser cache (above)
2. Make NEW deposit to NEW contract
3. Test withdrawal from NEW contract

---

**If this STILL doesn't work after all 3 solutions:**

The nuclear option is to **rebuild and restart with a cache-busting version**:

```bash
cd /opt/obsqra.starknet/zkdefi/frontend
# Add version to force cache invalidation
echo "NEXT_PUBLIC_VERSION=$(date +%s)" >> .env.local
npm run build
npm run start
```

Then access: `https://zkde.fi?v=$(date +%s)`
