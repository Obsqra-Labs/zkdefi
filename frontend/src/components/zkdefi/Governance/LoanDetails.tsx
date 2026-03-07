'use client';

import React from 'react';
import { DollarSign, Clock, TrendingUp, User, FileText } from 'lucide-react';
import { LoanWithHealth } from './types';
import { formatCurrency, formatPercentage, formatDate, truncateAddress } from './utils';

interface LoanDetailsProps {
  loan: LoanWithHealth;
  onRepay?: () => void;
  onViewBorrower?: () => void;
}

/**
 * LoanDetails Component
 * Expandable row showing comprehensive loan information:
 * - Principal and interest details
 * - Collateral information
 * - Current LTV and health
 * - Borrower reputation
 * - Payment history
 * - Action buttons (Repay, View Borrower)
 */
export function LoanDetails({ loan, onRepay, onViewBorrower }: LoanDetailsProps) {
  return (
    <div className="space-y-6">
      {/* Loan Header Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Principal and Interest */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-blue-400" />
            Loan Details
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Principal</span>
              <span className="font-medium text-white">{formatCurrency(loan.amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Interest Accrued</span>
              <span className="font-medium text-white">{formatCurrency(loan.interestAccrued)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Total Due</span>
              <span className="font-medium text-white">{formatCurrency(loan.totalDue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Interest Already Paid</span>
              <span className="font-medium text-white">{formatCurrency(loan.interestPaid)}</span>
            </div>
          </div>
        </div>

        {/* Collateral and LTV */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Collateral & Ratio
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Collateral (Deposit)</span>
              <span className="font-medium text-white">{formatCurrency(loan.collateralAmount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Current LTV</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{formatPercentage(loan.currentLTV)}</span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    loan.healthStatus === 'healthy'
                      ? 'bg-green-500/20 text-green-300'
                      : loan.healthStatus === 'at_risk'
                        ? 'bg-yellow-500/20 text-yellow-300'
                        : 'bg-red-500/20 text-red-300'
                  }`}
                >
                  {loan.healthStatus === 'healthy'
                    ? 'Healthy'
                    : loan.healthStatus === 'at_risk'
                      ? 'At Risk'
                      : 'Critical'}
                </span>
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Interest Rate</span>
              <span className="font-medium text-white">{formatPercentage(loan.rate)} APR</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Tier</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
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
        </div>

        {/* Timeline and Dates */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-400" />
            Timeline
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Originated</span>
              <span className="font-medium text-white">{formatDate(loan.createdAt)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Days Elapsed</span>
              <span className="font-medium text-white">{loan.daysElapsed} days</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Maturity</span>
              <span className="font-medium text-white">
                {loan.maturityDate ? formatDate(loan.maturityDate) : 'Open-ended'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Status</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  loan.status === 'active'
                    ? 'bg-green-500/20 text-green-300'
                    : loan.status === 'repaid'
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'bg-red-500/20 text-red-300'
                }`}
              >
                {loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Payment History and Borrower Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Payment History */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-400" />
            Payment History
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">On Time</span>
              <span className="font-medium text-green-400">{loan.paymentHistory.onTime}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Late</span>
              <span className="font-medium text-yellow-400">{loan.paymentHistory.late}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Missed</span>
              <span className="font-medium text-red-400">{loan.paymentHistory.missed}</span>
            </div>
            <div className="border-t border-slate-700 pt-2 flex justify-between text-sm">
              <span className="text-slate-400">Payment Rate</span>
              <span className="font-medium text-white">
                {loan.paymentHistory.onTime}/{loan.paymentHistory.onTime + loan.paymentHistory.late + loan.paymentHistory.missed}
              </span>
            </div>
          </div>
        </div>

        {/* Borrower Reputation */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <User className="w-4 h-4 text-orange-400" />
            Borrower Info
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Address</span>
              <code className="font-mono text-blue-400 text-xs">{truncateAddress(loan.borrowerAddress, 5)}</code>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Reputation Tier</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  loan.borrowerReputation?.tier === 'Tier1'
                    ? 'bg-blue-500/20 text-blue-300'
                    : loan.borrowerReputation?.tier === 'Tier2'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-orange-500/20 text-orange-300'
                }`}
              >
                {loan.borrowerReputation?.tier || loan.tier}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Reputation Score</span>
              <span className="font-medium text-white">{loan.borrowerReputation?.score || 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-700">
        <button
          onClick={onRepay}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Repay Loan
        </button>
        <button
          onClick={onViewBorrower}
          className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
        >
          View Borrower
        </button>
      </div>
    </div>
  );
}
