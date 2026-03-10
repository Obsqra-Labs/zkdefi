import { apiUrl } from '@/lib/api/client';

/**
 * Reputation score thresholds for tier mapping
 * - Tier1 (0-50): Can deposit + earn yield only
 * - Tier2 (51-75): Can borrow up to 50% LTV at DAO-voted rates
 * - Tier3 (76-100): Can borrow up to 150% LTV at DAO-voted rates
 */
const TIER_THRESHOLDS = {
  Tier1: { min: 0, max: 50 },
  Tier2: { min: 51, max: 75 },
  Tier3: { min: 76, max: 100 },
} as const;

const LTV_BY_TIER = {
  Tier1: 0,
  Tier2: 0.5,
  Tier3: 1.5,
} as const;

const BORROWING_RATE_BY_TIER = {
  Tier1: null,
  Tier2: 6,
  Tier3: 4,
} as const;

export type Tier = 'Tier1' | 'Tier2' | 'Tier3';

export interface ReputationGates {
  canSwap?: boolean;
  canLP?: boolean;
  canLend?: boolean;
  canBorrow?: boolean;
  canStake?: boolean;
  canPrivacy?: boolean;
  [key: string]: boolean | undefined;
}

export interface UserReputation {
  address: string;
  reputationScore: number;
  tier: Tier;
  updatedAt: string;
  gates?: ReputationGates | null;
}

export type AccessEventType = 'borrow' | 'repay';

export interface AccessEvent {
  timestamp: string;
  event: AccessEventType;
  amount: number;
  rate?: number;
}

/**
 * ReputationGatingService
 *
 * Maps reputation scores to economic access levels in the zkdefi system.
 * Implements privacy-first access control where reputation directly unlocks
 * borrowing power and rates without exposing full portfolio information.
 */
export class ReputationGatingService {
  /**
   * Fetches user reputation from the API and maps to tier
   *
   * @param address - User's wallet address
   * @returns UserReputation with computed tier
   */
  async getUserReputation(address: string): Promise<UserReputation> {
    const url = apiUrl(`/api/v1/zkdefi/reputation/user/${address}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch reputation (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();

    const score = data.reputation_score ?? data.reputationScore ?? 0;
    const tierName = data.tier_name ?? data.tierName ?? this.mapScoreToTier(score);

    return {
      address: data.address,
      reputationScore: score,
      tier: (["Tier1", "Tier2", "Tier3"].includes(tierName)
        ? tierName
        : this.mapScoreToTier(score)) as Tier,
      updatedAt: data.updatedAt ?? data.updated_at ?? new Date().toISOString(),
      gates: data.gates ?? null,
    };
  }

  /**
   * Maps a reputation score to its corresponding tier
   *
   * @param score - Reputation score (0-100)
   * @returns Tier (Tier1, Tier2, or Tier3)
   */
  mapScoreToTier(score: number): Tier {
    if (score >= TIER_THRESHOLDS.Tier3.min) {
      return 'Tier3';
    }
    if (score >= TIER_THRESHOLDS.Tier2.min) {
      return 'Tier2';
    }
    return 'Tier1';
  }

  /**
   * Calculates borrowing power based on tier and deposit amount
   *
   * @param tier - User's reputation tier
   * @param depositAmount - Amount deposited as collateral
   * @param pool - Pool identifier (for future DAO governance lookups)
   * @returns Maximum borrowing amount (0 for Tier1)
   */
  async getBorrowingPower(tier: Tier, depositAmount: number, pool: string): Promise<number> {
    const ltv = LTV_BY_TIER[tier];
    return depositAmount * ltv;
  }

  /**
   * Gets the borrowing rate for a tier
   *
   * @param tier - User's reputation tier
   * @param pool - Pool identifier (for future DAO governance lookups)
   * @returns Borrowing rate as percentage, or null if tier cannot borrow
   */
  async getBorrowingRate(tier: Tier, pool: string): Promise<number | null> {
    // TODO: In future, fetch DAO-voted rates from pool governance
    // For now, use default rates based on tier
    return BORROWING_RATE_BY_TIER[tier];
  }

  /**
   * Fetches the access/activity history for a user's reputation-gated actions
   *
   * @param address - User's wallet address
   * @returns Array of access events (borrows, repays, etc)
   */
  async getAccessHistory(address: string): Promise<AccessEvent[]> {
    const url = apiUrl(`/api/v1/zkdefi/reputation/access-history/${address}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch access history (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }
}
