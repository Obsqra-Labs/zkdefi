import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DCAAdapter } from '../DCAAdapter';
import * as client from '@/lib/api/client';

global.fetch = vi.fn();

describe('DCAAdapter', () => {
  let adapter: DCAAdapter;

  beforeEach(() => {
    adapter = new DCAAdapter();
    vi.clearAllMocks();
  });

  describe('ExecutionAdapter interface', () => {
    it('should have name property', () => {
      expect(adapter.name).toBe('dca');
    });

    it('should have supportsPrivacy property set to true', () => {
      expect(adapter.supportsPrivacy).toBe(true);
    });

    it('should have supportsActions array with required actions', () => {
      expect(Array.isArray(adapter.supportsActions)).toBe(true);
      expect(adapter.supportsActions).toContain('create_position');
      expect(adapter.supportsActions).toContain('pause');
      expect(adapter.supportsActions).toContain('resume');
      expect(adapter.supportsActions).toContain('cancel');
    });
  });

  describe('createPosition - Basic DCA position creation', () => {
    it('should create a DCA position (public)', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800, // 7 days
        amountPerInterval: 500,
        totalDuration: 2592000, // 30 days
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-001',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'public',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      const result = await adapter.createPosition(params);

      expect(result.positionId).toBe('dca-001');
      expect(result.status).toBe('active');
      expect(result.privacyMode).toBe('public');
      expect(result.nextExecutionTime).toBeDefined();
    });

    it('should call correct API endpoint for creation', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-001',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'public',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      await adapter.createPosition(params);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/zkdefi/dca/create'),
        expect.any(Object)
      );
    });

    it('should send POST request with required payload', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-001',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'public',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      await adapter.createPosition(params);

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(callArgs[1].body);
      expect(body.sell_token).toBe('USDC');
      expect(body.buy_token).toBe('STRK');
      expect(body.amount_per_interval).toBe(500);
    });
  });

  describe('createPosition - Privacy modes', () => {
    it('should support shielded privacy mode with commitment', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-shielded-001',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'shielded',
          commitment: 'commitment-hash-abc123',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      const result = await adapter.createPosition(params);

      expect(result.privacyMode).toBe('shielded');
      expect(result.commitment).toBeDefined();
    });

    it('should support fully_private privacy mode', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'fully_private' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-dark-001',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'fully_private',
          commitment: 'commitment-hash-def456',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      const result = await adapter.createPosition(params);

      expect(result.privacyMode).toBe('fully_private');
      expect(result.commitment).toBeDefined();
    });
  });

  describe('cancelPosition', () => {
    it('should cancel a DCA position', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'cancelled',
          executedCount: 3,
          remainingAmount: 1000,
        }),
      });

      const result = await adapter.cancelPosition(positionId);

      expect(result.status).toBe('cancelled');
      expect(result.executedCount).toBe(3);
      expect(result.remainingAmount).toBe(1000);
    });

    it('should call correct API endpoint for cancellation', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'cancelled',
          executedCount: 3,
          remainingAmount: 1000,
        }),
      });

      await adapter.cancelPosition(positionId);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/zkdefi/dca/${positionId}/cancel`),
        expect.any(Object)
      );
    });

    it('should send POST request for cancellation', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'cancelled',
          executedCount: 3,
          remainingAmount: 1000,
        }),
      });

      await adapter.cancelPosition(positionId);

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].method).toBe('POST');
    });
  });

  describe('getExecutionHistory', () => {
    it('should fetch execution history for a position', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            timestamp: '2026-03-07T10:00:00Z',
            amountIn: 500,
            amountOut: 1250,
            priceAtExecution: 2.5,
            txHash: '0xabc123',
          },
          {
            timestamp: '2026-03-14T10:00:00Z',
            amountIn: 500,
            amountOut: 1100,
            priceAtExecution: 2.2,
            txHash: '0xdef456',
          },
        ],
      });

      const result = await adapter.getExecutionHistory(positionId);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].amountIn).toBe(500);
      expect(result[0].priceAtExecution).toBe(2.5);
    });

    it('should call correct API endpoint for history', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await adapter.getExecutionHistory(positionId);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/zkdefi/dca/${positionId}/history`),
        expect.any(Object)
      );
    });

    it('should send GET request for history', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await adapter.getExecutionHistory(positionId);

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].method).toBe('GET');
    });
  });

  describe('estimateAverageCost', () => {
    it('should estimate average cost for DCA purchase', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        amountPerInterval: 500,
        historyDays: 30,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          estimatedAverageCost: 2.35,
          volatilityMitigation: 0.15,
          slippageExposure: 0.02,
        }),
      });

      const result = await adapter.estimateAverageCost(params);

      expect(result.estimatedAverageCost).toBe(2.35);
      expect(result.volatilityMitigation).toBe(0.15);
      expect(result.slippageExposure).toBe(0.02);
    });

    it('should call correct API endpoint for estimate', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        amountPerInterval: 500,
        historyDays: 30,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          estimatedAverageCost: 2.35,
          volatilityMitigation: 0.15,
          slippageExposure: 0.02,
        }),
      });

      await adapter.estimateAverageCost(params);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/zkdefi/dca/estimate'),
        expect.any(Object)
      );
    });

    it('should send POST request for estimate with correct payload', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        amountPerInterval: 500,
        historyDays: 30,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          estimatedAverageCost: 2.35,
          volatilityMitigation: 0.15,
          slippageExposure: 0.02,
        }),
      });

      await adapter.estimateAverageCost(params);

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].method).toBe('POST');

      const body = JSON.parse(callArgs[1].body);
      expect(body.sell_token).toBe('USDC');
      expect(body.buy_token).toBe('STRK');
      expect(body.amount_per_interval).toBe(500);
    });
  });

  describe('pausePosition', () => {
    it('should pause an active DCA position', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-001',
          status: 'paused',
        }),
      });

      const result = await adapter.pausePosition(positionId);

      expect(result.status).toBe('paused');
    });

    it('should call correct API endpoint for pause', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-001',
          status: 'paused',
        }),
      });

      await adapter.pausePosition(positionId);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/zkdefi/dca/${positionId}/pause`),
        expect.any(Object)
      );
    });
  });

  describe('resumePosition', () => {
    it('should resume a paused DCA position', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-001',
          status: 'active',
        }),
      });

      const result = await adapter.resumePosition(positionId);

      expect(result.status).toBe('active');
    });

    it('should call correct API endpoint for resume', async () => {
      const positionId = 'dca-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-001',
          status: 'active',
        }),
      });

      await adapter.resumePosition(positionId);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/zkdefi/dca/${positionId}/resume`),
        expect.any(Object)
      );
    });
  });

  describe('execute - ExecutionAdapter interface', () => {
    it('should implement execute method from ExecutionAdapter', async () => {
      const opportunity = {
        sellToken: 'USDC',
        buyToken: 'STRK',
      };
      const options = {
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-exec-001',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'public',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      const result = await adapter.execute(opportunity, options);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('adapter');
      expect(result.action).toBe('create_position');
      expect(result.adapter).toBe('dca');
    });

    it('should return TradeReceipt with execution metadata', async () => {
      const opportunity = {
        sellToken: 'USDC',
        buyToken: 'STRK',
      };
      const options = {
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-exec-001',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'public',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      const result = await adapter.execute(opportunity, options);

      expect(result.amount).toBe(500); // amountPerInterval
      expect(result.privacyLevel).toBe('public');
      expect(result.yieldImpact).toBe(0); // DCA doesn't generate yield
      expect(result.trustDelta).toBe(1); // Creating position increases trust
      expect(result.status).toBe('confirmed');
    });

    it('should set privacy level from options', async () => {
      const opportunity = {
        sellToken: 'USDC',
        buyToken: 'STRK',
      };
      const options = {
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-exec-shielded',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'shielded',
          commitment: 'commitment-hash',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      const result = await adapter.execute(opportunity, options);

      expect(result.privacyLevel).toBe('shielded');
    });
  });

  describe('estimateImpact', () => {
    it('should return zero yield for DCA (no yield generation)', async () => {
      const opportunity = {};
      const amount = 500;

      const impact = await adapter.estimateImpact(opportunity, amount);

      expect(impact.yield).toBe(0);
    });

    it('should indicate reduced risk for DCA (volatility mitigation)', async () => {
      const opportunity = {};
      const amount = 500;

      const impact = await adapter.estimateImpact(opportunity, amount);

      expect(impact.risk).toBe('reduced');
    });

    it('should handle different amounts', async () => {
      const opportunity = {};

      const impact1 = await adapter.estimateImpact(opportunity, 100);
      const impact2 = await adapter.estimateImpact(opportunity, 5000);

      expect(impact1.yield).toBe(0);
      expect(impact2.yield).toBe(0);
      expect(impact1.risk).toBe('reduced');
      expect(impact2.risk).toBe('reduced');
    });
  });

  describe('Multiple interval execution tracking', () => {
    it('should track execution history across multiple intervals', async () => {
      const positionId = 'dca-multi-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            timestamp: '2026-02-07T10:00:00Z',
            amountIn: 500,
            amountOut: 1200,
            priceAtExecution: 2.4,
            txHash: '0x1111',
          },
          {
            timestamp: '2026-02-14T10:00:00Z',
            amountIn: 500,
            amountOut: 1400,
            priceAtExecution: 2.8,
            txHash: '0x2222',
          },
          {
            timestamp: '2026-02-21T10:00:00Z',
            amountIn: 500,
            amountOut: 1300,
            priceAtExecution: 2.6,
            txHash: '0x3333',
          },
          {
            timestamp: '2026-02-28T10:00:00Z',
            amountIn: 500,
            amountOut: 1250,
            priceAtExecution: 2.5,
            txHash: '0x4444',
          },
        ],
      });

      const result = await adapter.getExecutionHistory(positionId);

      expect(result.length).toBe(4);
      const averagePrice =
        (2.4 + 2.8 + 2.6 + 2.5) / 4;
      expect(averagePrice).toBeCloseTo(2.575, 2);

      // Verify execution count
      const totalExecuted = result.reduce((sum, e) => sum + e.amountIn, 0);
      expect(totalExecuted).toBe(2000);
    });
  });

  describe('Error handling', () => {
    it('should handle API errors for position creation', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Invalid token pair' }),
      });

      await expect(adapter.createPosition(params)).rejects.toThrow(
        'Invalid token pair'
      );
    });

    it('should handle network errors gracefully', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(adapter.createPosition(params)).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle JSON parse errors from API', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(adapter.createPosition(params)).rejects.toThrow();
    });

    it('should provide meaningful error for invalid position cancellation', async () => {
      const positionId = 'dca-nonexistent';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Position not found' }),
      });

      await expect(adapter.cancelPosition(positionId)).rejects.toThrow(
        'Position not found'
      );
    });
  });

  describe('Integration workflow', () => {
    it('should execute full DCA workflow: create -> get history -> cancel', async () => {
      // Step 1: Create position
      const createParams = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'dca-workflow-001',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'public',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      const position = await adapter.createPosition(createParams);
      expect(position.positionId).toBe('dca-workflow-001');

      // Step 2: Get execution history
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            timestamp: '2026-03-07T10:00:00Z',
            amountIn: 500,
            amountOut: 1250,
            priceAtExecution: 2.5,
            txHash: '0xabc123',
          },
        ],
      });

      const history = await adapter.getExecutionHistory(position.positionId);
      expect(history.length).toBe(1);
      expect(history[0].priceAtExecution).toBe(2.5);

      // Step 3: Cancel position
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'cancelled',
          executedCount: 1,
          remainingAmount: 2000,
        }),
      });

      const cancelResult = await adapter.cancelPosition(position.positionId);
      expect(cancelResult.status).toBe('cancelled');
      expect(cancelResult.executedCount).toBe(1);
    });

    it('should track all API calls in correct order', async () => {
      const createParams = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        intervalSeconds: 604800,
        amountPerInterval: 500,
        totalDuration: 2592000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          positionId: 'dca-001',
          sellToken: 'USDC',
          buyToken: 'STRK',
          intervalSeconds: 604800,
          amountPerInterval: 500,
          totalDuration: 2592000,
          status: 'active',
          nextExecutionTime: '2026-03-14T10:00:00Z',
          privacyMode: 'public',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      // Execute multiple operations
      await adapter.createPosition(createParams);
      await adapter.pausePosition('dca-001');
      await adapter.resumePosition('dca-001');

      // Verify all calls were made
      expect(global.fetch).toHaveBeenCalledTimes(3);

      // Verify call URLs in order
      const calls = (global.fetch as any).mock.calls;
      expect(calls[0][0]).toContain('/api/v1/zkdefi/dca/create');
      expect(calls[1][0]).toContain('/api/v1/zkdefi/dca/dca-001/pause');
      expect(calls[2][0]).toContain('/api/v1/zkdefi/dca/dca-001/resume');
    });
  });
});
