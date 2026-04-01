"use client";

import { Shield, TrendingUp, Zap, Lock } from "lucide-react";
import type { ReputationProfile } from "@/lib/receiptos/types";

const TIER_CONFIG: Record<number, { color: string; bg: string; border: string; icon: typeof Shield }> = {
  0: { color: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/30", icon: Lock },
  1: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", icon: Shield },
  2: { color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30", icon: Zap },
};

function ringColor(score: number): string {
  if (score >= 70) return "stroke-emerald-400";
  if (score >= 40) return "stroke-amber-400";
  return "stroke-red-400";
}

/* ── Score formula (mirrors backend _composite_score in risk_passport.py) ── */

interface ScoreBreakdown {
  tierPts: number;
  tenurePts: number;
  volumePts: number;
  collateralPts: number;
  txnPts: number;
  protocolPts: number;
  walletPts: number;
  total: number;
}

function computeBreakdown(
  p: ReputationProfile,
  extra?: { protocolCount?: number; walletValueUsd?: number },
): ScoreBreakdown {
  const tierPts = p.tier * 25;                                         // max 75
  const tenurePts = Math.min(Math.floor(p.tenure_days / 10), 15);      // max 15
  const volumePts = Math.min(Math.floor(p.total_volume_eth * 2), 15);  // max 15
  const collateralPts = Math.min(Math.floor(p.collateral_eth * 10), 15); // max 15
  const txnPts = Math.min(p.transaction_count, 10);                    // max 10
  const protocolPts = Math.min((extra?.protocolCount ?? 0) * 3, 10);   // max 10
  const walletPts = Math.min(Math.floor((extra?.walletValueUsd ?? 0) / 10), 10); // max 10
  const total = Math.max(0, Math.min(100,
    tierPts + tenurePts + volumePts + collateralPts + txnPts + protocolPts + walletPts,
  ));
  return { tierPts, tenurePts, volumePts, collateralPts, txnPts, protocolPts, walletPts, total };
}

export function ScoreBanner({
  profile,
  protocolCount,
  walletValueUsd,
}: {
  profile: ReputationProfile;
  protocolCount?: number;
  walletValueUsd?: number;
}) {
  const tier = TIER_CONFIG[profile.tier] ?? TIER_CONFIG[0];
  const TierIcon = tier.icon;
  const bd = computeBreakdown(profile, { protocolCount, walletValueUsd });
  // Use the authoritative backend score for the ring, breakdown for detail bars
  const pct = profile.reputation_score > 0 ? profile.reputation_score : bd.total;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="glass rounded-2xl px-6 py-6 space-y-5">
      {/* Row 1: ring + headline stats */}
      <div className="flex items-center gap-6">
        {/* Score ring */}
        <div className="relative flex-shrink-0">
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor"
              className="text-zinc-800" strokeWidth="6" />
            <circle cx="50" cy="50" r={r} fill="none" strokeWidth="6"
              strokeLinecap="round" className={ringColor(pct)}
              strokeDasharray={circ} strokeDashoffset={offset}
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset 0.6s ease" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="stat-gradient text-2xl font-bold font-serif">{pct}</span>
            <span className="text-[9px] uppercase tracking-widest text-zinc-500">score</span>
          </div>
        </div>

        {/* Tier + key stats */}
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
            <Stat label="Transactions" value={`${profile.successful_txns}✓ ${profile.failed_txns}✗`} />
            <Stat label="Volume" value={`${profile.total_volume_eth.toFixed(2)} ETH`} />
            <Stat label="Collateral" value={`${profile.collateral_eth.toFixed(2)} ETH`} />
          </div>
        </div>
      </div>

      {/* Row 2: Score breakdown — shows exactly how the score is computed */}
      <div className="space-y-1.5">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">
          Score Breakdown
        </p>
        <div className="space-y-1">
          <BreakdownBar label="Tier" points={bd.tierPts} max={75} color="bg-blue-500" />
          <BreakdownBar label="Tenure" points={bd.tenurePts} max={15} color="bg-emerald-500" />
          <BreakdownBar label="Txns" points={bd.txnPts} max={10} color="bg-amber-500" />
          <BreakdownBar label="Protocols" points={bd.protocolPts} max={10} color="bg-cyan-500" />
          <BreakdownBar label="Wallet" points={bd.walletPts} max={10} color="bg-teal-500" />
          <BreakdownBar label="Volume" points={bd.volumePts} max={15} color="bg-violet-500" />
          <BreakdownBar label="Collateral" points={bd.collateralPts} max={15} color="bg-purple-500" />
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

function BreakdownBar({
  label, points, max, color,
}: {
  label: string; points: number; max: number; color: string;
}) {
  const absPoints = Math.abs(points);
  const pct = max > 0 ? Math.min(100, (absPoints / max) * 100) : 0;
  const isNeg = points < 0;
  const display = isNeg ? `−${absPoints.toFixed(1)}` : `+${absPoints.toFixed(1)}`;

  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-right text-[10px] text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-zinc-800">
        <div
          className={`h-1.5 rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%`, opacity: isNeg ? 0.6 : 0.8 }}
        />
      </div>
      <span className={`w-10 text-right font-mono text-[10px] ${isNeg ? "text-red-400" : "text-zinc-400"}`}>
        {display}
      </span>
    </div>
  );
}
