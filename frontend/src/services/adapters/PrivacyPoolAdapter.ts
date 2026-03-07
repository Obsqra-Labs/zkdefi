import { apiUrl } from '@/lib/api/client';
import { ExecutionAdapter, TradeReceipt } from './ExecutionAdapter';

/**
 * PoolDepositReceipt - returned from depositToPool
 */
export interface PoolDepositReceipt {
  id: string;
  pool: 'CONSERVATIVE_POOL' | 'MODERATE_POOL' | 'AGGRESSIVE_POOL';
  amount: number;
  privacyMode: 'public' | 'shielded' | 'dark_ledger';
  poolShare: number;
  txHash: string;
  timestamp: string; // ISO8601
  commitment?: string; // For private deposits
}

/**
 * PoolStats - pool statistics and metrics
 */
export interface PoolStats {
  pool: string;
  totalDeposited: number;
  currentYield: number; // APY percentage
  borrowersActive: number;
  avgBorrowingRate: number;
  idleCapital: number;
  utilizationRate: number; // 0-1
}

/**
 * YieldDistribution - tracked vault holder earnings
 */
export interface YieldDistribution {
  pool: string;
  amount: number;
  timestamp: string; // ISO8601
  reason: 'monthly' | 'quarterly' | 'weekly';
}

/**
 * PoolWithdrawalReceipt - returned from withdrawFromPool
 */
export interface PoolWithdrawalReceipt {
  id: string;
  pool: string;
  amount: number;
  address: string;
  txHash: string;
  timestamp: string; // ISO8601
  commitment?: string; // For private withdrawals
}

/**
 * Parameters for depositToPool
 */
export interface DepositParams {
  pool: 'CONSERVATIVE_POOL' | 'MODERATE_POOL' | 'AGGRESSIVE_POOL';
  amount: number;
  privacyMode: 'public' | 'shielded' | 'dark_ledger';
}

/**
 * Parameters for withdrawFromPool
 */
export interface WithdrawalParams {
  pool: string;
  amount: number;
  address: string;
}

/**
 * Pool yield strategies (APY %)
 */
const POOL_YIELDS = {
  CONSERVATIVE_POOL: 10,
  MODERATE_POOL: 12,
  AGGRESSIVE_POOL: 18,
} as const;

/**
 * Pool risk profiles
 */
const POOL_RISKS = {
  CONSERVATIVE_POOL: 'low',
  MODERATE_POOL: 'medium',
  AGGRESSIVE_POOL: 'high',
} as const;

/**
 * PrivacyPoolAdapter
 *
 * Manages the three privacy pools (Conservative, Moderate, Aggressive).
 * Each pool:
 * - Has a strategy yield (10%, 12%, 18% APY respectively)
 * - Has DAO-governed idle capital reserves (40%, 30%, 20%)
 * - Supports reputation-gated lending (Tier1 deposit-only, Tier2/3 borrow)
 * - Provides dual yield to vault holders (strategies + lending interest)
 *
 * Implements ExecutionAdapter interface for Trade Desk integration.
 */
export class PrivacyPoolAdapter implements ExecutionAdapter {
  name = 'privacy_pools';
  supportsPrivacy = true;
  supportsActions = ['deposit', 'withdraw', 'transfer'];

  /**
   * Map risk profile to pool identifier
   *
   * Synchronous mapping:
   * - 'conservative' → 'CONSERVATIVE_POOL'
   * - 'moderate' → 'MODERATE_POOL'
   * - 'aggressive' → 'AGGRESSIVE_POOL'
   *
   * @param profile - Risk profile name
   * @returns Pool identifier
   */
  getPoolForRiskProfile(
    profile: 'conservative' | 'moderate' | 'aggressive'
  ): 'CONSERVATIVE_POOL' | 'MODERATE_POOL' | 'AGGRESSIVE_POOL' {
    const poolMap = {
      conservative: 'CONSERVATIVE_POOL',
      moderate: 'MODERATE_POOL',
      aggressive: 'AGGRESSIVE_POOL',
    } as const;

    return poolMap[profile];
  }

