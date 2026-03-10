# TradeDesk V2 Rewrite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the entire TradeDesk surface with a rewrite that aggregates 8 real opportunity types, dual execution (wallet + relayer), AI advisory, and reputation-gated access.

**Architecture:** New `OpportunityAggregator` service normalizes data from 8 existing backend services into `UnifiedOpportunity`. New `trade_desk_v2.py` API replaces both `trade_desk.py` and `trade_desk_live.py`. New frontend `TradeDesk` component tree with `OpportunityExplorer`, `ActionPanel`, `ExecutionForm`, and `PrivacySidebar`. Dual execution: wallet signing for manual mode, relayer for agent mode. AI advisory from forecaster (quantitative) + LLM (narrative).

**Tech Stack:** Python/FastAPI (backend), React/Next.js/TypeScript (frontend), starknet-react (wallet), Ekubo API (DEX data), SQLite (execution store), existing services (lending, staking, privacy vault, note store, forecaster, ai_allocation)

**Design Doc:** `docs/plans/2026-03-08-tradedesk-v2-rewrite-design.md`

---

## Task 1: Backend — UnifiedOpportunity Model + Reputation Score

**Files:**
- Create: `backend/app/models/unified_opportunity.py`
- Modify: `backend/app/api/reputation.py` (add `reputation_score` computed field)

**Step 1: Create the UnifiedOpportunity dataclass**

```python
# backend/app/models/unified_opportunity.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

@dataclass
class Signal:
    yield_prediction: float
    risk_prediction: float
    confidence: float
    recommended: bool

@dataclass
class GatingResult:
    status: str  # "unlocked"|"advisory"|"locked"|"proof_required"
    reason: str | None = None
    required_tier: int | None = None

@dataclass
class UnifiedOpportunity:
    id: str
    type: str
    product_slug: str
    title: str
    pair: str
    protocol: str
    current_yield: float
    risk_score: float
    tvl_usd: float
    volume_24h: float
    privacy_level: str
    signal: Signal | None = None
    ai_narrative: str | None = None
    recommended: bool = False
    confidence: float = 0.0
    gating: GatingResult | None = None
    execution_mode: str = "wallet"
    calldata_builder: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "product_slug": self.product_slug,
            "title": self.title,
            "pair": self.pair,
            "protocol": self.protocol,
            "currentYield": self.current_yield,
            "riskScore": self.risk_score,
            "tvlUsd": self.tvl_usd,
            "volume24h": self.volume_24h,
            "privacyLevel": self.privacy_level,
            "signal": {
                "yieldPrediction": self.signal.yield_prediction,
                "riskPrediction": self.signal.risk_prediction,
                "confidence": self.signal.confidence,
                "recommended": self.signal.recommended,
            } if self.signal else None,
            "aiNarrative": self.ai_narrative,
            "recommended": self.recommended,
            "confidence": self.confidence,
            "gating": {
                "status": self.gating.status,
                "reason": self.gating.reason,
                "requiredTier": self.gating.required_tier,
            } if self.gating else None,
            "executionMode": self.execution_mode,
            "calldataBuilder": self.calldata_builder,
            "metadata": self.metadata,
        }
```

**Step 2: Add `reputation_score` to reputation API**

In `backend/app/api/reputation.py`, find the `/reputation/user/{address}` endpoint and add a computed `reputation_score` field to the response:

```python
def compute_reputation_score(tier: int, tenure: int, txns: int, collateral: float) -> int:
    tier_weight = tier * 25
    tenure_weight = min(tenure / 365, 1) * 10
    txn_weight = min(txns / 100, 1) * 10
    coll_weight = min(collateral / 10, 1) * 5
    return min(int(tier_weight + tenure_weight + txn_weight + coll_weight), 100)
```

Add this function and include `reputation_score` in the response dict of the user reputation endpoint. Also add a `gates` dict:

```python
gates = {
    "canSwap": tier >= 1,
    "canLP": tier >= 1,
    "canLend": tier >= 1,
    "canBorrow": tier >= 2,
    "canStake": tier >= 1,
    "canPrivacy": tier >= 1,
    "canDarkLedger": tier >= 2,
    "canDCA": tier >= 2,
    "canLimits": tier >= 1,
}
```

**Step 3: Verify**

Run: `curl -s http://127.0.0.1:8003/api/v1/zkdefi/reputation/user/0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d | python3 -m json.tool`

Expected: Response includes `reputation_score` (integer 0-100) and `gates` dict.

