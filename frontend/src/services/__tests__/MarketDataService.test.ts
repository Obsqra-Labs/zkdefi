import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketDataService } from '../MarketDataService';
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

    it('should handle multiple filters combined (type + yield + risk + privacy)', async () => {
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

    it('should return empty array when no opportunities match filters', async () => {
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

    it('should handle null descriptions in opportunities', async () => {
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

    it('should handle missing optional fields like tvl and tokenA/tokenB', async () => {
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
      expect(result[0].tvl).toBeUndefined();
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
    it('should return an observable that emits opportunities', async () => {
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

      return new Promise<void>((resolve) => {
        observable.subscribe((opps) => {
          expect(opps).toEqual(mockOpportunities);
          resolve();
        });
      });
    });
  });
});
