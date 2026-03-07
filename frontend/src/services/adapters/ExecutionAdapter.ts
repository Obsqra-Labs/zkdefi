/**
 * ExecutionAdapter Interface
 *
 * Defines the contract for execution adapters that handle various trading
 * and borrowing operations in the zkdefi system.
 *
 * Implementations must support:
 * - Basic execution of opportunities with options
 * - Estimating impact (yield, risk) of operations
 * - Privacy-aware operations
 */

export interface ExecutionAdapter {
  name: string;
  supportsPrivacy: boolean;
  supportsActions: string[];

  /**
   * Executes an opportunity with the given options
   * @param opportunity - The opportunity to execute (e.g., pool info for lending)
   * @param options - Execution options (e.g., amount, address, tier)
   * @returns TradeReceipt with execution metadata
   */
  execute(opportunity: Record<string, any>, options: Record<string, any>): Promise<TradeReceipt>;

  /**
   * Estimates the impact of an operation
   * @param opportunity - The opportunity being evaluated
   * @param amount - The amount to be transacted
   * @returns Object with yield and risk estimates
   */
  estimateImpact(
    opportunity: Record<string, any>,
    amount: number
  ): Promise<{ yield: number; risk: string }>;
}

/**
 * Receipt for trading/borrowing transactions
 * Used for audit trail in Memory Lane
 */
export interface TradeReceipt {
  id: string;
  timestamp: string; // ISO8601
  action: string; // 'borrow', 'repay', etc.
  adapter: string; // e.g., 'lending'
  opportunityName?: string;
  amount: number;
  privacyLevel: 'public' | 'shielded' | 'dark_ledger';
  exposureLevel?: number; // 0-100
  yieldImpact: number; // 0 for borrowing
  trustDelta: number; // e.g., 3 for loan repayment
  txHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
}
