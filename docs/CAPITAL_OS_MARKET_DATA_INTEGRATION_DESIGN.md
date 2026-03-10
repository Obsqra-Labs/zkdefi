# Capital OS Market Data Integration - Design-First Approach

## Current State
- Market data components exist (YieldTab, DexPanel, VaultTradeTab)
- Backend endpoints are working (opportunities, yield data, DEX feeds)
- But they're not integrated into Capital OS architecture as designed

## The Real Capital OS Design

From `2026-03-06-mission-control-ux-refactor-design.md`:

**Left Rail (Capital Ledger):**
```
- Deployed Positions:
  ├─ Ekubo LP: amount, APY, status
  ├─ Lending: supplied amount, APY, health factor
  ├─ Staking: staked amount, APY
  └─ Click any position → details appear in Center Stage
```

**Center Stage has Modes:**
1. **Execution Flow** (default) - Current agent decision pipeline
2. **Trade Desk** - Single-pane trading (Swap, LP, DCA)
3. **Circuit Board** - Policy composition
4. **Pipeline Monitor** - zkRAG intelligence
5. **Governance** - Voting

**Key Design Principle:** 
> "Everything that matters is always visible. No tab-switching to find information."

## The Integration Strategy (Design-First)

Instead of copying old tabs, we should:

### 1. **Capital Ledger: Rich Position Details**
When user clicks a position in the left rail:
```jsx
onClick={() => setSelectedPosition(position)}
```

Center stage shows:
```
┌─────────────────────────────────────┐
│ Ekubo LP: ETH/USDC                  │
├─────────────────────────────────────┤
│ METRICS:                             │
│ Amount: $2,340 USD                  │
│ APY: 12.5%                          │
│ 30-day Yield: $28.50                │
│ Price Range: $1.50 - $1.65          │
├─────────────────────────────────────┤
│ PERFORMANCE CHART (30d)             │
│ [Line chart showing cumulative yield│
├─────────────────────────────────────┤
│ ACTIONS:                            │
│ [Add Liquidity] [Remove] [Rebalance]│
│ [View TX History]                   │
└─────────────────────────────────────┘
```

This data comes from:
- `DexPanel` data (opportunity details)
- `YieldTab` chart logic (performance trend)
- But **rewritten as a detail panel**, not a separate tab

### 2. **Trade Desk Mode: Full Market Context**
When user clicks "Trade Desk" button:
```jsx
centerStageContent = <TradeDesk />
```

Combines:
- **Market data:** Live Ekubo/JediSwap pairs from `/strategies/opportunities`
- **Current positions:** From left rail (context-aware)
- **Trading interface:** Swap/LP/DCA subviews
- **Yield impact:** Shows expected APY after trade

This is **not** `VaultTradeTab` (old modular), but a **new unified TradeDesk** that:
- Fetches real opportunity feed
- Shows position-aware trading
- Displays APY impact
- Generates receipts for Memory Lane

### 3. **Memory Lane: Unified Activity Stream**
Already exists as `/api/v1/zkdefi/mc/stream` but needs to include:
- Swaps
- LP adds/removes
- DCA executions
- All with yield impact deltas

### 4. **Oracle Dashboard Strip: Actionable Intelligence**
The collapsed "Market Intelligence" strip at top of center stage already shows:
- Ekubo + JediSwap opportunities
- Risk/APY scatter plot
- Should have [Deploy] button → opens Trade Desk with pre-selected opportunity

## Implementation Plan

**NOT to do:**
- Don't restore old VaultSurface tabbed interface
- Don't copy YieldTab/VaultTradeTab 1:1

**TO do:**

### Task 1: Position Detail Panel
- When user clicks position in Capital Ledger
- Show rich detail card in center stage
- Uses YieldTab's chart logic (fetch + render)
- Uses DexPanel's market data logic
- But **written as a unified detail view**

### Task 2: Trade Desk Mode (Unified)
- New component integrating:
  - Ekubo market feeds (opportunities endpoint)
  - Current positions context (from left rail)
  - Swap/LP/DCA interfaces
  - APY impact calculations
- Not `VaultTradeTab` - a **new Trade Desk** built for Capital OS

### Task 3: Wiring Memory Lane
- Ensure all trade activity generates receipts
- All receipts appear in Memory Lane timeline
- Activity feeds into Execution Flow's "Strategy" step

### Task 4: Oracle Strip Integration
- When user clicks opportunity in Oracle Strip
- Opens Trade Desk with pre-selected pair
- Shows opportunity yield potential vs current portfolio

## Data Flow (Capital OS Way)

```
Capital Ledger Position
    ↓ (click)
    ↓
Center Stage: Position Detail Panel
    ├─ Fetch market data: /strategies/opportunities
    ├─ Fetch performance: /vault/yield-chart
    ├─ Show APY, 30-day yield, chart
    └─ [Actions: Trade, Rebalance, View History]

                    OR

Oracle Intelligence Strip
    ↓ (click opportunity)
    ↓
Center Stage: Trade Desk Mode
    ├─ Show opportunity details
    ├─ Show current positions
    ├─ Allow Swap/LP/DCA
    ├─ Calculate APY impact
    └─ Execute → Receipt → Memory Lane

                    ↓
                    
Memory Lane Timeline
    └─ All activity with trust deltas
       (shows yield gains, risk impact)
```

## Components to Build/Refactor

1. **`PositionDetailPanel.tsx`** (NEW)
   - Shows rich position data when selected
   - Uses opportunity/yield APIs
   - Replaces single-line position in left rail

2. **`TradeDesk.tsx`** (NEW - not VaultTradeTab)
   - Unified trading interface
   - Integrates opportunity data
   - Shows position context
   - Manages Swap/LP/DCA modes

3. **`MemoryLaneItem.tsx`** (UPDATE)
   - Include trade activity
   - Show yield impact
   - Link to position detail panel

4. **Update `CapitalLedger.tsx`**
   - Click position → set selectedPosition
   - Pass through to center stage

5. **Update `UnifiedStream.tsx`** 
   - Add selectedPosition state management
   - Render PositionDetailPanel instead of stream when position selected
   - Have "Back to Stream" button to return

## Backend Verification

✅ All needed endpoints exist and work:
- `/api/v1/strategies/opportunities` - Market data
- `/api/v1/zkdefi/vault/yield-chart` - Performance data
- `/api/v1/zkdefi/mc/stream` - Activity history
- `/api/v1/dex/*` - DEX feeds (for trading)

## Result

When implemented correctly, the Capital OS will have:
- **Left Rail:** Rich position list (click → details)
- **Center Stage:** Context-aware views
  - Position details with yield tracking
  - Unified trading desk with market data
  - Unified activity timeline
- **No tabs or orphaned components**
- **Market data integrated into natural workflows**

This is the Capital OS that was designed - not a retrofit of old UI patterns.
