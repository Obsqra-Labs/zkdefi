'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { LoanWithHealth } from './types';
import { formatCurrency, formatPercentage, truncateAddress } from './utils';
import { LoanDetails } from './LoanDetails';

interface LoansTableProps {
  loans: LoanWithHealth[];
  loading?: boolean;
  onLoanClick?: (loan: LoanWithHealth) => void;
}

/**
 * LoansTable Component
 * Main table view for displaying active loans with:
 * - Loan ID (truncated, clickable)
 * - Tier
 * - Amount
 * - Rate (APR)
 * - LTV
 * - Health status
 * - Expandable row for details
 */
export function LoansTable({ loans, loading = false, onLoanClick }: LoansTableProps) {
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<LoanWithHealth | null>(null);

  const handleExpandToggle = (loanId: string) => {
    if (expandedLoanId === loanId) {
      setExpandedLoanId(null);
      setSelectedLoan(null);
    } else {
      setExpandedLoanId(loanId);
      const loan = loans.find((l) => l.loanId === loanId);
      if (loan) {
        setSelectedLoan(loan);
        onLoanClick?.(loan);
      }
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-slate-400">Loading loans...</div>;
  }

  if (loans.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <div className="text-lg font-medium mb-2">No active loans</div>
        <div className="text-sm">All loans for this filter have been repaid or defaulted.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Table Header */}
      <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 bg-slate-900/30 border border-slate-700 rounded-lg">
        <div className="col-span-2 text-xs font-semibold text-slate-300">Loan ID</div>
        <div className="col-span-1 text-xs font-semibold text-slate-300">Tier</div>
        <div className="col-span-2 text-xs font-semibold text-slate-300 text-right">Amount</div>
        <div className="col-span-1 text-xs font-semibold text-slate-300 text-center">APR</div>
        <div className="col-span-1 text-xs font-semibold text-slate-300 text-center">LTV</div>
        <div className="col-span-2 text-xs font-semibold text-slate-300 text-center">Health</div>
        <div className="col-span-2 text-xs font-semibold text-slate-300 text-right">Interest</div>
      </div>

      {/* Table Rows */}
      {loans.map((loan) => (
        <div key={loan.loanId}>
          {/* Desktop Row */}
          <div
            className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-lg hover:bg-slate-900/70 cursor-pointer transition-colors"
            onClick={() => handleExpandToggle(loan.loanId)}
          >
            {/* Loan ID */}
            <div className="col-span-2 flex items-center gap-2">
              {expandedLoanId === loan.loanId ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
              <code className="text-sm font-mono text-blue-400">{truncateAddress(loan.loanId, 6)}</code>
            </div>

            {/* Tier */}
            <div className="col-span-1 flex items-center">
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                  loan.tier === 'Tier1'
                    ? 'bg-blue-500/20 text-blue-300'
                    : loan.tier === 'Tier2'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-orange-500/20 text-orange-300'
                }`}
              >
                {loan.tier}
              </span>
            </div>

            {/* Amount */}
            <div className="col-span-2 text-right">
              <div className="text-sm font-semibold text-white">{formatCurrency(loan.amount)}</div>
            </div>

            {/* Rate (APR) */}
            <div className="col-span-1 text-center">
              <div className="text-sm font-medium text-slate-200">{formatPercentage(loan.rate)}</div>
            </div>

            {/* LTV */}
            <div className="col-span-1 text-center">
              <div className="text-sm font-medium text-slate-200">{formatPercentage(loan.currentLTV)}</div>
            </div>

            {/* Health Status */}
            <div className="col-span-2 text-center">
              <div
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                  loan.healthStatus === 'healthy'
                    ? 'bg-green-500/20 text-green-300'
                    : loan.healthStatus === 'at_risk'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-red-500/20 text-red-300'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    loan.healthStatus === 'healthy'
                      ? 'bg-green-400'
                      : loan.healthStatus === 'at_risk'
                        ? 'bg-yellow-400'
                        : 'bg-red-400'
                  }`}
                />
                {loan.healthStatus === 'healthy'
                  ? 'Healthy'
                  : loan.healthStatus === 'at_risk'
                    ? 'At Risk'
                    : 'Critical'}
              </div>
            </div>

            {/* Interest Accrued */}
            <div className="col-span-2 text-right">
              <div className="text-sm font-semibold text-white">{formatCurrency(loan.interestAccrued)}</div>
            </div>
          </div>

          {/* Mobile Card */}
          <div
            className="md:hidden bg-slate-900/50 border border-slate-700 rounded-lg p-4 space-y-3"
            onClick={() => handleExpandToggle(loan.loanId)}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {expandedLoanId === loan.loanId ? (
                  <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                )}
                <div>
                  <div className="text-xs font-medium text-slate-400">Loan ID</div>
                  <code className="text-sm font-mono text-blue-400">{truncateAddress(loan.loanId, 4)}</code>
                </div>
              </div>
              <div
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                  loan.healthStatus === 'healthy'
                    ? 'bg-green-500/20 text-green-300'
                    : loan.healthStatus === 'at_risk'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-red-500/20 text-red-300'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    loan.healthStatus === 'healthy'
                      ? 'bg-green-400'
                      : loan.healthStatus === 'at_risk'
                        ? 'bg-yellow-400'
                        : 'bg-red-400'
                  }`}
                />
                {loan.healthStatus === 'healthy'
                  ? 'Healthy'
                  : loan.healthStatus === 'at_risk'
                    ? 'At Risk'
                    : 'Critical'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-400">Amount</div>
                <div className="font-semibold text-white">{formatCurrency(loan.amount)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">APR</div>
                <div className="font-semibold text-white">{formatPercentage(loan.rate)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">LTV</div>
                <div className="font-semibold text-white">{formatPercentage(loan.currentLTV)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Tier</div>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    loan.tier === 'Tier1'
                      ? 'bg-blue-500/20 text-blue-300'
                      : loan.tier === 'Tier2'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-orange-500/20 text-orange-300'
                  }`}
                >
                  {loan.tier}
                </span>
              </div>
            </div>

            <div className="text-sm">
              <div className="text-xs text-slate-400">Interest Accrued</div>
              <div className="font-semibold text-white">{formatCurrency(loan.interestAccrued)}</div>
            </div>
          </div>

          {/* Expanded Details */}
          {expandedLoanId === loan.loanId && selectedLoan && (
            <div className="mt-0 border-t border-slate-700 rounded-b-lg bg-slate-900/70 p-4 md:p-6">
              <LoanDetails loan={selectedLoan} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
