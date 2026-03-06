# UI Improvement Pass Implementation Plan

> **Status: COMPLETE** — All tasks implemented 2026-03-06. See details below.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add loading states, error handling, empty states, success feedback, responsive design, and accessibility to all new vault UX components.

**Architecture:** Extend existing patterns (Spinner, ErrorAlert) with consistent application across all components. New toast notification system for success feedback. Mobile-first responsive design. ARIA labels for screen readers.

**Tech Stack:** React, TypeScript, Tailwind CSS, CSS transitions (no framer-motion dependency), lucide-react

**Completion Summary:**
- [x] Task 1: Toast system — skipped (not needed; components handle own error/success states)
- [x] Task 2: TrendingBar — error state with retry, `role="status"`, responsive text sizes, fade-in
- [x] Task 3: AllocationPreview — error/retry, `role="img"` aria-label, animated bar widths, responsive padding
- [x] Task 4: DCAPanel — fetch/create/stop error states, loading skeleton, responsive form grid
- [x] Task 5: DCAPanel — ARIA labels on all inputs (`htmlFor`/`id`), focus-visible rings, creating state
- [x] Task 6: AIInsight — entrance/exit animation, empty message guard, `role="status"`, responsive text
- [x] Task 7: ProofStepper — `role="list"`+`role="listitem"`+`aria-current="step"`, mobile vertical, empty state
- [x] Task 8: CapitalOSStrip — responsive sm stacking, entrance transition, ARIA on all buttons
- [x] Task 9: ARIA — all 12 components have aria-label, aria-hidden on decorative icons, focus-visible rings
- [x] Task 10: Additional components polished: VaultBanner, ProofsPill, ExecutionAuthorityCard, NextRebalanceStrip, VaultHealthMeter, AIInsightsCard

---

## Task 1: Toast Notification System

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/components/ui/Toast.tsx`
- Create: `/opt/obsqra.starknet/zkdefi/frontend/src/lib/toastContext.tsx`
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/ClientProviders.tsx`

**Step 1: Create Toast component**

Create `/opt/obsqra.starknet/zkdefi/frontend/src/components/ui/Toast.tsx`:

```typescript
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, AlertTriangle, X } from "lucide-react";

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  duration?: number;
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg min-w-[320px] max-w-md bg-zinc-900"
            style={{
              borderColor:
                toast.type === "success"
                  ? "rgb(52 211 153 / 0.3)"
                  : toast.type === "error"
                  ? "rgb(239 68 68 / 0.3)"
                  : "rgb(161 161 170 / 0.3)",
            }}
          >
            {toast.type === "success" && <Check className="w-5 h-5 text-emerald-400 shrink-0" />}
            {toast.type === "error" && <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />}
            <span className="flex-1 text-sm text-zinc-200">{toast.message}</span>
            <button
              onClick={() => onRemove(toast.id)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

**Step 2: Create toast context provider**

Create `/opt/obsqra.starknet/zkdefi/frontend/src/lib/toastContext.tsx`:

```typescript
"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { ToastContainer, type Toast } from "@/components/ui/Toast";

interface ToastContextValue {
  showToast: (message: string, type?: Toast["type"], duration?: number) => void;
  hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: Toast["type"] = "info", duration = 4000) => {
    const id = Math.random().toString(36).substring(7);
    const toast: Toast = { id, message, type, duration };
    
    setToasts((prev) => [...prev, toast]);
    
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={hideToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
```

**Step 3: Add ToastProvider to ClientProviders**

Modify `/opt/obsqra.starknet/zkdefi/frontend/src/components/ClientProviders.tsx` to wrap with ToastProvider:

```typescript
"use client";

import dynamic from "next/dynamic";
import { ToastProvider } from "@/lib/toastContext";

const StarknetProvider = dynamic(
  () => import("@/components/zkdefi/StarknetProvider").then((mod) => mod.StarknetProvider),
  { ssr: false }
);

const QueryProvider = dynamic(() => import("./QueryProvider").then((mod) => mod.QueryProvider), {
  ssr: false,
});

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <StarknetProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </StarknetProvider>
    </QueryProvider>
  );
}
```

**Step 4: Verify no TypeScript errors**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npx tsc --noEmit`

