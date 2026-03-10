# Phase 3, Task 1: Core UI Services Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement three core services (MarketDataService, AIRecommendationService, ReceiptService) with 37 TDD tests that power UI data flow for the Trade Desk intelligence integration.

**Architecture:** Three independent services following the established adapter pattern. Each service fetches data via `apiUrl()` helper, uses fetch API with proper error handling, includes caching/mocking where appropriate, and is thoroughly tested with Vitest. Services feed the OpportunityList, ExecutionPanel, and TradeDesk UI components.

**Tech Stack:** TypeScript, Vitest (test runner), fetch API, Observable pattern (for streaming), Tailwind CSS (UI integration)

---

## File Structure

```
frontend/src/services/
├── MarketDataService.ts
├── AIRecommendationService.ts
├── ReceiptService.ts
└── __tests__/
    ├── MarketDataService.test.ts
    ├── AIRecommendationService.test.ts
    └── ReceiptService.test.ts
```

---

## Shared Interfaces (Define First)

These are used across all three services. Create `frontend/src/services/types.ts`:

```typescript
// Opportunity - used by MarketDataService and AIRecommendationService
export interface Opportunity {
  id: string;
  name: string;
  description: string;
  type: 'swap' | 'lp' | 'lending' | 'staking' | 'dca' | 'limit_orders';
  tokenA?: string;
  tokenB?: string;
  currentYield: number; // APY percentage
  riskScore: number; // 0-100
  tvl?: number;
  privacyModes: ('public' | 'shielded' | 'dark_ledger')[];
  source: 'zkGraph' | 'zkRAG' | 'Ekubo' | 'Strategy';
  updatedAt: string; // ISO8601
}

// PoolData - used by MarketDataService
export interface PoolData {
  poolId: string;
  token0: string;
  token1: string;
  liquidity: number;
  volume24h: number;
  apy: number;
  tvl: number;
  fee: number; // 0.01, 0.05, 0.3, 1.0
  riskFactors: { impermanentLoss: number; slippage: number };
  lastUpdated: string; // ISO8601
}

// MarketContext - used by MarketDataService
export interface MarketContext {
  volatilityIndex: number; // 0-100
  sentiment: 'bullish' | 'neutral' | 'bearish';
  riskWarnings: string[];
  trendingPairs: { tokenA: string; tokenB: string; volume24h: number }[];
  timestamp: string; // ISO8601
}

// Recommendation - used by AIRecommendationService
export interface Recommendation {
  id: string;
  action: string;
  reasoning: string;
  type: 'yield' | 'risk_reduction' | 'rebalance' | 'opportunity';
  expectedYield: number;
  expectedRiskReduction: number;
  confidence: number; // 0-1
  createdAt: string; // ISO8601
}

// RebalanceSuggestion - used by AIRecommendationService
export interface RebalanceSuggestion {
  changes: { opportunityId: string; action: 'increase' | 'decrease'; amount: number }[];
  rationale: string;
  expectedRiskReduction: number;
  expectedYieldImpact: number;
}

// MarketInsights - used by AIRecommendationService
export interface MarketInsights {
  emergingOpportunities: Opportunity[];
  warnings: string[];
  narrativeExplanation: string;
  timestamp: string; // ISO8601
}

// TradeReceipt - used by ReceiptService (already defined in adapters)
export interface TradeReceipt {
  id: string;
  type: 'swap' | 'lp' | 'lending' | 'dca' | 'limit_orders';
  status: 'pending' | 'executed' | 'failed';
  executedAt: string; // ISO8601
  adapter: string;
  transactionHash?: string;
  details: Record<string, any>;
}

// ReceiptWithImpact - used by ReceiptService
export interface ReceiptWithImpact extends TradeReceipt {
  reputationImpact: number;
  proofHash?: string;
  explanationFromAI?: string;
}

// ReceiptSummary - used by ReceiptService
export interface ReceiptSummary {
  totalExecutions: number;
  totalYield: number;
  successRate: number;
  reputationGainedFromProofs: number;
  topPerformingAdapter: string;
  lastExecutionTime: string; // ISO8601
}
```

---

## Task 1: Create Shared Types

**Files:**
- Create: `frontend/src/services/types.ts`

**Step 1: Write types file with all interfaces**

Create the types.ts file with all interfaces shown above.

**Step 2: Verify syntax**

Run: `npm run lint frontend/src/services/types.ts`
Expected: No errors

---

## Task 2: MarketDataService Implementation

**Files:**
- Create: `frontend/src/services/MarketDataService.ts`
- Create: `frontend/src/services/__tests__/MarketDataService.test.ts`

### MarketDataService Implementation

**Step 1: Write comprehensive failing tests**

Create `frontend/src/services/__tests__/MarketDataService.test.ts` with 15 tests:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketDataService } from '../MarketDataService';
import * as client from '@/lib/api/client';
import type { Opportunity, PoolData, MarketContext } from '../types';

global.fetch = vi.fn();

