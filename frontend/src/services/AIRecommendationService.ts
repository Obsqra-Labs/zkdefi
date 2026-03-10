import { apiFetch } from '@/lib/api/client';
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

    let recommendations: Recommendation[] = [];

    // Live endpoint is GET in backend route.
    try {
      const live = await apiFetch<Recommendation[] | { recommendations?: Recommendation[] }>(
        '/api/v1/zkdefi/ai/recommendations/live',
        {
          method: 'GET',
        },
      );
      recommendations = Array.isArray(live) ? live : (live.recommendations || []);
    } catch (e) {
      console.warn("Live recommendation fetch failed, trying fallback...");
    }

    if (recommendations.length === 0) {
      try {
        const data = await apiFetch<Recommendation[] | { recommendations?: Recommendation[] }>(
          '/api/v1/zkdefi/ai/recommendations',
          {
            method: 'POST',
            body: JSON.stringify(context),
          },
        );
        recommendations = Array.isArray(data) ? data : (data.recommendations || []);
      } catch (e) {
        console.warn("Fallback recommendation fetch failed");
      }
    }
    
    if (recommendations.length === 0) {
      throw new Error('Failed to fetch recommendations from any source');
    }

    // Update cache
    this.recommendationsCache = recommendations;
    this.recommendationsCacheTimestamp = Date.now();

    return recommendations;
  }

  async getRebalancingSuggestion(portfolio: any): Promise<RebalanceSuggestion> {
    return await apiFetch<RebalanceSuggestion>('/api/v1/zkdefi/ai/rebalance', {
      method: 'POST',
      body: JSON.stringify({ portfolio }),
    });
  }

  async getMarketInsights(): Promise<MarketInsights> {
    return await apiFetch<MarketInsights>('/api/v1/zkdefi/ai/insights', {
      method: 'GET',
    });
  }

  async explainDecision(decision: {
    type: 'swap' | 'lp' | 'lending' | 'dca';
    parameters: any;
  }): Promise<{ explanation: string; alternatives: any[] }> {
    return await apiFetch<{ explanation: string; alternatives: any[] }>('/api/v1/zkdefi/ai/explain', {
      method: 'POST',
      body: JSON.stringify(decision),
    });
  }
}