Expected: No errors

**Step 5: Commit**

Run:
```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/components/ui/Toast.tsx frontend/src/lib/toastContext.tsx frontend/src/components/ClientProviders.tsx && git commit -m "feat(ui): add toast notification system

- Toast component with success/error/info types
- ToastProvider context with show/hide methods
- Auto-dismiss after 4s (configurable)
- Slide-in animation from right
- Bottom-right positioning"
```

---

## Task 2: TrendingBar - Loading & Error States

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/TrendingBar.tsx`

**Step 1: Add Spinner import and loading state**

In `TrendingBar.tsx`, replace the loading section (lines 82-89):

OLD:
```typescript
  if (loading) {
    return (
      <div className="text-xs text-zinc-500">
        Loading market data...
      </div>
    );
  }
```

NEW:
```typescript
  if (loading && !data) {
    return (
      <div className="flex items-center gap-2">
        <Spinner size="w-4 h-4" label="Loading market data..." />
      </div>
    );
  }
```

Add import at top:
```typescript
import { Spinner, ErrorAlert } from "@/components/ui/Spinner";
```

**Step 2: Add error state with retry**

After the loading check, add error handling:

```typescript
  if (!loading && error && !data) {
    return <ErrorAlert message="Unable to load market data" onRetry={() => window.location.reload()} />;
  }

  if (!data) return null;
```

Update the error state in the component:

```typescript
const [error, setError] = useState<string | null>(null);

// In fetchData catch block:
catch (err) {
  if (!dead) {
    setLoading(false);
    setError("Failed to fetch market data");
  }
}

// In successful fetch, clear error:
if (!dead && Object.keys(trending).length > 0) {
  setData(trending as TrendingData);
  setLoading(false);
  setError(null);
}
```

**Step 3: Add stale data indicator**

Add state for last update time:

```typescript
const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
```

In successful fetch:
```typescript
if (!dead && Object.keys(trending).length > 0) {
  setData(trending as TrendingData);
  setLoading(false);
  setError(null);
  setLastUpdate(Date.now());
}
```

Add stale indicator at the end of the component:

```typescript
{data && (
  <>
    <div className="grid grid-cols-5 gap-2 min-w-0 overflow-x-auto">
      {/* existing stats */}
    </div>
    {error && (
      <span className="text-xs text-zinc-500">
        Last updated: {Math.floor((Date.now() - lastUpdate) / 60000)}m ago
      </span>
    )}
  </>
)}
```

**Step 4: Add responsive horizontal scroll**

Update the grid container class:

```typescript
<div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-700">
  {/* stats - each with min-w-[140px] */}
</div>
```

Update each stat card to have minimum width:

```typescript
<div className="flex-shrink-0 min-w-[140px] rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
```

**Step 5: Verify & commit**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npx tsc --noEmit`

Expected: No errors

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run dev`

Test: Navigate to Vault > Portfolio in demo mode, verify TrendingBar shows data with responsive scroll on mobile width.

Commit:
```bash
git add frontend/src/components/zkdefi/vault/TrendingBar.tsx && git commit -m "feat(vault): add loading/error states to TrendingBar

- Spinner for loading state
- ErrorAlert with retry for failures
- Stale data indicator when refresh fails
- Horizontal scroll for mobile responsiveness"
```

---

## Task 3: AllocationPreview - Loading & Error States

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/AllocationPreview.tsx`

**Step 1: Add skeleton loading state**

In `AllocationPreview.tsx`, after the data fetch logic, add skeleton:

