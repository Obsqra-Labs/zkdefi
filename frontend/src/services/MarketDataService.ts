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
    // Check cache only if no filters are applied
    if (
      !filters &&
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

    // Try live endpoint first, fallback to mock
    const urls = [
      apiUrl(`/api/v1/zkdefi/opportunities/live?${params}`),
      apiUrl(`/api/v1/zkdefi/opportunities/list?${params}`)
    ];
    
    let opportunities: Opportunity[] = [];
    
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          opportunities = Array.isArray(data) ? data : (data.opportunities || []);
          break;
        }
      } catch (e) {
        console.warn(`Fetch from ${url} failed, trying next...`);
        continue;
      }
    }
    
    if (opportunities.length === 0) {
      throw new Error('Failed to fetch opportunities from any source');
    }

    // Update cache only if no filters
    if (!filters) {
      this.opportunitiesCache = opportunities;
      this.cacheTimestamp = Date.now();
    }

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
