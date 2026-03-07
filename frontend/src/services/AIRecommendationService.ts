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