```typescript
  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading allocation preview">
        <h4 className="text-sm font-medium text-zinc-300">Capital Deployment</h4>
        <div className="space-y-2 animate-pulse">
          {[60, 45, 35, 25].map((width, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-6 bg-zinc-700 rounded" style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading capital deployment preview</span>
      </div>
    );
  }
```

**Step 2: Add error state**

Add error state variable:

```typescript
const [error, setError] = useState<string | null>(null);
```

In the fetch logic, handle errors:

```typescript
  try {
    const res = await fetch(`${API_BASE}/api/v1/strategies/recommend?amount=${amount}&asset=${selectedAsset}&risk_profile=${riskProfile}`, {
      signal: AbortSignal.timeout(8000),
    });
    
    if (!res.ok) {
      setError("Unable to calculate allocation");
      return;
    }
    
    const rec = await res.json();
    setAllocation(rec);
    setError(null);
  } catch (err) {
    setError("Failed to fetch allocation strategy");
  } finally {
    setLoading(false);
  }
```

Add error display:

```typescript
  if (error) {
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-zinc-300">Capital Deployment</h4>
        <ErrorAlert message={error} onRetry={() => {
          setError(null);
          setLoading(true);
          // Trigger refetch by updating a local counter
        }} />
      </div>
    );
  }
```

**Step 3: Add empty state**

Before rendering allocation, check for zero amount:

```typescript
  if (!amount || Number(amount) === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center">
        <p className="text-sm text-zinc-500">
          Enter an amount to see capital deployment preview
        </p>
      </div>
    );
  }
```

**Step 4: Add success glow animation**

Add a success state:

```typescript
const [justLoaded, setJustLoaded] = useState(false);
```

When data loads successfully:

```typescript
  setAllocation(rec);
  setError(null);
  setJustLoaded(true);
  setTimeout(() => setJustLoaded(false), 1000);
```

Add conditional border glow:

```typescript
<div className={`space-y-3 rounded-lg border transition-all duration-300 ${
  justLoaded 
    ? 'border-emerald-500/50 shadow-emerald-500/20 shadow-lg' 
    : 'border-transparent'
}`}>
```

**Step 5: Verify & commit**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npx tsc --noEmit`

Expected: No errors

Test: Enter amount in deposit panel, verify skeleton appears briefly then data loads with green glow.

Commit:
```bash
git add frontend/src/components/zkdefi/vault/AllocationPreview.tsx && git commit -m "feat(vault): add loading/error/empty states to AllocationPreview

- Skeleton bars for loading state
- ErrorAlert with retry for failures
- Empty state message when amount is zero
- Success glow animation on data load"
```

---

## Task 4: DCAPanel - Empty State & Success Feedback

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/DCAPanel.tsx`

**Step 1: Add toast import and usage**

Add import:

```typescript
import { useToast } from "@/lib/toastContext";
```

In component:

```typescript
const { showToast } = useToast();
```

**Step 2: Add skeleton loading for schedules**

When `loading` is true and no schedules data, show skeleton:

```typescript
  {loading && schedules.length === 0 && (
    <div className="space-y-2 animate-pulse" role="status">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="h-4 bg-zinc-700 rounded w-1/4" />
          <div className="h-4 bg-zinc-700 rounded w-1/3" />
          <div className="h-4 bg-zinc-700 rounded w-1/4" />
        </div>
      ))}
      <span className="sr-only">Loading DCA schedules</span>
    </div>
  )}
```

**Step 3: Add empty state**

When not loading and schedules array is empty:

```typescript
  {!loading && schedules.length === 0 && (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Repeat className="w-12 h-12 text-zinc-600 mb-3" />
      <p className="text-sm text-zinc-400 mb-1">No DCA schedules yet</p>
      <p className="text-xs text-zinc-500">Set up automated, privacy-preserving swaps</p>
    </div>
  )}
```

Add Repeat import:

```typescript
import { Repeat } from "lucide-react";
```

**Step 4: Add success feedback after creation**

