import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LimitOrdersAdapter } from '../LimitOrdersAdapter';
import { TradeReceipt } from '../ExecutionAdapter';

global.fetch = vi.fn();

describe('LimitOrdersAdapter', () => {
  let adapter: LimitOrdersAdapter;

  beforeEach(() => {
    adapter = new LimitOrdersAdapter();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ExecutionAdapter Interface Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('ExecutionAdapter interface', () => {
    it('should have name property set to "limit_orders"', () => {
      expect(adapter.name).toBe('limit_orders');
    });

    it('should have supportsPrivacy set to true', () => {
      expect(adapter.supportsPrivacy).toBe(true);
    });

    it('should have supportsActions array with place_order, cancel_order, and monitor', () => {
      expect(Array.isArray(adapter.supportsActions)).toBe(true);
      expect(adapter.supportsActions).toContain('place_order');
      expect(adapter.supportsActions).toContain('cancel_order');
      expect(adapter.supportsActions).toContain('monitor');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Place Limit Order Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('placeOrder', () => {
    it('should place a public limit order successfully', async () => {
      const params = {
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
        privacyMode: 'public' as const,
      };

      const mockOrder = {
        orderId: 1,
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
        status: 'open',
        fillStatus: 0,
        createdAt: new Date().toISOString(),
        txHash: '0xabc123',
        privacyLevel: 'public',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrder,
      });

      const result = await adapter.placeOrder(params);

      expect(result.orderId).toBe(1);
      expect(result.status).toBe('open');
      expect(result.privacyLevel).toBe('public');
      expect(result.sellToken).toBe('STRK');
      expect(result.buyToken).toBe('ETH');
    });

    it('should place a private (shielded) limit order with commitment', async () => {
      const params = {
        sellToken: 'ETH',
        buyToken: 'USDC',
        amount: 2000,
        limitTick: 40000,
        privacyMode: 'shielded' as const,
      };

      const mockOrder = {
        orderId: 2,
        sellToken: 'ETH',
        buyToken: 'USDC',
        amount: 2000,
        limitTick: 40000,
        status: 'open',
        fillStatus: 0,
        createdAt: new Date().toISOString(),
        txHash: '0xdef456',
        privacyLevel: 'shielded',
        commitment: '0xcommitment123',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrder,
      });

      const result = await adapter.placeOrder(params);

      expect(result.privacyLevel).toBe('shielded');
      expect(result.commitment).toBeDefined();
    });

    it('should place a dark ledger (fully private) limit order', async () => {
      const params = {
        sellToken: 'USDC',
        buyToken: 'STRK',
        amount: 3000,
        limitTick: 45000,
        privacyMode: 'fully_private' as const,
      };

      const mockOrder = {
        orderId: 3,
        sellToken: 'USDC',
        buyToken: 'STRK',
        amount: 3000,
        limitTick: 45000,
        status: 'open',
        fillStatus: 0,
        createdAt: new Date().toISOString(),
        txHash: '0xghi789',
        privacyLevel: 'fully_private',
        commitment: '0xcommitment456',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrder,
      });

      const result = await adapter.placeOrder(params);

      expect(result.privacyLevel).toBe('fully_private');
    });

    it('should handle network error when placing order', async () => {
      const params = {
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Server error' }),
      });

      await expect(adapter.placeOrder(params)).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cancel Order Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('should cancel an open limit order successfully', async () => {
      const params = {
        orderId: 1,
        sellToken: 'STRK',
        buyToken: 'ETH',
      };

      const mockCancelledOrder = {
        orderId: 1,
        sellToken: 'STRK',
        buyToken: 'ETH',
        status: 'cancelled',
        amount: 1000,
        limitTick: 50000,
        txHash: '0xcancel123',
        createdAt: new Date().toISOString(),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockCancelledOrder,
      });

      const result = await adapter.cancelOrder(params);

      expect(result.status).toBe('cancelled');
      expect(result.orderId).toBe(1);
    });

    it('should handle cancel error for non-existent order', async () => {
      const params = {
        orderId: 999,
        sellToken: 'STRK',
        buyToken: 'ETH',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Order not found' }),
      });

      await expect(adapter.cancelOrder(params)).rejects.toThrow('Order not found');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Get Active Orders Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('getActiveOrders', () => {
    it('should return list of active orders', async () => {
      const mockOrders = [
        {
          orderId: 1,
          sellToken: 'STRK',
          buyToken: 'ETH',
          amount: 1000,
          limitTick: 50000,
          status: 'open',
          fillStatus: 0,
          createdAt: new Date().toISOString(),
          txHash: '0xorder1',
          privacyLevel: 'public',
        },
        {
          orderId: 2,
          sellToken: 'ETH',
          buyToken: 'USDC',
          amount: 2000,
          limitTick: 40000,
          status: 'open',
          fillStatus: 25,
          createdAt: new Date().toISOString(),
          txHash: '0xorder2',
          privacyLevel: 'shielded',
          commitment: '0xcommitment123',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrders,
      });

      const result = await adapter.getActiveOrders();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].status).toBe('open');
      expect(result[1].status).toBe('open');
    });

    it('should return empty array when no active orders', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await adapter.getActiveOrders();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Estimate Fill Price Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('estimateFillPrice', () => {
    it('should estimate fill price for an order', async () => {
      const params = {
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
      };

      const mockEstimate = {
        estimatedFillPrice: 0.0015,
        fillProbability: 0.85,
        timeToFillEstimate: 3600,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockEstimate,
      });

      const result = await adapter.estimateFillPrice(params);

      expect(result.estimatedFillPrice).toBe(0.0015);
      expect(result.fillProbability).toBe(0.85);
      expect(result.timeToFillEstimate).toBe(3600);
    });

    it('should handle estimation error for invalid token pair', async () => {
      const params = {
        sellToken: 'INVALID_TOKEN',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Invalid token pair' }),
      });

      await expect(adapter.estimateFillPrice(params)).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Get Loan Record Tests (Order Details for Memory Lane)
  // ─────────────────────────────────────────────────────────────────────────

  describe('getLoanRecord', () => {
    it('should fetch order record for Memory Lane audit trail', async () => {
      const orderId = 1;

      const mockRecord = {
        orderId: 1,
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
        status: 'open',
        fillStatus: 0,
        createdAt: new Date().toISOString(),
        txHash: '0xabc123',
        privacyLevel: 'public',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRecord,
      });

      const result = await adapter.getLoanRecord(orderId);

      expect(result.orderId).toBe(1);
      expect(result.status).toBe('open');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Execute Method Tests (ExecutionAdapter Interface)
  // ─────────────────────────────────────────────────────────────────────────

  describe('execute method', () => {
    it('should execute place_order opportunity and return TradeReceipt', async () => {
      const opportunity = {
        type: 'limit_order',
        sellToken: 'STRK',
        buyToken: 'ETH',
      };

      const options = {
        amount: 1000,
        limitTick: 50000,
        privacyMode: 'public' as const,
      };

      const mockOrder = {
        orderId: 1,
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
        status: 'open',
        fillStatus: 0,
        createdAt: new Date().toISOString(),
        txHash: '0xabc123',
        privacyLevel: 'public',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrder,
      });

      const result = await adapter.execute(opportunity, options);

      expect(result).toBeDefined();
      expect(result.action).toBe('place_order');
      expect(result.adapter).toBe('limit_orders');
      expect(result.amount).toBe(1000);
      expect(result.privacyLevel).toBe('public');
      expect(result.status).toBe('confirmed');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Estimate Impact Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('estimateImpact method', () => {
    it('should estimate low yield and minimal risk for limit orders', async () => {
      const opportunity = {
        type: 'limit_order',
        sellToken: 'STRK',
        buyToken: 'ETH',
      };

      const result = await adapter.estimateImpact(opportunity, 1000);

      expect(result.yield).toBe(0);
      expect(result.risk).toBe('minimal');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multiple Orders Management Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('order management workflow', () => {
    it('should manage multiple orders independently', async () => {
      // Place first order
      const order1 = {
        orderId: 1,
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
        status: 'open',
        fillStatus: 0,
        createdAt: new Date().toISOString(),
        txHash: '0xorder1',
        privacyLevel: 'public',
      };

      // Place second order
      const order2 = {
        orderId: 2,
        sellToken: 'ETH',
        buyToken: 'USDC',
        amount: 2000,
        limitTick: 40000,
        status: 'open',
        fillStatus: 0,
        createdAt: new Date().toISOString(),
        txHash: '0xorder2',
        privacyLevel: 'shielded',
        commitment: '0xcommitment123',
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => order1,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => order2,
        });

      const result1 = await adapter.placeOrder({
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
        privacyMode: 'public',
      });

      const result2 = await adapter.placeOrder({
        sellToken: 'ETH',
        buyToken: 'USDC',
        amount: 2000,
        limitTick: 40000,
        privacyMode: 'shielded',
      });

      expect(result1.orderId).toBe(1);
      expect(result2.orderId).toBe(2);
      expect(result1.privacyLevel).toBe('public');
      expect(result2.privacyLevel).toBe('shielded');
    });

    it('should track order status changes from open to filled', async () => {
      // Simulate order status progression
      const openOrder = {
        orderId: 1,
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
        status: 'open',
        fillStatus: 0,
        createdAt: new Date().toISOString(),
        txHash: '0xorder1',
        privacyLevel: 'public',
      };

      const filledOrder = {
        ...openOrder,
        status: 'filled',
        fillStatus: 100,
        filledAt: new Date().toISOString(),
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => openOrder,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => filledOrder,
        });

      const initial = await adapter.getLoanRecord(1);
      expect(initial.status).toBe('open');
      expect(initial.fillStatus).toBe(0);

      const updated = await adapter.getLoanRecord(1);
      expect(updated.status).toBe('filled');
      expect(updated.fillStatus).toBe(100);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Error Handling Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      const params = {
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 1000,
        limitTick: 50000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(adapter.placeOrder(params)).rejects.toThrow('Network error');
    });

    it('should handle invalid amount (zero or negative)', async () => {
      const params = {
        sellToken: 'STRK',
        buyToken: 'ETH',
        amount: 0,
        limitTick: 50000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Amount must be greater than 0' }),
      });

      await expect(adapter.placeOrder(params)).rejects.toThrow();
    });

    it('should handle invalid token pair error', async () => {
      const params = {
        sellToken: 'UNKNOWN',
        buyToken: 'TOKENS',
        amount: 1000,
        limitTick: 50000,
        privacyMode: 'public' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Invalid token pair' }),
      });

      await expect(adapter.placeOrder(params)).rejects.toThrow('Invalid token pair');
    });
  });
});