  /**
   * Deposit to a privacy pool with optional privacy commitment
   *
   * Supports three privacy modes:
   * - 'public': transparent deposit
   * - 'shielded': private deposit with commitment
   * - 'dark_ledger': fully private with commitment
   *
   * @param params - Deposit parameters
   * @returns PoolDepositReceipt with pool share and commitment
   */
  async depositToPool(params: DepositParams): Promise<PoolDepositReceipt> {
    const { pool, amount, privacyMode } = params;

    // Validate parameters
    this.validateDepositParams(amount);

    const url = apiUrl(`/api/v1/dao/pools/${pool}/deposit`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        privacyMode,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Deposit request failed (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Get statistics for a privacy pool
   *
   * Returns pool metrics including yield, borrowers, utilization, and idle capital.
   *
   * @param pool - Pool identifier
   * @returns PoolStats with metrics
   */
  async getPoolStats(pool: string): Promise<PoolStats> {
    const url = apiUrl(`/api/v1/dao/pools/${pool}/stats`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch pool stats (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Get yield distributions for all pools
   *
   * Returns array of yield distributions tracked for vault holders.
   *
   * @returns Array of YieldDistribution objects
   */
  async getYieldDistributions(): Promise<YieldDistribution[]> {
    const url = apiUrl(`/api/v1/dao/pools/yield/distributions`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch yield distributions (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Withdraw from a privacy pool
   *
   * Supports private withdrawals via commitments.
   *
   * @param params - Withdrawal parameters
   * @returns PoolWithdrawalReceipt with transaction details
   */
  async withdrawFromPool(params: WithdrawalParams): Promise<PoolWithdrawalReceipt> {
    const { pool, amount, address } = params;

    // Validate parameters
    this.validateWithdrawalParams(amount);

    const url = apiUrl(`/api/v1/dao/pools/${pool}/withdraw`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        address,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Withdrawal request failed (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Execute as ExecutionAdapter interface
   *
   * Delegates to depositToPool and returns TradeReceipt for Memory Lane audit trail.
   *
   * @param opportunity - Pool details
   * @param options - Execution options (amount, privacyMode)
   * @returns TradeReceipt with execution metadata
   */
  async execute(
    opportunity: Record<string, any>,
    options: Record<string, any>
  ): Promise<TradeReceipt> {
    const { pool } = opportunity;
    const { amount, privacyMode } = options;

    const receipt = await this.depositToPool({
      pool,
      amount,
      privacyMode,
    });

    // Get pool yield for yieldImpact
    const poolYield = POOL_YIELDS[pool as keyof typeof POOL_YIELDS] || 10;

    // Generate ID from deposit receipt
    const id = `trade-${receipt.id}`;

    // Create TradeReceipt for audit trail
    return {
      id,
      timestamp: new Date().toISOString(),
      action: 'deposit',
      adapter: 'privacy_pools',
      amount: receipt.amount,
      privacyLevel: receipt.privacyMode,
      yieldImpact: poolYield,
      trustDelta: 2, // Successful deposit increases trust
      txHash: receipt.txHash,
      status: 'confirmed',
    };
  }

  /**
   * Estimate impact of a pool deposit operation
   *
   * Returns yield (strategy APY) and risk profile.
   *
   * The returned yield reflects the base strategy yield from the pool.
   * Actual earned yield includes lending interest from borrowers (~2-3% additional).
   *
   * @param opportunity - Pool details
   * @param amount - Deposit amount
   * @returns Impact estimates (yield, risk)
   */
  async estimateImpact(
    opportunity: Record<string, any>,
    amount: number
  ): Promise<{ yield: number; risk: string }> {
    const { pool } = opportunity;

    const baseYield = POOL_YIELDS[pool as keyof typeof POOL_YIELDS] || 10;
    const risk = POOL_RISKS[pool as keyof typeof POOL_RISKS] || 'medium';

    return {
      yield: baseYield,
      risk,
    };
  }

  /**
   * Validate deposit parameters
   *
   * @param amount - Deposit amount
   */
  private validateDepositParams(amount: number): void {
    if (amount <= 0) {
      throw new Error('Deposit amount must be greater than 0');
    }
  }

  /**
   * Validate withdrawal parameters
   *
   * @param amount - Withdrawal amount
   */
  private validateWithdrawalParams(amount: number): void {
    if (amount <= 0) {
      throw new Error('Withdrawal amount must be greater than 0');
    }
  }
}
