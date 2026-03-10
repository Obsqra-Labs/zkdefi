import { apiUrl } from '@/lib/api/client';
import { ExecutionAdapter, TradeReceipt } from './ExecutionAdapter';

/**
 * Limit Order - represents a pending or filled limit order on Ekubo DEX
 */
export interface LimitOrder {
  orderId: number;
  sellToken: string;
  buyToken: string;
  amount: number;
  limitTick: number;
  status: 'open' | 'filled' | 'cancelled' | 'expired';
  fillStatus: number; // 0-100 percentage
  createdAt: string; // ISO8601
  filledAt?: string; // ISO8601
  txHash: string;
  privacyLevel: 'public' | 'shielded' | 'dark_ledger';
  commitment?: string; // For shielded/dark_ledger orders
}

/**
 * Fill Estimate - prediction for order execution
 */
export interface FillEstimate {
  estimatedFillPrice: number;
  fillProbability: number; // 0-1
  timeToFillEstimate: number; // seconds
}

/**
 * Parameters for placing a limit order
 */
export interface PlaceOrderParams {
  sellToken: string;
  buyToken: string;
  amount: number;
  limitTick: number;
  privacyMode: 'public' | 'shielded' | 'dark_ledger';
}

/**
 * Parameters for cancelling a limit order
 */
export interface CancelOrderParams {
  orderId: number;
  sellToken: string;
  buyToken: string;
}

/**
 * Parameters for estimating fill price
 */
export interface EstimateFillPriceParams {
  sellToken: string;
  buyToken: string;
  amount: number;
  limitTick: number;
}

/**
 * LimitOrdersAdapter
 *
 * Implements the ExecutionAdapter interface for Ekubo limit order operations.
 *
 * Responsibilities:
 * 1. Place limit orders (sell X of Token A when price reaches Y for Token B)
 * 2. Cancel open limit orders
 * 3. Query active orders
 * 4. Estimate fill probabilities and timing
 * 5. Support privacy modes (public, shielded, dark_ledger)
 * 6. Track orders for audit trail (Memory Lane)
 */
export class LimitOrdersAdapter implements ExecutionAdapter {
  name = 'limit_orders';
  supportsPrivacy = true;
  supportsActions = ['place_order', 'cancel_order', 'monitor'];

  /**
   * Place a limit order on Ekubo DEX
   *
   * Creates an order to sell sellToken when the price reaches limitTick.
   * Supports privacy modes:
   * - public: Order visible on-chain
   * - shielded: Order hidden via commitment
   * - dark_ledger: Fully private order with encryption
   *
   * @param params - Order parameters
   * @returns LimitOrder with orderId, status, and privacy details
   * @throws Error if order placement fails (invalid pair, network error, etc.)
   */
  async placeOrder(params: PlaceOrderParams): Promise<LimitOrder> {
    const { sellToken, buyToken, amount, limitTick, privacyMode } = params;

    const url = apiUrl('/api/v1/zkdefi/limit-orders/place');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sell_token: sellToken,
        buy_token: buyToken,
        amount,
        limit_tick: limitTick,
        privacy_mode: privacyMode,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to place limit order (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Cancel an open limit order
   *
   * Withdraws the unsold tokens from the order and marks it as cancelled.
   * Only works for orders with status 'open'.
   *
   * @param params - Cancel parameters (orderId, sellToken, buyToken)
   * @returns Cancelled order details
   * @throws Error if order not found or cancel fails
   */
  async cancelOrder(params: CancelOrderParams): Promise<LimitOrder> {
    const { orderId, sellToken, buyToken } = params;

    const url = apiUrl('/api/v1/zkdefi/limit-orders/cancel');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: orderId,
        sell_token: sellToken,
        buy_token: buyToken,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to cancel limit order (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Get all active (open) limit orders for the current user
   *
   * Returns orders with status 'open'. Does not include filled or cancelled orders.
   *
   * @returns Array of active LimitOrder objects
   * @throws Error if fetch fails
   */
  async getActiveOrders(): Promise<LimitOrder[]> {
    const url = apiUrl('/api/v1/zkdefi/limit-orders/active');

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch active orders (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Estimate fill price and probability for a hypothetical order
   *
   * Uses market data to predict:
   * - Estimated fill price
   * - Probability the order will fill (0-1)
   * - Time estimate to fill (seconds)
   *
   * @param params - Estimation parameters
   * @returns FillEstimate with price, probability, and timing
   * @throws Error if estimation fails (invalid pair, network error)
   */
  async estimateFillPrice(params: EstimateFillPriceParams): Promise<FillEstimate> {
    const { sellToken, buyToken, amount, limitTick } = params;

    const url = apiUrl('/api/v1/zkdefi/limit-orders/estimate');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sell_token: sellToken,
        buy_token: buyToken,
        amount,
        limit_tick: limitTick,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to estimate fill price (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Fetch order record for Memory Lane audit trail
   *
   * Retrieves detailed order information for historical tracking.
   * Similar to LendingAdapter.getLoanRecord for audit purposes.
   *
   * @param orderId - Order identifier
   * @returns OrderRecord with full order details
   * @throws Error if order not found or fetch fails
   */
  async getLoanRecord(orderId: number): Promise<LimitOrder> {
    const url = apiUrl(`/api/v1/zkdefi/limit-orders/${orderId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch order record (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Execute an opportunity as ExecutionAdapter interface
   *
   * Handles place_order execution and returns TradeReceipt for Memory Lane.
   * Maps limit order execution to the ExecutionAdapter interface.
   *
   * @param opportunity - Opportunity details (type, tokens, etc.)
   * @param options - Execution options (amount, limitTick, privacyMode)
   * @returns TradeReceipt with execution metadata
   */
  async execute(
    opportunity: Record<string, any>,
    options: Record<string, any>
  ): Promise<TradeReceipt> {
    const { sellToken, buyToken } = opportunity;
    const { amount, limitTick, privacyMode } = options;

    const order = await this.placeOrder({
      sellToken,
      buyToken,
      amount,
      limitTick,
      privacyMode,
    });

    const id = `trade-${order.orderId}`;

    return {
      id,
      timestamp: new Date().toISOString(),
      action: 'place_order',
      adapter: 'limit_orders',
      amount: order.amount,
      privacyLevel: order.privacyLevel,
      yieldImpact: 0, // Limit orders don't generate yield
      trustDelta: 1, // Placing an order slightly increases trust
      txHash: order.txHash,
      status: 'confirmed',
    };
  }

  /**
   * Estimate impact of a limit order operation
   *
   * Limit orders:
   * - Generate zero yield (just position orders)
   * - Add minimal risk (no capital borrowed/locked)
   *
   * @param opportunity - Opportunity details
   * @param amount - Order amount
   * @returns Impact estimates (zero yield, minimal risk)
   */
  async estimateImpact(
    opportunity: Record<string, any>,
    amount: number
  ): Promise<{ yield: number; risk: string }> {
    return {
      yield: 0, // No yield generation
      risk: 'minimal', // No capital at risk
    };
  }
}
