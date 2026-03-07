'use client';

import React from 'react';
import { TrendingUp, AlertTriangle, Zap } from 'lucide-react';
import { LoansMetrics as LoansMetricsType } from './types';
import { formatCurrency, formatPercentage } from './utils';

interface LoansMetricsProps {
  metrics: LoansMetricsType;
  loading?: boolean;
}

/**
 * LoansMetrics Component
 * Displays key metrics at the top of ActiveLoansDisplay:
 * - Total borrowed
 * - Total interest accrued
 * - Average LTV
 * - At-risk count
 * - Pool health score
 */
export function LoansMetrics({ metrics, loading = false }: LoansMetricsProps) {
  if (loading) {
    return <div className="animate-pulse">Loading metrics...</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      {/* Total Borrowed */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-400">Total Borrowed</span>
          <TrendingUp className="w-4 h-4 text-blue-400" />
        </div>
        <div className="text-2xl font-bold text-white">{formatCurrency(metrics.totalBorrowed)}</div>
        <div className="text-xs text-slate-400 mt-1">{metrics.loanCount} active loans</div>
      </div>

      {/* Total Interest Accrued */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-400">Interest Accrued</span>
          <Zap className="w-4 h-4 text-yellow-400" />
        </div>
        <div className="text-2xl font-bold text-white">{formatCurrency(metrics.totalInterestAccrued)}</div>
        <div className="text-xs text-slate-400 mt-1">
          Avg {formatPercentage(metrics.averageAPR)}% APR
        </div>
      </div>

      {/* Average LTV */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-400">Average LTV</span>
          <div className="text-xs font-medium text-slate-300">LTV</div>
        </div>
        <div className="text-2xl font-bold text-white">{formatPercentage(metrics.averageLTV)}</div>
        <div className="text-xs text-slate-400 mt-1">Loan-to-Value Ratio</div>
      </div>

      {/* At-Risk Count */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-400">At-Risk Loans</span>
          <AlertTriangle className="w-4 h-4 text-red-400" />
        </div>
        <div className="text-2xl font-bold text-white">{metrics.atRiskCount + metrics.criticalCount}</div>
        <div className="text-xs text-slate-400 mt-1">
          <span className="text-yellow-400">
            {metrics.atRiskCount}
          </span>
          {' '}warning,{' '}
          <span className="text-red-400">
            {metrics.criticalCount}
          </span>
          {' '}critical
        </div>
      </div>

      {/* Pool Health Score */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-400">Pool Health</span>
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              metrics.poolHealthScore >= 80
                ? 'bg-green-500'
                : metrics.poolHealthScore >= 50
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
            }`}
          />
        </div>
        <div className="text-2xl font-bold text-white">{metrics.poolHealthScore}/100</div>
        <div className="w-full bg-slate-700 rounded-full h-1.5 mt-2 overflow-hidden">
          <div
            className={`h-full transition-all ${
              metrics.poolHealthScore >= 80
                ? 'bg-green-500'
                : metrics.poolHealthScore >= 50
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
            }`}
            style={{ width: `${metrics.poolHealthScore}%` }}
          />
        </div>
      </div>
    </div>
  );
}