**Step 4: Commit**

```bash
git add backend/app/models/unified_opportunity.py backend/app/api/reputation.py
git commit -m "feat: UnifiedOpportunity model + reputation score + gates"
```

---

## Task 2: Backend — OpportunityAggregator Service

**Files:**
- Create: `backend/app/services/opportunity_aggregator.py`

**Step 1: Create aggregator with all 8 data sources**

```python
# backend/app/services/opportunity_aggregator.py
```

The aggregator class `OpportunityAggregator` has these methods:
- `async def fetch_all(user_address: str | None = None, types: list[str] | None = None, limit: int = 50, offset: int = 0) -> list[UnifiedOpportunity]`
- `async def _fetch_swaps() -> list[UnifiedOpportunity]` — calls `ekubo_client.get_overview_pairs()`
- `async def _fetch_lp() -> list[UnifiedOpportunity]` — calls `EkuboPoolAggregator().fetch_pools()`
- `async def _fetch_lending() -> list[UnifiedOpportunity]` — calls `lending_service.get_pool_stats()` internally via httpx to `http://127.0.0.1:8003/api/v1/zkdefi/lending/pool`
- `async def _fetch_staking() -> list[UnifiedOpportunity]` — calls via httpx to `http://127.0.0.1:8003/api/v1/zkdefi/staking/pools`
- `async def _fetch_limits() -> list[UnifiedOpportunity]` — reads from `limit_orders_adapter.get_active_orders()`
- `async def _fetch_dca() -> list[UnifiedOpportunity]` — reads active DCA strategies
- `async def _fetch_privacy_pools() -> list[UnifiedOpportunity]` — reads from privacy vault pool stats
- `async def _fetch_dark_ledger() -> list[UnifiedOpportunity]` — reads from note_store

Each method wraps its source in try/except with logging — a failed source doesn't block others.

`fetch_all()` runs all fetchers concurrently via `asyncio.gather(*tasks, return_exceptions=True)`, flattens results, applies type filter, sorts by yield descending, applies pagination.

- `async def enrich_with_signals(opps)` — fetches `/api/v1/zkdefi/signals/top` and merges signal data by opportunity ID
- `async def enrich_with_gating(opps, user_address)` — fetches reputation, computes `GatingResult` per opportunity based on tier

Singleton pattern: `_aggregator = None; def get_aggregator() -> OpportunityAggregator`

**Step 2: Verify**

```python
# Quick test in Python shell
import asyncio
from app.services.opportunity_aggregator import get_aggregator
agg = get_aggregator()
opps = asyncio.run(agg.fetch_all())
print(f"Found {len(opps)} opportunities")
for opp in opps[:3]:
    print(f"  {opp.type}: {opp.title} ({opp.current_yield:.1f}%)")
```

**Step 3: Commit**

```bash
git add backend/app/services/opportunity_aggregator.py
git commit -m "feat: OpportunityAggregator - unified 8-source data feed"
```

---

## Task 3: Backend — TradeDesk V2 API Routes

**Files:**
- Create: `backend/app/api/routes/trade_desk_v2.py`
- Modify: `backend/app/main.py` (mount new router)

**Step 1: Create trade_desk_v2.py**

Endpoints:
- `GET /v2/opportunities` — paginated, filtered (`type`, `min_yield`, `max_risk`, `privacy_level`, `limit`, `offset`)
- `GET /v2/opportunities/{id}` — single opportunity with full detail
- `GET /v2/market/context` — real market context from oracle adapter (ETH/USD, STRK/USD, gas, block height)
- `GET /v2/ai/advisory/{opp_id}?user_address=` — forecaster signal + LLM narrative for one opportunity

All endpoints use `get_aggregator()` and return JSON via `opp.to_dict()`.

**Step 2: Create execution endpoints in trade_desk_v2.py**

- `POST /v2/execute/simulate` — takes `{opportunity_id, amount, user_address}`, returns estimated yield, price impact, gas estimate, fees. Uses real pool data from aggregator + oracle prices.
- `POST /v2/execute/prepare` — takes same input, routes to correct calldata builder based on opportunity type, returns `{calldata, contract_address, entry_point, estimated_gas}`. Builder routing:
  - swap → `build_swap_calldata` (from ekubo_config or dex route logic)
  - lp → `lp_recenter_adapter.build_mint_calldata()`
  - lending → httpx to `POST /api/v1/zkdefi/lending/supply/calldata`
  - staking → httpx to `POST /api/v1/zkdefi/staking/stake/calldata`
  - limit → `limit_orders_adapter.build_place_limit_order_calldata()`
  - privacy → `privacy_vault_service.shielded_deposit()`
  - dark_ledger → note_store transfer