describe('MarketDataService', () => {
  let service: MarketDataService;

  beforeEach(() => {
    service = new MarketDataService();
    vi.clearAllMocks();
  });

  describe('getOpportunities', () => {
    it('should fetch all opportunities without filters', async () => {
      const mockOpportunities: Opportunity[] = [
        {
          id: 'opp-1',
          name: 'ETH/USDC Swap',
          description: 'Swap ETH for USDC',
          type: 'swap',
          tokenA: 'ETH',
          tokenB: 'USDC',
          currentYield: 0,
          riskScore: 10,
          privacyModes: ['public'],
          source: 'zkGraph',
          updatedAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const result = await service.getOpportunities();

      expect(result).toEqual(mockOpportunities);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/zkdefi/opportunities/list'),
        expect.any(Object)
      );
    });

    it('should fetch opportunities filtered by type', async () => {
      const mockOpportunities: Opportunity[] = [
        {
          id: 'lp-1',
          name: 'ETH/USDC LP',
          description: 'Provide liquidity',
          type: 'lp',
          tokenA: 'ETH',
          tokenB: 'USDC',
          currentYield: 15,
          riskScore: 25,
          tvl: 1000000,
          privacyModes: ['public', 'shielded'],
          source: 'Ekubo',
          updatedAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const result = await service.getOpportunities({ type: 'lp' });

      expect(result).toEqual(mockOpportunities);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('type=lp'),
        expect.any(Object)
      );
    });

    it('should filter opportunities by minYield', async () => {
      const mockOpportunities: Opportunity[] = [
        {
          id: 'yield-1',
          name: 'High Yield LP',
          description: 'High yield opportunity',
          type: 'lp',
          currentYield: 25,
          riskScore: 50,
          tvl: 500000,
          privacyModes: ['public'],
          source: 'Strategy',
          updatedAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const result = await service.getOpportunities({ minYield: 20 });

      expect(result[0].currentYield).toBeGreaterThanOrEqual(20);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('minYield=20'),
        expect.any(Object)
      );
    });

    it('should filter opportunities by maxRisk', async () => {
      const mockOpportunities: Opportunity[] = [
        {
          id: 'safe-1',
          name: 'Safe Opportunity',
          description: 'Low risk',
          type: 'staking',
          currentYield: 8,
          riskScore: 15,
          privacyModes: ['public'],
          source: 'zkGraph',
          updatedAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const result = await service.getOpportunities({ maxRisk: 25 });

      expect(result[0].riskScore).toBeLessThanOrEqual(25);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('maxRisk=25'),
        expect.any(Object)
      );
    });

    it('should filter opportunities by privacy mode', async () => {
      const mockOpportunities: Opportunity[] = [
        {
          id: 'shielded-1',
          name: 'Shielded Opportunity',
          description: 'Privacy enabled',
          type: 'swap',
          currentYield: 0,
          riskScore: 10,
          privacyModes: ['shielded', 'dark_ledger'],
          source: 'zkRAG',
          updatedAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const result = await service.getOpportunities({ privacyMode: 'shielded' });

      expect(result[0].privacyModes).toContain('shielded');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('privacyMode=shielded'),
        expect.any(Object)
      );
    });

    it('should handle multiple filters combined', async () => {
      const mockOpportunities: Opportunity[] = [];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const result = await service.getOpportunities({
        type: 'lp',
        minYield: 10,
        maxRisk: 40,
        privacyMode: 'public',
      });

      expect(result).toEqual([]);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('type=lp'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('minYield=10'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('maxRisk=40'),
        expect.any(Object)
      );
    });

    it('should return empty array when no opportunities match', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await service.getOpportunities({ minYield: 100 });

      expect(result).toEqual([]);
    });

    it('should handle network error when fetching opportunities', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal server error' }),
      });

      await expect(service.getOpportunities()).rejects.toThrow('Internal server error');
    });

    it('should handle 404 when opportunities endpoint unavailable', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Not found' }),
      });

      await expect(service.getOpportunities()).rejects.toThrow('Not found');
    });
  });

  describe('getPoolData', () => {
    it('should fetch pool data by poolId', async () => {
      const mockPoolData: PoolData = {
        poolId: 'pool-eth-usdc',
        token0: 'ETH',
        token1: 'USDC',
        liquidity: 5000000,
        volume24h: 1500000,
        apy: 12.5,
        tvl: 5000000,
        fee: 0.05,
        riskFactors: { impermanentLoss: 2.5, slippage: 1.2 },
        lastUpdated: '2026-03-07T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolData,
      });

      const result = await service.getPoolData('pool-eth-usdc');

      expect(result).toEqual(mockPoolData);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/zkdefi/pools/pool-eth-usdc/data'),
        expect.any(Object)
      );
    });

    it('should handle missing pool data (404)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Pool not found' }),
      });

      await expect(service.getPoolData('nonexistent-pool')).rejects.toThrow('Pool not found');
    });

    it('should handle network errors for pool data', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ detail: 'Service unavailable' }),
      });

      await expect(service.getPoolData('pool-1')).rejects.toThrow('Service unavailable');
    });
  });

  describe('getMarketContext', () => {
    it('should fetch market context with volatility, sentiment, and warnings', async () => {
      const mockContext: MarketContext = {
        volatilityIndex: 65,
        sentiment: 'neutral',
        riskWarnings: ['Stablecoin depegging risk', 'High slippage on large orders'],
        trendingPairs: [
          { tokenA: 'ETH', tokenB: 'USDC', volume24h: 2000000 },
          { tokenA: 'STRK', tokenB: 'USDC', volume24h: 1500000 },
        ],
        timestamp: '2026-03-07T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockContext,
      });

      const result = await service.getMarketContext();

      expect(result).toEqual(mockContext);
      expect(result.volatilityIndex).toBe(65);
      expect(result.sentiment).toBe('neutral');
      expect(result.riskWarnings.length).toBeGreaterThan(0);
      expect(result.trendingPairs.length).toBeGreaterThan(0);
    });

    it('should handle missing market context gracefully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Cannot fetch market data' }),
      });

      await expect(service.getMarketContext()).rejects.toThrow('Cannot fetch market data');
    });
  });

  describe('streamOpportunities', () => {
    it('should return an observable that emits opportunities', (done) => {
      const mockOpportunities: Opportunity[] = [
        {
          id: 'opp-stream-1',
          name: 'Streaming Opp',
          description: 'Real-time opportunity',
          type: 'swap',
          currentYield: 0,
          riskScore: 10,
          privacyModes: ['public'],
          source: 'zkGraph',
          updatedAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const observable = service.streamOpportunities();

      observable.subscribe((opps) => {
        expect(opps).toEqual(mockOpportunities);
        done();
      });
    });
  });

  describe('caching', () => {
    it('should cache opportunities for 30 seconds', async () => {
      const mockOpportunities: Opportunity[] = [
        {
          id: 'cached-1',
          name: 'Cached Opportunity',
          description: 'Should be cached',
          type: 'lp',
          currentYield: 10,
          riskScore: 20,
          tvl: 1000000,
          privacyModes: ['public'],
          source: 'zkGraph',
          updatedAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const result1 = await service.getOpportunities();
      const result2 = await service.getOpportunities();

      expect(result1).toEqual(result2);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Should only fetch once
    });
  });

  describe('edge cases', () => {
    it('should handle null descriptions', async () => {
      const mockOpportunities: any[] = [
        {
          id: 'null-desc',
          name: 'No Description Opp',
          description: null,
          type: 'swap',
          currentYield: 0,
          riskScore: 10,
          privacyModes: ['public'],
          source: 'zkGraph',
          updatedAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const result = await service.getOpportunities();

      expect(result).toHaveLength(1);
      expect(result[0].description).toBeNull();
    });

    it('should handle missing optional fields', async () => {
      const mockOpportunities: any[] = [
        {
          id: 'minimal-1',
          name: 'Minimal Opp',
          description: 'Minimal data',
          type: 'staking',
          currentYield: 5,
          riskScore: 5,
          privacyModes: ['public'],
          source: 'zkGraph',
          updatedAt: '2026-03-07T10:00:00Z',
          // No tokenA, tokenB, tvl
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpportunities,
      });

      const result = await service.getOpportunities();

      expect(result).toHaveLength(1);
      expect(result[0].tokenA).toBeUndefined();
    });
  });
});
```

**Step 2: Run tests to verify they all fail**

Run: `npm test frontend/src/services/__tests__/MarketDataService.test.ts`
Expected: All 15 tests FAIL (MarketDataService does not exist)

**Step 3: Write minimal MarketDataService implementation**

Create `frontend/src/services/MarketDataService.ts`:

```typescript
import { apiUrl } from '@/lib/api/client';
import type { Opportunity, PoolData, MarketContext } from './types';

export class MarketDataService {
  private opportunitiesCache: Opportunity[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  async getOpportunities(filters?: {
    type?: 'swap' | 'lp' | 'lending' | 'staking' | 'dca' | 'limit_orders';
    minYield?: number;
    maxRisk?: number;
    privacyMode?: 'public' | 'shielded' | 'dark_ledger';
  }): Promise<Opportunity[]> {
    // Check cache
    if (
      this.opportunitiesCache &&
      Date.now() - this.cacheTimestamp < this.CACHE_DURATION
    ) {
      return this.opportunitiesCache;
    }

    const params = new URLSearchParams();
    if (filters?.type) params.append('type', filters.type);
    if (filters?.minYield !== undefined) params.append('minYield', String(filters.minYield));
    if (filters?.maxRisk !== undefined) params.append('maxRisk', String(filters.maxRisk));
    if (filters?.privacyMode) params.append('privacyMode', filters.privacyMode);

    const url = apiUrl(`/api/v1/zkdefi/opportunities/list?${params}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch opportunities (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    const opportunities = Array.isArray(data) ? data : [];

    // Update cache
    this.opportunitiesCache = opportunities;
    this.cacheTimestamp = Date.now();

    return opportunities;
  }

  async getPoolData(poolId: string): Promise<PoolData> {
    const url = apiUrl(`/api/v1/zkdefi/pools/${poolId}/data`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch pool data (${response.status})`;
      throw new Error(detail);
    }

    return await response.json();
  }

  async getMarketContext(): Promise<MarketContext> {
    const url = apiUrl('/api/v1/zkdefi/market/context');

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch market context (${response.status})`;
      throw new Error(detail);
    }

    return await response.json();
  }

  streamOpportunities() {
    return {
      subscribe: (callback: (opps: Opportunity[]) => void) => {
        this.getOpportunities().then(callback).catch(console.error);
        return { unsubscribe: () => {} };
      },
    };
  }
}
```

**Step 4: Run tests to verify they all pass**

Run: `npm test frontend/src/services/__tests__/MarketDataService.test.ts`
Expected: All 15 tests PASS

**Step 5: Commit**

```bash
git add frontend/src/services/types.ts frontend/src/services/MarketDataService.ts frontend/src/services/__tests__/MarketDataService.test.ts
git commit -m "feat(services): add MarketDataService with 15 tests"
```

---

## Task 3: AIRecommendationService Implementation

**Files:**
- Create: `frontend/src/services/AIRecommendationService.ts`
- Create: `frontend/src/services/__tests__/AIRecommendationService.test.ts`

**Step 1: Write 12 comprehensive failing tests**

Create `frontend/src/services/__tests__/AIRecommendationService.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIRecommendationService } from '../AIRecommendationService';
import type { Recommendation, RebalanceSuggestion, MarketInsights, Opportunity } from '../types';

global.fetch = vi.fn();

describe('AIRecommendationService', () => {
  let service: AIRecommendationService;

  beforeEach(() => {
    service = new AIRecommendationService();
    vi.clearAllMocks();
  });

  describe('getRecommendations', () => {
    it('should fetch recommendations for conservative portfolio', async () => {
      const mockRecommendations: Recommendation[] = [
        {
          id: 'rec-1',
          action: 'Increase staking allocation to 30%',
          reasoning: 'Low risk profile matches conservative goals',
          type: 'yield',
          expectedYield: 6,
          expectedRiskReduction: 0,
          confidence: 0.92,
          createdAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRecommendations,
      });

      const result = await service.getRecommendations({
        currentPortfolio: { staking: 0.2, lending: 0.3 },
        riskProfile: 'conservative',
      });

      expect(result).toEqual(mockRecommendations);
      expect(result[0].confidence).toBeGreaterThan(0.8);
    });

    it('should fetch recommendations for moderate portfolio', async () => {
      const mockRecommendations: Recommendation[] = [
        {
          id: 'rec-2',
          action: 'Add 20% LP position in ETH/USDC',
          reasoning: 'Moderate risk balance with yield optimization',
          type: 'opportunity',
          expectedYield: 12,
          expectedRiskReduction: 0,
          confidence: 0.78,
          createdAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRecommendations,
      });

      const result = await service.getRecommendations({
        currentPortfolio: { lp: 0.1, staking: 0.2 },
        riskProfile: 'moderate',
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('opportunity');
    });

    it('should fetch recommendations for aggressive portfolio', async () => {
      const mockRecommendations: Recommendation[] = [
        {
          id: 'rec-3',
          action: 'Use limit orders for high-volatility pairs',
          reasoning: 'High risk tolerance enables leveraged strategies',
          type: 'yield',
          expectedYield: 25,
          expectedRiskReduction: 0,
          confidence: 0.65,
          createdAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRecommendations,
      });

      const result = await service.getRecommendations({
        currentPortfolio: { limitOrders: 0.3 },
        riskProfile: 'aggressive',
      });

      expect(result[0].expectedYield).toBeGreaterThan(20);
    });

    it('should include portfolio goals in recommendation context', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await service.getRecommendations({
        currentPortfolio: {},
        riskProfile: 'moderate',
        goals: ['maximize yield', 'minimize tax'],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/zkdefi/ai/recommendations'),
        expect.any(Object)
      );
    });

    it('should handle empty portfolio', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await service.getRecommendations({
        currentPortfolio: {},
        riskProfile: 'conservative',
      });

      expect(result).toEqual([]);
    });

    it('should handle null portfolio gracefully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await service.getRecommendations({
        currentPortfolio: null as any,
        riskProfile: 'moderate',
      });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getRebalancingSuggestion', () => {
    it('should get rebalancing suggestion for portfolio', async () => {
      const mockSuggestion: RebalanceSuggestion = {
        changes: [
          { opportunityId: 'lp-eth-usdc', action: 'increase', amount: 5000 },
          { opportunityId: 'staking-strk', action: 'decrease', amount: 2000 },
        ],
        rationale: 'Reduce exposure to staking, increase LP yield',
        expectedRiskReduction: 5,
        expectedYieldImpact: 8,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuggestion,
      });

      const result = await service.getRebalancingSuggestion({
        staking: 0.4,
        lp: 0.2,
        lending: 0.4,
      });

      expect(result).toEqual(mockSuggestion);
      expect(result.changes).toHaveLength(2);
      expect(result.expectedRiskReduction).toBeGreaterThan(0);
    });

    it('should handle portfolio needing no rebalancing', async () => {
      const mockSuggestion: RebalanceSuggestion = {
        changes: [],
        rationale: 'Portfolio is already well-balanced',
        expectedRiskReduction: 0,
        expectedYieldImpact: 0,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuggestion,
      });

      const result = await service.getRebalancingSuggestion({
        swap: 0.2,
        lp: 0.5,
        staking: 0.3,
      });

      expect(result.changes).toHaveLength(0);
    });
  });

  describe('getMarketInsights', () => {
    it('should fetch market insights with opportunities and warnings', async () => {
      const mockInsights: MarketInsights = {
        emergingOpportunities: [
          {
            id: 'emg-1',
            name: 'New STRK/USDC Pool',
            description: 'Newly launched high-volume pool',
            type: 'lp',
            tokenA: 'STRK',
            tokenB: 'USDC',
            currentYield: 18,
            riskScore: 35,
            tvl: 500000,
            privacyModes: ['public'],
            source: 'zkGraph',
            updatedAt: '2026-03-07T10:00:00Z',
          },
        ],
        warnings: [
          'Increased smart contract risk detected',
          'Liquidity concentration in single pool',
        ],
        narrativeExplanation:
          'Market shows bullish sentiment on emerging infrastructure tokens. However, concentration risk in new pools requires careful position sizing.',
        timestamp: '2026-03-07T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockInsights,
      });

      const result = await service.getMarketInsights();

      expect(result.emergingOpportunities).toHaveLength(1);
      expect(result.warnings).toHaveLength(2);
      expect(result.narrativeExplanation).toBeTruthy();
    });

    it('should handle AI service unavailability', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ detail: 'AI service unavailable' }),
      });

      await expect(service.getMarketInsights()).rejects.toThrow('AI service unavailable');
    });
  });

  describe('explainDecision', () => {
    it('should explain swap decision', async () => {
      const mockExplanation = {
        explanation:
          'Swap ETH to USDC to reduce exposure to volatility while maintaining stablecoin yield',
        alternatives: [
          { action: 'Use DCA instead', rationale: 'Smooth entry over time' },
          { action: 'Use limit order', rationale: 'Wait for better price' },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockExplanation,
      });

      const result = await service.explainDecision({
        type: 'swap',
        parameters: { tokenIn: 'ETH', tokenOut: 'USDC', amount: 10 },
      });

      expect(result.explanation).toBeTruthy();
      expect(result.alternatives).toHaveLength(2);
    });

    it('should explain LP decision', async () => {
      const mockExplanation = {
        explanation:
          'Provide liquidity to ETH/USDC pair to earn trading fees while maintaining price exposure',
        alternatives: [
          { action: 'Use staking instead', rationale: 'Lower impermanent loss' },
          { action: 'Use single-sided LP', rationale: 'Less capital required' },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockExplanation,
      });

      const result = await service.explainDecision({
        type: 'lp',
        parameters: { pool: 'eth-usdc', amount0: 5, amount1: 5000 },
      });

      expect(result.explanation).toContain('liquidity');
      expect(result.alternatives).toHaveLength(2);
    });
  });

  describe('confidence scoring', () => {
    it('should include confidence scores in recommendations', async () => {
      const mockRecommendations: Recommendation[] = [
        {
          id: 'conf-1',
          action: 'Action 1',
          reasoning: 'Reasoning',
          type: 'yield',
          expectedYield: 10,
          expectedRiskReduction: 0,
          confidence: 0.95,
          createdAt: '2026-03-07T10:00:00Z',
        },
        {
          id: 'conf-2',
          action: 'Action 2',
          reasoning: 'Reasoning',
          type: 'yield',
          expectedYield: 8,
          expectedRiskReduction: 0,
          confidence: 0.65,
          createdAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRecommendations,
      });

      const result = await service.getRecommendations({
        currentPortfolio: {},
        riskProfile: 'moderate',
      });

      expect(result[0].confidence).toBe(0.95);
      expect(result[1].confidence).toBe(0.65);
    });
  });

  describe('caching', () => {
    it('should cache recommendations for 60 seconds', async () => {
      const mockRecommendations: Recommendation[] = [
        {
          id: 'cache-rec-1',
          action: 'Cached recommendation',
          reasoning: 'Should use cache',
          type: 'yield',
          expectedYield: 10,
          expectedRiskReduction: 0,
          confidence: 0.9,
          createdAt: '2026-03-07T10:00:00Z',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRecommendations,
      });

      const result1 = await service.getRecommendations({
        currentPortfolio: {},
        riskProfile: 'moderate',
      });

      const result2 = await service.getRecommendations({
        currentPortfolio: {},
        riskProfile: 'moderate',
      });

      expect(result1).toEqual(result2);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should handle network errors in getRecommendations', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'AI service error' }),
      });

      await expect(
        service.getRecommendations({
          currentPortfolio: {},
          riskProfile: 'conservative',
        })
      ).rejects.toThrow('AI service error');
    });

    it('should handle malformed AI responses', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: 'response' }),
      });

      // Should not crash, handle gracefully
      const result = await service.getRecommendations({
        currentPortfolio: {},
        riskProfile: 'moderate',
      });

      expect(result).toBeDefined();
    });
  });
});
```

**Step 2: Run tests to verify they all fail**

Run: `npm test frontend/src/services/__tests__/AIRecommendationService.test.ts`
Expected: All 12 tests FAIL

**Step 3: Write minimal AIRecommendationService implementation**

Create `frontend/src/services/AIRecommendationService.ts`:

```typescript
import { apiUrl } from '@/lib/api/client';
import type { Recommendation, RebalanceSuggestion, MarketInsights } from './types';

export class AIRecommendationService {
  private recommendationsCache: Recommendation[] | null = null;
  private recommendationsCacheTimestamp: number = 0;
  private readonly RECOMMENDATIONS_CACHE_DURATION = 60000; // 60 seconds

  async getRecommendations(context: {
    currentPortfolio: any;
    riskProfile: 'conservative' | 'moderate' | 'aggressive';
    goals?: string[];
  }): Promise<Recommendation[]> {
    const cacheKey = `recommendations-${context.riskProfile}`;

    // Check cache
    if (
      this.recommendationsCache &&
      Date.now() - this.recommendationsCacheTimestamp < this.RECOMMENDATIONS_CACHE_DURATION
    ) {
      return this.recommendationsCache;
    }

    const url = apiUrl('/api/v1/zkdefi/ai/recommendations');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch recommendations (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    const recommendations = Array.isArray(data) ? data : [];

    // Update cache
    this.recommendationsCache = recommendations;
    this.recommendationsCacheTimestamp = Date.now();

    return recommendations;
  }

  async getRebalancingSuggestion(portfolio: any): Promise<RebalanceSuggestion> {
    const url = apiUrl('/api/v1/zkdefi/ai/rebalance');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolio }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch rebalancing suggestion (${response.status})`;
      throw new Error(detail);
    }

    return await response.json();
  }

  async getMarketInsights(): Promise<MarketInsights> {
    const url = apiUrl('/api/v1/zkdefi/ai/insights');

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch market insights (${response.status})`;
      throw new Error(detail);
    }

    return await response.json();
  }

  async explainDecision(decision: {
    type: 'swap' | 'lp' | 'lending' | 'dca';
    parameters: any;
  }): Promise<{ explanation: string; alternatives: any[] }> {
    const url = apiUrl('/api/v1/zkdefi/ai/explain');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to explain decision (${response.status})`;
      throw new Error(detail);
    }

    return await response.json();
  }
}
```

**Step 4: Run tests to verify they all pass**

Run: `npm test frontend/src/services/__tests__/AIRecommendationService.test.ts`
Expected: All 12 tests PASS

**Step 5: Commit**

```bash
git add frontend/src/services/AIRecommendationService.ts frontend/src/services/__tests__/AIRecommendationService.test.ts
git commit -m "feat(services): add AIRecommendationService with 12 tests"
```

---

## Task 4: ReceiptService Implementation

**Files:**
- Create: `frontend/src/services/ReceiptService.ts`
- Create: `frontend/src/services/__tests__/ReceiptService.test.ts`

**Step 1: Write 10 comprehensive failing tests**

Create `frontend/src/services/__tests__/ReceiptService.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReceiptService } from '../ReceiptService';
import type { ReceiptWithImpact, ReceiptSummary, TradeReceipt } from '../types';

global.fetch = vi.fn();

describe('ReceiptService', () => {
  let service: ReceiptService;

  beforeEach(() => {
    service = new ReceiptService();
    vi.clearAllMocks();
  });

  describe('recordReceipt', () => {
    it('should record a trade receipt', async () => {
      const mockReceipt: TradeReceipt = {
        id: 'receipt-1',
        type: 'swap',
        status: 'executed',
        executedAt: '2026-03-07T10:00:00Z',
        adapter: 'SwapAdapter',
        transactionHash: '0xabc123',
        details: { tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 10 },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'receipt-1' }),
      });

      const result = await service.recordReceipt(mockReceipt);

      expect(result).toBe('receipt-1');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/zkdefi/receipts'),
        expect.any(Object)
      );
    });

    it('should handle recording failure gracefully', async () => {
      const mockReceipt: TradeReceipt = {
        id: 'receipt-fail',
        type: 'lp',
        status: 'failed',
        executedAt: '2026-03-07T10:00:00Z',
        adapter: 'LPAdapter',
        details: {},
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Failed to store receipt' }),
      });

      await expect(service.recordReceipt(mockReceipt)).rejects.toThrow(
        'Failed to store receipt'
      );
    });
  });

  describe('getReceipts', () => {
    it('should fetch all receipts without filters', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'receipt-1',
          type: 'swap',
          status: 'executed',
          executedAt: '2026-03-07T10:00:00Z',
          adapter: 'SwapAdapter',
          transactionHash: '0xabc123',
          details: {},
          reputationImpact: 5,
        },
        {
          id: 'receipt-2',
          type: 'lp',
          status: 'executed',
          executedAt: '2026-03-06T10:00:00Z',
          adapter: 'LPAdapter',
          transactionHash: '0xdef456',
          details: {},
          reputationImpact: 8,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts();

      expect(result).toEqual(mockReceipts);
      expect(result).toHaveLength(2);
    });

    it('should fetch receipts filtered by date range', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'receipt-dated',
          type: 'swap',
          status: 'executed',
          executedAt: '2026-03-07T10:00:00Z',
          adapter: 'SwapAdapter',
          details: {},
          reputationImpact: 3,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts({
        startDate: '2026-03-01T00:00:00Z',
        endDate: '2026-03-10T23:59:59Z',
      });

      expect(result).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('startDate'),
        expect.any(Object)
      );
    });

    it('should fetch receipts filtered by type', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'lp-receipt',
          type: 'lp',
          status: 'executed',
          executedAt: '2026-03-07T10:00:00Z',
          adapter: 'LPAdapter',
          details: {},
          reputationImpact: 8,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts({ type: 'lp' });

      expect(result[0].type).toBe('lp');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('type=lp'),
        expect.any(Object)
      );
    });

    it('should fetch receipts filtered by adapter', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'dca-receipt',
          type: 'dca',
          status: 'executed',
          executedAt: '2026-03-07T10:00:00Z',
          adapter: 'DCAAdapter',
          details: {},
          reputationImpact: 2,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts({ adapter: 'DCAAdapter' });

      expect(result[0].adapter).toBe('DCAAdapter');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('adapter=DCAAdapter'),
        expect.any(Object)
      );
    });

    it('should handle empty results', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await service.getReceipts({ type: 'nonexistent' });

      expect(result).toEqual([]);
    });
  });

  describe('getReceiptSummary', () => {
    it('should fetch receipt summary with all metrics', async () => {
      const mockSummary: ReceiptSummary = {
        totalExecutions: 25,
        totalYield: 1250,
        successRate: 0.92,
        reputationGainedFromProofs: 145,
        topPerformingAdapter: 'LPAdapter',
        lastExecutionTime: '2026-03-07T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSummary,
      });

      const result = await service.getReceiptSummary();

      expect(result).toEqual(mockSummary);
      expect(result.totalExecutions).toBe(25);
      expect(result.successRate).toBeCloseTo(0.92, 2);
      expect(result.topPerformingAdapter).toBe('LPAdapter');
    });

    it('should handle zero execution history', async () => {
      const mockSummary: ReceiptSummary = {
        totalExecutions: 0,
        totalYield: 0,
        successRate: 0,
        reputationGainedFromProofs: 0,
        topPerformingAdapter: 'N/A',
        lastExecutionTime: '',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSummary,
      });

      const result = await service.getReceiptSummary();

      expect(result.totalExecutions).toBe(0);
      expect(result.totalYield).toBe(0);
    });
  });

  describe('getReceiptTimeline', () => {
    it('should fetch recent receipts in descending order (Memory Lane)', async () => {
      const mockTimeline: ReceiptWithImpact[] = [
        {
          id: 'receipt-latest',
          type: 'swap',
          status: 'executed',
          executedAt: '2026-03-07T15:00:00Z',
          adapter: 'SwapAdapter',
          details: {},
          reputationImpact: 5,
          explanationFromAI: 'Swap executed due to market conditions',
        },
        {
          id: 'receipt-prev',
          type: 'lp',
          status: 'executed',
          executedAt: '2026-03-07T14:00:00Z',
          adapter: 'LPAdapter',
          details: {},
          reputationImpact: 8,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTimeline,
      });

      const result = await service.getReceiptTimeline(50);

      expect(result).toHaveLength(2);
      // Most recent should be first
      expect(new Date(result[0].executedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result[1].executedAt).getTime()
      );
    });

    it('should respect limit parameter', async () => {
      const mockTimeline: ReceiptWithImpact[] = Array.from({ length: 10 }, (_, i) => ({
        id: `receipt-${i}`,
        type: 'swap' as const,
        status: 'executed' as const,
        executedAt: '2026-03-07T10:00:00Z',
        adapter: 'SwapAdapter',
        details: {},
        reputationImpact: 5,
      }));

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTimeline,
      });

      const result = await service.getReceiptTimeline(10);

      expect(result).toHaveLength(10);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      );
    });

    it('should include AI explanations when available', async () => {
      const mockTimeline: ReceiptWithImpact[] = [
        {
          id: 'receipt-explained',
          type: 'lp',
          status: 'executed',
          executedAt: '2026-03-07T10:00:00Z',
          adapter: 'LPAdapter',
          details: {},
          reputationImpact: 8,
          explanationFromAI: 'High yield opportunity in ETH/USDC pair',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTimeline,
      });

      const result = await service.getReceiptTimeline(50);

      expect(result[0].explanationFromAI).toBeTruthy();
    });
  });

  describe('reputation impact calculation', () => {
    it('should track reputation impact for successful trades', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'success-high-impact',
          type: 'lp',
          status: 'executed',
          executedAt: '2026-03-07T10:00:00Z',
          adapter: 'LPAdapter',
          details: {},
          reputationImpact: 15,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts();

      expect(result[0].reputationImpact).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should handle network errors when recording receipt', async () => {
      const mockReceipt: TradeReceipt = {
        id: 'receipt-error',
        type: 'swap',
        status: 'executed',
        executedAt: '2026-03-07T10:00:00Z',
        adapter: 'SwapAdapter',
        details: {},
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ detail: 'Service temporarily unavailable' }),
      });

      await expect(service.recordReceipt(mockReceipt)).rejects.toThrow(
        'Service temporarily unavailable'
      );
    });

    it('should handle network errors when fetching receipts', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal server error' }),
      });

      await expect(service.getReceipts()).rejects.toThrow('Internal server error');
    });
  });

  describe('integration', () => {
    it('should record, retrieve, and summarize receipts', async () => {
      // Record
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'new-receipt' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              id: 'new-receipt',
              type: 'swap',
              status: 'executed',
              executedAt: '2026-03-07T10:00:00Z',
              adapter: 'SwapAdapter',
              details: {},
              reputationImpact: 5,
            },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            totalExecutions: 1,
            totalYield: 0,
            successRate: 1.0,
            reputationGainedFromProofs: 5,
            topPerformingAdapter: 'SwapAdapter',
            lastExecutionTime: '2026-03-07T10:00:00Z',
          }),
        });

      const receipt: TradeReceipt = {
        id: 'new-receipt',
        type: 'swap',
        status: 'executed',
        executedAt: '2026-03-07T10:00:00Z',
        adapter: 'SwapAdapter',
        details: {},
      };

      const id = await service.recordReceipt(receipt);
      expect(id).toBe('new-receipt');

      const receipts = await service.getReceipts();
      expect(receipts).toHaveLength(1);

      const summary = await service.getReceiptSummary();
      expect(summary.totalExecutions).toBe(1);
    });
  });
});
```

**Step 2: Run tests to verify they all fail**

Run: `npm test frontend/src/services/__tests__/ReceiptService.test.ts`
Expected: All 10 tests FAIL

**Step 3: Write minimal ReceiptService implementation**

Create `frontend/src/services/ReceiptService.ts`:

```typescript
import { apiUrl } from '@/lib/api/client';
import type { TradeReceipt, ReceiptWithImpact, ReceiptSummary } from './types';

