"use client";

import { useState, useCallback } from "react";
import {
  TrendingUp,
  Shield,
  Flame,
  Loader2,
  CheckCircle2,
  Zap,
  ArrowRight,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

interface ProposedMove {
  action: string;
  protocol: string;
  pool_name: string;
  asset_symbol: string;
  amount_usd: number;
  expected_apy: number;
  risk_score: number;
  reasoning: string;
}

interface StrategyData {
  risk_profile: string;
  expected_blended_apy: number;
  expected_annual_yield_usd: number;
  reasoning: string;
  proposal_hash: string;
  moves_count: number;
  portfolio_value_usd: number;
  moves: ProposedMove[];
}

interface CompareResult {
  portfolio: {
    wallet_address: string;
    total_value_usd: number;
    position_count: number;
    protocols_found: string[];
  };
  is_hypothetical: boolean;
  strategies: {
    conservative: StrategyData;
    balanced: StrategyData;
    aggressive: StrategyData;
  };
}

interface StrategyCompareProps {
  walletAddress: string;
  hypotheticalUsd?: number;
  onSelectStrategy: (profile: string, strategy: StrategyData) => void;
}

/* ─── styles ───────────────────────────────────────────────────────── */

const PROFILE_STYLES = {
  conservative: {
    icon: Shield,
    color: "text-cyan-400",
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/5",
    hoverBg: "hover:bg-cyan-500/10",
    selectedBg: "bg-cyan-500/15",
    selectedBorder: "border-cyan-500",
    gradient: "from-cyan-500/10 to-transparent",
    barColor: "bg-cyan-500",
  },
  balanced: {
    icon: TrendingUp,
    color: "text-emerald-400",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    hoverBg: "hover:bg-emerald-500/10",
    selectedBg: "bg-emerald-500/15",
    selectedBorder: "border-emerald-500",
    gradient: "from-emerald-500/10 to-transparent",
    barColor: "bg-emerald-500",
  },
  aggressive: {
    icon: Flame,
    color: "text-amber-400",
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    hoverBg: "hover:bg-amber-500/10",
    selectedBg: "bg-amber-500/15",
    selectedBorder: "border-amber-500",
    gradient: "from-amber-500/10 to-transparent",
    barColor: "bg-amber-500",
  },
} as const;

type ProfileKey = keyof typeof PROFILE_STYLES;

const PROTOCOL_COLORS: Record<string, string> = {
  ekubo: "text-cyan-400",
  vesu: "text-emerald-400",
  endur: "text-amber-400",
  nostra: "text-rose-400",
  troves: "text-indigo-400",
  wallet: "text-zinc-400",
};

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/* ─── component ────────────────────────────────────────────────────── */

export function StrategyCompare({
  walletAddress,
  hypotheticalUsd,
  onSelectStrategy,
}: StrategyCompareProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [selected, setSelected] = useState<ProfileKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchComparison = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { wallet_address: walletAddress };
      if (hypotheticalUsd) body.hypothetical_usd = hypotheticalUsd;

      const data = await apiFetch<CompareResult>("/api/v1/paper-trade/compare-strategies", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 60_000,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compare strategies");
    } finally {
      setLoading(false);
    }
  }, [walletAddress, hypotheticalUsd]);

  const handleSelect = (profile: ProfileKey) => {
    if (!result) return;
    setSelected(profile);
    onSelectStrategy(profile, result.strategies[profile]);
  };

  // Auto-fetch on mount if not loaded
  if (!result && !loading && !error) {
    fetchComparison();
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-zinc-800 bg-zinc-900/30">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        <p className="text-sm text-zinc-400">
          Running 3 strategies against live pool data…
        </p>
        <p className="text-[10px] text-zinc-600">
          Conservative · Balanced · Aggressive — same portfolio, different risk appetites
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-5 py-4 text-sm text-rose-400">
        {error}
        <button onClick={fetchComparison} className="ml-3 underline hover:text-rose-300">Retry</button>
      </div>
    );
  }

  if (!result) return null;

  const maxApy = Math.max(
    result.strategies.conservative.expected_blended_apy,
    result.strategies.balanced.expected_blended_apy,
    result.strategies.aggressive.expected_blended_apy,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">
          Strategy Comparison
          {result.is_hypothetical && (
            <span className="ml-2 text-[10px] text-amber-400/80 font-normal">
              Hypothetical {fmtUsd(result.strategies.balanced.portfolio_value_usd)}
            </span>
          )}
        </h3>
        <button
          onClick={fetchComparison}
          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* ── 3-column comparison ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(["conservative", "balanced", "aggressive"] as const).map((profile) => {
          const strategy = result.strategies[profile];
          const style = PROFILE_STYLES[profile];
          const Icon = style.icon;
          const isSelected = selected === profile;
          const apyBarWidth = maxApy > 0 ? (strategy.expected_blended_apy / maxApy) * 100 : 0;

          return (
            <button
              key={profile}
              onClick={() => handleSelect(profile)}
              className={`group text-left rounded-xl border transition-all ${
                isSelected
                  ? `${style.selectedBorder} ${style.selectedBg}`
                  : `${style.border} ${style.bg} ${style.hoverBg}`
              } p-4 space-y-3`}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${style.color}`} />
                  <span className={`text-xs font-bold uppercase tracking-wider ${style.color}`}>
                    {profile}
                  </span>
                </div>
                {isSelected && (
                  <CheckCircle2 className={`h-4 w-4 ${style.color}`} />
                )}
              </div>

              {/* APY + yield */}
              <div>
                <p className={`text-2xl font-bold tabular-nums ${style.color}`}>
                  {fmtPct(strategy.expected_blended_apy)}
                </p>
                <p className="text-[10px] text-zinc-500">
                  ~{fmtUsd(strategy.expected_annual_yield_usd)}/yr
                </p>
              </div>

              {/* APY bar */}
              <div className="h-1.5 w-full rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full ${style.barColor} transition-all duration-500`}
                  style={{ width: `${apyBarWidth}%` }}
                />
              </div>

              {/* Moves summary */}
              <div className="space-y-1">
                {strategy.moves.slice(0, 3).map((move, i) => {
                  const protocolColor = PROTOCOL_COLORS[move.protocol] ?? "text-zinc-400";
                  return (
                    <div key={i} className="flex items-center justify-between text-[10px]">
                      <span className={`${protocolColor} truncate mr-2`}>
                        {move.protocol} · {move.asset_symbol}
                      </span>
                      <span className="text-zinc-500 tabular-nums">
                        {fmtPct(move.expected_apy)}
                      </span>
                    </div>
                  );
                })}
                {strategy.moves.length > 3 && (
                  <p className="text-[9px] text-zinc-600">
                    +{strategy.moves.length - 3} more
                  </p>
                )}
              </div>

              {/* Risk summary */}
              <div className="pt-1 border-t border-zinc-800/50">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-zinc-600">Avg risk</span>
                  <span className={`font-bold ${
                    profile === "conservative" ? "text-cyan-400" :
                    profile === "balanced" ? "text-amber-400" : "text-rose-400"
                  }`}>
                    {strategy.moves.length > 0
                      ? Math.round(strategy.moves.reduce((s, m) => s + m.risk_score, 0) / strategy.moves.length)
                      : 0}/100
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-zinc-600">Moves</span>
                  <span className="text-zinc-400">{strategy.moves_count}</span>
                </div>
              </div>

              {/* Select CTA */}
              {!isSelected && (
                <div className={`flex items-center justify-center gap-1 pt-1 text-[10px] font-medium ${style.color} opacity-0 group-hover:opacity-100 transition-opacity`}>
                  Select {profile}
                  <ArrowRight className="h-3 w-3" />
                </div>
              )}
              {isSelected && (
                <div className={`flex items-center justify-center gap-1 pt-1 text-[10px] font-bold ${style.color}`}>
                  <Zap className="h-3 w-3" />
                  Selected — ready to execute
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
