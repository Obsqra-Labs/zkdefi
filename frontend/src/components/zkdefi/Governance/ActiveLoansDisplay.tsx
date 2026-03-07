'use client';

import React, { useEffect, useState } from 'react';
import { Filter, ArrowUpDown } from 'lucide-react';
import { VaultLendingGovernanceService } from '@/services/VaultLendingGovernanceService';
import { ReputationGatingService } from '@/services/ReputationGatingService';
import { LoanRecord } from '@/services/VaultLendingGovernanceService';
import {
  ExtendedLoanRecord,
  LoanWithHealth,
  LoansFilterState,
  SortOption,
  TabOption,
  LoansMetrics as LoansMetricsType,
} from './types';
import {
  addHealthStatus,
  calculateMetrics,
  calculateTierMetrics,
  calculateRiskMetrics,
  filterByHealth,
  filterByTier,
  filterByDateRange,
  sortLoans,
  calculateDaysElapsed,
} from './utils';
import { LoansMetrics } from './LoansMetrics';
import { LoansTable } from './LoansTable';
import { RiskAnalysis } from './RiskAnalysis';

interface ActiveLoansDisplayProps {
  poolId: string;
  userAddress?: string;
  showAnalytics?: boolean;
}

/**
 * ActiveLoansDisplay Component
 * Main component for displaying and analyzing active loans in a vault
 * Features:
 * - Tabbed interface (All Loans / By Tier / Risk Analysis)
 * - Filtering by tier, health status, date range
 * - Sorting by various metrics
 * - Real-time metrics calculation
 * - Responsive mobile design
 */
