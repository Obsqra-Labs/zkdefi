/**
 * Utility functions for loan calculations and metrics
 */

import { ExtendedLoanRecord, HealthStatus, LoanWithHealth, LoansMetrics, RiskMetrics, TierMetrics } from './types';
import { Tier } from '@/services/ReputationGatingService';

/**
 * Determine health status based on LTV
 * - Healthy: LTV < 80%
 * - At Risk: 80% <= LTV < 90%
 * - Critical: LTV >= 90%
 */
export function getHealthStatus(ltv: number): HealthStatus {
  if (ltv >= 90) return 'critical';
  if (ltv >= 80) return 'at_risk';
  return 'healthy';
}

/**
 * Add health status to loan record
 */
export function addHealthStatus(loan: ExtendedLoanRecord): LoanWithHealth {
  return {
    ...loan,
    healthStatus: getHealthStatus(loan.currentLTV),
  };
}

/**
 * Calculate aggregate metrics from loans
 */
export function calculateMetrics(loans: LoanWithHealth[]): LoansMetrics {
  if (loans.length === 0) {
    return {
      totalBorrowed: 0,
      totalInterestAccrued: 0,
      totalDue: 0,
      averageLTV: 0,
      averageAPR: 0,
      atRiskCount: 0,
      criticalCount: 0,
      poolHealthScore: 100,
      loanCount: 0,
    };
  }

  const totalBorrowed = loans.reduce((sum, loan) => sum + loan.amount, 0);
  const totalInterestAccrued = loans.reduce((sum, loan) => sum + loan.interestAccrued, 0);
  const totalDue = loans.reduce((sum, loan) => sum + loan.totalDue, 0);
  const averageLTV = loans.reduce((sum, loan) => sum + loan.currentLTV, 0) / loans.length;
  const averageAPR = loans.reduce((sum, loan) => sum + loan.rate, 0) / loans.length;

  const atRiskCount = loans.filter((l) => l.healthStatus === 'at_risk').length;
  const criticalCount = loans.filter((l) => l.healthStatus === 'critical').length;
  const healthyCount = loans.filter((l) => l.healthStatus === 'healthy').length;

  // Pool health score: 0-100 (100 = all healthy)
  // Formula: (healthy_count / total) * 100, adjusted for at-risk and critical
  const healthScore = Math.round(
    (healthyCount / loans.length) * 100 - (atRiskCount / loans.length) * 20 - (criticalCount / loans.length) * 50
  );

  return {
    totalBorrowed,
    totalInterestAccrued,
    totalDue,
    averageLTV,
    averageAPR,
    atRiskCount,
    criticalCount,
    poolHealthScore: Math.max(0, Math.min(100, healthScore)),
    loanCount: loans.length,
  };
}

/**
 * Calculate metrics by tier
 */
export function calculateTierMetrics(loans: LoanWithHealth[]): TierMetrics[] {
  const tiers: Tier[] = ['Tier1', 'Tier2', 'Tier3'];
  return tiers.map((tier) => {
    const tierLoans = loans.filter((l) => l.tier === tier);
    if (tierLoans.length === 0) {
      return {
        tier,
        count: 0,
        totalBorrowed: 0,
        averageLTV: 0,
        averageAPR: 0,
        totalInterestAccrued: 0,
      };
    }

    return {
      tier,
      count: tierLoans.length,
      totalBorrowed: tierLoans.reduce((sum, l) => sum + l.amount, 0),
      averageLTV: tierLoans.reduce((sum, l) => sum + l.currentLTV, 0) / tierLoans.length,
      averageAPR: tierLoans.reduce((sum, l) => sum + l.rate, 0) / tierLoans.length,
      totalInterestAccrued: tierLoans.reduce((sum, l) => sum + l.interestAccrued, 0),
    };
  });
}

/**
 * Calculate risk metrics including LTV distribution
 */
export function calculateRiskMetrics(loans: LoanWithHealth[]): RiskMetrics {
  const ltvDistribution = {
    healthy: loans.filter((l) => l.currentLTV < 80).length,
    atRisk: loans.filter((l) => l.currentLTV >= 80 && l.currentLTV < 90).length,
    critical: loans.filter((l) => l.currentLTV >= 90).length,
  };

  const tierCounts: Record<Tier, { count: number; borrowed: number }> = {
    Tier1: { count: 0, borrowed: 0 },
    Tier2: { count: 0, borrowed: 0 },
    Tier3: { count: 0, borrowed: 0 },
  };

  loans.forEach((loan) => {
    tierCounts[loan.tier].count++;
    tierCounts[loan.tier].borrowed += loan.amount;
  });

  const tierDistribution = Object.entries(tierCounts).map(([tier, data]) => ({
    tier: tier as Tier,
    count: data.count,
    totalBorrowed: data.borrowed,
  }));

  // Create LTV histogram (5% bins)
  const ltvBins = ['0-20%', '20-40%', '40-60%', '60-80%', '80-90%', '90%+'];
  const ltvHistogram = ltvBins.map((bin) => {
    const [min, max] = bin === '90%+' ? [90, 100] : bin.split('-').map((b) => parseInt(b));
    const count = loans.filter((l) => l.currentLTV >= min && l.currentLTV < max).length;
    return { bin, count };
  });

  return {
    ltvDistribution,
    tierDistribution,
    ltvHistogram,
  };
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format percentage for display
 */
export function formatPercentage(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format date for display
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Calculate days elapsed since loan creation
 */
export function calculateDaysElapsed(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Filter loans by health status
 */
export function filterByHealth(loans: LoanWithHealth[], health: 'all' | HealthStatus): LoanWithHealth[] {
  if (health === 'all') return loans;
  return loans.filter((l) => l.healthStatus === health);
}

/**
 * Filter loans by tier
 */
export function filterByTier(loans: LoanWithHealth[], tier: 'all' | Tier): LoanWithHealth[] {
  if (tier === 'all') return loans;
  return loans.filter((l) => l.tier === tier);
}

/**
 * Filter loans by date range
 */
export function filterByDateRange(
  loans: LoanWithHealth[],
  dateRange: 'all' | '7d' | '30d' | '90d'
): LoanWithHealth[] {
  if (dateRange === 'all') return loans;

  const daysMap = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
  };

  const days = daysMap[dateRange];
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return loans.filter((l) => new Date(l.createdAt) >= cutoffDate);
}

/**
 * Sort loans by option
 */
export function sortLoans(
  loans: LoanWithHealth[],
  sortBy: 'amount' | 'ltv' | 'interest' | 'date' | 'health'
): LoanWithHealth[] {
  const sorted = [...loans];

  switch (sortBy) {
    case 'amount':
      return sorted.sort((a, b) => b.amount - a.amount);
    case 'ltv':
      return sorted.sort((a, b) => b.currentLTV - a.currentLTV);
    case 'interest':
      return sorted.sort((a, b) => b.interestAccrued - a.interestAccrued);
    case 'date':
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case 'health':
      // Sort by health status: critical -> at_risk -> healthy
      const healthOrder = { critical: 0, at_risk: 1, healthy: 2 };
      return sorted.sort((a, b) => healthOrder[a.healthStatus] - healthOrder[b.healthStatus]);
    default:
      return sorted;
  }
}

/**
 * Truncate address for display
 */
export function truncateAddress(address: string, chars = 6): string {
  return `${address.substring(0, chars)}...${address.substring(address.length - chars)}`;
}
