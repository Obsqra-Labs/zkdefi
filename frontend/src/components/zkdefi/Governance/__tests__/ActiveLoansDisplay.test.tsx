import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActiveLoansDisplay } from '../ActiveLoansDisplay';
import { LoansTable } from '../LoansTable';
import { LoanDetails } from '../LoanDetails';
import { LoansMetrics } from '../LoansMetrics';
import { RiskAnalysis } from '../RiskAnalysis';
import {
  getHealthStatus,
  calculateMetrics,
  calculateTierMetrics,
  calculateRiskMetrics,
  filterByHealth,
  filterByTier,
  filterByDateRange,
  sortLoans,
  formatCurrency,
  formatPercentage,
  formatDate,
  calculateDaysElapsed,
  truncateAddress,
} from '../utils';
import { LoanWithHealth, HealthStatus } from '../types';

// Mock data
const mockLoan: LoanWithHealth = {
  loanId: '0x123abc456def',
  borrowerAddress: '0xabc123def456ghi789',
  amount: 50000,
  rate: 4,
  tier: 'Tier2',
  status: 'active',
  createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  collateralAmount: 76923,
  interestAccrued: 1200,
  totalDue: 51200,
  currentLTV: 65,
  daysElapsed: 24,
  paymentHistory: {
    onTime: 1,
    late: 0,
    missed: 0,
  },
  interestPaid: 0,
  borrowerReputation: {
    tier: 'Tier2',
    score: 75,
  },
  healthStatus: 'healthy',
};

const mockLoans: LoanWithHealth[] = [
  mockLoan,
  {
    ...mockLoan,
    loanId: '0x456def789ghi',
    amount: 25000,
    currentLTV: 48,
    healthStatus: 'healthy',
  },
  {
    ...mockLoan,
    loanId: '0x789ghi012jkl',
    amount: 100000,
    rate: 3,
    currentLTV: 82,
    healthStatus: 'at_risk',
    tier: 'Tier3',
  },
];

describe('Utils - Health Status', () => {
  it('should return healthy for LTV < 80', () => {
    expect(getHealthStatus(75)).toBe('healthy');
    expect(getHealthStatus(0)).toBe('healthy');
    expect(getHealthStatus(79.9)).toBe('healthy');
  });

  it('should return at_risk for LTV 80-90', () => {
    expect(getHealthStatus(80)).toBe('at_risk');
    expect(getHealthStatus(85)).toBe('at_risk');
    expect(getHealthStatus(89.9)).toBe('at_risk');
  });

  it('should return critical for LTV >= 90', () => {
    expect(getHealthStatus(90)).toBe('critical');
    expect(getHealthStatus(95)).toBe('critical');
    expect(getHealthStatus(100)).toBe('critical');
  });
});

describe('Utils - Metrics Calculation', () => {
  it('should calculate total borrowed correctly', () => {
    const metrics = calculateMetrics(mockLoans);
    expect(metrics.totalBorrowed).toBe(175000);
  });

  it('should calculate average LTV correctly', () => {
    const metrics = calculateMetrics(mockLoans);
    expect(metrics.averageLTV).toBeCloseTo((65 + 48 + 82) / 3, 1);
  });

  it('should count at-risk and critical loans', () => {
    const metrics = calculateMetrics(mockLoans);
    expect(metrics.atRiskCount).toBe(1);
    expect(metrics.criticalCount).toBe(0);
    expect(metrics.loanCount).toBe(3);
  });

  it('should calculate pool health score', () => {
    const metrics = calculateMetrics(mockLoans);
    expect(metrics.poolHealthScore).toBeGreaterThanOrEqual(0);
    expect(metrics.poolHealthScore).toBeLessThanOrEqual(100);
  });

  it('should handle empty loans array', () => {
    const metrics = calculateMetrics([]);
    expect(metrics.totalBorrowed).toBe(0);
    expect(metrics.loanCount).toBe(0);
    expect(metrics.poolHealthScore).toBe(100);
  });
});