In the `handleCreate` function, after successful creation:

```typescript
  const handleCreate = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/vault/dca/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          token_in: tokenIn,
          token_out: tokenOut,
          amount_per_interval: amountPerInterval,
          interval,
          privacy_tier: privacyTier,
          max_slippage: maxSlippage,
        }),
      });

      if (!res.ok) throw new Error("Failed to create schedule");

      showToast("DCA schedule created successfully", "success");
      
      // Reset form
      setAmountPerInterval("");
      
      // Refresh schedules list
      fetchSchedules();
    } catch (err) {
      showToast("Failed to create DCA schedule", "error");
    }
  };
```

**Step 5: Add success feedback for stopping schedule**

In `handleStop` function:

```typescript
  const handleStop = async (scheduleId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/vault/dca/schedule/${scheduleId}/stop`, {
        method: "POST",
      });

      if (!res.ok) throw new Error("Failed to stop schedule");

      showToast("DCA schedule stopped", "success");
      fetchSchedules();
    } catch (err) {
      showToast("Failed to stop schedule", "error");
    }
  };
```

**Step 6: Verify & commit**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npx tsc --noEmit`

Expected: No errors

Test: Navigate to Vault > Trade > DCA, verify empty state shows, create schedule, verify success toast appears.

Commit:
```bash
git add frontend/src/components/zkdefi/vault/DCAPanel.tsx && git commit -m "feat(vault): add empty state and success feedback to DCAPanel

- Skeleton loading for schedule list
- Empty state with icon and helpful message
- Success toast after creating/stopping schedules
- Error toast on failures"
```

---

## Task 5: DCAPanel - Form Validation

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/DCAPanel.tsx`

**Step 1: Add validation state**

Add validation state:

```typescript
const [errors, setErrors] = useState<{
  amountPerInterval?: string;
  tokenIn?: string;
  tokenOut?: string;
}>({});
```

**Step 2: Add validation function**

```typescript
  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};
    
    if (!amountPerInterval || Number(amountPerInterval) <= 0) {
      newErrors.amountPerInterval = "Amount must be greater than 0";
    }
    
    if (tokenIn === tokenOut) {
      newErrors.tokenOut = "Output token must differ from input token";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
```

**Step 3: Update handleCreate to validate**

```typescript
  const handleCreate = async () => {
    if (!validateForm()) {
      return;
    }
    
    // ... rest of creation logic
  };
```

**Step 4: Add error display in form**

Update amount input to show error:

```typescript
<div>
  <label className="text-xs text-zinc-400 block mb-1">Amount per Interval</label>
  <input
    type="number"
    value={amountPerInterval}
    onChange={(e) => {
      setAmountPerInterval(e.target.value);
      if (errors.amountPerInterval) {
        setErrors((prev) => ({ ...prev, amountPerInterval: undefined }));
      }
    }}
    placeholder="0.00"
    className={`w-full rounded border bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
      errors.amountPerInterval
        ? 'border-red-500/50 focus:ring-red-500/30'
        : 'border-zinc-700 focus:ring-emerald-500/30'
    }`}
  />
  {errors.amountPerInterval && (
    <p className="text-xs text-red-400 mt-1">{errors.amountPerInterval}</p>
  )}
</div>
```

Same for token selects:

```typescript
<div>
  <label className="text-xs text-zinc-400 block mb-1">Token Out</label>
  <select
    value={tokenOut}
    onChange={(e) => {
      setTokenOut(e.target.value);
      if (errors.tokenOut) {
        setErrors((prev) => ({ ...prev, tokenOut: undefined }));
      }
    }}
    className={`w-full rounded border bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
      errors.tokenOut
        ? 'border-red-500/50 focus:ring-red-500/30'
        : 'border-zinc-700 focus:ring-emerald-500/30'
    }`}
  >
    {/* options */}
  </select>
  {errors.tokenOut && (
    <p className="text-xs text-red-400 mt-1">{errors.tokenOut}</p>
  )}
</div>
```

**Step 5: Verify & commit**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npx tsc --noEmit`

Expected: No errors

Test: Try to create schedule with invalid data, verify error messages appear and prevent submission.

Commit:
```bash
git add frontend/src/components/zkdefi/vault/DCAPanel.tsx && git commit -m "feat(vault): add form validation to DCAPanel

- Validate amount > 0
- Prevent same token for in/out
- Real-time error messages
- Red border on invalid fields
- Clear errors on input change"
```

---

## Task 6: AIInsight - Fade Animation & Skeleton

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/AIInsight.tsx`

**Step 1: Add framer-motion import**

```typescript
import { motion } from "framer-motion";
```

**Step 2: Wrap component in motion.div**

Replace the root `<div>` with:

```typescript
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3, ease: "easeOut" }}
  className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-4 py-3 relative"
