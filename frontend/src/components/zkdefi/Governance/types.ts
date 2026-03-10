/**
 * Types and interfaces for ActiveLoansDisplay component
 * Extends the base LoanRecord from VaultLendingGovernanceService
 */

import { Tier } from '@/services/ReputationGatingService';

/**
 * Extended loan record with calculated metrics
 */
export interface ExtendedLoanRecord {
  loanId: string;
  borrowerAddress: string;
  amount: number;
  rate: number; // APR percentage (e.g., 4 for 4%)
  tier: Tier;
  status: 'active' | 'repaid' | 'defaulted';
  createdAt: string;
  maturityDate?: string;
  collateralAmount: number;
  interestAccrued: number;
  totalDue: number;
  currentLTV: number; // Loan-to-value ratio
  daysElapsed: number;
  paymentHistory: {
    onTime: number;
    late: number;
    missed: number;
  };
  interestPaid: number;
  borrowerReputation?: {
    tier: Tier;
    score: number;
  };
}

/**
 * Health status of a loan based on LTV
 */
export type HealthStatus = 'healthy' | 'at_risk' | 'critical';

/**
 * Loan with health status indicator
 */
export interface LoanWithHealth extends ExtendedLoanRecord {
  healthStatus: HealthStatus;
}

/**
 * Aggregated metrics for all active loans
 */
export interface LoansMetrics {
  totalBorrowed: number;
  totalInterestAccrued: number;
  totalDue: number;
  averageLTV: number;
  averageAPR: number;
  atRiskCount: number; // LTV 80-90%
  criticalCount: number; // LTV > 90%
  poolHealthScore: number; // 0-100, 100 = all healthy
  loanCount: number;
}

/**
 * Metrics aggregated by reputation tier
 */
export interface TierMetrics {
  tier: Tier;
  count: number;
  totalBorrowed: number;
  averageLTV: number;
  averageAPR: number;
  totalInterestAccrued: number;
}

/**
 * Risk analysis data for charts
 */
export interface RiskMetrics {
  ltvDistribution: {
    healthy: number; // LTV < 80%
    atRisk: number; // 80% <= LTV < 90%
    critical: number; // LTV >= 90%
  };
  tierDistribution: {
    tier: Tier;
    count: number;
    totalBorrowed: number;
  }[];
  ltvHistogram: {
    bin: string; // e.g., "0-20%", "20-40%", etc.
    count: number;
  }[];
}

/**
 * Filter state for loans display
 */
export interface LoansFilterState {
  tier: 'all' | Tier;
  health: 'all' | HealthStatus;
  dateRange: 'all' | '7d' | '30d' | '90d';
}

/**
 * Sort option for loans
 */
export type SortOption = 'amount' | 'ltv' | 'interest' | 'date' | 'health';

/**
 * Tab options for the display
 */
export type TabOption = 'all' | 'by_tier' | 'risk';
