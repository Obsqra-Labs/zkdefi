import { apiFetch } from '@/lib/api/client';
import type { Opportunity, PoolData, MarketContext } from './types';

export class MarketDataService {
  private opportunitiesCache: Opportunity[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  private buildPath(basePath: string, params?: URLSearchParams): string {
    const query = params?.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

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

    // Try live endpoint first, fallback to list endpoint.
    const urls = [
      this.buildPath('/api/v1/zkdefi/opportunities/live', params),
      this.buildPath('/api/v1/zkdefi/opportunities/list', params),
    ];
    
    let opportunities: Opportunity[] = [];
    
    for (const url of urls) {
      try {
        const data = await apiFetch<Opportunity[] | { opportunities?: Opportunity[] }>(url, {
          method: 'GET',
        });
        opportunities = Array.isArray(data) ? data : (data.opportunities || []);
        if (opportunities.length > 0) break;
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
    return await apiFetch<PoolData>(`/api/v1/zkdefi/pools/${poolId}/data`, {
      method: 'GET',
    });
  }

  async getMarketContext(): Promise<MarketContext> {
    return await apiFetch<MarketContext>('/api/v1/zkdefi/market/context', {
      method: 'GET',
    });
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