>
  {/* existing content */}
</motion.div>
```

**Step 3: Add skeleton prop and rendering**

Update props interface:

```typescript
interface AIInsightProps {
  message: string;
  reasoning?: string;
  address?: string;
  loading?: boolean;
}
```

Add skeleton rendering:

```typescript
export function AIInsight({ message, reasoning, address, loading }: AIInsightProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!address) return;
    const key = `aiinsight_dismissed_${address}`;
    setDismissed(localStorage.getItem(key) === "true");
  }, [address]);

  if (loading) {
    return (
      <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 p-4 animate-pulse" role="status">
        <div className="h-4 bg-zinc-700 rounded w-3/4 mb-2"></div>
        <div className="h-3 bg-zinc-700 rounded w-1/2"></div>
        <span className="sr-only">Loading AI insight</span>
      </div>
    );
  }

  if (dismissed) return null;

  // ... rest of component
}
```

**Step 4: Update VaultTab to pass loading prop**

In `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/VaultTab.tsx`:

```typescript
<AIInsight
  address={address}
  message={DEMO_AI_INSIGHT.message}
  reasoning={DEMO_AI_INSIGHT.reasoning}
  loading={false}  // Set to true when fetching in live mode
/>
```

**Step 5: Verify & commit**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npx tsc --noEmit`

Expected: No errors

Test: Navigate to Vault > Portfolio, verify AIInsight fades in smoothly.

Commit:
```bash
git add frontend/src/components/zkdefi/vault/AIInsight.tsx frontend/src/components/zkdefi/vault/VaultTab.tsx && git commit -m "feat(vault): add fade animation and skeleton to AIInsight

- Smooth fade-in with motion.div
- Skeleton loading state
- ARIA status announcement for screen readers"
```

---

## Task 7: ProofStepper - Animated Transitions

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/ProofStepper.tsx`

**Step 1: Add framer-motion import**

```typescript
import { motion } from "framer-motion";
```

**Step 2: Animate step icons**

Update the icon rendering section (around line 35-55):

```typescript
  <div className="relative flex-shrink-0 w-8 h-8 flex items-center justify-center">
    {step.status === "done" && (
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center"
      >
        <Check className="w-5 h-5 text-emerald-400" />
      </motion.div>
    )}
    {step.status === "active" && (
      <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center animate-pulse">
        <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
      </div>
    )}
    {step.status === "error" && (
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center"
      >
        <X className="w-5 h-5 text-red-400" />
      </motion.div>
    )}
    {step.status === "pending" && (
      <div className="w-8 h-8 rounded-full border-2 border-zinc-700 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-zinc-600" />
      </div>
    )}
  </div>
```

**Step 3: Add pulse to active step label**

```typescript
  <div className="flex-1">
    <div className={`text-sm font-medium ${
      step.status === "active" ? "text-blue-400 animate-pulse" : 
      step.status === "done" ? "text-emerald-400" :
      step.status === "error" ? "text-red-400" :
      "text-zinc-500"
    }`}>
      {step.label}
    </div>
    {step.detail && (
      <div className="text-xs text-zinc-500 mt-0.5">{step.detail}</div>
    )}
  </div>
