import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LPAdapter } from '../LPAdapter';
import * as client from '@/lib/api/client';

global.fetch = vi.fn();

describe('LPAdapter', () => {
  let adapter: LPAdapter;

  beforeEach(() => {
    adapter = new LPAdapter();
    vi.clearAllMocks();
  });

  describe('ExecutionAdapter interface', () => {
    it('should have name property set to "lp"', () => {
      expect(adapter.name).toBe('lp');
    });

    it('should have supportsPrivacy set to true', () => {
      expect(adapter.supportsPrivacy).toBe(true);
    });

    it('should have supportsActions with required actions', () => {
      expect(Array.isArray(adapter.supportsActions)).toBe(true);
      expect(adapter.supportsActions).toContain('add_liquidity');
      expect(adapter.supportsActions).toContain('remove_liquidity');
      expect(adapter.supportsActions).toContain('collect_fees');
      expect(adapter.supportsActions).toContain('rebalance');
    });
  });

  describe('addLiquidity - conservative profile', () => {
    it('should add conservative liquidity with narrow tick range', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'pos-001',
          tokenA: 'ETH',
          tokenB: 'USDC',
          amountA: 1,
          amountB: 2500,
          liquidity: 2500,
          status: 'active',
          riskProfile: 'conservative',
          privacyMode: 'public',
          createdAt: '2026-03-07T00:00:00Z',
        }),
      });

      const result = await adapter.addLiquidity({
        tokenA: 'ETH',
        tokenB: 'USDC',
        amountA: 1,
        amountB: 2500,
        riskProfile: 'conservative',
        privacyMode: 'public',
      });

      expect(result.positionId).toBe('pos-001');
      expect(result.riskProfile).toBe('conservative');
      expect(result.status).toBe('active');
      expect(result.privacyMode).toBe('public');
    });

    it('should support shielded conservative position with commitment', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'pos-002',
          tokenA: 'ETH',
          tokenB: 'USDC',
          amountA: 1,
          amountB: 2500,
          liquidity: 2500,
          status: 'active',
          riskProfile: 'conservative',
          privacyMode: 'shielded',
          commitment: 'commitment-123',
          createdAt: '2026-03-07T00:00:00Z',
        }),
      });

      const result = await adapter.addLiquidity({
        tokenA: 'ETH',
        tokenB: 'USDC',
        amountA: 1,
        amountB: 2500,
        riskProfile: 'conservative',
        privacyMode: 'shielded',
      });

      expect(result.commitment).toBe('commitment-123');
      expect(result.privacyMode).toBe('shielded');
    });
  });

  describe('addLiquidity - moderate profile', () => {
    it('should add moderate liquidity with medium tick range', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'pos-003',
          tokenA: 'STRK',
          tokenB: 'ETH',
          amountA: 100,
          amountB: 0.5,
          liquidity: 5000,
          status: 'active',
          riskProfile: 'moderate',
          privacyMode: 'public',
          createdAt: '2026-03-07T00:00:00Z',
        }),
      });

      const result = await adapter.addLiquidity({
        tokenA: 'STRK',
        tokenB: 'ETH',
        amountA: 100,
        amountB: 0.5,
        riskProfile: 'moderate',
        privacyMode: 'public',
      });

      expect(result.positionId).toBe('pos-003');
      expect(result.riskProfile).toBe('moderate');
      expect(result.liquidity).toBe(5000);
    });
  });

  describe('addLiquidity - aggressive profile', () => {
    it('should add aggressive liquidity with wide tick range', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'pos-004',
          tokenA: 'STRK',
          tokenB: 'ETH',
          amountA: 200,
          amountB: 1,
          liquidity: 10000,
          status: 'active',
          riskProfile: 'aggressive',
          privacyMode: 'dark_ledger',
          commitment: 'commitment-456',
          createdAt: '2026-03-07T00:00:00Z',
        }),
      });

      const result = await adapter.addLiquidity({
        tokenA: 'STRK',
        tokenB: 'ETH',
        amountA: 200,
        amountB: 1,
        riskProfile: 'aggressive',
        privacyMode: 'dark_ledger',
      });

      expect(result.riskProfile).toBe('aggressive');
      expect(result.privacyMode).toBe('dark_ledger');
      expect(result.commitment).toBeDefined();
    });
  });

  describe('removeLiquidity', () => {
    it('should remove partial liquidity from a position', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          amountA: 0.5,
          amountB: 1250,
          feeCollected: 25,
          txHash: 'tx-remove-001',
        }),
      });

      const result = await adapter.removeLiquidity({
        positionId: 'pos-001',
        liquidityShare: 0.5,
      });

      expect(result.amountA).toBe(0.5);
      expect(result.amountB).toBe(1250);
      expect(result.feeCollected).toBe(25);
      expect(result.txHash).toBe('tx-remove-001');
    });

    it('should remove full liquidity from a position', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          amountA: 1,
          amountB: 2500,
          feeCollected: 50,
          txHash: 'tx-remove-002',
        }),
      });

      const result = await adapter.removeLiquidity({
        positionId: 'pos-001',
        liquidityShare: 1,
      });

      expect(result.amountA).toBe(1);
      expect(result.amountB).toBe(2500);
      expect(result.feeCollected).toBe(50);
    });
  });

  describe('getPositionDetails', () => {
    it('should fetch position details with PnL and yield metrics', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'pos-001',
          currentValue: 2700,
          entryValue: 2600,
          unrealizedPnL: 100,
          feeEarned: 50,
          apy: 12.5,
        }),
      });

      const result = await adapter.getPositionDetails('pos-001');

      expect(result.positionId).toBe('pos-001');
      expect(result.currentValue).toBe(2700);
      expect(result.unrealizedPnL).toBe(100);
      expect(result.apy).toBe(12.5);
    });
  });

  describe('getRiskProfile', () => {
    it('should get conservative risk profile details', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profile: 'conservative',
          tickRange: 6000,
          acceptedPairs: ['ETH/USDC', 'STRK/USDC'],
        }),
      });

      const result = await adapter.getRiskProfile('conservative');

      expect(result.profile).toBe('conservative');
      expect(result.tickRange).toBe(6000);
      expect(result.acceptedPairs).toContain('ETH/USDC');
    });

    it('should get moderate risk profile details', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profile: 'moderate',
          tickRange: 3000,
          acceptedPairs: ['STRK/ETH', 'STRK/USDC'],
        }),
      });

      const result = await adapter.getRiskProfile('moderate');

      expect(result.tickRange).toBe(3000);
    });

    it('should get aggressive risk profile details', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profile: 'aggressive',
          tickRange: 1200,
          acceptedPairs: ['STRK/ETH'],
        }),
      });

      const result = await adapter.getRiskProfile('aggressive');

      expect(result.tickRange).toBe(1200);
    });
  });

  describe('collectFees', () => {
    it('should collect accrued fees from a position', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          feeAmount: 50,
          txHash: 'tx-collect-001',
        }),
      });

      const result = await adapter.collectFees('pos-001');

      expect(result.feeAmount).toBe(50);
      expect(result.txHash).toBe('tx-collect-001');
    });
  });

  describe('execute - ExecutionAdapter interface', () => {
    it('should execute add liquidity and return TradeReceipt', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'pos-005',
          tokenA: 'ETH',
          tokenB: 'USDC',
          amountA: 1,
          amountB: 2500,
          liquidity: 2500,
          status: 'active',
          riskProfile: 'conservative',
          privacyMode: 'public',
          createdAt: '2026-03-07T00:00:00Z',
        }),
      });

      const receipt = await adapter.execute(
        {
          opportunityName: 'ETH/USDC Conservative Pool',
        },
        {
          action: 'add_liquidity',
          tokenA: 'ETH',
          tokenB: 'USDC',
          amountA: 1,
          amountB: 2500,
          riskProfile: 'conservative',
          privacyMode: 'public',
        }
      );

      expect(receipt.id).toBeDefined();
      expect(receipt.action).toBe('add_liquidity');
      expect(receipt.adapter).toBe('lp');
      expect(receipt.status).toBe('confirmed');
    });

    it('should generate proper TradeReceipt with metadata', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'pos-006',
          tokenA: 'STRK',
          tokenB: 'ETH',
          amountA: 100,
          amountB: 0.5,
          liquidity: 5000,
          status: 'active',
          riskProfile: 'moderate',
          privacyMode: 'shielded',
          commitment: 'commitment-789',
          createdAt: '2026-03-07T00:00:00Z',
        }),
      });

      const receipt = await adapter.execute(
        { opportunityName: 'STRK/ETH Moderate Pool' },
        {
          action: 'add_liquidity',
          tokenA: 'STRK',
          tokenB: 'ETH',
          amountA: 100,
          amountB: 0.5,
          riskProfile: 'moderate',
          privacyMode: 'shielded',
        }
      );

      expect(receipt.privacyLevel).toBe('shielded');
      expect(receipt.opportunityName).toBe('STRK/ETH Moderate Pool');
      expect(receipt.timestamp).toBeDefined();
    });
  });

  describe('estimateImpact', () => {
    it('should estimate yield and IL risk for conservative position', async () => {
      const result = await adapter.estimateImpact({ riskProfile: 'conservative' }, 2500);

      expect(result.yield).toBe(9); // 8-10% range, mid-point
      expect(result.risk).toBe('low');
    });

    it('should estimate yield and IL risk for moderate position', async () => {
      const result = await adapter.estimateImpact({ riskProfile: 'moderate' }, 5000);

      expect(result.yield).toBeGreaterThanOrEqual(12);
      expect(result.yield).toBeLessThanOrEqual(15);
      expect(result.risk).toBe('medium');
    });

    it('should estimate yield and IL risk for aggressive position', async () => {
      const result = await adapter.estimateImpact({ riskProfile: 'aggressive' }, 10000);

      expect(result.yield).toBeGreaterThanOrEqual(18);
      expect(result.yield).toBeLessThanOrEqual(25);
      expect(result.risk).toBe('high');
    });
  });

  describe('Error handling', () => {
    it('should throw error when adding liquidity fails', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Invalid token pair' }),
      });

      await expect(
        adapter.addLiquidity({
          tokenA: 'INVALID',
          tokenB: 'PAIR',
          amountA: 1,
          amountB: 1,
          riskProfile: 'conservative',
          privacyMode: 'public',
        })
      ).rejects.toThrow('Invalid token pair');
    });

    it('should throw error when amounts are imbalanced', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Imbalanced amounts' }),
      });

      await expect(
        adapter.addLiquidity({
          tokenA: 'ETH',
          tokenB: 'USDC',
          amountA: 0.001, // Too small
          amountB: 2500,
          riskProfile: 'conservative',
          privacyMode: 'public',
        })
      ).rejects.toThrow('Imbalanced amounts');
    });

    it('should throw error when position not found', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ detail: 'Position not found' }),
      });

      await expect(adapter.getPositionDetails('pos-invalid')).rejects.toThrow(
        'Position not found'
      );
    });
  });

  describe('Rebalancing workflow', () => {
    it('should support rebalancing action in supportsActions', () => {
      expect(adapter.supportsActions).toContain('rebalance');
    });

    it('should execute rebalance operation', async () => {
      const receipt = await adapter.execute(
        { opportunityName: 'Rebalance Position' },
        {
          action: 'rebalance',
          positionId: 'pos-001',
          newRiskProfile: 'moderate',
        }
      );

      expect(receipt.action).toBe('rebalance');
      expect(receipt.adapter).toBe('lp');
    });
  });

  describe('Private position workflow', () => {
    it('should maintain commitment for dark_ledger positions', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          positionId: 'pos-007',
          tokenA: 'STRK',
          tokenB: 'ETH',
          amountA: 200,
          amountB: 1,
          liquidity: 10000,
          status: 'active',
          riskProfile: 'aggressive',
          privacyMode: 'dark_ledger',
          commitment: 'commitment-dark-001',
          createdAt: '2026-03-07T00:00:00Z',
        }),
      });

      const result = await adapter.addLiquidity({
        tokenA: 'STRK',
        tokenB: 'ETH',
        amountA: 200,
        amountB: 1,
        riskProfile: 'aggressive',
        privacyMode: 'dark_ledger',
      });

      expect(result.commitment).toBe('commitment-dark-001');
      expect(result.privacyMode).toBe('dark_ledger');
    });
  });
});
