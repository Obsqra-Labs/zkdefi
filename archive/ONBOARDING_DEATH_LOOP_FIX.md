# Onboarding Death Loop Fix

## The Bug

After the "Generate Proofs" button completed successfully at Step 5 (Authorize), the UI would stay on Step 5 instead of advancing to Step 6 (Fund). This created an endless loop where:

1. User at Step 5 clicks "Generate Proofs"
2. Proof generates successfully in ~1.5s
3. Success toast shows "Authorization configured"
4. **But UI stays on Step 5**
5. User sees "Generate Proofs" button again
6. User clicks it again thinking it didn't work
7. Loop repeats endlessly

## Root Cause

**File**: `frontend/src/components/zkdefi/OnboardingWizard.tsx`  
**Line 127** (in `generateMasterProof` function)

```typescript
// WRONG - We're already at step 5!
setStep(5); 
```

The function was setting step to 5, but the user was already ON step 5. It should advance to step 6.

## The Fix

Changed line 127 from:
```typescript
setStep(5); // Stay on current step (WRONG!)
```

To:
```typescript
setStep(6); // Move to next step - Fund Your Agent
```

## Code Context

```typescript
const generateMasterProof = async () => {
  if (!address) return;
  setIsLoading(true);
  setProofState("generating");
  
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  const demoProofHash = "0x" + Array.from({ length: 64 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  
  setProofHashes([demoProofHash]);
  setProofState("valid");
  toastSuccess("Authorization configured");
  setStep(6); // ✅ FIXED - Now advances to Fund step
  setIsLoading(false);
};
```

## Flow After Fix

| Step | Action | Next Step |
|------|--------|-----------|
| 1. Connect | User connects wallet | → Step 2 |
| 2. Risk Disclosure | User signs disclosure | → Step 3 |
| 3. Configure | User sets constraints | → Step 4 |
| 4. Claims | User selects claims | → Step 5 |
| 5. Authorize | **Click "Generate Proofs"** | **→ Step 6** ✅ |
| 6. Fund | User can deposit (demo) | → Step 7 |
| 7. Complete | Onboarding done | → Dashboard |

## Why This Happened

Copy-paste error or typo. The original code probably had a backend API call that would advance to step 5 after generating proofs. When we replaced it with the client-side simulation, we should have changed `setStep(5)` to `setStep(6)` but didn't.

## Testing

1. Clear localStorage:
   ```javascript
   localStorage.clear();
   location.reload();
   ```

2. Go through onboarding:
   - Steps 1-4: Work as expected
   - **Step 5**: Click "Generate Proofs"
   - ✅ After ~1.5s, should automatically advance to Step 6
   - ✅ No more endless loop
   - ✅ Can complete onboarding to Step 7

---

**Status**: ✅ Fixed  
**Date**: Feb 4, 2026  
**Deployed**: Yes (zkde.fi)  
**Root Cause**: Off-by-one step number in `setStep()` call