- `POST /v2/execute/submit` — submits via `relayer_client.submit_transaction()`, stores receipt in `execution_store`
- `GET /v2/execute/status/{tx_hash}` — reads from `execution_store` + checks on-chain

**Step 3: Mount in main.py**

```python
trade_desk_v2_router = _optional_router("app.api.routes.trade_desk_v2")
if trade_desk_v2_router:
    app.include_router(trade_desk_v2_router, prefix="/api/v1/zkdefi", tags=["trade-desk-v2"])
```

**Step 4: Add POST /receipts endpoint**

In `backend/app/api/routes/receipts.py`, add:
```python
@router.post("/receipts")
async def record_receipt(receipt: dict = Body(...)):
    # Store in execution_store or receipt service
    ...
```

**Step 5: Verify**

```bash
curl -s http://127.0.0.1:8003/api/v1/zkdefi/v2/opportunities?limit=5 | python3 -m json.tool
curl -s http://127.0.0.1:8003/api/v1/zkdefi/v2/market/context | python3 -m json.tool
```

Expected: Real opportunities from all 8 sources, real market context with live prices.

**Step 6: Commit**

```bash
git add backend/app/api/routes/trade_desk_v2.py backend/app/main.py backend/app/api/routes/receipts.py
git commit -m "feat: TradeDesk V2 API - opportunities, market, execution, advisory"
```

---

## Task 4: Frontend — TradeDeskApiService

**Files:**
- Create: `frontend/src/services/TradeDeskApiService.ts`

**Step 1: Create service with typed interfaces**

```typescript
// Types matching backend UnifiedOpportunity
export interface UnifiedOpportunity { ... }
export interface Signal { ... }
export interface GatingResult { ... }
export interface MarketContext { ... }
export interface AdvisoryResponse { ... }
export interface SimulationResult { ... }
export interface PreparedExecution { ... }
export interface ExecutionStatus { ... }

export class TradeDeskApiService {
  async getOpportunities(filters?): Promise<{opportunities: UnifiedOpportunity[], pagination: {...}}>
  async getOpportunity(id: string): Promise<UnifiedOpportunity>
  async getMarketContext(): Promise<MarketContext>
  async getAdvisory(oppId: string, userAddress: string): Promise<AdvisoryResponse>
  async simulate(params): Promise<SimulationResult>
  async prepare(params): Promise<PreparedExecution>
  async submit(params): Promise<{txHash: string, receiptId: string}>
  async getExecutionStatus(txHash: string): Promise<ExecutionStatus>
}

export const tradeDeskApi = new TradeDeskApiService();
```

All methods use `fetchWithRetry` from `@/lib/api/fetchUtils`.

**Step 2: Commit**

```bash
git add frontend/src/services/TradeDeskApiService.ts
git commit -m "feat: TradeDeskApiService - typed frontend client for V2 API"
```

---

## Task 5: Frontend — TradeDesk Shell + Header

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/index.tsx` (new orchestrator)
- Create: `frontend/src/components/zkdefi/TradeDesk/TradeDeskHeader.tsx`
- Modify: `frontend/src/components/zkdefi/TradeDesk.tsx` → replace with import from `TradeDesk/index.tsx`

**Step 1: Create TradeDeskHeader**

Displays: UserReputationBadge (tier, score, gates), PortfolioSummary (total value from receipts), MarketConditions (ETH/STRK prices from market context). Uses real `UserReputation` interface with `reputationScore` and `gates`.

**Step 2: Create new TradeDesk orchestrator**

- Fetches opportunities via `tradeDeskApi.getOpportunities()`
- Fetches market context via `tradeDeskApi.getMarketContext()`
- Fetches reputation via `ReputationGatingService.getUserReputation()`
- Fetches receipts via `ReceiptService.getReceipts()`
- Manages state: selectedOpportunity, filters, rightPanelMode
- Renders: TradeDeskHeader, OpportunityExplorer (left), ActionPanel (right), MemoryLane (bottom)
- Wraps all panels in ErrorBoundary
- Shows OpportunityListSkeleton during loading

**Step 3: Replace old TradeDesk.tsx**

The old `frontend/src/components/zkdefi/TradeDesk.tsx` becomes a re-export:
```typescript
export { TradeDesk } from "./TradeDesk/index";
```

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/TradeDesk/
git commit -m "feat: TradeDesk V2 shell + header with real reputation"
```

