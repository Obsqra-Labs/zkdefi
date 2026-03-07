# TradeDesk Component Design

**Date:** 2026-03-07  
**Status:** Design Approved  
**Scope:** Orchestrator component integrating OpportunityList, ExecutionPanel, MarketInfo, and Memory Lane

---

## Overview

**Goal:** Implement a 3-column layout orchestrator component that ties together opportunity discovery, execution, and audit trail with real-time market data.

**Architecture:** Container component (TradeDesk) manages state for selected opportunity, user reputation, market context, and receipts. Child components (OpportunityList, ExecutionPanel, MarketInfoPanel, MemoryLane) receive props and callbacks to update parent state. Real-time data polls via intervals on mount/cleanup.

**Tech Stack:** React 18, TypeScript, TailwindCSS, Vitest + React Testing Library, existing services (MarketDataService, ReputationGatingService, ReceiptService, AIRecommendationService)

---

## Component Architecture

### File Structure
```
frontend/src/components/zkdefi/TradeDesk.tsx (main)
frontend/src/components/zkdefi/TradeDesk/Header.tsx
frontend/src/components/zkdefi/TradeDesk/MarketInfoPanel.tsx
frontend/src/components/zkdefi/TradeDesk/MemoryLane.tsx
frontend/src/components/zkdefi/TradeDesk/__tests__/TradeDesk.test.tsx
```

### Props Interface
```typescript
interface TradeDeskProps {
  userAddress?: string;
  autoRefresh?: boolean; // Default true
  showMemoryLane?: boolean; // Default true
}
```

### State Management

**TradeDesk manages:**
- `selectedOpportunity` (Opportunity | null)
- `userReputation` (UserReputation | null)
- `marketContext` (MarketContext | null)
- `insights` (MarketInsights | null)
- `receipts` (ReceiptWithImpact[])
- `opportunities` (Opportunity[])
- `loading` (boolean)
- `error` (string | null)
- `executionMode` ('manual' | 'advisory' | 'terminal')

**Child callbacks:**
- `onOpportunitySelect(opportunity)` → updates selectedOpportunity
- `onExecute(params)` → executes adapter, records receipt, refreshes state
- `onModeChange(mode)` → updates executionMode

---

## Layout (3-Column + Header + Footer)

```
┌─────────────────────────────────────────────────┐
│ Header: Title + Stats + Mode Toggle             │
├──────────────┬──────────────┬────────────────────┤
│ OpportList   │ ExecutionPnl │ MarketInfo + AI    │
│ (25%)        │ (35%)        │ (40%)              │
│              │              │                    │
├──────────────┴──────────────┴────────────────────┤
│ Memory Lane: Receipt Timeline (newest first)     │
└──────────────────────────────────────────────────┘
```

**Responsive breakpoints:**
- Desktop (1024px+): 3-column layout as above
- Tablet (768px-1023px): 2-column (OpportList+ExecPanel, MarketInfo, MemoryLane stacked)
- Mobile (<768px): Stacked vertically (OpportList → ExecPanel → MarketInfo → MemoryLane)

---

## Components

### Header.tsx
Displays:
- "Trade Desk" title
- Stats: Total yield (24h/7d/APY), Risk score, Tier badge, Borrowing power
- Mode toggle (Manual / Advisory / Terminal)
- Settings/Portfolio button

### OpportunityList.tsx
- List of opportunities from MarketDataService
- Filters: type, minYield, maxRisk, privacyMode
- Sorting: by compositeScore (yield + risk)
- Cards show: name, APY, risk, privacy badge, policy status
- Click → onOpportunitySelect callback
- Real-time updates via polling

### ExecutionPanel.tsx
- Shows selectedOpportunity details
- Amount input with max calculated from LTV (tier-based)
- Privacy mode selector (public/shielded/dark_ledger)
- Slippage/LTV controls (collapsible)
- Confidence badge (from recommendations)
- Execute button → calls adapter, records receipt
- Hidden if no opportunity selected

### MarketInfoPanel.tsx
- Market volatility indicator
- Sentiment badge (bullish/neutral/bearish)
- Trending pairs carousel
- Risk warnings list
- AI recommendations (top 3 with reasoning)
- Real-time updates every 30s

### MemoryLane.tsx
- Timeline of recent receipts (newest first)
- Date filters: Last 24h, 7d, 30d buttons
- Receipt cards: timestamp, action, amount (hashed if private), yield, trust delta, status
- Expandable detail view per receipt
- Search/filter by adapter type
- Infinite scroll or pagination

### Main Component (TradeDesk.tsx)
- Lifecycle: On mount → fetch opportunities, reputation, market context, receipts
- Polling: If autoRefresh enabled, set intervals for market context (30s) and receipts (60s)
- Cleanup: Clear intervals on unmount
- Error boundaries around each panel
- Loading skeleton states for each panel

---

## Data Flow

### Load Phase
1. Mount → useEffect fetches:
   - `MarketDataService.getOpportunities()`
   - `ReputationGatingService.getUserReputation(userAddress)`
   - `MarketDataService.getMarketContext()`
   - `AIRecommendationService.getRecommendations()`
   - `ReceiptService.getReceipts()`

### Execution Phase
1. User selects opportunity → `onOpportunitySelect(opportunity)`
2. ExecutionPanel updates amount, privacy, parameters
3. User clicks Execute → `onExecute(params)` calls adapter.execute()
4. Adapter returns TradeReceipt
5. `ReceiptService.recordReceipt(receipt)`
6. Update receipts state, refresh opportunities
7. MemoryLane renders new receipt

### Real-time Updates
- Market context polls every 30s if `autoRefresh` true
- Receipts poll every 60s if `autoRefresh` true
- Opportunities re-fetch on receipt record (yield impact)

---

## Error Handling

**Per-panel error boundaries:**
- OpportunityList: show "Failed to load opportunities" + retry
- ExecutionPanel: show "Failed to execute" + details
- MarketInfoPanel: show "Failed to fetch market data"
- MemoryLane: show "Failed to load receipts"

**Global error state:**
- Show banner if any critical service fails
- Disable execution if reputation unavailable

---

## Testing Strategy

**Unit Tests (TradeDesk.test.tsx):**
1. Renders header, opportunity list, execution panel, memory lane
2. Loads opportunities on mount
3. Loads user reputation on mount
4. Handles opportunity selection → updates selected state
5. Handles execution → records receipt, updates state
6. Polls market context at correct interval
7. Polls receipts at correct interval
8. Cleans up intervals on unmount
9. Handles errors gracefully
10. Responsive layout renders correctly on mobile/tablet/desktop

**Integration tests (if separate file):**
- Full workflow: select opportunity → execute → receipt appears in memory lane
- Mode switching: Manual → Advisory → Terminal
- Privacy mode selection
- Filters and sorting

---

## Success Criteria

- ✅ 3-column layout renders correctly on desktop
- ✅ Responsive on tablet/mobile
- ✅ Real-time polling for market context and receipts
- ✅ Opportunity selection updates ExecutionPanel
- ✅ Execution flow: select → execute → receipt → memory lane
- ✅ Error handling with retry buttons
- ✅ All tests passing (Vitest)
- ✅ No TypeScript errors
- ✅ Accessibility: ARIA labels, keyboard navigation

---

## Notes

- ExecutionPanel hidden by default (no opportunity selected)
- MemoryLane scrollable independently (sticky header)
- All timestamps in ISO8601 format for consistency
- Privacy-aware receipt display (hash amounts if private)
- Use `useCallback` for memoized callbacks to children
- Use `useMemo` for opportunities filtering/sorting
