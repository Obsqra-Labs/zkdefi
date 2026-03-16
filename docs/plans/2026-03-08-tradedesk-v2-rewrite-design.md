# TradeDesk V2 Monolithic Rewrite — Design Document

**Date**: 2026-03-08  
**Status**: Approved  
**Approach**: Monolithic rewrite (Approach A)

## Context

The TradeDesk is the human-facing trade surface for zkde.fi. It currently shows 3 opportunity types (lending, staking, DEX swap) with partially real data, fake execution (Math.random tx hashes), dead AI advisory, broken reputation gating, and multiple bugs. The product catalog lists 22 products across 4 categories but none are properly represented as actionable opportunities.

**Key distinction**: TradeDesk = human trade surface with AI recommendations (user signs). Capital OS oracle/agents = autonomous signals-based execution (relayer submits). Privacy is the key domain.

## Opportunity Types (8)

| Type | Data Source (real) | Product Slug | Execution |
|------|-------------------|--------------|-----------|
| Swap | Ekubo pairs via ekubo_client | private-swaps | Wallet sign |
| LP | EkuboPoolAggregator (TVL, APY, volume) | private-lp-yield | Wallet sign |
| Lending (supply/borrow) | lending_service pool stats | private-lending | Wallet sign |
| Staking | native_staking on-chain pools | private-staking | Wallet sign |
| Limit Orders | limit_orders_adapter | private-swaps | Wallet sign |
| DCA | dca_service | private-swaps | Relayer |
| Privacy Pool (shield/unshield) | privacy_vault_service | privacy-pools | Wallet sign |
| Dark Ledger (private transfer) | note_store | dark-ledger | Relayer |

## Architecture

### Backend: Unified Opportunity Aggregator

New service: `backend/app/services/opportunity_aggregator.py`

```
OpportunityAggregator
├── fetch_all(user_address?) → list[UnifiedOpportunity]
│   ├── _fetch_swaps()        → Ekubo pairs via ekubo_client.get_overview_pairs()
│   ├── _fetch_lp()           → EkuboPoolAggregator.fetch_pools()
│   ├── _fetch_lending()      → lending_service.get_pool_stats()
│   ├── _fetch_staking()      → native_staking.get_pools()
│   ├── _fetch_limits()       → limit_orders_adapter.get_active_orders()
│   ├── _fetch_dca()          → dca_service active strategies
│   ├── _fetch_privacy_pools()→ privacy_vault_service pool stats
│   └── _fetch_dark_ledger()  → note_store active notes/balances
├── enrich_with_signals(opps) → Merge forecaster predictions
├── enrich_with_reputation(opps, address) → Filter/rank by user tier
└── get_ai_narrative(opp, user_profile) → LLM explanation
```

**Normalized shape** (`UnifiedOpportunity`):

```python
@dataclass
class UnifiedOpportunity:
    id: str
    type: str          # "swap"|"lp"|"lending"|"staking"|"limit"|"dca"|"privacy"|"dark_ledger"
    product_slug: str  # Maps to product catalog slug
    title: str
    pair: str          # e.g. "ETH/USDC"
    protocol: str      # "Ekubo"|"zkde.fi"|etc.
    current_yield: float
    risk_score: float  # 0-100
    tvl_usd: float
    volume_24h: float
    privacy_level: str # "public"|"shielded"|"fully_private"
    
    signal: Signal | None
    ai_narrative: str | None
    recommended: bool
    confidence: float
    gating: GatingResult | None
    
    execution_mode: str  # "wallet"|"relayer"|"both"
    calldata_builder: str | None
```

### New API: `trade_desk_v2.py`

Replaces both trade_desk.py and trade_desk_live.py:

```
GET  /api/v1/zkdefi/v2/opportunities           → Paginated, filtered, enriched
GET  /api/v1/zkdefi/v2/opportunities/{id}       → Single opportunity detail
GET  /api/v1/zkdefi/v2/market/context            → Real market context (oracle prices)
GET  /api/v1/zkdefi/v2/ai/advisory/{opp_id}      → Forecaster + LLM for one opportunity
POST /api/v1/zkdefi/v2/execute/simulate          → Impact preview
POST /api/v1/zkdefi/v2/execute/prepare            → Calldata for wallet signing
POST /api/v1/zkdefi/v2/execute/submit             → Submit via relayer (agent mode)
GET  /api/v1/zkdefi/v2/execute/status/{tx_hash}  → Track tx status
```

## Reputation & Gating

### Backend: Add computed reputation_score

```python
def compute_reputation_score(tier, tenure_days, transaction_count, collateral_eth) -> int:
    tier_weight = tier * 25                         # 0-75
    tenure_weight = min(tenure_days / 365, 1) * 10  # 0-10
    txn_weight = min(transaction_count / 100, 1) * 10  # 0-10
    coll_weight = min(collateral_eth / 10, 1) * 5   # 0-5
    return min(int(tier_weight + tenure_weight + txn_weight + coll_weight), 100)
```

### Gating: ConstraintGate wired into aggregator

Each opportunity annotated with gating result: "unlocked", "advisory", "locked", "proof_required".

### Tier-based access:

