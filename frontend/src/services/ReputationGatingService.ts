import { apiFetch } from '@/lib/api/client';

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

const DEFAULT_SCORE_BY_TIER: Record<Tier, number> = {
  Tier1: 45,
  Tier2: 65,
  Tier3: 85,
};

export type Tier = 'Tier1' | 'Tier2' | 'Tier3';

export interface UserReputation {
  address: string;
  reputationScore: number;
  tier: Tier;
  updatedAt: string;
}

export type AccessEventType = 'borrow' | 'repay';

export interface AccessEvent {
  timestamp: string;
  event: AccessEventType;
  amount: number;
  rate?: number;
}

function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function normalizeTierFromRaw(rawTier: unknown, rawTierName: unknown): Tier | null {
  const numeric = asNumber(rawTier);
  if (numeric !== null) {
    if (numeric >= 2) return 'Tier3';
    if (numeric >= 1) return 'Tier2';
    return 'Tier1';
  }

  const text = String(rawTierName ?? rawTier ?? '').trim().toLowerCase();
  if (text.includes('tier3') || text.includes('trusted') || text.includes('express')) return 'Tier3';
  if (text.includes('tier2') || text.includes('standard')) return 'Tier2';
  if (text.includes('tier1') || text.includes('strict') || text.includes('anon')) return 'Tier1';
  return null;
}

function isLikelyRiskProfileV2(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.profile_version === 'string' ||
    typeof payload.reputation === 'object' ||
    typeof payload.passport === 'object'
  );
}

function normalizeFromLegacyPayload(data: Record<string, unknown>, fallbackAddress: string, nowIso: string, mapScoreToTier: (score: number) => Tier): UserReputation {
  const score = clampScore(
    asNumber(data.reputationScore) ??
      asNumber(data.trust_score) ??
      asNumber(data.composite_score) ??
      0
  );

  const explicitTier =
    normalizeTierFromRaw(data.tier ?? data.current_tier, data.tier_name) ??
    mapScoreToTier(score || DEFAULT_SCORE_BY_TIER.Tier1);
  const normalizedScore = score || DEFAULT_SCORE_BY_TIER[explicitTier];

  return {
    address: String(data.address ?? fallbackAddress),
    reputationScore: normalizedScore,
    tier: explicitTier,
    updatedAt: String(data.updatedAt ?? nowIso),
  };
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
    const nowIso = new Date().toISOString();
    try {
      const profileV2 = await apiFetch<Record<string, unknown>>(`/api/v1/zkdefi/risk_profile/v2/${address}`, {
        method: 'GET',
      });

      if (!isLikelyRiskProfileV2(profileV2)) {
        return normalizeFromLegacyPayload(profileV2, address, nowIso, this.mapScoreToTier.bind(this));
      }

      const profileRep = (profileV2.reputation as Record<string, unknown> | undefined) ?? {};
      const profilePassport = (profileV2.passport as Record<string, unknown> | undefined) ?? {};
      const tier =
        normalizeTierFromRaw(profileRep.tier, profileRep.tier_name) ??
        this.mapScoreToTier(clampScore(asNumber(profilePassport.composite_score) ?? 0));
      const score = clampScore(asNumber(profilePassport.composite_score) ?? DEFAULT_SCORE_BY_TIER[tier]);

      return {
        address: String(profileV2.address ?? address),
        reputationScore: score,
        tier,
        updatedAt: String(profileV2.generated_at ?? nowIso),
      };
    } catch (v2Error) {
      try {
        const data = await apiFetch<Record<string, unknown>>(`/api/v1/zkdefi/reputation/user/${address}`, {
          method: 'GET',
        });
        return normalizeFromLegacyPayload(data, address, nowIso, this.mapScoreToTier.bind(this));
      } catch {
        throw v2Error;
      }
    }
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
    const data = await apiFetch<unknown>(`/api/v1/zkdefi/reputation/access-history/${address}`, {
      method: 'GET',
    });
    return Array.isArray(data) ? (data as AccessEvent[]) : [];
  }
}
