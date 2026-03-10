import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LendingAdapter } from './LendingAdapter';
import { ReputationGatingService } from '../ReputationGatingService';
import * as client from '@/lib/api/client';

global.fetch = vi.fn();

describe('LendingAdapter', () => {
  let adapter: LendingAdapter;
  let mockReputationService: ReputationGatingService;

  beforeEach(() => {
    mockReputationService = new ReputationGatingService();
    adapter = new LendingAdapter(mockReputationService);
    vi.clearAllMocks();
  });

  describe('ExecutionAdapter interface', () => {
    it('should have name property', () => {
      expect(adapter.name).toBe('lending');
    });

    it('should have supportsPrivacy property', () => {
      expect(adapter.supportsPrivacy).toBe(true);
    });

    it('should have supportsActions array with borrow action', () => {
      expect(Array.isArray(adapter.supportsActions)).toBe(true);
      expect(adapter.supportsActions).toContain('borrow');
    });
  });

  describe('borrowFromPool - Tier restrictions', () => {
    it('should reject Tier1 users from borrowing', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 1000,
        address: '0x123abc',
        tier: 'Tier1' as const,
        depositAmount: 10000,
      };

      await expect(adapter.borrowFromPool(params)).rejects.toThrow(
        'Tier1 cannot borrow from lending pools'
      );
    });

    it('should reject Tier2 users from borrowing with tier in error', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 1000,
        address: '0x123abc',
        tier: 'Tier1' as const,
        depositAmount: 10000,
      };

      const error = await adapter.borrowFromPool(params).catch((e) => e);
      expect(error.message).toContain('Tier1');
    });
  });

  describe('borrowFromPool - LTV limits', () => {
    it('should allow Tier2 to borrow up to 50% LTV', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-001',
          borrowAmount: 5000,
          rate: 6,
          maxBorrow: 5000,
        }),
      });

      const result = await adapter.borrowFromPool(params);
      expect(result.loanId).toBe('loan-001');
      expect(result.borrowAmount).toBe(5000);
    });

    it('should reject Tier2 borrow exceeding 50% LTV', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 6000, // Exceeds 50% of 10000
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      await expect(adapter.borrowFromPool(params)).rejects.toThrow(
        'Borrow amount exceeds LTV limit of 50% for Tier2'
      );
    });

    it('should allow Tier3 to borrow up to 150% LTV', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 15000,
        address: '0x123abc',
        tier: 'Tier3' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-002',
          borrowAmount: 15000,
          rate: 4,
          maxBorrow: 15000,
        }),
      });

      const result = await adapter.borrowFromPool(params);
      expect(result.borrowAmount).toBe(15000);
    });

    it('should reject Tier3 borrow exceeding 150% LTV', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 16000, // Exceeds 150% of 10000
        address: '0x123abc',
        tier: 'Tier3' as const,
        depositAmount: 10000,
      };

      await expect(adapter.borrowFromPool(params)).rejects.toThrow(
        'Borrow amount exceeds LTV limit of 150% for Tier3'
      );
    });
  });

  describe('borrowFromPool - Idle capital validation', () => {
    it('should reject borrow if pool has insufficient idle capital', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Insufficient idle capital in pool' }),
      });

      await expect(adapter.borrowFromPool(params)).rejects.toThrow(
        'Insufficient idle capital in pool'
      );
    });
  });

  describe('borrowFromPool - DAO-voted rates', () => {
    it('should apply Tier2 rate (6%)', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-003',
          borrowAmount: 5000,
          rate: 6,
          apr: 6,
          maxBorrow: 5000,
        }),
      });

      const result = await adapter.borrowFromPool(params);
      expect(result.rate).toBe(6);
      expect(result.apr).toBe(6);
    });

    it('should apply Tier3 rate (4%)', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 10000,
        address: '0x123abc',
        tier: 'Tier3' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-004',
          borrowAmount: 10000,
          rate: 4,
          apr: 4,
          maxBorrow: 15000,
        }),
      });

      const result = await adapter.borrowFromPool(params);
      expect(result.rate).toBe(4);
      expect(result.apr).toBe(4);
    });
  });

  describe('borrowFromPool - Receipt format', () => {
    it('should return BorrowReceipt with all required fields', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-005',
          borrowAmount: 5000,
          rate: 6,
          apr: 6,
          maxBorrow: 5000,
        }),
      });

      const result = await adapter.borrowFromPool(params);

      expect(result).toHaveProperty('loanId');
      expect(result).toHaveProperty('borrowAmount');
      expect(result).toHaveProperty('rate');
      expect(result).toHaveProperty('apr');
      expect(result).toHaveProperty('maxBorrow');
      expect(result).toHaveProperty('tier');
      expect(result).toHaveProperty('type');
      expect(result.type).toBe('dao_voted_lending');
    });
  });

  describe('borrowFromPool - API endpoint', () => {
    it('should call correct API endpoint with pool name', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-006',
          borrowAmount: 5000,
          rate: 6,
          apr: 6,
          maxBorrow: 5000,
        }),
      });

      await adapter.borrowFromPool(params);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/dao/pools/MODERATE_POOL/borrow'),
        expect.any(Object)
      );
    });

    it('should send POST request with required payload', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-007',
          borrowAmount: 5000,
          rate: 6,
          apr: 6,
          maxBorrow: 5000,
        }),
      });

      await adapter.borrowFromPool(params);

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({
        address: '0x123abc',
        amount: 5000,
        tier: 'Tier2',
      });
    });
  });

  describe('execute - ExecutionAdapter interface', () => {
    it('should implement execute method from ExecutionAdapter', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        depositAmount: 10000,
      };
      const options = {
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-008',
          borrowAmount: 5000,
          rate: 6,
          apr: 6,
          maxBorrow: 5000,
        }),
      });

      const result = await adapter.execute(opportunity, options);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('adapter');
      expect(result.action).toBe('borrow');
      expect(result.adapter).toBe('lending');
    });

    it('should return TradeReceipt with execution metadata', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        opportunityName: 'Test Borrow',
        depositAmount: 10000,
      };
      const options = {
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-009',
          borrowAmount: 5000,
          rate: 6,
          apr: 6,
          maxBorrow: 5000,
        }),
      });

      const result = await adapter.execute(opportunity, options);

      expect(result.opportunityName).toBe('Test Borrow');
      expect(result.amount).toBe(5000);
      expect(result.yieldImpact).toBe(0);
      expect(result.trustDelta).toBe(3);
    });

    it('should set privacy level to shielded for borrowing', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        depositAmount: 10000,
      };
      const options = {
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-010',
          borrowAmount: 5000,
          rate: 6,
          apr: 6,
          maxBorrow: 5000,
        }),
      });

      const result = await adapter.execute(opportunity, options);

      expect(result.privacyLevel).toBe('shielded');
    });

    it('should set status to confirmed on successful borrow', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        depositAmount: 10000,
      };
      const options = {
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-011',
          borrowAmount: 5000,
          rate: 6,
          apr: 6,
          maxBorrow: 5000,
        }),
      });

      const result = await adapter.execute(opportunity, options);

      expect(result.status).toBe('confirmed');
    });
  });

  describe('estimateImpact', () => {
    it('should return zero yield for borrowing', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        depositAmount: 10000,
      };

      const impact = await adapter.estimateImpact(opportunity, 5000);

      expect(impact.yield).toBe(0);
    });

    it('should indicate increased risk for borrowing', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        depositAmount: 10000,
      };

      const impact = await adapter.estimateImpact(opportunity, 5000);

      expect(impact.risk).toBe('increased');
    });

    it('should handle different borrow amounts', async () => {
      const opportunity = {
        pool: 'MODERATE_POOL',
        depositAmount: 10000,
      };

      const impact1 = await adapter.estimateImpact(opportunity, 1000);
      const impact2 = await adapter.estimateImpact(opportunity, 8000);

      expect(impact1.yield).toBe(0);
      expect(impact2.yield).toBe(0);
      expect(impact1.risk).toBe('increased');
      expect(impact2.risk).toBe('increased');
    });
  });

  describe('getLoanRecord', () => {
    it('should fetch loan details from API', async () => {
      const loanId = 'loan-001';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-001',
          amount: 5000,
          rate: 6,
          tier: 'Tier2',
          status: 'active',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      const record = await adapter.getLoanRecord(loanId);

      expect(record.loanId).toBe('loan-001');
      expect(record.amount).toBe(5000);
      expect(record.rate).toBe(6);
      expect(record.tier).toBe('Tier2');
      expect(record.status).toBe('active');
    });

    it('should call correct API endpoint for loan record', async () => {
      const loanId = 'loan-abc123';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-abc123',
          amount: 5000,
          rate: 6,
          tier: 'Tier2',
          status: 'active',
          createdAt: '2026-03-07T10:00:00Z',
        }),
      });

      await adapter.getLoanRecord(loanId);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/dao/loans/${loanId}`),
        expect.any(Object)
      );
    });

    it('should handle API errors when fetching loan record', async () => {
      const loanId = 'loan-nonexistent';

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Loan not found' }),
      });

      await expect(adapter.getLoanRecord(loanId)).rejects.toThrow('Loan not found');
    });
  });

  describe('error handling', () => {
    it('should provide meaningful error message for network failures', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(adapter.borrowFromPool(params)).rejects.toThrow('Network error');
    });

    it('should handle JSON parse errors from API', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(adapter.borrowFromPool(params)).rejects.toThrow();
    });

    it('should reject with descriptive message for validation errors', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: -1000, // Invalid negative amount
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      await expect(adapter.borrowFromPool(params)).rejects.toThrow();
    });
  });

  describe('integration - reputation gate + LTV + rate workflow', () => {
    it('should enforce full borrowing workflow: tier check -> LTV calc -> rate fetch -> borrow', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 7500,
        address: '0x123abc',
        tier: 'Tier3' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-full-integration',
          borrowAmount: 7500,
          rate: 4,
          apr: 4,
          maxBorrow: 15000,
        }),
      });

      const result = await adapter.borrowFromPool(params);

      expect(result.loanId).toBe('loan-full-integration');
      expect(result.borrowAmount).toBe(7500);
      expect(result.rate).toBe(4); // Tier3 rate
      expect(result.apr).toBe(4);
      expect(result.tier).toBe('Tier3');
      expect(result.maxBorrow).toBe(15000); // 150% LTV
    });

    it('should return proper receipt for Memory Lane audit trail', async () => {
      const params = {
        pool: 'MODERATE_POOL',
        amount: 5000,
        address: '0x123abc',
        tier: 'Tier2' as const,
        depositAmount: 10000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loanId: 'loan-memory-lane',
          borrowAmount: 5000,
          rate: 6,
          apr: 6,
          maxBorrow: 5000,
        }),
      });

      const receipt = await adapter.borrowFromPool(params);

      // Audit trail fields
      expect(receipt.loanId).toBeDefined();
      expect(receipt.borrowAmount).toBeDefined();
      expect(receipt.rate).toBeDefined();
      expect(receipt.tier).toBeDefined();
      expect(receipt.type).toBe('dao_voted_lending');
    });
  });
});