export class ReceiptService {
  async recordReceipt(receipt: TradeReceipt): Promise<string> {
    const url = apiUrl('/api/v1/zkdefi/receipts');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receipt),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to record receipt (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    return data.id;
  }

  async getReceipts(filters?: {
    startDate?: string;
    endDate?: string;
    type?: string;
    adapter?: string;
  }): Promise<ReceiptWithImpact[]> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.adapter) params.append('adapter', filters.adapter);

    const url = apiUrl(`/api/v1/zkdefi/receipts?${params}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch receipts (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async getReceiptSummary(): Promise<ReceiptSummary> {
    const url = apiUrl('/api/v1/zkdefi/receipts/summary');

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch receipt summary (${response.status})`;
      throw new Error(detail);
    }

    return await response.json();
  }

  async getReceiptTimeline(limit: number = 50): Promise<ReceiptWithImpact[]> {
    const params = new URLSearchParams();
    params.append('limit', String(limit));

    const url = apiUrl(`/api/v1/zkdefi/receipts/timeline?${params}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch receipt timeline (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }
}
```

**Step 4: Run tests to verify they all pass**

Run: `npm test frontend/src/services/__tests__/ReceiptService.test.ts`
Expected: All 10 tests PASS

**Step 5: Commit**

```bash
git add frontend/src/services/ReceiptService.ts frontend/src/services/__tests__/ReceiptService.test.ts
git commit -m "feat(services): add ReceiptService with 10 tests"
```

---

## Task 5: Final Verification & Integration

**Step 1: Run all tests to verify complete suite passes**

Run: `npm test frontend/src/services/`
Expected: All 37 tests PASS (15 MarketData + 12 AIRecommendation + 10 Receipt)

**Step 2: Lint check**

Run: `npm run lint frontend/src/services/`
Expected: No errors

**Step 3: Create integration test file documenting usage**

Create `frontend/src/services/__tests__/services-integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MarketDataService } from '../MarketDataService';
import { AIRecommendationService } from '../AIRecommendationService';
import { ReceiptService } from '../ReceiptService';

describe('Phase 3 Services Integration', () => {
  it('should instantiate all three core services', () => {
    const marketDataService = new MarketDataService();
    const aiRecommendationService = new AIRecommendationService();
    const receiptService = new ReceiptService();

    expect(marketDataService).toBeDefined();
    expect(aiRecommendationService).toBeDefined();
    expect(receiptService).toBeDefined();
  });

  it('should have all required methods for MarketDataService', () => {
    const service = new MarketDataService();

    expect(typeof service.getOpportunities).toBe('function');
    expect(typeof service.getPoolData).toBe('function');
    expect(typeof service.getMarketContext).toBe('function');
    expect(typeof service.streamOpportunities).toBe('function');
  });

  it('should have all required methods for AIRecommendationService', () => {
    const service = new AIRecommendationService();

    expect(typeof service.getRecommendations).toBe('function');
    expect(typeof service.getRebalancingSuggestion).toBe('function');
    expect(typeof service.getMarketInsights).toBe('function');
    expect(typeof service.explainDecision).toBe('function');
  });

  it('should have all required methods for ReceiptService', () => {
    const service = new ReceiptService();

    expect(typeof service.recordReceipt).toBe('function');
    expect(typeof service.getReceipts).toBe('function');
    expect(typeof service.getReceiptSummary).toBe('function');
    expect(typeof service.getReceiptTimeline).toBe('function');
  });
});
```

**Step 4: Final commit**

```bash
git add frontend/src/services/__tests__/services-integration.test.ts
git commit -m "test(services): add integration test for Phase 3 core services"
```

**Step 5: Final verification commands**

Run all three verification checks:

```bash
npm test frontend/src/services/ -- --reporter=verbose
npm run lint frontend/src/services/
```

Expected output:
- All 38+ tests pass (37 unit tests + integration tests)
- No linting errors
- Services ready for UI component integration

---

## Success Criteria

✅ **MarketDataService** - 15 tests passing, methods for opportunities/pools/market context, 30s caching
✅ **AIRecommendationService** - 12 tests passing, methods for recommendations/rebalancing/insights/explanations, 60s caching
✅ **ReceiptService** - 10 tests passing, methods for record/retrieve/summary/timeline with reputation tracking
✅ All services use `apiUrl()` helper for routing
✅ All services have proper error handling and type safety
✅ Shared types in `types.ts`
✅ All 37+ tests pass
✅ No linting errors
✅ Commits follow "feat(services): ..." pattern

---

## Next Steps After Completion

This unblocks **Phase 3, Task 2: UI Components**:
- OpportunityList component (uses MarketDataService)
- ExecutionPanel component (uses AIRecommendationService)
- TradeDesk component (uses ReceiptService)
- Memory Lane timeline view