describe('Utils - Tier Metrics', () => {
  it('should calculate metrics per tier', () => {
    const tierMetrics = calculateTierMetrics(mockLoans);
    expect(tierMetrics).toHaveLength(3);

    const tier2 = tierMetrics.find((t) => t.tier === 'Tier2');
    expect(tier2?.count).toBe(2);
    expect(tier2?.totalBorrowed).toBe(75000);

    const tier3 = tierMetrics.find((t) => t.tier === 'Tier3');
    expect(tier3?.count).toBe(1);
    expect(tier3?.totalBorrowed).toBe(100000);
  });

  it('should return zero metrics for empty tier', () => {
    const tierMetrics = calculateTierMetrics(mockLoans);
    const tier1 = tierMetrics.find((t) => t.tier === 'Tier1');
    expect(tier1?.count).toBe(0);
    expect(tier1?.totalBorrowed).toBe(0);
  });
});

describe('Utils - Risk Metrics', () => {
  it('should calculate LTV distribution', () => {
    const riskMetrics = calculateRiskMetrics(mockLoans);
    expect(riskMetrics.ltvDistribution.healthy).toBe(2);
    expect(riskMetrics.ltvDistribution.atRisk).toBe(1);
    expect(riskMetrics.ltvDistribution.critical).toBe(0);
  });

  it('should calculate tier distribution', () => {
    const riskMetrics = calculateRiskMetrics(mockLoans);
    expect(riskMetrics.tierDistribution).toHaveLength(3);
  });

  it('should create LTV histogram', () => {
    const riskMetrics = calculateRiskMetrics(mockLoans);
    expect(riskMetrics.ltvHistogram).toHaveLength(6);
    expect(riskMetrics.ltvHistogram[0].bin).toBe('0-20%');
    expect(riskMetrics.ltvHistogram[5].bin).toBe('90%+');
  });
});

describe('Utils - Filtering', () => {
  it('should filter by health status', () => {
    let filtered = filterByHealth(mockLoans, 'healthy');
    expect(filtered).toHaveLength(2);

    filtered = filterByHealth(mockLoans, 'at_risk');
    expect(filtered).toHaveLength(1);

    filtered = filterByHealth(mockLoans, 'all');
    expect(filtered).toHaveLength(3);
  });

  it('should filter by tier', () => {
    let filtered = filterByTier(mockLoans, 'Tier2');
    expect(filtered).toHaveLength(2);

    filtered = filterByTier(mockLoans, 'Tier3');
    expect(filtered).toHaveLength(1);

    filtered = filterByTier(mockLoans, 'all');
    expect(filtered).toHaveLength(3);
  });

  it('should filter by date range', () => {
    const oldLoan = {
      ...mockLoan,
      loanId: '0xold',
      createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const loans = [...mockLoans, oldLoan];
    const filtered = filterByDateRange(loans, '30d');
    expect(filtered).toHaveLength(3); // Only the newer ones
  });
});

describe('Utils - Sorting', () => {
  it('should sort by amount (high to low)', () => {
    const sorted = sortLoans(mockLoans, 'amount');
    expect(sorted[0].amount).toBe(100000);
    expect(sorted[1].amount).toBe(50000);
    expect(sorted[2].amount).toBe(25000);
  });

  it('should sort by LTV (high to low)', () => {
    const sorted = sortLoans(mockLoans, 'ltv');
    expect(sorted[0].currentLTV).toBe(82);
    expect(sorted[sorted.length - 1].currentLTV).toBe(48);
  });

  it('should sort by health (critical first)', () => {
    const sorted = sortLoans(mockLoans, 'health');
    expect(sorted[0].healthStatus).toBe('at_risk');
  });
});

describe('Utils - Formatting', () => {
  it('should format currency correctly', () => {
    expect(formatCurrency(1000)).toBe('$1,000');
    expect(formatCurrency(1000.5)).toContain('$1,000');
    expect(formatCurrency(0)).toBe('$0');
  });

  it('should format percentage correctly', () => {
    expect(formatPercentage(65)).toBe('65.00%');
    expect(formatPercentage(4.567, 1)).toBe('4.6%');
    expect(formatPercentage(50, 0)).toBe('50%');
  });

  it('should format date correctly', () => {
    const date = new Date('2024-03-01T00:00:00Z');
    const formatted = formatDate(date.toISOString());
    expect(formatted).toContain('Mar');
    expect(formatted).toContain('1');
  });

  it('should calculate days elapsed correctly', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const days = calculateDaysElapsed(yesterday);
    expect(days).toBe(1);
  });

  it('should truncate address correctly', () => {
    const address = '0x1234567890abcdef1234567890abcdef';
    expect(truncateAddress(address, 4)).toBe('0x12...cdef');
    expect(truncateAddress(address, 6)).toBe('0x1234...bcdef');
  });
});

