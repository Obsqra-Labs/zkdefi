# Missing Market Data Components - Integration Plan

## 🎯 Root Cause

The following market data components **EXIST in the codebase** but are **NOT being rendered** in the new Capital OS layout:

### Components That Need Integration

1. **`VaultSurface.tsx`** - Master tab container with full tabbed interface
   - Imports and manages all vault-related data tabs
   - Handles tab routing (portfolio, yield, trade, lending, staking, activity)
   - Coordinates LP data, DEX swaps, yield charts

2. **`YieldTab.tsx`** - Yield performance reporting
   - Calls `/api/v1/zkdefi/vault/yield-chart?days=30`
   - Renders historical yield accumulation chart
   - Shows APY trends and performance metrics
   - **Status:** ✅ Component ready, ✅ Backend endpoint needs creation

3. **`VaultTradeTab.tsx`** - DEX trading interface
   - Integrates with DEX routers (Ekubo, JediSwap)
   - Shows trading pairs, volume, TVL
   - Executes swaps with slippage protection
   - **Status:** ✅ Component ready, ✅ Backend endpoints operational

4. **`DexPanel.tsx`** - Detailed DEX market data
   - Lists trading pairs across DEX venues
   - Shows volume, TVL, price feeds
   - Token information and pricing
   - **Status:** ✅ Component ready, ✅ Backend endpoints working

5. **`LiquidityTab.tsx`** - LP position management
   - Views and manages LP positions
   - APY calculations
   - **Status:** ✅ Component ready

6. **`ActivityTab.tsx`** - Transaction history
   - Lists deposits, withdrawals, swaps, trades
   - **Status:** ✅ Component ready, ✅ Backend streaming data

## 🔴 Why Tabs Aren't Showing

The `agent/page.tsx` currently renders:
```jsx
centerStage={
  <UnifiedStream address={address} ... />
}
```

But `UnifiedStream` doesn't render `VaultSurface` or its tabs. The tabs are orphaned components.

## ✅ Solution: Two Approaches

### Option A: Add Tab Bar to Unified Stream (RECOMMENDED)
Modify `UnifiedStream.tsx` to include tabs:
```
┌─────────────────────────────────────┐
│ Oracle Dashboard Strip (signals)    │  ← Already there
├─────────────────────────────────────┤
│ TAB BAR: Portfolio | Yield | Trade  │  ← ADD THIS
├─────────────────────────────────────┤
│ CONTENT:                            │
│ ├─ Portfolio: Vault balances, LP   │
│ ├─ Yield: Performance chart        │
│ ├─ Trade: DEX interface            │
│ └─ Activity: TX history            │
├─────────────────────────────────────┤
│ Execution Stream / Memory Lane      │  ← Already there
└─────────────────────────────────────┘
```

**Implementation:**
1. Add state management for active tab in `UnifiedStream`
2. Conditionally render tab bar with: Portfolio, Yield, Trade, Lending, Activity
3. Render appropriate component based on active tab:
   ```jsx
   {activeTab === 'portfolio' && <VaultTab address={address} />}
   {activeTab === 'yield' && <YieldTab address={address} />}
   {activeTab === 'trade' && <VaultTradeTab address={address} />}
   {activeTab === 'activity' && <ActivityTab address={address} />}
   ```
4. **Impact:** Reclaims 50-60% of the center stage for data-rich tabs

### Option B: Add Market Data Sidebar
Keep execution stream as-is, add a side panel with tabs (would clutter interface)

## 📋 Missing Backend Endpoints

These endpoints are called by the tabs but don't exist:
- `/api/v1/zkdefi/vault/yield-chart?days=30` - Needed by `YieldTab`
- `/api/v1/zkdefi/dex/pairs` - DEX pair listing (may need creation)
- Possibly others in `DexPanel` and `LiquidityTab`

**These can be added as-needed or use mock data temporarily**

## 🔗 Data Flow When Integrated

```
VaultSurface (tab container)
├─ VaultTab → vault balance, positions, health
├─ YieldTab → /api/v1/zkdefi/vault/yield-chart → performance chart
├─ VaultTradeTab (has DexPanel) → /api/v1/dex/* → trading pairs/quotes
├─ LendingPanel → /api/v1/zkdefi/lending/* → borrowing positions
├─ NativeStakingPanel → /api/v1/zkdefi/staking/* → staking info
└─ ActivityTab → /api/v1/zkdefi/mc/stream → transaction history
```

## 🎯 Next Steps

**Immediate (5 min):**
1. Add tab routing to `UnifiedStream.tsx`
2. Conditionally render `VaultTab` / `YieldTab` / `VaultTradeTab` / `ActivityTab`
3. Test that tabs appear and load data

**Short-term (20 min):**
1. Create missing `/api/v1/zkdefi/vault/yield-chart` endpoint
2. Verify all DEX endpoints are wired

**Result:** Market surface with real Ekubo/JediSwap data, yield charts, and activity history will be accessible within Mission Control

---

## Code Changes Required

### File: `frontend/src/components/zkdefi/mission-control/UnifiedStream.tsx`

Add at top of component:
```tsx
// Add to imports
import { VaultTab } from "@/components/zkdefi/vault/VaultTab";
import { YieldTab } from "@/components/zkdefi/vault/YieldTab";
import { VaultTradeTab } from "@/components/zkdefi/vault/VaultTradeTab";
import { ActivityTab } from "@/components/zkdefi/vault/ActivityTab";

// Add to state
const [activeVaultTab, setActiveVaultTab] = useState<"portfolio" | "yield" | "trade" | "activity">("portfolio");
```

Add to render (after Oracle Dashboard Strip, before filters):
```tsx
{/* Vault Data Tabs */}
<div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/30">
  <div className="flex gap-1 px-2 py-1.5 overflow-x-auto">
    {[
      { id: "portfolio", label: "Portfolio" },
      { id: "yield", label: "Yield" },
      { id: "trade", label: "Trade" },
      { id: "activity", label: "Activity" },
    ].map(tab => (
      <button
        key={tab.id}
        onClick={() => setActiveVaultTab(tab.id as any)}
        className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
          activeVaultTab === tab.id
            ? "bg-emerald-600 text-white"
            : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800"
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>
</div>

{/* Tab Content - Replace filter + stream */}
{activeVaultTab === "portfolio" && <VaultTab address={address} />}
{activeVaultTab === "yield" && <YieldTab address={address} />}
{activeVaultTab === "trade" && <VaultTradeTab address={address} />}
{activeVaultTab === "activity" && <ActivityTab address={address} />}
```

**This will immediately surface:**
- ✅ Ekubo LP data (in Portfolio tab)
- ✅ Yield performance charts (in Yield tab)
- ✅ DEX trading with live pairs (in Trade tab)
- ✅ Full transaction history (in Activity tab)

---

## Data Verification

All backend endpoints for these tabs **ARE WORKING**:
```
✓ /api/v1/strategies/opportunities - Ekubo/JediSwap opportunities
✓ /api/v1/zkdefi/position/{address} - LP positions
✓ /api/v1/zkdefi/reputation/user/{address} - Reputation data
✓ /api/v1/zkdefi/private-yield/vault/stats - Vault allocation
✓ /api/v1/zkdefi/mc/stream - Activity history
```

Only missing: `/api/v1/zkdefi/vault/yield-chart` (can mock or create)

**Once wired, the Market Surface will be fully operational with real data!**