---

## Task 6: Frontend — OpportunityExplorer (FilterBar + OpportunityList + OpportunityCard)

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/OpportunityExplorer.tsx`
- Create: `frontend/src/components/zkdefi/TradeDesk/FilterBar.tsx`
- Create: `frontend/src/components/zkdefi/TradeDesk/OpportunityCard.tsx` (rewrite)
- Create: `frontend/src/components/zkdefi/TradeDesk/OpportunityList.tsx` (rewrite)

**Step 1: Create FilterBar**

Toggle buttons for opportunity types (swap, lp, lending, staking, limit, dca, privacy, dark_ledger). Range sliders for min yield, max risk. Privacy level filter (all, public, shielded, fully_private). All filters are URL-param-driven for shareability.

**Step 2: Create OpportunityCard**

Per-type rendering with type icon, pair, yield, risk score, TVL, signal badge (if forecaster recommends), gating indicator (lock icon if locked, advisory icon if advisory required). Privacy level badge. No `autoHighlight` — `recommended` comes from signal enrichment.

**Step 3: Create OpportunityList**

Receives `opportunities[]` as prop (no self-fetching). Maps to OpportunityCard. Handles selection. Shows pagination controls.

**Step 4: Create OpportunityExplorer**

Composes FilterBar + OpportunityList. Manages filter state, passes filtered opportunities down.

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/TradeDesk/OpportunityExplorer.tsx \
       frontend/src/components/zkdefi/TradeDesk/FilterBar.tsx \
       frontend/src/components/zkdefi/TradeDesk/OpportunityCard.tsx \
       frontend/src/components/zkdefi/TradeDesk/OpportunityList.tsx
git commit -m "feat: OpportunityExplorer - filterable, type-aware, signal-enriched"
```

---

## Task 7: Frontend — ActionPanel (ExecutionForm + ImpactPreview + GatingStatus)

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/ActionPanel.tsx`
- Create: `frontend/src/components/zkdefi/TradeDesk/ExecutionForm.tsx`
- Create: `frontend/src/components/zkdefi/TradeDesk/ImpactPreview.tsx`
- Create: `frontend/src/components/zkdefi/TradeDesk/GatingStatus.tsx`
- Rewrite: `frontend/src/components/zkdefi/TradeDesk/ManualMode.tsx`
- Rewrite: `frontend/src/components/zkdefi/TradeDesk/AdvisoryMode.tsx`
- Rewrite: `frontend/src/components/zkdefi/TradeDesk/TerminalMode.tsx`

**Step 1: Create ActionPanel**

Context-dependent right panel:
- No selection → show MarketOverview (market context data) + AI summary
- Opportunity selected → show OpportunityDetail + ExecutionForm
- Executing → show ExecutionProgress (tx tracking)

**Step 2: Create ExecutionForm**

Three modes:
- ManualMode: user sets amount/params, clicks Execute → calls `tradeDeskApi.prepare()` → wallet signs
- AdvisoryMode: fetches `tradeDeskApi.getAdvisory()` on mount, shows AI recommendation with confidence, narrative, suggested params. User accepts or modifies. Execute calls prepare → wallet signs.
- TerminalMode: shows raw calldata, user can inspect before signing. Uses `userReputation.reputationScore` (fixed from undefined `score`).

`userAddress` is passed as a direct prop (fixing the `"[object Object]"` bug).

**Step 3: Create ImpactPreview**

Calls `tradeDeskApi.simulate()` when user enters amount. Shows: estimated yield, price impact, gas estimate, fees, net result. Updates in real-time as user changes params.

**Step 4: Create GatingStatus**

Shows current gating status for selected opportunity:
- "unlocked" → green checkmark
- "advisory" → yellow, "AI recommendation required"
- "locked" → red, "Tier X required" with upgrade path
- "proof_required" → blue, "Generate proof first"

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/TradeDesk/ActionPanel.tsx \
       frontend/src/components/zkdefi/TradeDesk/ExecutionForm.tsx \
       frontend/src/components/zkdefi/TradeDesk/ImpactPreview.tsx \
       frontend/src/components/zkdefi/TradeDesk/GatingStatus.tsx \
       frontend/src/components/zkdefi/TradeDesk/ManualMode.tsx \
       frontend/src/components/zkdefi/TradeDesk/AdvisoryMode.tsx \
       frontend/src/components/zkdefi/TradeDesk/TerminalMode.tsx
git commit -m "feat: ActionPanel - execution form, impact preview, gating, 3 modes"
```

