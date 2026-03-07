import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReceiptService } from '../ReceiptService';

global.fetch = vi.fn();

// Type definitions for tests
interface TradeReceipt {
  id: string;
  timestamp: string;
  action: string;
  adapter: string;
  opportunityName?: string;
  amount: number;
  privacyLevel: 'public' | 'shielded' | 'dark_ledger';
  exposureLevel?: number;
  yieldImpact: number;
  trustDelta: number;
  commitment?: string;
  amountHashed?: string;
  txHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
}

interface ReceiptWithImpact extends TradeReceipt {
  reputationImpact: number;
  proofHash?: string;
  explanationFromAI?: string;
}

interface ReceiptSummary {
  totalExecutions: number;
  totalYield: number;
  successRate: number;
  reputationGainedFromProofs: number;
  topPerformingAdapter: string;
  lastExecutionTime: string;
}

describe('ReceiptService', () => {
  let service: ReceiptService;

  beforeEach(() => {
    service = new ReceiptService();
    vi.clearAllMocks();
  });

  describe('recordReceipt', () => {
    it('should record a trade receipt and return receiptId', async () => {
      const mockReceipt: TradeReceipt = {
        id: 'receipt-1',
        timestamp: '2026-03-07T10:00:00Z',
        action: 'swap',
        adapter: 'SwapAdapter',
        opportunityName: 'ETH/USDC Swap',
        amount: 10,
        privacyLevel: 'public',
        yieldImpact: 0,
        trustDelta: 2,
        txHash: '0xabc123',
        status: 'confirmed',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'receipt-1' }),
      });

      const result = await service.recordReceipt(mockReceipt);

      expect(result).toBe('receipt-1');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/zkdefi/receipts'),
        expect.any(Object)
      );
    });

    it('should handle recording failure gracefully', async () => {
      const mockReceipt: TradeReceipt = {
        id: 'receipt-fail',
        timestamp: '2026-03-07T10:00:00Z',
        action: 'lp_add',
        adapter: 'LPAdapter',
        amount: 5000,
        privacyLevel: 'shielded',
        yieldImpact: 15,
        trustDelta: 5,
        status: 'failed',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Failed to store receipt' }),
      });

      await expect(service.recordReceipt(mockReceipt)).rejects.toThrow(
        'Failed to store receipt'
      );
    });
  });

  describe('getReceipts', () => {
    it('should fetch all receipts without filters', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'receipt-1',
          timestamp: '2026-03-07T10:00:00Z',
          action: 'swap',
          adapter: 'SwapAdapter',
          opportunityName: 'ETH/USDC',
          amount: 10,
          privacyLevel: 'public',
          yieldImpact: 0,
          trustDelta: 2,
          txHash: '0xabc123',
          status: 'confirmed',
          reputationImpact: 5,
        },
        {
          id: 'receipt-2',
          timestamp: '2026-03-06T10:00:00Z',
          action: 'lp_add',
          adapter: 'LPAdapter',
          opportunityName: 'ETH/USDC LP',
          amount: 5000,
          privacyLevel: 'public',
          yieldImpact: 15,
          trustDelta: 8,
          txHash: '0xdef456',
          status: 'confirmed',
          reputationImpact: 8,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts();

      expect(result).toEqual(mockReceipts);
      expect(result).toHaveLength(2);
    });

    it('should fetch receipts filtered by date range', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'receipt-dated',
          timestamp: '2026-03-07T10:00:00Z',
          action: 'swap',
          adapter: 'SwapAdapter',
          amount: 10,
          privacyLevel: 'public',
          yieldImpact: 0,
          trustDelta: 2,
          status: 'confirmed',
          reputationImpact: 3,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts({
        startDate: '2026-03-01T00:00:00Z',
        endDate: '2026-03-10T23:59:59Z',
      });

      expect(result).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('startDate'),
        expect.any(Object)
      );
    });

    it('should fetch receipts filtered by type (action)', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'lp-receipt',
          timestamp: '2026-03-07T10:00:00Z',
          action: 'lp_add',
          adapter: 'LPAdapter',
          opportunityName: 'LP Pool',
          amount: 5000,
          privacyLevel: 'public',
          yieldImpact: 15,
          trustDelta: 8,
          status: 'confirmed',
          reputationImpact: 8,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts({ type: 'lp_add' });

      expect(result[0].action).toBe('lp_add');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('type=lp_add'),
        expect.any(Object)
      );
    });

    it('should fetch receipts filtered by adapter', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'dca-receipt',
          timestamp: '2026-03-07T10:00:00Z',
          action: 'swap',
          adapter: 'DCAAdapter',
          opportunityName: 'DCA Strategy',
          amount: 1000,
          privacyLevel: 'public',
          yieldImpact: 0,
          trustDelta: 1,
          status: 'confirmed',
          reputationImpact: 2,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts({ adapter: 'DCAAdapter' });

      expect(result[0].adapter).toBe('DCAAdapter');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('adapter=DCAAdapter'),
        expect.any(Object)
      );
    });

    it('should handle empty results gracefully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await service.getReceipts({ type: 'nonexistent' });

      expect(result).toEqual([]);
    });
  });

  describe('getReceiptSummary', () => {
    it('should fetch receipt summary with all metrics', async () => {
      const mockSummary: ReceiptSummary = {
        totalExecutions: 25,
        totalYield: 1250,
        successRate: 0.92,
        reputationGainedFromProofs: 145,
        topPerformingAdapter: 'LPAdapter',
        lastExecutionTime: '2026-03-07T10:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSummary,
      });

      const result = await service.getReceiptSummary();

      expect(result).toEqual(mockSummary);
      expect(result.totalExecutions).toBe(25);
      expect(result.successRate).toBeCloseTo(0.92, 2);
      expect(result.topPerformingAdapter).toBe('LPAdapter');
    });

    it('should handle zero execution history', async () => {
      const mockSummary: ReceiptSummary = {
        totalExecutions: 0,
        totalYield: 0,
        successRate: 0,
        reputationGainedFromProofs: 0,
        topPerformingAdapter: 'N/A',
        lastExecutionTime: '',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSummary,
      });

      const result = await service.getReceiptSummary();

      expect(result.totalExecutions).toBe(0);
      expect(result.totalYield).toBe(0);
    });
  });

  describe('getReceiptTimeline', () => {
    it('should fetch recent receipts in descending order with default limit 50', async () => {
      const mockTimeline: ReceiptWithImpact[] = [
        {
          id: 'receipt-latest',
          timestamp: '2026-03-07T15:00:00Z',
          action: 'swap',
          adapter: 'SwapAdapter',
          opportunityName: 'ETH/USDC',
          amount: 10,
          privacyLevel: 'public',
          yieldImpact: 0,
          trustDelta: 2,
          txHash: '0xabc123',
          status: 'confirmed',
          reputationImpact: 5,
          explanationFromAI: 'Swap executed due to market conditions',
        },
        {
          id: 'receipt-prev',
          timestamp: '2026-03-07T14:00:00Z',
          action: 'lp_add',
          adapter: 'LPAdapter',
          opportunityName: 'LP Pool',
          amount: 5000,
          privacyLevel: 'public',
          yieldImpact: 15,
          trustDelta: 8,
          txHash: '0xdef456',
          status: 'confirmed',
          reputationImpact: 8,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTimeline,
      });

      const result = await service.getReceiptTimeline();

      expect(result).toHaveLength(2);
      // Most recent should be first
      expect(new Date(result[0].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(result[1].timestamp).getTime()
      );
    });

    it('should respect custom limit parameter', async () => {
      const mockTimeline: ReceiptWithImpact[] = Array.from({ length: 10 }, (_, i) => ({
        id: `receipt-${i}`,
        timestamp: '2026-03-07T10:00:00Z',
        action: 'swap' as const,
        adapter: 'SwapAdapter',
        amount: 10,
        privacyLevel: 'public' as const,
        yieldImpact: 0,
        trustDelta: 2,
        status: 'confirmed' as const,
        reputationImpact: 5,
      }));

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTimeline,
      });

      const result = await service.getReceiptTimeline(10);

      expect(result).toHaveLength(10);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      );
    });

    it('should include AI explanations when available in timeline', async () => {
      const mockTimeline: ReceiptWithImpact[] = [
        {
          id: 'receipt-explained',
          timestamp: '2026-03-07T10:00:00Z',
          action: 'lp_add',
          adapter: 'LPAdapter',
          opportunityName: 'LP Pool',
          amount: 5000,
          privacyLevel: 'public',
          yieldImpact: 15,
          trustDelta: 8,
          status: 'confirmed',
          reputationImpact: 8,
          explanationFromAI: 'High yield opportunity in ETH/USDC pair',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTimeline,
      });

      const result = await service.getReceiptTimeline(50);

      expect(result[0].explanationFromAI).toBeTruthy();
    });
  });

  describe('reputation impact tracking', () => {
    it('should track positive reputation impact for successful trades', async () => {
      const mockReceipts: ReceiptWithImpact[] = [
        {
          id: 'success-high-impact',
          timestamp: '2026-03-07T10:00:00Z',
          action: 'lp_add',
          adapter: 'LPAdapter',
          opportunityName: 'LP Pool',
          amount: 5000,
          privacyLevel: 'public',
          yieldImpact: 15,
          trustDelta: 8,
          status: 'confirmed',
          reputationImpact: 15,
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReceipts,
      });

      const result = await service.getReceipts();

      expect(result[0].reputationImpact).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should handle network errors when recording receipt', async () => {
      const mockReceipt: TradeReceipt = {
        id: 'receipt-error',
        timestamp: '2026-03-07T10:00:00Z',
        action: 'swap',
        adapter: 'SwapAdapter',
        amount: 10,
        privacyLevel: 'public',
        yieldImpact: 0,
        trustDelta: 2,
        status: 'pending',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ detail: 'Service temporarily unavailable' }),
      });

      await expect(service.recordReceipt(mockReceipt)).rejects.toThrow(
        'Service temporarily unavailable'
      );
    });

    it('should handle network errors when fetching receipts', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal server error' }),
      });

      await expect(service.getReceipts()).rejects.toThrow('Internal server error');
    });
  });
});
