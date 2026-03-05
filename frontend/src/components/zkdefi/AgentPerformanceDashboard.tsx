"use client";

/**
 * AgentPerformanceDashboard — Performance timeline + stats for an identity-bound agent.
 *
 * Shows cumulative returns, win rate, drawdown, proof count, and period-by-period history.
 * Includes reputation witness generation for on-chain attestation.
 */

import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Shield,
  BarChart3,
  Award,
  Target,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertTriangle,
  Zap,
} from "lucide-react";

import { API_BASE } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PeriodPerformance {
  period: number;
  return_bps: number;
  volume: number;
  actions: number;
  proof_count: number;
  drawdown_bps: number;
  balance: number;
}

interface PerformanceSummary {
  agent_id: string;
  total_periods: number;
  cumulative_return_bps: number;
  win_rate: number;
  total_volume: number;
  total_proofs: number;
  peak_balance: number;
  worst_drawdown_bps: number;
  avg_return_bps: number;
  periods: PeriodPerformance[];
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePerformanceSummary(agentId: string, payload: unknown): PerformanceSummary {
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const summary = row.summary && typeof row.summary === "object" ? (row.summary as Record<string, unknown>) : {};
  const periodsRaw = Array.isArray(row.periods) ? row.periods : [];

  // Build synthetic balances if backend omits per-period balance.
  let runningBalance = toNumber(summary.current_balance, 10_000);
  const periods: PeriodPerformance[] = periodsRaw.map((entry, index) => {
    const p = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const returnBps = toNumber(p.return_bps, 0);
    runningBalance = Math.max(0, runningBalance * (1 + returnBps / 10_000));
    return {
      period: toNumber(p.period ?? p.period_id ?? index + 1, index + 1),
      return_bps: returnBps,
      volume: toNumber(p.volume, 0),
      actions: toNumber(p.actions ?? (toNumber(p.successful_actions, 0) + toNumber(p.failed_actions, 0)), 0),
      proof_count: toNumber(p.proof_count, 0),
      drawdown_bps: toNumber(p.drawdown_bps ?? p.max_drawdown_bps, 0),
      balance: toNumber(p.balance, runningBalance),
    };
  });

  return {
    agent_id: String(row.agent_id ?? agentId),
    total_periods: toNumber(row.total_periods ?? summary.total_periods, periods.length),
    cumulative_return_bps: toNumber(row.cumulative_return_bps ?? summary.cumulative_return_bps, 0),
    win_rate: toNumber(row.win_rate ?? summary.win_rate, 0),
    total_volume: toNumber(row.total_volume ?? summary.total_volume, 0),
    total_proofs: toNumber(row.total_proofs ?? summary.total_proofs, 0),
    peak_balance: toNumber(row.peak_balance ?? summary.peak_balance, Math.max(...periods.map((p) => p.balance), 0)),
    worst_drawdown_bps: toNumber(row.worst_drawdown_bps ?? summary.worst_drawdown_bps ?? summary.max_drawdown_bps, 0),
    avg_return_bps: toNumber(row.avg_return_bps ?? summary.avg_return_bps ?? summary.mean_return_bps, 0),
    periods,
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

function formatUsd(val: number): string {
  if (val >= 1_000_000) return "$" + (val / 1_000_000).toFixed(2) + "M";
  if (val >= 1_000) return "$" + (val / 1_000).toFixed(1) + "K";
  return "$" + val.toFixed(2);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentPerformanceDashboard({ agentId }: { agentId: string | null }) {
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPerformance = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/zkdefi/agent-builder/agents/${agentId}/performance`
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setData(normalizePerformanceSummary(agentId, json));
    } catch (e: any) {
      setError(e.message || "Failed to load performance");
      // Demo fallback
      setData({
        agent_id: agentId,
        total_periods: 6,
        cumulative_return_bps: 342,
        win_rate: 0.667,
        total_volume: 125_000,
        total_proofs: 18,
        peak_balance: 11_200,
        worst_drawdown_bps: 180,
        avg_return_bps: 57,
        periods: [
          { period: 1, return_bps: 85, volume: 20000, actions: 4, proof_count: 3, drawdown_bps: 50, balance: 10_085 },
          { period: 2, return_bps: -30, volume: 18000, actions: 3, proof_count: 2, drawdown_bps: 80, balance: 9_755 },
          { period: 3, return_bps: 120, volume: 25000, actions: 5, proof_count: 4, drawdown_bps: 0, balance: 10_926 },
          { period: 4, return_bps: 45, volume: 22000, actions: 4, proof_count: 3, drawdown_bps: 0, balance: 11_200 },
          { period: 5, return_bps: -100, volume: 15000, actions: 2, proof_count: 2, drawdown_bps: 180, balance: 10_080 },
          { period: 6, return_bps: 222, volume: 25000, actions: 6, proof_count: 4, drawdown_bps: 0, balance: 10_342 },
        ],
      });
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchPerformance();
  }, [fetchPerformance]);

  if (!agentId) {
    return (
      <div className="p-4 rounded-lg border border-white/5 bg-white/[0.02] text-center text-white/30 text-sm">
        Select an agent to view performance
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center p-8 text-white/30">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading performance…
      </div>
    );
  }

  if (!data) return null;

  const maxBalance = Math.max(...data.periods.map((p) => p.balance), 1);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[#00FFD1]" />
          <h3 className="text-sm font-semibold text-white">Performance</h3>
        </div>
        <button onClick={fetchPerformance} className="text-white/30 hover:text-white/60">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <div className="text-[10px] text-amber-400/60 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> Demo data — API unavailable
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="Cumulative Return"
          value={bpsToPercent(data.cumulative_return_bps)}
          icon={data.cumulative_return_bps >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
          color={data.cumulative_return_bps >= 0 ? "emerald" : "red"}
        />
        <StatCard
          label="Win Rate"
          value={(data.win_rate * 100).toFixed(1) + "%"}
          icon={<Target className="w-4 h-4 text-blue-400" />}
          color="blue"
        />
        <StatCard
          label="Total Volume"
          value={formatUsd(data.total_volume)}
          icon={<Activity className="w-4 h-4 text-purple-400" />}
          color="purple"
        />
        <StatCard
          label="Max Drawdown"
          value={bpsToPercent(data.worst_drawdown_bps)}
          icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
          color="amber"
        />
        <StatCard
          label="ZK Proofs"
          value={String(data.total_proofs)}
          icon={<Shield className="w-4 h-4 text-[#00FFD1]" />}
          color="teal"
        />
        <StatCard
          label="Avg Period Return"
          value={bpsToPercent(data.avg_return_bps)}
          icon={<Zap className="w-4 h-4 text-amber-400" />}
          color="amber"
        />
      </div>

      {/* Balance chart (mini bar chart) */}
      <div className="p-3 rounded-lg border border-white/5 bg-white/[0.02]">
        <div className="text-xs text-white/40 mb-2">Balance by Period</div>
        <div className="flex items-end gap-1 h-16">
          {data.periods.map((p) => {
            const h = Math.max(4, (p.balance / maxBalance) * 100);
            const positive = p.return_bps >= 0;
            return (
              <div
                key={p.period}
                className="flex-1 group relative"
                title={`Period ${p.period}: ${bpsToPercent(p.return_bps)} ${formatUsd(p.balance)}`}
              >
                <div
                  className={`w-full rounded-t transition-all ${
                    positive ? "bg-emerald-500/40" : "bg-red-500/40"
                  } group-hover:opacity-80`}
                  style={{ height: `${h}%` }}
                />
                <div className="text-[8px] text-white/20 text-center mt-0.5">{p.period}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Period history */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 rounded-lg border border-white/5 bg-white/[0.02] text-white/40 text-xs hover:text-white/60"
      >
        <span>{data.total_periods} periods recorded</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {data.periods
            .slice()
            .reverse()
            .map((p) => (
              <div
                key={p.period}
                className="flex items-center justify-between px-3 py-1.5 rounded text-xs border border-white/[0.03] bg-white/[0.01]"
              >
                <span className="text-white/40">Period {p.period}</span>
                <span
                  className={`font-mono ${
                    p.return_bps >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {p.return_bps >= 0 ? "+" : ""}
                  {bpsToPercent(p.return_bps)}
                </span>
                <span className="text-white/30">{formatUsd(p.volume)}</span>
                <span className="text-white/20 flex items-center gap-0.5">
                  <Shield className="w-2.5 h-2.5" /> {p.proof_count}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Reputation witness button */}
      <div className="flex gap-2">
        <WitnessButton agentId={agentId} type="reputation" />
        <WitnessButton agentId={agentId} type="performance" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="p-2.5 rounded-lg border border-white/5 bg-white/[0.02]">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-white/40">{label}</span>
      </div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function WitnessButton({ agentId, type }: { agentId: string; type: "reputation" | "performance" }) {
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const endpoint = type === "reputation" ? "reputation-witness" : "performance-witness";
      const res = await fetch(
        `${API_BASE}/api/v1/zkdefi/agent-builder/agents/${agentId}/${endpoint}`
      );
      if (res.ok) {
        await res.json();
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <button
      onClick={generate}
      disabled={generating}
      className="flex-1 py-1.5 rounded-lg border border-white/5 text-[10px] text-white/30 hover:text-white/50 hover:border-white/10 flex items-center justify-center gap-1 disabled:opacity-30"
    >
      {generating ? (
        <RefreshCw className="w-3 h-3 animate-spin" />
      ) : (
        <Award className="w-3 h-3" />
      )}
      {type === "reputation" ? "Reputation Witness" : "Performance Witness"}
    </button>
  );
}