---

## Task 8: Frontend — PrivacySidebar + Bug Fixes

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/PrivacySidebar.tsx`
- Modify: `frontend/src/components/zkdefi/TradeDesk/PrivacyPoolPanel.tsx` (fix shielded balance)
- Modify: `frontend/src/components/zkdefi/TradeDesk/CreditLinePanel.tsx` (fix line ID)
- Modify: `frontend/src/services/ReputationGatingService.ts` (fix schema)

**Step 1: Create PrivacySidebar**

Collapsible right sidebar with:
- ShieldedBalance: fetches `privacyVaultService.getShieldedBalance()` on mount
- QuickShield: compact deposit form
- QuickUnshield: compact withdrawal form
- DarkLedgerTransfer: compact note transfer form

**Step 2: Fix PrivacyPoolPanel**

Add `useEffect` to fetch `getShieldedBalance(userAddress)` on mount and display it.

**Step 3: Fix CreditLinePanel**

Change `setSelectedLineId(lines.lines[0].user_address)` to use a proper `line_id` field. Backend credit line response should include unique IDs.

**Step 4: Fix ReputationGatingService**

Update `getUserReputation()` to map the backend response correctly:
- Use `reputation_score` (new computed field) for `reputationScore`
- Map `tier_name` to `tierName`
- Include `gates` from backend response

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/TradeDesk/PrivacySidebar.tsx \
       frontend/src/components/zkdefi/TradeDesk/PrivacyPoolPanel.tsx \
       frontend/src/components/zkdefi/TradeDesk/CreditLinePanel.tsx \
       frontend/src/services/ReputationGatingService.ts
git commit -m "feat: PrivacySidebar + fix bugs in privacy, credit, reputation"
```

---

## Task 9: Integration — Wire Frontend Services to fetchWithRetry

**Files:**
- Modify: `frontend/src/services/PrivacyVaultService.ts`
- Modify: `frontend/src/services/CreditLineService.ts`
- Modify: `frontend/src/services/CollateralService.ts`
- Modify: `frontend/src/services/ReceiptService.ts`
- Modify: `frontend/src/services/MarketDataService.ts`

**Step 1: Replace raw `fetch()` with `fetchWithRetry()`**

In each service, import `fetchWithRetry` from `@/lib/api/fetchUtils` and replace all `fetch()` calls with `fetchWithRetry()`. This adds timeout handling and exponential backoff automatically.

**Step 2: Commit**

```bash
git add frontend/src/services/
git commit -m "fix: wire all frontend services to fetchWithRetry for resilience"
```

---

## Task 10: Build, Deploy, Verify

**Step 1: Build frontend**

```bash
cd frontend && npm run build
```

Expected: Clean build, zero errors.

**Step 2: Restart services**

```bash
pm2 restart zkdefi-backend zkdefi-frontend
```

**Step 3: Verify backend**

```bash
curl -s http://127.0.0.1:8003/api/v1/zkdefi/v2/opportunities?limit=5 | python3 -m json.tool
curl -s http://127.0.0.1:8003/api/v1/zkdefi/v2/market/context | python3 -m json.tool
curl -s http://127.0.0.1:8003/health/detailed | python3 -m json.tool
```

Expected: Real opportunities from multiple sources, real market prices, healthy system.

**Step 4: Verify frontend**

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/
```

Expected: 200.

**Step 5: Commit**

```bash
git commit -m "deploy: TradeDesk V2 live - 8 opportunity types, dual execution, AI advisory"
```

---

## Task Order Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | UnifiedOpportunity model + reputation score | 20 min |
| 2 | OpportunityAggregator service | 45 min |
| 3 | TradeDesk V2 API routes | 60 min |
| 4 | TradeDeskApiService (frontend) | 20 min |
| 5 | TradeDesk shell + header | 30 min |
| 6 | OpportunityExplorer (filter, list, card) | 45 min |
| 7 | ActionPanel (execution, impact, gating, modes) | 60 min |
| 8 | PrivacySidebar + bug fixes | 30 min |
| 9 | Wire services to fetchWithRetry | 15 min |
| 10 | Build, deploy, verify | 15 min |
| **Total** | | **~5.5 hours** |