describe('Components - LoansMetrics', () => {
  it('should render metrics correctly', () => {
    const metrics = calculateMetrics(mockLoans);
    render(<LoansMetrics metrics={metrics} />);

    expect(screen.getByText('Total Borrowed')).toBeTruthy();
    expect(screen.getByText('Interest Accrued')).toBeTruthy();
    expect(screen.getByText('Average LTV')).toBeTruthy();
    expect(screen.getByText('At-Risk Loans')).toBeTruthy();
    expect(screen.getByText('Pool Health')).toBeTruthy();
  });

  it('should show loading state', () => {
    const metrics = calculateMetrics(mockLoans);
    render(<LoansMetrics metrics={metrics} loading={true} />);
    expect(screen.getByText('Loading metrics...')).toBeTruthy();
  });
});

describe('Components - LoansTable', () => {
  it('should render table headers on desktop', () => {
    render(<LoansTable loans={mockLoans} />);
    expect(screen.getByText('Loan ID')).toBeInTheDocument();
    expect(screen.getByText('Tier')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('should show empty state when no loans', () => {
    render(<LoansTable loans={[]} />);
    expect(screen.getByText('No active loans')).toBeInTheDocument();
  });

  it('should render loan rows', () => {
    render(<LoansTable loans={mockLoans} />);
    expect(screen.getByText('Tier2')).toBeInTheDocument();
    expect(screen.getByText('Tier3')).toBeInTheDocument();
  });

  it('should expand/collapse loan details', async () => {
    const user = userEvent.setup();
    render(<LoansTable loans={mockLoans} />);

    // Click to expand
    const expandButton = screen.getAllByRole('button')[0];
    await user.click(expandButton);

    // Details should be visible
    await waitFor(() => {
      expect(screen.getByText('Loan Details')).toBeInTheDocument();
    });
  });
});

describe('Components - LoanDetails', () => {
  it('should render all loan details', () => {
    render(<LoanDetails loan={mockLoan} />);

    expect(screen.getByText('Loan Details')).toBeInTheDocument();
    expect(screen.getByText('Principal')).toBeInTheDocument();
    expect(screen.getByText('Interest Accrued')).toBeInTheDocument();
    expect(screen.getByText('Collateral & Ratio')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Payment History')).toBeInTheDocument();
    expect(screen.getByText('Borrower Info')).toBeInTheDocument();
  });

  it('should show action buttons', () => {
    render(<LoanDetails loan={mockLoan} />);
    expect(screen.getByText('Repay Loan')).toBeInTheDocument();
    expect(screen.getByText('View Borrower')).toBeInTheDocument();
  });

  it('should call callbacks on button click', async () => {
    const user = userEvent.setup();
    const onRepay = vi.fn();
    const onViewBorrower = vi.fn();

    render(
      <LoanDetails loan={mockLoan} onRepay={onRepay} onViewBorrower={onViewBorrower} />
    );

    await user.click(screen.getByText('Repay Loan'));
    expect(onRepay).toHaveBeenCalled();

    await user.click(screen.getByText('View Borrower'));
    expect(onViewBorrower).toHaveBeenCalled();
  });
});

describe('Components - RiskAnalysis', () => {
  it('should render risk summary cards', () => {
    const riskMetrics = calculateRiskMetrics(mockLoans);
    render(<RiskAnalysis loans={mockLoans} riskMetrics={riskMetrics} />);

    expect(screen.getByText('At-Risk Loans')).toBeInTheDocument();
    expect(screen.getByText('Critical Loans')).toBeInTheDocument();
    expect(screen.getByText('Liquidation Risk Value')).toBeInTheDocument();
  });

  it('should render charts', () => {
    const riskMetrics = calculateRiskMetrics(mockLoans);
    render(<RiskAnalysis loans={mockLoans} riskMetrics={riskMetrics} />);

    expect(screen.getByText('LTV Distribution')).toBeInTheDocument();
    expect(screen.getByText('Tier Distribution')).toBeInTheDocument();
    expect(screen.getByText('LTV Histogram')).toBeInTheDocument();
  });

  it('should show loading state', () => {
    const riskMetrics = calculateRiskMetrics(mockLoans);
    render(<RiskAnalysis loans={mockLoans} riskMetrics={riskMetrics} loading={true} />);
    expect(screen.getByText('Loading risk analysis...')).toBeInTheDocument();
  });
});
