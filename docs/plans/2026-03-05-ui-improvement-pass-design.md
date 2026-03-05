# UI Improvement Pass — Comprehensive Polish Design

**Date:** 2026-03-05  
**Status:** Approved  
**Scope:** Add loading states, error handling, empty states, success feedback, responsive design, and accessibility improvements to all new vault UX components from the March 5 Capital OS implementation.

---

## 1. Context

Recent implementation added:
- Capital OS Strip (right half with Next Step + AI Insight)
- TrendingBar (market pulse stats)
- AIInsight card (dismissable recommendations)
- AllocationPreview (capital deployment visualization)
- ProofStepper (privacy pipeline steps)
- DCAPanel (dollar-cost averaging configuration)

These components currently lack:
- Consistent loading states
- Error handling and recovery
- Empty state messaging
- Success feedback
- Mobile responsiveness
- Accessibility features

---

## 2. Design Principles

**Foundation over decoration:** Extend existing patterns (Spinner, ErrorAlert, ErrorBoundary) rather than creating new systems.

**Graceful degradation:** Show last known data with stale indicators when refresh fails.

**User confidence:** Clear feedback at every stage (loading, success, error, empty).

**Mobile-first responsive:** Stack layouts on small screens, preserve functionality.

**Accessible by default:** ARIA labels, keyboard navigation, screen reader announcements.

---

## 3. Existing Patterns (Audit Results)

### Color System
- **Primary/Success:** `emerald-400/500/600`
- **Error:** `red-300/400/500` with `/10` and `/30` opacity variants
- **Warning:** `amber-400`
- **Neutral:** `zinc-400/500/700/800/900/950`
- **Privacy tiers:** `blue-400`, `emerald-400`, `amber-400`, `purple-400`

### Components
- **`Spinner`** (`components/ui/Spinner.tsx`): RefreshCw icon with `animate-spin`, configurable size/color, optional label
- **`ErrorAlert`** (`components/ui/Spinner.tsx`): Inline error banner with AlertTriangle icon, optional retry button, red-500 color scheme
- **`ErrorBoundary`** (`components/ErrorBoundary.tsx`): Full-page error fallback with "Reload Page" and "Go to Home" actions

### Animation
- Tailwind utilities: `animate-spin`, `animate-pulse`, `transition-colors`
- Timing: Quick transitions (150-300ms), no spring physics

### Loading Pattern
```typescript
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
const [data, setData] = useState<T | null>(null);
```

### Error Message Tone
Balanced approach: technical enough for debugging, friendly enough for users.
Example: "Unable to fetch pool data. Check connection."

---

## 4. Component-Specific Improvements

### 4.1 TrendingBar

**Current state:** Shows "Loading..." text or data.

**Improvements:**
- **Loading:** Replace text with `<Spinner size="w-4 h-4" label="Loading market data..." />`
- **Error:** Show `<ErrorAlert message="Unable to load market data" onRetry={fetchData} />` inline
- **Stale data:** If refresh fails but previous data exists, show data with gray "Last updated: Xm ago" indicator
- **Responsive:** Add `overflow-x-auto` for horizontal scroll on mobile, `flex-nowrap` to prevent wrapping

**Layout:**
```tsx
{loading && !data && <Spinner label="Loading market data..." />}
{error && !data && <ErrorAlert message={error} onRetry={fetchData} />}
{data && (
  <>
    <div className="grid grid-cols-5 gap-2 overflow-x-auto">...</div>
    {stale && <span className="text-xs text-zinc-500">Last updated: {timeAgo}m ago</span>}
  </>
)}
```

---

### 4.2 AIInsight

**Current state:** Renders immediately with data.

**Improvements:**
- **Animation:** Fade-in with `motion.div` from framer-motion: `initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}`
- **Loading:** Show skeleton card (same dimensions, pulsing background) while fetching in live mode
- **Error:** If fetch fails, don't show card (graceful absence)
- **Responsive:** Already responsive with `lg:` breakpoints, no changes needed

