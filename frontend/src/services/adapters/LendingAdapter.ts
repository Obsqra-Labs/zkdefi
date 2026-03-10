import { apiUrl } from '@/lib/api/client';
import { ReputationGatingService, Tier } from '../ReputationGatingService';
import { ExecutionAdapter, TradeReceipt } from './ExecutionAdapter';

/**
 * BorrowReceipt - returned from borrowFromPool
 */
export interface BorrowReceipt {
  loanId: string;
  borrowAmount: number;
  rate: number; // APR as percentage (6 = 6%)
  apr: number; // APR as percentage (6 = 6%)
  maxBorrow: number;
  tier: Tier;
  type: 'dao_voted_lending';
}

/**
 * Loan record for audit trail
 */
export interface LoanRecord {
  loanId: string;
  amount: number;
  rate: number;
  tier: Tier;
  status: string;
  createdAt: string;
}

/**
 * Parameters for borrowFromPool
 */
export interface BorrowParams {
  pool: string; // e.g., "MODERATE_POOL"
  amount: number;
  address: string; // User's wallet address
  tier: Tier;
  depositAmount?: number; // For LTV calculation
}

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

/**
 * LendingAdapter
 *
 * Implements the ExecutionAdapter interface for reputation-gated borrowing
 * from DAO-governed privacy pools.
 *
 * Responsibilities:
 * 1. Enforce reputation tiers (Tier1 cannot borrow)
 * 2. Enforce LTV limits per tier (50% for Tier2, 150% for Tier3)
 * 3. Apply DAO-voted borrowing rates
 * 4. Track loans for audit trail
 */
export class LendingAdapter implements ExecutionAdapter {
  name = 'lending';
  supportsPrivacy = true;
  supportsActions = ['borrow'];

  constructor(private reputationService: ReputationGatingService) {}

  /**
   * Borrow from a DAO-governed lending pool with reputation gating
   *
   * Enforces:
   * - Tier1 cannot borrow (rejected)
   * - LTV limits per tier
   * - Idle capital availability
   * - DAO-voted rates
   *
   * @param params - Borrow parameters
   * @returns BorrowReceipt with loan details
   */
  async borrowFromPool(params: BorrowParams): Promise<BorrowReceipt> {
    const { pool, amount, address, tier, depositAmount = 0 } = params;

    // Validation
    this.validateBorrowParams(amount, tier, depositAmount);

    // Check reputation tier restrictions
    if (tier === 'Tier1') {
      throw new Error('Tier1 cannot borrow from lending pools');
    }

    // Calculate max borrow based on LTV
    const maxBorrow = depositAmount * LTV_BY_TIER[tier];

    // Enforce LTV limit
    if (amount > maxBorrow) {
      const ltv = (LTV_BY_TIER[tier] * 100).toFixed(0);
      throw new Error(`Borrow amount exceeds LTV limit of ${ltv}% for ${tier}`);
    }

    // Get DAO-voted rate for this tier
    const rate = await this.reputationService.getBorrowingRate(tier, pool);
    if (rate === null) {
      throw new Error(`${tier} cannot borrow from lending pools`);
    }

    // Execute borrow at API endpoint
    const url = apiUrl(`/api/v1/dao/pools/${pool}/borrow`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address,
        amount,
        tier,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Borrow request failed (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();

    return {
      loanId: data.loanId,
      borrowAmount: data.borrowAmount,
      rate: rate, // APR as percentage (6 = 6%)
      apr: rate,
      maxBorrow: data.maxBorrow,
      tier,
      type: 'dao_voted_lending',
    };
  }

  /**
   * Execute an opportunity as ExecutionAdapter interface
   *
   * Wraps borrowFromPool and returns TradeReceipt for Memory Lane
   *
   * @param opportunity - Pool details
   * @param options - Execution options (amount, address, tier)
   * @returns TradeReceipt with execution metadata
   */
  async execute(
    opportunity: Record<string, any>,
    options: Record<string, any>
  ): Promise<TradeReceipt> {
    const { pool, depositAmount, opportunityName } = opportunity;
    const { amount, address, tier } = options;

    const receipt = await this.borrowFromPool({
      pool,
      amount,
      address,
      tier,
      depositAmount,
    });

    // Generate ID from loanId
    const id = `trade-${receipt.loanId}`;

    // Create TradeReceipt for audit trail
    return {
      id,
      timestamp: new Date().toISOString(),
      action: 'borrow',
      adapter: 'lending',
      opportunityName,
      amount: receipt.borrowAmount,
      privacyLevel: 'shielded', // Borrowing through privacy pool
      exposureLevel: 50,
      yieldImpact: 0, // Borrowing doesn't generate yield
      trustDelta: 3, // Successfully executed borrow increases trust
      status: 'confirmed',
    };
  }

  /**
   * Estimate impact of a borrowing operation
   *
   * Borrowing adds risk (must repay with interest) and no yield
   *
   * @param opportunity - Pool details
   * @param amount - Borrow amount
   * @returns Impact estimates
   */
  async estimateImpact(
    opportunity: Record<string, any>,
    amount: number
  ): Promise<{ yield: number; risk: string }> {
    // Borrowing generates no yield
    // Borrowing increases risk (must repay loan + interest)
    return {
      yield: 0,
      risk: 'increased',
    };
  }

  /**
   * Fetch loan record for Memory Lane audit trail
   *
   * @param loanId - Loan identifier
   * @returns LoanRecord with details
   */
  async getLoanRecord(loanId: string): Promise<LoanRecord> {
    const url = apiUrl(`/api/v1/dao/loans/${loanId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : `Failed to fetch loan record (${response.status})`;
      throw new Error(detail);
    }

    return response.json();
  }

  /**
   * Validate borrow parameters
   *
   * @param amount - Borrow amount
   * @param tier - User's reputation tier
   * @param depositAmount - Collateral amount
   */
  private validateBorrowParams(amount: number, tier: Tier, depositAmount: number): void {
    if (amount <= 0) {
      throw new Error('Borrow amount must be greater than 0');
    }

    if (depositAmount < 0) {
      throw new Error('Deposit amount cannot be negative');
    }

    if (!['Tier1', 'Tier2', 'Tier3'].includes(tier)) {
      throw new Error(`Invalid tier: ${tier}`);
    }
  }
}
