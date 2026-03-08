import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReputationGatingService } from '../ReputationGatingService';
import * as client from '@/lib/api/client';

// Mock the fetch API
global.fetch = vi.fn();

describe('ReputationGatingService', () => {
  let service: ReputationGatingService;

  beforeEach(() => {
    service = new ReputationGatingService();
    vi.clearAllMocks();
  });

  describe('getUserReputation', () => {
    it('should fetch user reputation from API and return with tier mapping', async () => {
      const mockAddress = '0x123abc';
      const mockResponse = {
        address: mockAddress,
        reputationScore: 65,
        updatedAt: '2026-03-07T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getUserReputation(mockAddress);

      expect(result).toEqual({
        address: mockAddress,
        reputationScore: 65,
        tier: 'Tier2',
        updatedAt: '2026-03-07T10:00:00Z',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/zkdefi/risk_profile/v2/${mockAddress}`),
        expect.any(Object)
      );
    });

    it('should handle API errors gracefully', async () => {
      const mockAddress = '0x123abc';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'User not found' }),
      });
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'User not found' }),
      });

      await expect(service.getUserReputation(mockAddress)).rejects.toThrow('User not found');
    });
  });

  describe('mapScoreToTier', () => {
    it('should map score 0-50 to Tier1', () => {
      expect(service.mapScoreToTier(0)).toBe('Tier1');
      expect(service.mapScoreToTier(25)).toBe('Tier1');
      expect(service.mapScoreToTier(50)).toBe('Tier1');
    });

    it('should map score 51-75 to Tier2', () => {
      expect(service.mapScoreToTier(51)).toBe('Tier2');
      expect(service.mapScoreToTier(65)).toBe('Tier2');
      expect(service.mapScoreToTier(75)).toBe('Tier2');
    });

    it('should map score 76-100 to Tier3', () => {
      expect(service.mapScoreToTier(76)).toBe('Tier3');
      expect(service.mapScoreToTier(85)).toBe('Tier3');
      expect(service.mapScoreToTier(100)).toBe('Tier3');
    });

    it('should handle boundary cases at tier transitions', () => {
      expect(service.mapScoreToTier(50)).toBe('Tier1');
      expect(service.mapScoreToTier(51)).toBe('Tier2');
      expect(service.mapScoreToTier(75)).toBe('Tier2');
      expect(service.mapScoreToTier(76)).toBe('Tier3');
    });
  });

  describe('getBorrowingPower', () => {
    it('should return 0 for Tier1 (cannot borrow)', async () => {
      const power = await service.getBorrowingPower('Tier1', 10000, 'starknet-pool');
      expect(power).toBe(0);
    });

    it('should calculate 50% LTV for Tier2', async () => {
      const power = await service.getBorrowingPower('Tier2', 10000, 'starknet-pool');
      expect(power).toBe(5000);
    });

    it('should calculate 150% LTV for Tier3', async () => {
      const power = await service.getBorrowingPower('Tier3', 10000, 'starknet-pool');
      expect(power).toBe(15000);
    });

    it('should handle decimal deposit amounts', async () => {
      const power = await service.getBorrowingPower('Tier2', 10000.5, 'starknet-pool');
      expect(power).toBe(5000.25);
    });

    it('should handle zero deposit', async () => {
      const power = await service.getBorrowingPower('Tier2', 0, 'starknet-pool');
      expect(power).toBe(0);
    });
  });

  describe('getBorrowingRate', () => {
    it('should return null for Tier1 (cannot borrow)', async () => {
      const rate = await service.getBorrowingRate('Tier1', 'starknet-pool');
      expect(rate).toBeNull();
    });

    it('should return ~6% for Tier2', async () => {
      const rate = await service.getBorrowingRate('Tier2', 'starknet-pool');
      expect(rate).toBe(6);
    });

    it('should return ~4% for Tier3', async () => {
      const rate = await service.getBorrowingRate('Tier3', 'starknet-pool');
      expect(rate).toBe(4);
    });

    it('should use default rates when DAO governance data unavailable', async () => {
      const rate2 = await service.getBorrowingRate('Tier2', 'ekubo-pool');
      const rate3 = await service.getBorrowingRate('Tier3', 'ekubo-pool');

      expect(rate2).toBe(6);
      expect(rate3).toBe(4);
    });
  });

  describe('getAccessHistory', () => {
    it('should fetch access history from API', async () => {
      const mockAddress = '0x123abc';
      const mockHistory = [
        {
          timestamp: '2026-03-06T10:00:00Z',
          event: 'borrow' as const,
          amount: 5000,
          rate: 6,
        },
        {
          timestamp: '2026-03-05T14:30:00Z',
          event: 'repay' as const,
          amount: 2500,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistory,
      });

      const result = await service.getAccessHistory(mockAddress);

      expect(result).toEqual(mockHistory);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/zkdefi/reputation/access-history/${mockAddress}`),
        expect.any(Object)
      );
    });

    it('should return empty array when user has no history', async () => {
      const mockAddress = '0xnewuser';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await service.getAccessHistory(mockAddress);

      expect(result).toEqual([]);
    });

    it('should handle API errors when fetching history', async () => {
      const mockAddress = '0x123abc';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal server error' }),
      });

      await expect(service.getAccessHistory(mockAddress)).rejects.toThrow(
        'Internal server error'
      );
    });
  });

  describe('integration - reputation to access workflow', () => {
    it('should map high reputation score to high borrowing power', async () => {
      const mockAddress = '0xrichuser';
      const mockResponse = {
        address: mockAddress,
        reputationScore: 95,
        updatedAt: '2026-03-07T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const reputation = await service.getUserReputation(mockAddress);
      expect(reputation.tier).toBe('Tier3');

      const borrowingPower = await service.getBorrowingPower(reputation.tier, 10000, 'pool-1');
      const borrowingRate = await service.getBorrowingRate(reputation.tier, 'pool-1');

      expect(borrowingPower).toBe(15000);
      expect(borrowingRate).toBe(4);
    });

    it('should map low reputation score to limited access', async () => {
      const mockAddress = '0xnewuser';
      const mockResponse = {
        address: mockAddress,
        reputationScore: 30,
        updatedAt: '2026-03-07T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const reputation = await service.getUserReputation(mockAddress);
      expect(reputation.tier).toBe('Tier1');

      const borrowingPower = await service.getBorrowingPower(reputation.tier, 10000, 'pool-1');
      const borrowingRate = await service.getBorrowingRate(reputation.tier, 'pool-1');

      expect(borrowingPower).toBe(0);
      expect(borrowingRate).toBeNull();
    });
  });
});
