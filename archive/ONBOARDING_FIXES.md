# Onboarding Flow Fixes

## Issues Fixed

### 1. Chain ID Mismatch Error
**Error**: `Cannot sign the message from a different chainId. Expected 0x534e5f5345504f4c4941, got 0x333933343032313333303235393937373938303030393631`

**Root Cause**: The OnboardingWizard was converting `chain.id` to a string using `String(chain.id)`, which converted the chain ID to decimal notation instead of hex format.

**Fix**: Always use the default `constants.StarknetChainId.SN_SEPOLIA` from starknet.js instead of reading from the wallet's chain object.

**Files Changed**:
- `frontend/src/components/zkdefi/OnboardingWizard.tsx` (line 83)
  - Changed from: `const chainIdHex = chain?.id ? String(chain.id) : undefined;`
  - Changed to: Always use default (SN_SEPOLIA) from buildRiskDisclosureTypedData()

### 2. Risk Disclosure Appearing Before Onboarding
**Issue**: The risk disclosure modal was showing immediately on page load, before wallet connection or onboarding.

**Root Cause**: `RiskDisclosure` component in `layout.tsx` was checking `localStorage.getItem("risk-acknowledged")` and showing modal if not set.

**Fix**: Disabled the standalone risk disclosure modal. Risk disclosure is now only shown as Step 2 in the OnboardingWizard, where it's properly signed and stored.

**Files Changed**:
- `frontend/src/components/RiskDisclosure.tsx`
  - Component kept for backwards compatibility but `setShowModal(false)` always
  - Risk disclosure now only happens in onboarding wizard

## New Flow

1. **Landing page** → No risk modal popup
2. **Connect wallet** (Step 1)
3. **Sign risk disclosure** (Step 2) → TypedData signature stored
4. **Configure constraints** (Step 3)
5. **Select claims** (Step 4)
6. **Authorize session** (Step 5)
7. **Fund account** (Step 6)
8. **Complete** (Step 7)

## Benefits

✅ **Single signature** - Risk disclosure signed once during onboarding
✅ **No chain ID errors** - Uses correct SN_SEPOLIA constant
✅ **Better UX** - No popup before wallet connection
✅ **Stored in localStorage** - Signature persists, onboarding skipped on return

## Testing

1. Clear localStorage:
   ```javascript
   localStorage.clear();
   location.reload();
   ```

2. Visit zkde.fi
3. Should NOT see risk disclosure modal
4. Click "Launch App"
5. Connect wallet (Step 1)
6. Sign risk disclosure (Step 2) → Should work without chain ID error
7. Complete remaining steps

---

**Status**: ✅ Fixed
**Date**: Feb 4, 2026
**Deployed**: Yes (zkde.fi)