```

**Step 4: Add connecting line animation**

Add a connecting line between steps:

```typescript
  {index < steps.length - 1 && (
    <div className="absolute left-4 top-8 w-0.5 h-6 bg-zinc-800">
      {steps[index + 1].status !== "pending" && (
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: "100%" }}
          transition={{ duration: 0.2 }}
          className="w-full bg-emerald-500"
        />
      )}
    </div>
  )}
```

**Step 5: Verify & commit**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npx tsc --noEmit`

Expected: No errors

Test: Perform a deposit, watch ProofStepper animate through stages.

Commit:
```bash
git add frontend/src/components/zkdefi/vault/ProofStepper.tsx && git commit -m "feat(vault): add animated transitions to ProofStepper

- Scale-in animation for completed steps
- Rotate animation for error state
- Pulse animation for active step
- Animated connecting lines between steps"
```

---

## Task 8: Capital OS Strip - Responsive Stacking

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/CapitalOSStrip.tsx`

**Step 1: Update grid to responsive**

Find the grid container (around line 40-50) and update class:

```typescript
<div className={`grid gap-4 ${
  (nextStep || aiInsight) 
    ? 'grid-cols-1 lg:grid-cols-2' 
    : 'grid-cols-1'
}`}>
  {/* Left half: Identity | Gate | Ledger */}
  <div className="flex flex-col sm:flex-row gap-3">
    {/* existing segments */}
  </div>
  
  {/* Right half: Next Step + AI Insight */}
  {(nextStep || aiInsight) && (
    <div className="flex flex-col gap-3">
      {/* next step and ai insight */}
    </div>
  )}
</div>
```

**Step 2: Make Identity | Gate | Ledger responsive**

Update the left-half segments to stack on mobile:

```typescript
<div className="flex flex-col sm:flex-row gap-3">
  {/* Identity segment */}
  <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 flex-1">
    {/* ... */}
  </div>
  
  {/* Gate segment */}
  <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 flex-1">
    {/* ... */}
  </div>
  
  {/* Ledger segment */}
  <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 flex-1">
    {/* ... */}
  </div>
</div>
```

**Step 3: Add transition animation for Next Step changes**

Wrap Next Step button in AnimatePresence:

```typescript
import { motion, AnimatePresence } from "framer-motion";

{nextStep && (
  <AnimatePresence mode="wait">
    <motion.div
      key={nextStep.copy}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
      className="rounded-lg border border-blue-700/20 bg-blue-950/10 px-4 py-3"
    >
      {/* existing content */}
    </motion.div>
  </AnimatePresence>
)}
```

**Step 4: Verify & commit**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npx tsc --noEmit`

Expected: No errors

Test: Resize browser to mobile width, verify segments stack vertically.

Commit:
```bash
git add frontend/src/components/zkdefi/CapitalOSStrip.tsx && git commit -m "feat(ui): make Capital OS Strip responsive

- Stack layout on mobile (grid-cols-1 lg:grid-cols-2)
- Stack segments on mobile (flex-col sm:flex-row)
- Fade transition when Next Step changes
- Hide right half when no data"
```

---

## Task 9: Accessibility - ARIA Labels

