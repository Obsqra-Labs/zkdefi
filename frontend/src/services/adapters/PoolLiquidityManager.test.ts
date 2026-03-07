import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PoolLiquidityManager } from './PoolLiquidityManager';

global.fetch = vi.fn();

describe('PoolLiquidityManager', () => {
  let manager: PoolLiquidityManager;

  beforeEach(() => {
    manager = new PoolLiquidityManager();
    vi.clearAllMocks();
  });

  describe('getPoolLiquidity', () => {
    it('should fetch pool liquidity from API endpoint', async () => {
      const poolId = 'starknet-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 1000000,
        idleCapital: 300000,
        activeStrategies: 2,
        utilizationRate: 0.7,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.getPoolLiquidity(poolId);

      expect(result).toEqual(mockLiquidity);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/dao/pools/${poolId}/liquidity`),
        expect.any(Object)
      );
    });

    it('should handle API errors gracefully', async () => {
      const poolId = 'invalid-pool';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Pool not found' }),
      });

      await expect(manager.getPoolLiquidity(poolId)).rejects.toThrow('Pool not found');
    });

    it('should handle network errors', async () => {
      const poolId = 'starknet-pool';

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(manager.getPoolLiquidity(poolId)).rejects.toThrow('Network error');
    });
  });

  describe('getAvailableCapitalByTier', () => {
    it('should calculate tier allocations with Tier1 = 0, Tier2 = 50%, Tier3 = 80%', async () => {
      const poolId = 'starknet-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 1000000,
        idleCapital: 100000,
        activeStrategies: 2,
        utilizationRate: 0.9,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.getAvailableCapitalByTier(poolId);

      expect(result).toEqual({
        pool: poolId,
        availableForBorrowingTier1: 0,
        availableForBorrowingTier2: 50000, // 50% of 100000
        availableForBorrowingTier3: 80000, // 80% of 100000
      });
    });

    it('should handle zero idle capital', async () => {
      const poolId = 'starknet-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 500000,
        idleCapital: 0,
        activeStrategies: 1,
        utilizationRate: 1.0,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.getAvailableCapitalByTier(poolId);

      expect(result).toEqual({
        pool: poolId,
        availableForBorrowingTier1: 0,
        availableForBorrowingTier2: 0,
        availableForBorrowingTier3: 0,
      });
    });

    it('should handle large idle capital amounts', async () => {
      const poolId = 'large-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 10000000,
        idleCapital: 2500000,
        activeStrategies: 5,
        utilizationRate: 0.75,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.getAvailableCapitalByTier(poolId);

      expect(result).toEqual({
        pool: poolId,
        availableForBorrowingTier1: 0,
        availableForBorrowingTier2: 1250000, // 50% of 2500000
        availableForBorrowingTier3: 2000000, // 80% of 2500000
      });
    });
  });

  describe('canBorrowAmount', () => {
    it('should return true when Tier2 amount is within available 50%', async () => {
      const poolId = 'starknet-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 1000000,
        idleCapital: 100000,
        activeStrategies: 2,
        utilizationRate: 0.9,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.canBorrowAmount(poolId, 30000, 'Tier2');

      expect(result).toBe(true);
    });

    it('should return false when Tier2 amount exceeds available 50%', async () => {
      const poolId = 'starknet-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 1000000,
        idleCapital: 100000,
        activeStrategies: 2,
        utilizationRate: 0.9,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.canBorrowAmount(poolId, 60000, 'Tier2');

      expect(result).toBe(false);
    });

    it('should return true when Tier3 amount is within available 80%', async () => {
      const poolId = 'starknet-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 1000000,
        idleCapital: 100000,
        activeStrategies: 2,
        utilizationRate: 0.9,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.canBorrowAmount(poolId, 75000, 'Tier3');

      expect(result).toBe(true);
    });

    it('should return false when Tier3 amount exceeds available 80%', async () => {
      const poolId = 'starknet-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 1000000,
        idleCapital: 100000,
        activeStrategies: 2,
        utilizationRate: 0.9,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.canBorrowAmount(poolId, 85000, 'Tier3');

      expect(result).toBe(false);
    });

    it('should return false when Tier1 tries to borrow (always 0 available)', async () => {
      const poolId = 'starknet-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 1000000,
        idleCapital: 100000,
        activeStrategies: 2,
        utilizationRate: 0.9,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.canBorrowAmount(poolId, 1, 'Tier1');

      expect(result).toBe(false);
    });

    it('should handle boundary case at exactly available limit', async () => {
      const poolId = 'starknet-pool';
      const mockLiquidity = {
        pool: poolId,
        totalDeposited: 1000000,
        idleCapital: 100000,
        activeStrategies: 2,
        utilizationRate: 0.9,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLiquidity,
      });

      const result = await manager.canBorrowAmount(poolId, 50000, 'Tier2');

      expect(result).toBe(true);
    });

    it('should handle network error gracefully', async () => {
      const poolId = 'starknet-pool';

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(manager.canBorrowAmount(poolId, 50000, 'Tier2')).rejects.toThrow(
        'Network error'
      );
    });
  });
});
