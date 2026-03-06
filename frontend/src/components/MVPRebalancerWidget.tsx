'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle, TrendingUp, Zap, CheckCircle } from 'lucide-react';

interface RebalancerConfig {
  apy_threshold: number;
  fee_tier_spread_bps: number;
  utilization_ratio_threshold: number;
  min_rebalance_interval_hours: number;
}

interface RebalanceCheck {
  position_id: string;
  should_rebalance: boolean;
  reason: string;
  details: {
    apy_improvement: number;
    fee_spread: number;
    pool_utilization: number;
    hours_since_rebalance: number;
  };
}

export function MVPRebalancerWidget() {
  const [config, setConfig] = useState<RebalancerConfig | null>(null);
  const [lastCheck, setLastCheck] = useState<RebalanceCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/v1/phase4a/rebalancer-config');
        if (!response.ok) throw new Error('Failed to fetch config');
        const data = await response.json();
        setConfig(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading config');
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  if (loading) {
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
        <div className="text-zinc-400 text-sm">Loading rebalancer config...</div>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error || 'Failed to load rebalancer configuration'}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center gap-2 text-emerald-400">
        <Zap className="w-5 h-5" />
        <h3 className="font-semibold text-white">Autonomous Rebalancer</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-zinc-900 rounded p-3 border border-zinc-700">
          <div className="text-zinc-400 text-xs mb-1">APY Threshold</div>
          <div className="text-emerald-400 font-mono">{config.apy_threshold.toFixed(1)}%</div>
          <div className="text-zinc-500 text-xs mt-1">improvement needed</div>
        </div>

        <div className="bg-zinc-900 rounded p-3 border border-zinc-700">
          <div className="text-zinc-400 text-xs mb-1">Fee Spread</div>
          <div className="text-emerald-400 font-mono">{config.fee_tier_spread_bps} bps</div>
          <div className="text-zinc-500 text-xs mt-1">max difference</div>
        </div>

        <div className="bg-zinc-900 rounded p-3 border border-zinc-700">
          <div className="text-zinc-400 text-xs mb-1">Utilization</div>
          <div className="text-emerald-400 font-mono">{(config.utilization_ratio_threshold * 100).toFixed(0)}%</div>
          <div className="text-zinc-500 text-xs mt-1">pool threshold</div>
        </div>

        <div className="bg-zinc-900 rounded p-3 border border-zinc-700">
          <div className="text-zinc-400 text-xs mb-1">Min Interval</div>
          <div className="text-emerald-400 font-mono">{config.min_rebalance_interval_hours}h</div>
          <div className="text-zinc-500 text-xs mt-1">between rebalances</div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-emerald-700 rounded p-3">
        <div className="flex items-center gap-2 text-emerald-400 text-sm mb-2">
          <CheckCircle className="w-4 h-4" />
          <span className="font-medium">Monitoring Active</span>
        </div>
        <p className="text-zinc-400 text-xs">
          Rebalancer monitors positions and automatically triggers when constraints are met. All metrics are evaluated against your configured thresholds.
        </p>
      </div>
    </div>
  );
}
