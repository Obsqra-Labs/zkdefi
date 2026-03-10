import { apiUrl } from '@/lib/api/client';
import { ExecutionAdapter, TradeReceipt } from './ExecutionAdapter';

/**
 * LPPosition - represents a liquidity provision position in Ekubo pools
 */
export interface LPPosition {
  positionId: string;
  tokenA: string;
  tokenB: string;
  amountA: number;
  amountB: number;
  liquidity: number;
  status: 'active' | 'closed';
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
  privacyMode: 'public' | 'shielded' | 'dark_ledger';
  createdAt: string; // ISO8601
  commitment?: string; // For non-public positions
}

/**
 * LPPositionDetails - detailed metrics for an LP position
 */
export interface LPPositionDetails {
  positionId: string;
  currentValue: number;
  entryValue: number;
  unrealizedPnL: number;
  feeEarned: number;
  apy: number;
}

/**
 * RiskProfile - defines LP strategy parameters
 */
export interface RiskProfile {
  profile: string;
  tickRange: number;
  acceptedPairs: string[];
}

/**
 * Parameters for adding liquidity
 */
export interface AddLiquidityParams {
  tokenA: string;
  tokenB: string;
  amountA: number;
  amountB: number;
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
  privacyMode: 'public' | 'shielded' | 'dark_ledger';
}

/**
 * Parameters for removing liquidity
 */
export interface RemoveLiquidityParams {
  positionId: string;
  liquidityShare: number; // 0-1
}

/**
 * Return from removing liquidity
 */
export interface RemoveLiquidityResult {
  amountA: number;
  amountB: number;
  feeCollected: number;
  txHash: string;
}

/**
 * Return from collecting fees
 */
export interface CollectFeesResult {
  feeAmount: number;
  txHash: string;
}

/**
 * Risk profile configurations
 */
const RISK_PROFILES = {
  conservative: {
    tickRange: 6000,
    yieldRange: { min: 8, max: 10 },
    ilRisk: 'low',
  },
  moderate: {
    tickRange: 3000,
    yieldRange: { min: 12, max: 15 },
    ilRisk: 'medium',
  },
  aggressive: {
    tickRange: 1200,
    yieldRange: { min: 18, max: 25 },
    ilRisk: 'high',
  },
} as const;

/**
 * LPAdapter
 *
 * Manages liquidity provision in Ekubo pools with risk-profile-aware
 * tick range management and privacy support.
 *
 * Responsibilities:
 * 1. Add liquidity with configurable risk profiles
 * 2. Remove liquidity (partial or full)
 * 3. Collect accrued fees
 * 4. Query position details and PnL
 * 5. Support privacy modes (public, shielded, dark_ledger)
 * 6. Estimate yield and impermanent loss based on risk profile
 */
export class LPAdapter implements ExecutionAdapter {
  name = 'lp';
  supportsPrivacy = true;
  supportsActions = ['add_liquidity', 'remove_liquidity', 'collect_fees', 'rebalance'];

