import { apiUrl } from '@/lib/api/client';
import { ExecutionAdapter, TradeReceipt } from './ExecutionAdapter';

/**
 * DCA Position - represents a scheduled purchase position
 */
export interface DCAPosition {
  positionId: string;
  sellToken: string;
  buyToken: string;
  intervalSeconds: number;
  amountPerInterval: number;
  totalDuration: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  nextExecutionTime: string; // ISO8601
  privacyMode: 'public' | 'shielded' | 'dark_ledger';
  createdAt: string; // ISO8601
  commitment?: string;
}

/**
 * Execution - records a single purchase execution
 */
export interface Execution {
  timestamp: string; // ISO8601
  amountIn: number;
  amountOut: number;
  priceAtExecution: number;
  txHash: string;
}

/**
 * Average Cost Estimate - prediction for DCA average cost
 */
export interface AverageCostEstimate {
  estimatedAverageCost: number;
  volatilityMitigation: number; // 0-1 (15% = 0.15)
  slippageExposure: number;
}

/**
 * Parameters for creating a DCA position
 */
export interface CreatePositionParams {
  sellToken: string;
  buyToken: string;
  intervalSeconds: number;
  amountPerInterval: number;
  totalDuration: number;
  privacyMode: 'public' | 'shielded' | 'dark_ledger';
}

/**
 * Parameters for estimating average cost
 */
export interface EstimateAverageCostParams {
  sellToken: string;
  buyToken: string;
  amountPerInterval: number;
  historyDays: number;
}

/**
 * Response from cancel position
 */
export interface CancelPositionResponse {
  status: string;
  executedCount: number;
  remainingAmount: number;
}

/**
 * Response from pause/resume position
 */
export interface PauseResumeResponse {
  positionId: string;
  status: string;
}

/**
 * DCAAdapter
 *
 * Implements the ExecutionAdapter interface for Dollar-Cost Averaging operations.
 *
 * Responsibilities:
 * 1. Create recurring scheduled purchase positions
 * 2. Cancel or modify positions (pause/resume)
 * 3. Track execution history across intervals
 * 4. Estimate average cost with volatility mitigation analysis
 * 5. Support privacy modes (public, shielded, dark_ledger)
 * 6. Track positions for audit trail (Memory Lane)
 */
export class DCAAdapter implements ExecutionAdapter {
  name = 'dca';
  supportsPrivacy = true;
  supportsActions = ['create_position', 'pause', 'resume', 'cancel'];