| Tier | Swap | LP | Lending | Staking | Limits | DCA | Privacy | Dark Ledger |
|------|------|----|---------|---------|--------|-----|---------|-------------|
| 0 (Unverified) | view | view | view | view | -- | -- | -- | -- |
| 1 (Verified) | exec | exec | supply | exec | exec | -- | deposit | -- |
| 2 (Established) | exec | exec | supply+borrow | exec | exec | exec | full | transfer |
| 3 (Strict) | full | full | full+reduced rates | full | full | full | full | full |

### Frontend UserReputation interface:

```typescript
interface UserReputation {
  address: string;
  tier: number;
  tierName: string;
  reputationScore: number;  // 0-100
  transactionCount: number;
  tenureDays: number;
  collateralEth: number;
  gates: {
    canSwap: boolean; canLP: boolean; canLend: boolean;
    canBorrow: boolean; canStake: boolean; canPrivacy: boolean;
    canDarkLedger: boolean;
  };
}
```

## AI Advisory (Two-Layer)

### Layer 1: Quantitative (Forecaster)

Wire existing `signals/top` into opportunity enrichment. Each opportunity gets yield prediction, risk prediction, confidence score, recommended flag (score >= 70).

### Layer 2: Narrative (LLM)

On-demand per-opportunity via `ai_allocation_service.explain_opportunity()`. Returns recommendation (execute/wait/avoid), confidence, narrative, suggested parameters, risk factors.

## Execution (Dual Path)

### Manual Mode (TradeDesk → wallet):
1. POST /v2/execute/simulate → impact preview
2. POST /v2/execute/prepare → calldata
3. Frontend → starknet account.execute(calldata)
4. User signs in wallet
5. GET /v2/execute/status/{hash} → poll

### Agent Mode (Capital OS → relayer):
1. Signal from oracle → evaluate_signal()
2. ConstraintGate.check() → pass/fail
3. POST /v2/execute/submit → relayer submits
4. tx_confirmation_worker polls
5. Receipt stored

### Calldata builders (existing, just need routing):
- swap → ekubo swap calldata
- lp → lp_recenter_adapter.build_mint_calldata()
- lending → lending_service.get_supply/borrow_calldata()
- staking → native_staking.get_stake_calldata()
- limit → limit_orders_adapter.build_place_limit_order_calldata()
- dca → dca_service calldata
- privacy → privacy_vault_service
- dark_ledger → note_store transfer

## Frontend Component Tree

```
TradeDesk (new)
├── TradeDeskHeader
│   ├── UserReputationBadge
│   ├── PortfolioSummary
│   └── MarketConditions
├── OpportunityExplorer (left)
│   ├── FilterBar (type, yield, risk, privacy)
│   ├── OpportunityList
│   │   └── OpportunityCard (per-type rendering)
│   └── Pagination
├── ActionPanel (right, context-dependent)
│   ├── No selection → MarketOverview + AI Advisory
│   ├── Selected → OpportunityDetail + ExecutionForm
│   │   ├── ManualMode (wallet signs)
│   │   ├── AdvisoryMode (AI suggests, user approves)
│   │   └── TerminalMode (raw calldata)
│   ├── ImpactPreview
│   ├── GatingStatus
│   └── ExecuteButton
├── MemoryLane (bottom)
│   ├── Real receipts from execution history
│   └── Voyager links for on-chain txs
└── PrivacySidebar (collapsible)
    ├── ShieldedBalance
    ├── QuickShield/Unshield
    └── DarkLedgerTransfer
```

## Bug Fixes (resolved by rewrite)

| Bug | Resolution |
|-----|-----------|
| autoHighlight marks ALL cards | recommended set by signal score |
| insights never fetched | replaced by ai/advisory |
| aiRecommendation never passed | advisory mode calls real endpoint |
| getHealthFactor("object Object") | ExecutionPanel gets userAddress prop |
| TerminalMode userReputation.score undefined | new UserReputation has reputationScore |
| ReputationGatingService schema mismatch | backend adds reputation_score |
| ReceiptService.recordReceipt no POST | add POST /receipts |
| get_ai_insights references undefined OPPORTUNITIES | replaced by v2/ai/advisory |
| CreditLinePanel wrong line ID | proper line_id field |
| PrivacyPoolPanel never fetches balance | useEffect on mount |
| duplicate opportunity fetches | single fetch, prop-drilled |
| strategy_recommendation_service hardcoded | replaced by aggregator |
| trade_desk pool data same for all pool_id | real per-pool data |

## Files

### Created:
- backend/app/services/opportunity_aggregator.py
- backend/app/api/routes/trade_desk_v2.py
- frontend/src/services/TradeDeskApiService.ts
- frontend/src/components/zkdefi/TradeDesk/ (all new components)

### Removed (replaced):
- backend/app/api/routes/trade_desk.py → trade_desk_v2.py
- backend/app/api/routes/trade_desk_live.py → trade_desk_v2.py
- frontend/src/components/zkdefi/TradeDesk.tsx → new orchestrator
- All TradeDesk sub-components (rebuilding)

### Kept/Evolved:
- MemoryLane.tsx + MemoryLaneCard.tsx (working)
- PrivacyPoolPanel.tsx + CreditLinePanel.tsx (fix bugs)
- All backend services (real data sources)
- All frontend services (refactored to use fetchWithRetry)
