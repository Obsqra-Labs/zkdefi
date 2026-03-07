import { apiUrl } from '@/lib/api/client';
import { Tier } from '../ReputationGatingService';

/**
 * Pool liquidity snapshot with capital allocation metrics
 */
export interface PoolLiquidity {
  pool: string;
  totalDeposited: number;
  idleCapital: number;
  activeStrategies: number;
  utilizationRate: number; // 0-1
}

/**
 * Tier-based lending capacity derived from pool idle capital
 *
 * Allocation strategy:
 * - Tier1: 0% (cannot borrow)
 * - Tier2: 50% of idle capital
 * - Tier3: 80% of idle capital
 */
export interface PoolLiquidityGate {
  pool: string;
  availableForBorrowingTier1: number;
  availableForBorrowingTier2: number;
  availableForBorrowingTier3: number;
}

/**
 * PoolLiquidityManager
 *
 * Tracks idle capital in lending pools and allocates borrowing capacity
 * by reputation tier. Works with VaultLendingGovernanceService to enforce
 * capital constraints during borrowing.
 *
 * Responsibilities:
 * 1. Fetch pool liquidity stats from API
 * 2. Calculate tier-based lending capacity (Tier1=0%, Tier2=50%, Tier3=80%)
 * 3. Validate borrowing requests against available capital
 * 4. Provide real-time capacity metrics for UI display
 */
export class PoolLiquidityManager {
  /**
   * Fetches current liquidity snapshot for a pool
   *
   * @param pool - Pool identifier
   * @returns PoolLiquidity with current stats
   */
  async getPoolLiquidity(pool: string): Promise<PoolLiquidity> {
    const url = apiUrl(`/api/v1/dao/pools/${pool}/liquidity`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch pool liquidity (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Calculates available borrowing capacity per tier based on idle capital
   *
   * Allocation:
   * - Tier1: 0 (cannot borrow)
   * - Tier2: 50% of idle capital
   * - Tier3: 80% of idle capital
   *
   * @param pool - Pool identifier
   * @returns PoolLiquidityGate with tier-based allocations
   */
  async getAvailableCapitalByTier(pool: string): Promise<PoolLiquidityGate> {
    const liquidity = await this.getPoolLiquidity(pool);

    return {
      pool,
      availableForBorrowingTier1: 0,
      availableForBorrowingTier2: liquidity.idleCapital * 0.5,
      availableForBorrowingTier3: liquidity.idleCapital * 0.8,
    };
  }

  /**
   * Checks if a borrow request can be fulfilled for a given tier
   *
   * @param pool - Pool identifier
   * @param amount - Requested borrow amount
   * @param tier - User's reputation tier
   * @returns true if amount is available for tier, false otherwise
   */
  async canBorrowAmount(pool: string, amount: number, tier: Tier): Promise<boolean> {
    const gate = await this.getAvailableCapitalByTier(pool);

    if (tier === 'Tier1') {
      return false; // Tier1 cannot borrow
    }

    if (tier === 'Tier2') {
      return amount <= gate.availableForBorrowingTier2;
    }

    if (tier === 'Tier3') {
      return amount <= gate.availableForBorrowingTier3;
    }

    return false;
  }
}