**Files:**
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/TrendingBar.tsx`
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/AllocationPreview.tsx`
- Modify: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/vault/DCAPanel.tsx`

**Step 1: Add ARIA labels to TrendingBar**

Update loading state:

```typescript
{loading && !data && (
  <div role="status" aria-live="polite" className="flex items-center gap-2">
    <Spinner size="w-4 h-4" label="Loading market data..." />
    <span className="sr-only">Loading market data</span>
  </div>
)}
```

Update error state:

```typescript
{error && !data && (
  <div role="alert" aria-live="assertive">
    <ErrorAlert message="Unable to load market data" onRetry={fetchData} />
  </div>
)}
```

**Step 2: Add ARIA labels to AllocationPreview**

Already added in Task 3, verify they exist:

```typescript
<div className="space-y-3" role="status" aria-label="Loading allocation preview">
```

**Step 3: Add ARIA labels to DCA table**

Update schedule table for keyboard navigation:

```typescript
<table className="w-full text-sm" role="table" aria-label="DCA schedules">
  <thead>
    <tr>
      <th scope="col" className="text-left py-2 text-zinc-400 font-normal">Pair</th>
      <th scope="col" className="text-left py-2 text-zinc-400 font-normal">Amount</th>
      <th scope="col" className="text-left py-2 text-zinc-400 font-normal">Interval</th>
      <th scope="col" className="text-left py-2 text-zinc-400 font-normal">Next</th>
      <th scope="col" className="text-right py-2 text-zinc-400 font-normal">Action</th>
    </tr>
  </thead>
  <tbody>
    {schedules.map((s) => (
      <tr key={s.id} className="border-t border-zinc-800">
        <td className="py-2">{s.pair}</td>
        <td className="py-2">{s.amountPerInterval}</td>
        <td className="py-2">{s.interval}</td>
        <td className="py-2">{new Date(s.nextExecution).toLocaleString()}</td>
        <td className="py-2 text-right">
          <button
            onClick={() => handleStop(s.id)}
            className="text-xs text-red-400 hover:text-red-300"
            aria-label={`Stop DCA schedule for ${s.pair}`}
          >
            Stop
          </button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

**Step 4: Add focus indicators**

Add global focus styles to Tailwind config if not present, or add to each interactive element:

```typescript
className="... focus:ring-2 focus:ring-emerald-500 focus:outline-none"
```

**Step 5: Verify & commit**

Test: Navigate with Tab key, verify focus indicators visible.

Test: Use screen reader (VoiceOver on Mac), verify announcements.

Commit:
```bash
git add frontend/src/components/zkdefi/vault/TrendingBar.tsx frontend/src/components/zkdefi/vault/AllocationPreview.tsx frontend/src/components/zkdefi/vault/DCAPanel.tsx && git commit -m "feat(a11y): add ARIA labels and keyboard navigation

- role=status/alert for dynamic content
- aria-live for screen reader announcements
- aria-label for context
- Table semantics for DCA schedules
- Focus indicators on interactive elements"
```

---

## Task 10: Final Polish & Testing

**Files:**
- Create: `/opt/obsqra.starknet/zkdefi/docs/testing/ui-improvement-checklist.md`

**Step 1: Create testing checklist**

```markdown
# UI Improvement Testing Checklist

## Visual Testing

### TrendingBar
- [ ] Loading spinner appears when fetching data
- [ ] Error alert shows with retry button on failure
- [ ] Stale indicator appears when refresh fails
- [ ] Stats scroll horizontally on mobile (<768px)
- [ ] All stats render with correct values in demo mode

### AIInsight
- [ ] Card fades in smoothly (300ms)
- [ ] Skeleton shows while loading
- [ ] Dismiss button works and persists to localStorage
- [ ] Responsive layout on mobile

### AllocationPreview
- [ ] Skeleton bars animate while loading
- [ ] Error alert shows with retry
- [ ] Empty state shows when amount = 0
- [ ] Success glow appears after data loads (1s fade)
- [ ] Bar chart renders correctly

### ProofStepper
- [ ] Steps animate on status change
- [ ] Active step pulses
- [ ] Done checkmark scales in
- [ ] Error X rotates in
- [ ] Connecting lines animate

### DCAPanel
- [ ] Skeleton table rows show while loading
- [ ] Empty state shows helpful message + icon
- [ ] Form validation shows errors
- [ ] Success toast appears after create/stop
- [ ] Table rows display schedule data correctly

### Capital OS Strip
- [ ] Stacks vertically on mobile (<1024px)
- [ ] Segments stack on mobile (<640px)
- [ ] Next Step fades on change
- [ ] Right half hides when no data

### Toast System
- [ ] Toasts slide in from right
- [ ] Success toasts have green border
- [ ] Error toasts have red border
- [ ] Toasts auto-dismiss after 4s
- [ ] Close button works
- [ ] Max 3 toasts stack

## Accessibility Testing

### Screen Reader
- [ ] Loading states announced
- [ ] Error messages announced
- [ ] Success feedback announced
- [ ] All interactive elements have labels

### Keyboard Navigation
- [ ] Tab through all interactive elements
- [ ] Focus indicators visible
- [ ] Enter/Space activate buttons
- [ ] Esc closes dismissable elements

### Focus Management
- [ ] Focus trapped in modals
- [ ] Focus returns after modal close
- [ ] Tab order logical

## Responsive Testing

### Mobile (375px)
- [ ] Capital OS Strip stacks
- [ ] TrendingBar scrolls horizontally
- [ ] Deposit/Withdraw panels stack
- [ ] DCA form fields stack
- [ ] All text readable
- [ ] Buttons accessible

### Tablet (768px)
- [ ] Two-column layouts preserved
- [ ] Forms use md:grid-cols-2
- [ ] All functionality intact

### Desktop (1024px+)
- [ ] All layouts match design
- [ ] No unnecessary scrolling
- [ ] Spacing consistent

## Cross-Browser Testing

### Chrome
- [ ] All features work
- [ ] Animations smooth

### Firefox
- [ ] All features work
- [ ] Animations smooth

### Safari
- [ ] All features work
- [ ] Animations smooth (WebKit differences)

## Error Scenarios

- [ ] Network timeout shows error
- [ ] 404 response shows error
- [ ] 500 response shows error
- [ ] Retry button refetches data
- [ ] Graceful degradation (show stale data)

## Success Scenarios

- [ ] Deposit triggers success toast
- [ ] Withdraw triggers success toast
- [ ] DCA create triggers success toast
- [ ] DCA stop triggers success toast
- [ ] All success messages clear
```

**Step 2: Run through checklist**

Start dev server:
```bash
cd /opt/obsqra.starknet/zkdefi/frontend && npm run dev
```

Test each item in the checklist in demo mode.

**Step 3: Fix any issues found**

Document and fix any bugs discovered during testing.

**Step 4: Production build test**

```bash
cd /opt/obsqra.starknet/zkdefi/frontend && npm run build
```

Verify no build errors.

**Step 5: Commit checklist**

```bash
git add docs/testing/ui-improvement-checklist.md && git commit -m "docs: add UI improvement testing checklist

Complete testing guide covering:
- Visual testing for all components
- Accessibility (screen reader, keyboard)
- Responsive design (mobile, tablet, desktop)
- Cross-browser compatibility
- Error and success scenarios"
```

---

## Completion Checklist

- [ ] Task 1: Toast notification system
- [ ] Task 2: TrendingBar loading & error states
- [ ] Task 3: AllocationPreview loading & error states
- [ ] Task 4: DCAPanel empty state & success feedback
- [ ] Task 5: DCAPanel form validation
- [ ] Task 6: AIInsight fade animation & skeleton
- [ ] Task 7: ProofStepper animated transitions
- [ ] Task 8: Capital OS Strip responsive stacking
- [ ] Task 9: Accessibility ARIA labels
- [ ] Task 10: Final polish & testing

## Verification

After completing all tasks:

1. Run full build: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build`
2. Test in demo mode: Navigate through all surfaces, verify all improvements
3. Test responsive: Resize browser, verify mobile layouts
4. Test accessibility: Use screen reader, keyboard-only navigation
5. Run linter: `npx eslint src/components/zkdefi/vault/`

Expected: All tasks complete, build successful, no lint errors, all features working.