**Skeleton structure:**
```tsx
{loading && (
  <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 p-4 animate-pulse">
    <div className="h-4 bg-zinc-700 rounded w-3/4 mb-2"></div>
    <div className="h-3 bg-zinc-700 rounded w-1/2"></div>
  </div>
)}
```

---

### 4.3 AllocationPreview

**Current state:** Fetches on amount change, no loading indicator.

**Improvements:**
- **Loading:** Show skeleton bars (4 horizontal bars with pulsing animation) while fetching strategy
- **Error:** Show `<ErrorAlert message="Unable to calculate allocation" onRetry />` in place of chart
- **Empty:** When `amount === 0` or no amount entered, show helpful message: "Enter an amount to see capital deployment preview"
- **Success feedback:** Brief green glow on border when data successfully loads (fade out after 1s)

**Skeleton:**
```tsx
{loading && (
  <div className="space-y-2 animate-pulse">
    {[60, 45, 30, 20].map((w, i) => (
      <div key={i} className="h-6 bg-zinc-700 rounded" style={{ width: `${w}%` }} />
    ))}
  </div>
)}
```

---

### 4.4 ProofStepper

**Current state:** Static steps with icons.

**Improvements:**
- **Animated progress:** When step transitions to "active", add `animate-pulse` to icon
- **Checkmarks:** When step completes ("done"), animate checkmark with scale: `scale-0 → scale-100` transition
- **Estimated time:** Add optional `estimatedMs` to each step, show countdown: "~3s remaining"
- **Expandable details:** Click step to expand technical details (circuit, proof size, verification gas)

**Step with animation:**
```tsx
<motion.div
  initial={{ scale: 0 }}
  animate={{ scale: status === "done" ? 1 : 0 }}
  transition={{ type: "spring", stiffness: 300 }}
>
  <Check className="w-4 h-4 text-emerald-400" />
</motion.div>
```

---

### 4.5 DCAPanel

**Current state:** Form + table, no feedback on actions.

**Improvements:**
- **Loading schedules:** Show skeleton table rows (3 rows, pulsing) while fetching active schedules
- **Empty state:** When no schedules, show centered message with icon:
  ```
  "No DCA schedules yet
  Set up automated, privacy-preserving swaps"
  [Create Schedule button]
  ```
- **Success feedback:** After creating schedule, show green success banner for 3s: "✓ DCA schedule created successfully"
- **Error handling:** If create/stop fails, show `<ErrorAlert />` above form with specific error message
- **Form validation:** Real-time validation with red border + error text for invalid inputs (amount > 0, valid interval)
- **Preview:** Show "Next 3 executions" preview before creating schedule

**Empty state:**
```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <Repeat className="w-12 h-12 text-zinc-600 mb-3" />
  <p className="text-sm text-zinc-400 mb-1">No DCA schedules yet</p>
  <p className="text-xs text-zinc-500 mb-4">Set up automated, privacy-preserving swaps</p>
</div>
```

---

### 4.6 Capital OS Strip

**Current state:** Two-column grid (`grid-cols-2`).

**Improvements:**
- **Responsive:** Stack on mobile: `grid-cols-1 lg:grid-cols-2`
- **Transition:** When Next Step changes, fade out old → fade in new (200ms)
- **Empty state:** If no Next Step or AI Insight, render only left half (Identity | Gate | Ledger) at full width

---

### 4.7 Toast Notification System (NEW)

**Purpose:** Success feedback for vault operations (deposit, withdraw, DCA actions).

**Design:** Bottom-right corner, auto-dismiss after 4s, max 3 toasts stacked.

**Structure:**
```tsx
// components/ui/Toast.tsx
<AnimatePresence>
  {toasts.map((toast) => (
    <motion.div
      key={toast.id}
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 400, opacity: 0 }}
      className="rounded-lg border px-4 py-3 shadow-lg"
    >
      {toast.type === "success" && <Check className="w-5 h-5 text-emerald-400" />}
      {toast.type === "error" && <AlertTriangle className="w-5 h-5 text-red-400" />}
      <span>{toast.message}</span>
    </motion.div>
  ))}
</AnimatePresence>
```

