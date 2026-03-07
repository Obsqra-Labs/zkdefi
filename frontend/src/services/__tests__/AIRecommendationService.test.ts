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
