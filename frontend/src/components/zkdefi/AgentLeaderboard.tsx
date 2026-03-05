"use client";

/**
 * AgentLeaderboard — Ranked table of identity-bound agents by performance.
 *
 * Fetches leaderboard from the agent-builder API and renders a ranked table
 * with cumulative return, win rate, volume, proof count, and reputation tier.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Trophy,
  Crown,
  Medal,
  Shield,
  TrendingUp,
  Activity,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ArrowUpDown,
} from "lucide-react";

import { API_BASE } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaderboardEntry {
  agent_id: string;
  name: string;
  owner: string;
  cumulative_return_bps: number;
  win_rate: number;
  total_volume: number;
  total_proofs: number;
  total_periods: number;
  worst_drawdown_bps: number;
  rank: number;
}

type SortKey = "cumulative_return_bps" | "total_volume" | "total_proofs" | "win_rate";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "cumulative_return_bps", label: "Return" },
  { key: "total_volume", label: "Volume" },
  { key: "total_proofs", label: "Proofs" },
  { key: "win_rate", label: "Win Rate" },
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

function formatCompact(val: number): string {
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + "M";
  if (val >= 1_000) return (val / 1_000).toFixed(1) + "K";
  return String(val);
}

function shortAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function rankIcon(rank: number) {
  if (rank === 1) return <Crown className="w-4 h-4 text-amber-400" />;
  if (rank === 2) return <Medal className="w-4 h-4 text-gray-300" />;
  if (rank === 3) return <Medal className="w-4 h-4 text-amber-600" />;
  return <span className="text-xs text-white/30 w-4 text-center">{rank}</span>;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLeaderboardEntry(input: unknown, rank: number): LeaderboardEntry {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    agent_id: String(row.agent_id ?? row.id ?? `agent_${rank}`),
    name: String(row.name ?? "Unnamed Agent"),
    owner: String(row.owner ?? row.owner_address ?? ""),
    cumulative_return_bps: toNumber(row.cumulative_return_bps, 0),
    win_rate: toNumber(row.win_rate, 0),
    total_volume: toNumber(row.total_volume, 0),
    total_proofs: toNumber(row.total_proofs, 0),
    total_periods: toNumber(row.total_periods, 0),
    worst_drawdown_bps: toNumber(row.worst_drawdown_bps ?? row.max_drawdown_bps, 0),
    rank,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentLeaderboard({
  onSelectAgent,
}: {
  onSelectAgent?: (agentId: string) => void;
}) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("cumulative_return_bps");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/zkdefi/agent-builder/leaderboard?sort_by=${sortBy}&limit=20`
      );
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setEntries(
        (Array.isArray(data?.leaderboard) ? data.leaderboard : []).map((e: unknown, i: number) =>
          normalizeLeaderboardEntry(e, i + 1),
        ),
      );
    } catch {
      setError(true);
      // Demo data
      setEntries([
        { agent_id: "agent_001", name: "Yield Maximizer Alpha", owner: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b9", cumulative_return_bps: 542, win_rate: 0.72, total_volume: 250_000, total_proofs: 34, total_periods: 12, worst_drawdown_bps: 120, rank: 1 },
        { agent_id: "agent_002", name: "Risk Guardian Beta", owner: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd", cumulative_return_bps: 380, win_rate: 0.68, total_volume: 185_000, total_proofs: 28, total_periods: 10, worst_drawdown_bps: 200, rank: 2 },
        { agent_id: "agent_003", name: "Arb Hunter Gamma", owner: "0x053c91253bc9682c04929ca02ed00b3e423f6710", cumulative_return_bps: 215, win_rate: 0.55, total_volume: 420_000, total_proofs: 45, total_periods: 8, worst_drawdown_bps: 350, rank: 3 },
        { agent_id: "agent_004", name: "Conservative Delta", owner: "0x068f5c6a61780768455de69077e07e89787839b", cumulative_return_bps: 185, win_rate: 0.8, total_volume: 80_000, total_proofs: 12, total_periods: 15, worst_drawdown_bps: 60, rank: 4 },
        { agent_id: "agent_005", name: "Paper Pilot", owner: "0x0demo_fallback_address", cumulative_return_bps: 95, win_rate: 0.5, total_volume: 50_000, total_proofs: 8, total_periods: 4, worst_drawdown_bps: 150, rank: 5 },
      ]);
    } finally {
      setLoading(false);
    }
  }, [sortBy]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Agent Leaderboard</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/60 focus:outline-none appearance-none cursor-pointer"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <button onClick={fetchLeaderboard} className="text-white/30 hover:text-white/60">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[10px] text-amber-400/60 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> Demo data — API unavailable
        </div>
      )}

      {/* Table header */}
      <div className="grid grid-cols-[28px_1fr_72px_56px_48px_48px] gap-1 px-2 text-[10px] text-white/30 font-medium">
        <span>#</span>
        <span>Agent</span>
        <span className="text-right">Return</span>
        <span className="text-right">Win%</span>
        <span className="text-right">Vol</span>
        <span className="text-right flex items-center justify-end gap-0.5">
          <Shield className="w-2.5 h-2.5" /> ZK
        </span>
      </div>

      {/* Rows */}
      <div className="space-y-0.5">
        {entries.map((entry) => (
          <button
            key={entry.agent_id}
            onClick={() => onSelectAgent?.(entry.agent_id)}
            className="w-full grid grid-cols-[28px_1fr_72px_56px_48px_48px] gap-1 px-2 py-2 rounded-lg text-xs border border-white/[0.03] bg-white/[0.01] hover:bg-white/[0.04] hover:border-white/10 transition-all items-center"
          >
            <div className="flex items-center justify-center">{rankIcon(entry.rank)}</div>
            <div className="text-left overflow-hidden">
              <div className="text-white font-medium truncate">{entry.name}</div>
              <div className="text-[10px] text-white/20 font-mono">
                {shortAddress(entry.owner)}
              </div>
            </div>
            <div
              className={`text-right font-mono ${
                entry.cumulative_return_bps >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {entry.cumulative_return_bps >= 0 ? "+" : ""}
              {bpsToPercent(entry.cumulative_return_bps)}
            </div>
            <div className="text-right text-white/60">
              {(entry.win_rate * 100).toFixed(0)}%
            </div>
            <div className="text-right text-white/40">{formatCompact(entry.total_volume)}</div>
            <div className="text-right text-[#00FFD1]/60">{entry.total_proofs}</div>
          </button>
        ))}
      </div>

      {entries.length === 0 && !loading && (
        <div className="text-center text-white/20 text-xs py-6">No agents yet</div>
      )}
    </div>
  );
}