  /**
   * Add liquidity to an Ekubo pool with risk-profile-specific tick range
   *
   * @param params - Liquidity parameters (tokens, amounts, risk profile, privacy mode)
   * @returns LPPosition with positionId, liquidity amount, and commitment if private
   * @throws Error if tokens are invalid or amounts are imbalanced
   */
  async addLiquidity(params: AddLiquidityParams): Promise<LPPosition> {
    const { tokenA, tokenB, amountA, amountB, riskProfile, privacyMode } = params;

    const url = apiUrl('/api/v1/zkdefi/lp/add');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token_a: tokenA,
        token_b: tokenB,
        amount_a: amountA,
        amount_b: amountB,
        risk_profile: riskProfile,
        privacy_mode: privacyMode,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to add liquidity (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Remove liquidity from a position
   *
   * @param params - Position ID and liquidity share to remove (0-1)
   * @returns Withdrawn amounts and accrued fees
   * @throws Error if position not found or removal fails
   */
  async removeLiquidity(params: RemoveLiquidityParams): Promise<RemoveLiquidityResult> {
    const { positionId, liquidityShare } = params;

    const url = apiUrl(`/api/v1/zkdefi/lp/${positionId}/remove`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        liquidity_share: liquidityShare,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to remove liquidity (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Get detailed metrics for a liquidity position
   *
   * @param positionId - Position identifier
   * @returns Position details with current value, PnL, fees, and APY
   * @throws Error if position not found
   */
  async getPositionDetails(positionId: string): Promise<LPPositionDetails> {
    const url = apiUrl(`/api/v1/zkdefi/lp/${positionId}/details`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch position details (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Get risk profile configuration
   *
   * @param profile - Risk profile name ('conservative', 'moderate', 'aggressive')
   * @returns Profile details including tick range and accepted pairs
   */
  async getRiskProfile(
    profile: 'conservative' | 'moderate' | 'aggressive'
  ): Promise<RiskProfile> {
    const url = apiUrl(`/api/v1/zkdefi/lp/risk-profile/${profile}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch risk profile (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Collect accrued fees from a position without removing liquidity
   *
   * @param positionId - Position identifier
   * @returns Fee amount collected and transaction hash
   * @throws Error if position not found or collection fails
   */
  async collectFees(positionId: string): Promise<CollectFeesResult> {
    const url = apiUrl(`/api/v1/zkdefi/lp/${positionId}/collect-fees`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to collect fees (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Execute an LP operation as ExecutionAdapter interface
   *
   * Supports add_liquidity, remove_liquidity, collect_fees, and rebalance actions.
   *
   * @param opportunity - Operation context
   * @param options - Action and parameters
   * @returns TradeReceipt for Memory Lane audit trail
   */
  async execute(
    opportunity: Record<string, any>,
    options: Record<string, any>
  ): Promise<TradeReceipt> {
    const { action } = options;
    const { opportunityName } = opportunity;

    let result: any;
    let actionType = action;

    if (action === 'add_liquidity') {
      const { tokenA, tokenB, amountA, amountB, riskProfile, privacyMode } = options;
      result = await this.addLiquidity({
        tokenA,
        tokenB,
        amountA,
        amountB,
        riskProfile,
        privacyMode,
      });
    } else if (action === 'remove_liquidity') {
      const { positionId, liquidityShare } = options;
      result = await this.removeLiquidity({ positionId, liquidityShare });
    } else if (action === 'collect_fees') {
      const { positionId } = options;
      result = await this.collectFees(positionId);
    } else if (action === 'rebalance') {
      // For rebalance: simulate by returning the position
      result = { positionId: options.positionId };
    }

    // Generate ID from position or fee collection
    const id = `trade-${result.positionId || result.feeAmount || Date.now()}`;

    // Estimate yield for add_liquidity actions
    let yieldImpact = 0;
    if (action === 'add_liquidity') {
      const impact = await this.estimateImpact(
        { riskProfile: options.riskProfile },
        options.amountA + options.amountB
      );
      yieldImpact = impact.yield;
    }

    return {
      id,
      timestamp: new Date().toISOString(),
      action: actionType,
      adapter: 'lp',
      opportunityName,
      amount: options.amountA || options.amountB || 0,
      privacyLevel: options.privacyMode || 'public',
      yieldImpact,
      trustDelta: 2, // LP adds trust
      status: 'confirmed',
    };
  }

  /**
   * Estimate yield and impermanent loss (IL) risk for an LP position
   *
   * Returns yield range based on risk profile and risk level (IL risk).
   * Yield estimates are conservative mid-points:
   * - Conservative: 8-10% (IL risk: low)
   * - Moderate: 12-15% (IL risk: medium)
   * - Aggressive: 18-25% (IL risk: high)
   *
   * @param opportunity - Contains riskProfile
   * @param amount - LP amount (used for normalization, yield is profile-dependent)
   * @returns Yield estimate and risk level
   */
  async estimateImpact(
    opportunity: Record<string, any>,
    amount: number
  ): Promise<{ yield: number; risk: string }> {
    const { riskProfile } = opportunity;
    const profile = RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES];

    if (!profile) {
      throw new Error(`Unknown risk profile: ${riskProfile}`);
    }

    // Calculate mid-point yield
    const yieldMidpoint = (profile.yieldRange.min + profile.yieldRange.max) / 2;

    return {
      yield: yieldMidpoint,
      risk: profile.ilRisk,
    };
  }
}
