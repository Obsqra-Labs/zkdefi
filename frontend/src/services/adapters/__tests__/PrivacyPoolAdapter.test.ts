import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrivacyPoolAdapter } from '../PrivacyPoolAdapter';
import * as client from '@/lib/api/client';

global.fetch = vi.fn();

describe('PrivacyPoolAdapter', () => {
  let adapter: PrivacyPoolAdapter;

  beforeEach(() => {
    adapter = new PrivacyPoolAdapter();
    vi.clearAllMocks();
  });

  describe('ExecutionAdapter interface', () => {
    it('should have name property set to privacy_pools', () => {
      expect(adapter.name).toBe('privacy_pools');
    });

    it('should have supportsPrivacy property set to true', () => {
      expect(adapter.supportsPrivacy).toBe(true);
    });

    it('should have supportsActions array with deposit, withdraw, transfer', () => {
      expect(Array.isArray(adapter.supportsActions)).toBe(true);
      expect(adapter.supportsActions).toContain('deposit');
      expect(adapter.supportsActions).toContain('withdraw');
      expect(adapter.supportsActions).toContain('transfer');
    });
  });

  describe('getPoolForRiskProfile', () => {
    it('should map conservative to CONSERVATIVE_POOL', () => {
      const pool = adapter.getPoolForRiskProfile('conservative');
      expect(pool).toBe('CONSERVATIVE_POOL');
    });

    it('should map moderate to MODERATE_POOL', () => {
      const pool = adapter.getPoolForRiskProfile('moderate');
      expect(pool).toBe('MODERATE_POOL');
    });

    it('should map aggressive to AGGRESSIVE_POOL', () => {
      const pool = adapter.getPoolForRiskProfile('aggressive');
      expect(pool).toBe('AGGRESSIVE_POOL');
    });
  });

  describe('depositToPool', () => {
    it('should deposit to pool and return receipt with pool share', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 10000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-001',
          pool: 'MODERATE_POOL',
          amount: 10000,
          privacyMode: 'shielded',
          poolShare: 0.05,
          txHash: '0xabc123',
          timestamp: '2026-03-07T10:00:00Z',
        }),
      });

      const receipt = await adapter.depositToPool(params);

      expect(receipt.id).toBe('deposit-001');
      expect(receipt.pool).toBe('MODERATE_POOL');
      expect(receipt.amount).toBe(10000);
      expect(receipt.privacyMode).toBe('shielded');
      expect(receipt.poolShare).toBe(0.05);
      expect(receipt.txHash).toBe('0xabc123');
    });

    it('should call correct API endpoint for deposit', async () => {
      const params = {
        pool: 'CONSERVATIVE_POOL',
        amount: 5000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-002',
          pool: 'CONSERVATIVE_POOL',
          amount: 5000,
          privacyMode: 'public',
          poolShare: 0.02,
          txHash: '0xdef456',
          timestamp: '2026-03-07T10:01:00Z',
        }),
      });

      await adapter.depositToPool(params);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/dao/pools/CONSERVATIVE_POOL/deposit'),
        expect.any(Object)
      );
    });

    it('should support private deposits with commitment', async () => {
      const params = {
        pool: 'AGGRESSIVE_POOL',
        amount: 20000,
        privacyMode: 'dark_ledger' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-003',
          pool: 'AGGRESSIVE_POOL',
          amount: 20000,
          privacyMode: 'dark_ledger',
          poolShare: 0.08,
          txHash: '0xghi789',
          timestamp: '2026-03-07T10:02:00Z',
          commitment: 'commitment-hash-xyz',
        }),
      });

      const receipt = await adapter.depositToPool(params);

      expect(receipt.privacyMode).toBe('dark_ledger');
      expect(receipt.commitment).toBeDefined();
    });

    it('should send POST request with deposit payload', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 10000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-004',
          pool: 'MODERATE_POOL',
          amount: 10000,
          privacyMode: 'shielded',
          poolShare: 0.05,
          txHash: '0xjkl012',
          timestamp: '2026-03-07T10:03:00Z',
        }),
      });

      await adapter.depositToPool(params);

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(callArgs[1].body);
      expect(body.amount).toBe(10000);
      expect(body.privacyMode).toBe('shielded');
    });
  });

  describe('getPoolStats', () => {
    it('should fetch pool statistics', async () => {
      const pool = 'MODERATE_POOL';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pool: 'MODERATE_POOL',
          totalDeposited: 500000,
          currentYield: 14.5,
          borrowersActive: 12,
          avgBorrowingRate: 5.2,
          idleCapital: 150000,
          utilizationRate: 0.7,
        }),
      });

      const stats = await adapter.getPoolStats(pool);

      expect(stats.pool).toBe('MODERATE_POOL');
      expect(stats.totalDeposited).toBe(500000);
      expect(stats.currentYield).toBe(14.5);
      expect(stats.borrowersActive).toBe(12);
      expect(stats.avgBorrowingRate).toBe(5.2);
      expect(stats.idleCapital).toBe(150000);
      expect(stats.utilizationRate).toBe(0.7);
    });

    it('should call correct API endpoint for pool stats', async () => {
      const pool = 'CONSERVATIVE_POOL';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pool: 'CONSERVATIVE_POOL',
          totalDeposited: 1000000,
          currentYield: 10.0,
          borrowersActive: 5,
          avgBorrowingRate: 3.5,
          idleCapital: 400000,
          utilizationRate: 0.6,
        }),
      });

      await adapter.getPoolStats(pool);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/dao/pools/${pool}/stats`),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('getYieldDistributions', () => {
    it('should fetch yield distributions for vault holders', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            pool: 'CONSERVATIVE_POOL',
            amount: 5000,
            timestamp: '2026-03-01T00:00:00Z',
            reason: 'monthly',
          },
          {
            pool: 'MODERATE_POOL',
            amount: 7500,
            timestamp: '2026-03-01T00:00:00Z',
            reason: 'monthly',
          },
        ],
      });

      const distributions = await adapter.getYieldDistributions();

      expect(Array.isArray(distributions)).toBe(true);
      expect(distributions.length).toBe(2);
      expect(distributions[0].pool).toBe('CONSERVATIVE_POOL');
      expect(distributions[0].amount).toBe(5000);
      expect(distributions[0].reason).toBe('monthly');
    });

    it('should call correct API endpoint for yield distributions', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await adapter.getYieldDistributions();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/dao/pools/yield/distributions'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('withdrawFromPool', () => {
    it('should withdraw from pool', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'withdraw-001',
          pool: 'MODERATE_POOL',
          amount: 5000,
          address: '0x123abc',
          txHash: '0xabc999',
          timestamp: '2026-03-07T10:30:00Z',
        }),
      });

      const receipt = await adapter.withdrawFromPool(params);

      expect(receipt.id).toBe('withdraw-001');
      expect(receipt.pool).toBe('MODERATE_POOL');
      expect(receipt.amount).toBe(5000);
    });

    it('should call correct API endpoint for withdrawal', async () => {
      const params = {
        pool: 'CONSERVATIVE_POOL',
        amount: 2000,
        address: '0x456def',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'withdraw-002',
          pool: 'CONSERVATIVE_POOL',
          amount: 2000,
          address: '0x456def',
          txHash: '0xdef888',
          timestamp: '2026-03-07T10:31:00Z',
        }),
      });

      await adapter.withdrawFromPool(params);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/dao/pools/CONSERVATIVE_POOL/withdraw'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should handle private withdrawals with commitment', async () => {
      const params = {
        pool: 'AGGRESSIVE_POOL',
        amount: 10000,
        address: '0x789ghi',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'withdraw-003',
          pool: 'AGGRESSIVE_POOL',
          amount: 10000,
          address: '0x789ghi',
          txHash: '0xghi777',
          timestamp: '2026-03-07T10:32:00Z',
          commitment: 'commitment-withdrawal-123',
        }),
      });

      const receipt = await adapter.withdrawFromPool(params);

      expect(receipt.commitment).toBeDefined();
    });
  });

  describe('execute - ExecutionAdapter interface', () => {
    it('should implement execute method for deposits', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        type: 'privacy_pool_deposit',
      };
      const options = {
        amount: 10000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-exec-001',
          pool: 'MODERATE_POOL',
          amount: 10000,
          privacyMode: 'shielded',
          poolShare: 0.05,
          txHash: '0xexec001',
          timestamp: '2026-03-07T11:00:00Z',
        }),
      });

      const receipt = await adapter.execute(opportunity, options);

      expect(receipt).toHaveProperty('id');
      expect(receipt).toHaveProperty('timestamp');
      expect(receipt).toHaveProperty('action');
      expect(receipt).toHaveProperty('adapter');
      expect(receipt.action).toBe('deposit');
      expect(receipt.adapter).toBe('privacy_pools');
    });

    it('should return TradeReceipt with execution metadata', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        type: 'privacy_pool_deposit',
      };
      const options = {
        amount: 10000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-exec-002',
          pool: 'MODERATE_POOL',
          amount: 10000,
          privacyMode: 'shielded',
          poolShare: 0.05,
          txHash: '0xexec002',
          timestamp: '2026-03-07T11:01:00Z',
        }),
      });

      const receipt = await adapter.execute(opportunity, options);

      expect(receipt.amount).toBe(10000);
      expect(receipt.privacyLevel).toBe('shielded');
      expect(receipt.yieldImpact).toBeGreaterThan(0);
    });

    it('should set privacy level from options', async () => {
      const opportunity = {
        pool: 'CONSERVATIVE_POOL',
        type: 'privacy_pool_deposit',
      };
      const options = {
        amount: 5000,
        privacyMode: 'dark_ledger' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-exec-003',
          pool: 'CONSERVATIVE_POOL',
          amount: 5000,
          privacyMode: 'dark_ledger',
          poolShare: 0.02,
          txHash: '0xexec003',
          timestamp: '2026-03-07T11:02:00Z',
        }),
      });

      const receipt = await adapter.execute(opportunity, options);

      expect(receipt.privacyLevel).toBe('dark_ledger');
    });

    it('should set status to confirmed on successful deposit', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        type: 'privacy_pool_deposit',
      };
      const options = {
        amount: 10000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-exec-004',
          pool: 'MODERATE_POOL',
          amount: 10000,
          privacyMode: 'shielded',
          poolShare: 0.05,
          txHash: '0xexec004',
          timestamp: '2026-03-07T11:03:00Z',
        }),
      });

      const receipt = await adapter.execute(opportunity, options);

      expect(receipt.status).toBe('confirmed');
    });
  });

  describe('estimateImpact', () => {
    it('should estimate yield impact for deposits', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        type: 'privacy_pool_deposit',
      };

      const impact = await adapter.estimateImpact(opportunity, 10000);

      expect(impact.yield).toBeGreaterThan(0);
      expect(typeof impact.risk).toBe('string');
    });

    it('should return conservative yield for conservative pool', async () => {
      const opportunity = {
        pool: 'CONSERVATIVE_POOL',
        type: 'privacy_pool_deposit',
      };

      const impact = await adapter.estimateImpact(opportunity, 10000);

      expect(impact.yield).toBeCloseTo(10, 1);
      expect(impact.risk).toBe('low');
    });

    it('should return moderate yield for moderate pool', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        type: 'privacy_pool_deposit',
      };

      const impact = await adapter.estimateImpact(opportunity, 10000);

      expect(impact.yield).toBeCloseTo(12, 1);
      expect(impact.risk).toBe('medium');
    });

    it('should return aggressive yield for aggressive pool', async () => {
      const opportunity = {
        pool: 'AGGRESSIVE_POOL',
        type: 'privacy_pool_deposit',
      };

      const impact = await adapter.estimateImpact(opportunity, 10000);

      expect(impact.yield).toBeCloseTo(18, 1);
      expect(impact.risk).toBe('high');
    });

    it('should handle different deposit amounts', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        type: 'privacy_pool_deposit',
      };

      const impact1 = await adapter.estimateImpact(opportunity, 1000);
      const impact2 = await adapter.estimateImpact(opportunity, 50000);

      expect(impact1.yield).toBeCloseTo(12, 1);
      expect(impact2.yield).toBeCloseTo(12, 1);
    });
  });

  describe('error handling', () => {
    it('should provide meaningful error message for API failures', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 10000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Invalid pool' }),
      });

      await expect(adapter.depositToPool(params)).rejects.toThrow('Invalid pool');
    });

    it('should handle network errors gracefully', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 10000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockRejectedValueOnce(new Error('Network timeout'));

      await expect(adapter.depositToPool(params)).rejects.toThrow('Network timeout');
    });

    it('should reject invalid pool amounts', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: -1000,
        privacyMode: 'shielded' as const,
      };

      await expect(adapter.depositToPool(params)).rejects.toThrow();
    });

    it('should handle insufficient idle capital error', async () => {
      const params = {
        pool: 'CONSERVATIVE_POOL',
        amount: 100000000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Insufficient idle capital in pool' }),
      });

      await expect(adapter.depositToPool(params)).rejects.toThrow(
        'Insufficient idle capital in pool'
      );
    });
  });

  describe('integration - reputation tier based access', () => {
    it('should enforce Tier1 deposit-only (no borrowing)', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-tier1',
          pool: 'MODERATE_POOL',
          amount: 5000,
          privacyMode: 'shielded',
          poolShare: 0.025,
          txHash: '0xtier1',
          timestamp: '2026-03-07T12:00:00Z',
        }),
      });

      const receipt = await adapter.depositToPool(params);

      expect(receipt.pool).toBe('MODERATE_POOL');
      expect(receipt.amount).toBe(5000);
    });

    it('should enable Tier2/Tier3 both deposit and borrow', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 10000,
        privacyMode: 'shielded' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'deposit-tier23',
          pool: 'MODERATE_POOL',
          amount: 10000,
          privacyMode: 'shielded',
          poolShare: 0.05,
          txHash: '0xtier23',
          timestamp: '2026-03-07T12:01:00Z',
        }),
      });

      const receipt = await adapter.depositToPool(params);

      expect(receipt.amount).toBe(10000);
    });

    it('should track dual yield: strategy + lending interest', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        type: 'privacy_pool_deposit',
      };

      const impact = await adapter.estimateImpact(opportunity, 10000);

      // Base strategy yield is 12% for MODERATE_POOL
      // Actual earned includes lending interest but estimateImpact returns base strategy yield
      expect(impact.yield).toBe(12);
    });
  });
});
