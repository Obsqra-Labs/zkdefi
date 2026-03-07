'use client';

import React from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { AlertTriangle, TrendingDown } from 'lucide-react';
import { RiskMetrics as RiskMetricsType, LoanWithHealth } from './types';
import { formatCurrency } from './utils';

interface RiskAnalysisProps {
  loans: LoanWithHealth[];
  riskMetrics: RiskMetricsType;
  loading?: boolean;
}

const COLORS = {
  healthy: '#10b981',
  atRisk: '#eab308',
  critical: '#ef4444',
};

/**
 * RiskAnalysis Component
 * Displays risk visualization with:
 * - LTV distribution pie chart (healthy/at-risk/critical)
 * - Tier distribution pie chart
 * - LTV histogram (distribution across bins)
 * - Liquidation risk metrics
 */
export function RiskAnalysis({ loans, riskMetrics, loading = false }: RiskAnalysisProps) {
  if (loading) {
    return <div className="text-center py-8 text-slate-400">Loading risk analysis...</div>;
  }

  // Prepare data for LTV distribution pie chart
  const ltvDistributionData = [
    {
      name: 'Healthy (< 80%)',
      value: riskMetrics.ltvDistribution.healthy,
      color: COLORS.healthy,
    },
    {
      name: 'At Risk (80-90%)',
      value: riskMetrics.ltvDistribution.atRisk,
      color: COLORS.atRisk,
    },
    {
      name: 'Critical (≥ 90%)',
      value: riskMetrics.ltvDistribution.critical,
      color: COLORS.critical,
    },
  ];

  // Prepare data for tier distribution pie chart
  const tierDistributionData = riskMetrics.tierDistribution.map((tier) => ({
    name: tier.tier,
    value: tier.count,
    borrowed: tier.totalBorrowed,
  }));

  const tierColors = {
    Tier1: '#60a5fa',
    Tier2: '#34d399',
    Tier3: '#fb923c',
  };

  // Calculate liquidation risk metrics
  const estimatedLiquidationValue = loans
    .filter((l) => l.currentLTV > 80)
    .reduce((sum, l) => sum + l.collateralAmount * 0.9, 0); // Assume 90% recovery

  return (
    <div className="space-y-8">
      {/* Risk Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Loans at Risk */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h3 className="text-sm font-semibold text-slate-300">At-Risk Loans</h3>
          </div>
          <div className="text-3xl font-bold text-white">{riskMetrics.ltvDistribution.atRisk}</div>
          <div className="text-xs text-slate-400 mt-2">
            LTV between 80% and 90% - monitor closely
          </div>
        </div>

        {/* Critical Loans */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h3 className="text-sm font-semibold text-slate-300">Critical Loans</h3>
          </div>
          <div className="text-3xl font-bold text-white">{riskMetrics.ltvDistribution.critical}</div>
          <div className="text-xs text-slate-400 mt-2">LTV ≥ 90% - high liquidation risk</div>
        </div>

        {/* Estimated Liquidation Value */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-5 h-5 text-red-400" />
            <h3 className="text-sm font-semibold text-slate-300">Liquidation Risk Value</h3>
          </div>
          <div className="text-3xl font-bold text-white">{formatCurrency(estimatedLiquidationValue)}</div>
          <div className="text-xs text-slate-400 mt-2">Estimated recovery at 90% collateral</div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LTV Distribution Pie Chart */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">LTV Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={ltvDistributionData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                label={({ name, value }) => `${name} (${value})`}
              >
                {ltvDistributionData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value} loan(s)`} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Tier Distribution Pie Chart */}
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Tier Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={tierDistributionData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                label={({ name, value }) => `${name} (${value})`}
              >
                {tierDistributionData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={tierColors[entry.name as keyof typeof tierColors]}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value} loan(s)`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LTV Histogram */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">LTV Histogram</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={riskMetrics.ltvHistogram}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
            <XAxis dataKey="bin" stroke="rgba(148, 163, 184, 0.5)" />
            <YAxis stroke="rgba(148, 163, 184, 0.5)" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '6px',
              }}
              formatter={(value) => [`${value} loan(s)`, 'Count']}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Risk Metrics Details */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Risk Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LTV Distribution */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase">LTV Risk Tiers</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-sm text-slate-300">Healthy (LTV &lt; 80%)</span>
                </div>
                <span className="font-semibold text-white">{riskMetrics.ltvDistribution.healthy}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="text-sm text-slate-300">At Risk (80-90%)</span>
                </div>
                <span className="font-semibold text-white">{riskMetrics.ltvDistribution.atRisk}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="text-sm text-slate-300">Critical (LTV ≥ 90%)</span>
                </div>
                <span className="font-semibold text-white">{riskMetrics.ltvDistribution.critical}</span>
              </div>
            </div>
          </div>

          {/* Tier Distribution */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase">Loans by Tier</h4>
            <div className="space-y-2">
              {riskMetrics.tierDistribution.map((tier) => (
                <div key={tier.tier} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor:
                          tier.tier === 'Tier1'
                            ? '#60a5fa'
                            : tier.tier === 'Tier2'
                              ? '#34d399'
                              : '#fb923c',
                      }}
                    />
                    <span className="text-sm text-slate-300">{tier.tier}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-white">{tier.count} loans</div>
                    <div className="text-xs text-slate-400">{formatCurrency(tier.totalBorrowed)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