**Usage:**
- After deposit: "Deposit submitted • Tx: 0x1234..."
- After withdraw: "Withdrawal initiated • Proof verified"
- After DCA create: "DCA schedule created"
- After DCA stop: "DCA schedule stopped"

---

## 5. Responsive Design Strategy

### Breakpoints (Tailwind defaults)
- `sm:` 640px
- `md:` 768px
- `lg:` 1024px

### Layout Changes

**Capital OS Strip:**
```tsx
<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
  {/* Left: Identity | Gate | Ledger */}
  {/* Right: Next Step + AI Insight */}
</div>
```

**Deposit/Withdraw Panels:**
Already using `lg:grid-cols-2`, no changes needed.

**TrendingBar:**
```tsx
<div className="flex gap-3 overflow-x-auto pb-2">
  {/* Stats cards with min-w-[120px] to prevent collapse */}
</div>
```

**DCAPanel Form:**
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
  {/* Token inputs, amount, interval */}
</div>
```

---

## 6. Accessibility Improvements

### Screen Reader Announcements

**Loading states:**
```tsx
<div role="status" aria-live="polite">
  <Spinner label="Loading market data..." />
  <span className="sr-only">Loading market data</span>
</div>
```

**Error messages:**
```tsx
<div role="alert" aria-live="assertive">
  <ErrorAlert message="Unable to load data" />
</div>
```

**Success feedback:**
```tsx
<div role="status" aria-live="polite" aria-atomic="true">
  Deposit submitted successfully
</div>
```

### Keyboard Navigation

**DCA Table:**
- Table rows: `tabIndex={0}`, Enter/Space to select
- Stop button: Focus trap, Esc to cancel

**Modals/Drawers:**
- Focus management: Focus first input on open, return focus on close
- Esc to close

### Focus Indicators
All interactive elements: `focus:ring-2 focus:ring-emerald-500 focus:outline-none`

---

## 7. Implementation Priorities

### Phase 1: Core Improvements (High Impact)
1. TrendingBar: Loading + error states
2. AllocationPreview: Skeleton + error handling
3. DCAPanel: Empty state + success feedback + form validation
4. Toast system: Base component + context provider

### Phase 2: Polish (Medium Impact)
5. AIInsight: Fade-in animation + skeleton
6. ProofStepper: Animated transitions
7. Capital OS Strip: Responsive stacking

### Phase 3: Accessibility (Essential for Production)
8. ARIA labels for all loading/error states
9. Keyboard navigation for DCA table
10. Focus management for all interactive elements

---

## 8. Dependencies

**New packages needed:**
- `framer-motion` (if not already installed) - for toast animations and smooth transitions

**Existing packages:**
- `lucide-react` - for icons (Check, AlertTriangle, RefreshCw, Repeat)
- `tailwindcss` - for styling and responsive utilities

---

## 9. Verification Strategy

**Visual testing:**
- [ ] Test each component in loading state (mock slow network)
- [ ] Test each component in error state (mock failed fetch)
- [ ] Test empty states (clear data, fresh session)
- [ ] Test responsive breakpoints (Chrome DevTools)

**Accessibility testing:**
- [ ] Screen reader navigation (VoiceOver on Mac, NVDA on Windows)
- [ ] Keyboard-only navigation (Tab, Enter, Space, Esc)
- [ ] Focus indicators visible on all interactive elements

**Cross-browser testing:**
- [ ] Chrome (primary)
- [ ] Firefox
- [ ] Safari (WebKit differences)

---

## 10. Success Metrics

**Functional:**
- All components have loading, error, and empty states
- No component silently fails (always show error or fallback)
- All interactive elements accessible via keyboard

**Visual:**
- Consistent use of color system (emerald success, red error)
- Smooth transitions (no jarring layout shifts)
- Mobile layouts preserve all functionality

**User Experience:**
- Clear feedback at every action (loading → success/error)
- Helpful error messages with recovery options
- Empty states guide next action