  /**
   * Create a DCA position for recurring purchases
   *
   * Creates a scheduled purchase position that will execute at fixed intervals.
   * Supports privacy modes:
   * - public: Schedule visible on-chain
   * - shielded: Schedule hidden via commitment
   * - dark_ledger: Fully private execution with encryption
   *
   * @param params - Position creation parameters
   * @returns DCAPosition with positionId, status, and next execution time
   * @throws Error if creation fails (invalid pair, network error, etc.)
   */
  async createPosition(params: CreatePositionParams): Promise<DCAPosition> {
    const {
      sellToken,
      buyToken,
      intervalSeconds,
      amountPerInterval,
      totalDuration,
      privacyMode,
    } = params;

    const url = apiUrl('/api/v1/zkdefi/dca/create');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sell_token: sellToken,
        buy_token: buyToken,
        interval_seconds: intervalSeconds,
        amount_per_interval: amountPerInterval,
        total_duration: totalDuration,
        privacy_mode: privacyMode,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to create DCA position (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Cancel a DCA position
   *
   * Stops future executions and withdraws remaining unspent amount.
   * Returns execution count and remaining amount.
   *
   * @param positionId - Position identifier
   * @returns Response with status, execution count, and remaining amount
   * @throws Error if position not found or cancel fails
   */
  async cancelPosition(positionId: string): Promise<CancelPositionResponse> {
    const url = apiUrl(`/api/v1/zkdefi/dca/${positionId}/cancel`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to cancel DCA position (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Get execution history for a position
   *
   * Returns all past executions with timestamps, amounts, and prices.
   *
   * @param positionId - Position identifier
   * @returns Array of Execution objects
   * @throws Error if fetch fails
   */
  async getExecutionHistory(positionId: string): Promise<Execution[]> {
    const url = apiUrl(`/api/v1/zkdefi/dca/${positionId}/history`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch execution history (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Estimate average cost with DCA
   *
   * Uses historical price data to predict:
   * - Estimated average cost per unit
   * - Volatility mitigation benefit (0-1 scale)
   * - Slippage exposure
   *
   * @param params - Estimation parameters
   * @returns AverageCostEstimate with predictions
   * @throws Error if estimation fails
   */
  async estimateAverageCost(
    params: EstimateAverageCostParams
  ): Promise<AverageCostEstimate> {
    const { sellToken, buyToken, amountPerInterval, historyDays } = params;

    const url = apiUrl('/api/v1/zkdefi/dca/estimate');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sell_token: sellToken,
        buy_token: buyToken,
        amount_per_interval: amountPerInterval,
        history_days: historyDays,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to estimate average cost (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Pause a DCA position
   *
   * Temporarily stops scheduled executions without cancelling.
   *
   * @param positionId - Position identifier
   * @returns Position details with paused status
   * @throws Error if pause fails
   */
  async pausePosition(positionId: string): Promise<PauseResumeResponse> {
    const url = apiUrl(`/api/v1/zkdefi/dca/${positionId}/pause`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to pause DCA position (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Resume a paused DCA position
   *
   * Restarts scheduled executions for a previously paused position.
   *
   * @param positionId - Position identifier
   * @returns Position details with active status
   * @throws Error if resume fails
   */
  async resumePosition(positionId: string): Promise<PauseResumeResponse> {
    const url = apiUrl(`/api/v1/zkdefi/dca/${positionId}/resume`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to resume DCA position (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Execute an opportunity as ExecutionAdapter interface
   *
   * Handles create_position execution and returns TradeReceipt for Memory Lane.
   * Maps DCA position creation to the ExecutionAdapter interface.
   *
   * @param opportunity - Opportunity details (sellToken, buyToken)
   * @param options - Execution options (intervalSeconds, amountPerInterval, etc.)
   * @returns TradeReceipt with execution metadata
   */
  async execute(
    opportunity: Record<string, any>,
    options: Record<string, any>
  ): Promise<TradeReceipt> {
    const { sellToken, buyToken } = opportunity;
    const {
      intervalSeconds,
      amountPerInterval,
      totalDuration,
      privacyMode,
    } = options;

    const position = await this.createPosition({
      sellToken,
      buyToken,
      intervalSeconds,
      amountPerInterval,
      totalDuration,
      privacyMode,
    });

    const id = `trade-${position.positionId}`;

    return {
      id,
      timestamp: new Date().toISOString(),
      action: 'create_position',
      adapter: 'dca',
      amount: position.amountPerInterval,
      privacyLevel: position.privacyMode,
      yieldImpact: 0, // DCA doesn't generate yield
      trustDelta: 1, // Creating a position slightly increases trust
      status: 'confirmed',
    };
  }

  /**
   * Estimate impact of a DCA operation
   *
   * DCA:
   * - Generates zero yield (just systematic buying)
   * - Reduces risk through volatility mitigation and dollar-cost averaging
   *
   * @param opportunity - Opportunity details
   * @param amount - Amount per interval
   * @returns Impact estimates (zero yield, reduced risk)
   */
  async estimateImpact(
    opportunity: Record<string, any>,
    amount: number
  ): Promise<{ yield: number; risk: string }> {
    return {
      yield: 0, // No yield generation
      risk: 'reduced', // DCA reduces volatility risk
    };
  }
}
