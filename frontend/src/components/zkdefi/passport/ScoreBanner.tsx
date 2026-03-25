"use client";

import { Shield, TrendingUp, Zap, Lock } from "lucide-react";
import type { ReputationProfile } from "@/lib/receiptos/types";

const TIER_CONFIG: Record<number, { color: string; bg: string; border: string; icon: typeof Shield }> = {
  0: { color: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/30", icon: Lock },
  1: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", icon: Shield },
  2: { color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30", icon: Zap },
};

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function ringColor(score: number): string {
  if (score >= 70) return "stroke-emerald-400";
  if (score >= 40) return "stroke-amber-400";
  return "stroke-red-400";
}

export function ScoreBanner({ profile }: { profile: ReputationProfile }) {
  const tier = TIER_CONFIG[profile.tier] ?? TIER_CONFIG[0];
  const TierIcon = tier.icon;
  const pct = Math.max(0, Math.min(100, profile.reputation_score));
  // SVG circle math (radius 40, circumference ~251.3)
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="glass rounded-2xl px-6 py-6">
      <div className="flex items-center gap-6">
        {/* Score ring */}
        <div className="relative flex-shrink-0">
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r={r}
              fill="none" stroke="currentColor"
              className="text-zinc-800" strokeWidth="6"
            />
            <circle
              cx="50" cy="50" r={r}
              fill="none" strokeWidth="6"
              strokeLinecap="round"
              className={ringColor(pct)}
              strokeDasharray={circ}
              strokeDashoffset={offset}
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset 0.6s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`stat-gradient text-2xl font-bold font-serif`}>{pct}</span>
            <span className="text-[9px] uppercase tracking-widest text-zinc-500">score</span>
          </div>
        </div>

        {/* Tier + stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full ${tier.bg} ${tier.border} border px-3 py-1 text-xs font-semibold ${tier.color}`}>
              <TierIcon className="h-3 w-3" />
              {profile.tier_name}
            </span>
            <span className="text-[10px] text-zinc-600">Tier {profile.tier}</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <Stat label="Tenure" value={`${profile.tenure_days}d`} />
            <Stat label="Transactions" value={profile.transaction_count.toLocaleString()} />
            <Stat label="Success Rate" value={successRate(profile)} />
            <Stat label="Collateral" value={`${profile.collateral_eth.toFixed(2)} ETH`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono font-medium text-zinc-300">{value}</span>
    </div>
  );
}

function successRate(p: ReputationProfile): string {
  const total = p.successful_txns + p.failed_txns;
  if (total === 0) return "—";
  return `${Math.round((p.successful_txns / total) * 100)}%`;
}