export function ActiveLoansDisplay({
  poolId,
  userAddress,
  showAnalytics = true,
}: ActiveLoansDisplayProps) {
  // State
  const [loans, setLoans] = useState<LoanWithHealth[]>([]);
  const [filteredLoans, setFilteredLoans] = useState<LoanWithHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filters, setFilters] = useState<LoansFilterState>({
    tier: 'all',
    health: 'all',
    dateRange: 'all',
  });

  // Sorting and tabs
  const [sortBy, setSortBy] = useState<SortOption>('health');
  const [activeTab, setActiveTab] = useState<TabOption>('all');

  // Metrics
  const [metrics, setMetrics] = useState<LoansMetricsType | null>(null);
  const [tierMetrics, setTierMetrics] = useState<any[]>([]);
  const [riskMetrics, setRiskMetrics] = useState<any>(null);

  // Services
  const govService = new VaultLendingGovernanceService();
  const reputationService = new ReputationGatingService();

  /**
   * Fetch active loans from the service
   */
  useEffect(() => {
    const fetchLoans = async () => {
      setLoading(true);
      setError(null);
      try {
        const loanRecords = await govService.getActiveLoans(poolId);

        // Enrich loan records with additional data
        const enrichedLoans: ExtendedLoanRecord[] = loanRecords.map((loan: LoanRecord) => {
          const daysElapsed = calculateDaysElapsed(loan.createdAt);
          return {
            loanId: loan.loanId,
            borrowerAddress: 'N/A', // Would be fetched from backend
            amount: loan.amount,
            rate: loan.rate,
            tier: loan.tier,
            status: loan.status,
            createdAt: loan.createdAt,
            collateralAmount: loan.amount / 0.65, // Estimate from LTV
            interestAccrued: (loan.amount * loan.rate * (daysElapsed / 365)) / 100,
            totalDue: loan.amount + (loan.amount * loan.rate * (daysElapsed / 365)) / 100,
            currentLTV: 65, // Placeholder - would come from backend
            daysElapsed,
            paymentHistory: {
              onTime: 1,
              late: 0,
              missed: 0,
            },
            interestPaid: 0,
            borrowerReputation: {
              tier: loan.tier,
              score: 75,
            },
          };
        });

        // Add health status
        const loansWithHealth = enrichedLoans.map(addHealthStatus);
        setLoans(loansWithHealth);

        // Calculate metrics
        setMetrics(calculateMetrics(loansWithHealth));
        setTierMetrics(calculateTierMetrics(loansWithHealth));
        setRiskMetrics(calculateRiskMetrics(loansWithHealth));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch loans');
      } finally {
        setLoading(false);
      }
    };

    fetchLoans();
  }, [poolId]);

  /**
   * Apply filters and sorting
   */
  useEffect(() => {
    let result = [...loans];

    // Apply filters
    result = filterByTier(result, filters.tier);
    result = filterByHealth(result, filters.health);
    result = filterByDateRange(result, filters.dateRange);

    // Apply sorting
    result = sortLoans(result, sortBy);

    // Filter by user if specified
    if (userAddress) {
      result = result.filter((l) => l.borrowerAddress === userAddress);
    }

    setFilteredLoans(result);
  }, [loans, filters, sortBy, userAddress]);

  /**
   * Handle filter changes
   */
  const handleFilterChange = (key: keyof LoansFilterState, value: any) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  /**
   * Handle sort change
   */
  const handleSortChange = (option: SortOption) => {
    setSortBy(option);
  };

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-200">
        <div className="font-semibold">Error loading loans</div>
        <div className="text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Metrics */}
      {metrics && <LoansMetrics metrics={metrics} loading={loading} />}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-700 overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-3 font-medium text-sm whitespace-nowrap transition-colors ${
            activeTab === 'all'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          All Active Loans
        </button>
        <button
          onClick={() => setActiveTab('by_tier')}
          className={`px-4 py-3 font-medium text-sm whitespace-nowrap transition-colors ${
            activeTab === 'by_tier'
              ? 'border-b-2 border-blue-500 text-blue-400'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          By Tier
        </button>
        {showAnalytics && (
          <button
            onClick={() => setActiveTab('risk')}
            className={`px-4 py-3 font-medium text-sm whitespace-nowrap transition-colors ${
              activeTab === 'risk'
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Risk Analysis
          </button>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === 'all' && (
        <div className="space-y-4">
          {/* Filter and Sort Controls */}
          <div className="flex flex-col md:flex-row gap-3">
            {/* Tier Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={filters.tier}
                onChange={(e) => handleFilterChange('tier', e.target.value)}
                className="px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white hover:border-slate-500 transition-colors"
              >
                <option value="all">All Tiers</option>
                <option value="Tier1">Tier1</option>
                <option value="Tier2">Tier2</option>
                <option value="Tier3">Tier3</option>
              </select>
            </div>

            {/* Health Filter */}
            <select
              value={filters.health}
              onChange={(e) => handleFilterChange('health', e.target.value)}
              className="px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white hover:border-slate-500 transition-colors"
            >
              <option value="all">All Health</option>
              <option value="healthy">Healthy</option>
              <option value="at_risk">At Risk</option>
              <option value="critical">Critical</option>
            </select>

            {/* Date Range Filter */}
            <select
              value={filters.dateRange}
              onChange={(e) => handleFilterChange('dateRange', e.target.value)}
              className="px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white hover:border-slate-500 transition-colors"
            >
              <option value="all">All Time</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2 ml-auto">
              <ArrowUpDown className="w-4 h-4 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => handleSortChange(e.target.value as SortOption)}
                className="px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm text-white hover:border-slate-500 transition-colors"
              >
                <option value="health">Sort by Health</option>
                <option value="ltv">Sort by LTV (High)</option>
                <option value="amount">Sort by Amount (High)</option>
                <option value="interest">Sort by Interest (High)</option>
                <option value="date">Sort by Date (Newest)</option>
              </select>
            </div>
          </div>

          {/* Loans Table */}
          <LoansTable loans={filteredLoans} loading={loading} />
        </div>
      )}

      {activeTab === 'by_tier' && (
        <div className="space-y-6">
          {/* Tier Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {tierMetrics.map((tier) => (
              <div key={tier.tier} className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <div className="text-sm font-semibold text-slate-300 mb-3">{tier.tier}</div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-slate-400">Loans</span>
                    <span className="font-medium text-white">{tier.count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-slate-400">Total Borrowed</span>
                    <span className="font-medium text-white">{`$${(tier.totalBorrowed / 1000).toFixed(1)}k`}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-slate-400">Avg LTV</span>
                    <span className="font-medium text-white">{tier.averageLTV.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-slate-400">Avg APR</span>
                    <span className="font-medium text-white">{tier.averageAPR.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-slate-400">Interest Accrued</span>
                    <span className="font-medium text-white">{`$${(tier.totalInterestAccrued / 1000).toFixed(1)}k`}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Loans by Tier */}
          {tierMetrics.map((tier) => {
            const tierLoans = loans.filter((l) => l.tier === tier.tier);
            return (
              <div key={tier.tier}>
                <h3 className="text-lg font-semibold text-white mb-3">{tier.tier} Loans</h3>
                <LoansTable loans={tierLoans} loading={loading} />
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'risk' && riskMetrics && (
        <RiskAnalysis loans={filteredLoans} riskMetrics={riskMetrics} loading={loading} />
      )}
    </div>
  );
}
