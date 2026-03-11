"use client";

import { useState } from "react";
import {
  Copy,
  Check,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  ShieldCheck,
  Shield,
  Clock3,
  TrendingUp,
  Award,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { useHealthPassport } from "@/hooks/useHealthPassport";
import { CreditGauge } from "../shared/CreditGauge";
import { DEMO_HEALTH } from "@/lib/demoCapitalOS";
import type { RiskProfileV2 } from "@/hooks/useProfile";

const TIER_STYLE: Record<number, { label: string; cls: string; ring: string }> = {
  0: { label: "Unranked", cls: "bg-zinc-800 text-zinc-400 border-zinc-700", ring: "ring-zinc-700" },
  1: { label: "T1", cls: "bg-emerald-900/50 text-emerald-400 border-emerald-700/50", ring: "ring-emerald-500/40" },
  2: { label: "T2", cls: "bg-cyan-900/50 text-cyan-400 border-cyan-700/50", ring: "ring-cyan-500/40" },
  3: { label: "T3", cls: "bg-violet-900/50 text-violet-400 border-violet-700/50", ring: "ring-violet-500/40" },
};

const DEMO_PROFILE_V2: Partial<RiskProfileV2> = {
  reputation: {
    tier: 2,
    tier_name: "Express",
    tenure_days: 45,
    transaction_count: 87,
    successful_txns: 82,
    collateral_eth: 0.5,
    total_volume_eth: 3.2,
  },
  passport: {
    composite_score: 72,
    letter_rating: "B+",
    tier: 2,
    tier_name: "Express",
    credit_tier: "prime",
    credit_score: 720,
    receipt_summary: { count: 14, by_type: { deposit: 8, proof: 4, withdrawal: 2 } },
  },
  governance: {
    voting_power: 120,
    lp_usd: 164.87,
    lending_usd: 0,
    staking_usd: 0,
    tier_multiplier: 1.2,
    formula_version: "v2",
  },
  predictive_credit: {
    grade: "B+",
    grade_confidence: 0.82,
    max_ltv: 0.65,
    rate_bps: 450,
    credit_line_eth: 0.3,
    collaborative_multiplier: 1.1,
    model_name: "zkfico_mlp_v1",
  },
};

interface IdentityBadgeProps {
  address: string;
  onSlideout: (mode: string) => void;
  isDemo?: boolean;
  profileV2?: RiskProfileV2 | null;
}

export function IdentityBadge({ address, onSlideout, isDemo, profileV2: profileV2Prop }: IdentityBadgeProps) {
  const healthRaw = useHealthPassport(address);
  const [copied, setCopied] = useState(false);

  // In demo mode, always use demo health data for consistency
  const health = (() => {
    if (!isDemo) return healthRaw;
    return {
      loading: false,
      tier: DEMO_HEALTH.tier,
      tier_name: DEMO_HEALTH.tier_name,
      trust_score: DEMO_HEALTH.trust_score,
      proof_count: DEMO_HEALTH.proof_count,
      credit_score: DEMO_HEALTH.credit_score as number | null,
    };
  })();

  // Use V2 profile when available (passed from agent page), fall back to demo data
  const profile = isDemo ? DEMO_PROFILE_V2 as RiskProfileV2 : profileV2Prop;

  const creditScore = profile?.passport?.credit_score ?? profile?.predictive_credit?.credit_line_eth ? health.credit_score : health.credit_score;
  const compositeScore = profile?.passport?.composite_score ?? health.trust_score;
  const letterRating = profile?.passport?.letter_rating;
  const tenureDays = profile?.reputation?.tenure_days ?? 0;
  const txnCount = profile?.reputation?.transaction_count ?? profile?.reputation?.successful_txns ?? 0;
  const proofCount = profile?.passport?.receipt_summary?.count ?? health.proof_count;
  const votingPower = profile?.governance?.voting_power ?? 0;
  const creditGrade = profile?.predictive_credit?.grade;
  const creditConfidence = profile?.predictive_credit?.grade_confidence;
  const maxLtv = profile?.predictive_credit?.max_ltv;

  const handleCopy = () => {
    navigator.clipboard?.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const truncated = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
  const tier = TIER_STYLE[health.tier] ?? TIER_STYLE[0]!;

  if (health.loading) {
    return (
      <div className="w-[240px] flex-shrink-0 p-4 space-y-3 animate-pulse">
        <div className="h-5 w-28 bg-zinc-800 rounded" />
        <div className="h-6 w-16 bg-zinc-800 rounded" />
        <div className="h-4 w-24 bg-zinc-800 rounded" />
        <div className="h-4 w-20 bg-zinc-800 rounded" />
        <div className="h-16 w-16 bg-zinc-800 rounded-full mx-auto" />
        <div className="h-px bg-zinc-800" />
        <div className="flex gap-2">
          <div className="h-8 flex-1 bg-zinc-800 rounded" />
          <div className="h-8 flex-1 bg-zinc-800 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-[240px] flex-shrink-0 flex flex-col gap-0 overflow-y-auto">
      {/* Identity Header */}
      <div className="p-4 pb-3 space-y-2.5">
        {/* Address + copy */}
        <div className="flex items-center gap-2">
          <code className="text-[13px] text-zinc-200 font-mono tracking-tight">{truncated}</code>
          <button onClick={handleCopy} className="p-1 rounded hover:bg-zinc-800 transition-colors" title="Copy address">
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-500" />}
          </button>
        </div>

        {/* Tier badge + letter rating */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-semibold ${tier.cls}`}>
            <ShieldCheck className="w-3 h-3" />
            {tier.label} — {health.tier_name}
          </span>
          {letterRating && (
            <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[11px] font-bold text-zinc-200">
              {letterRating}
            </span>
          )}
        </div>
      </div>

      {/* Credit Gauge & Trust Score */}
      <div className="px-4 py-3 border-t border-zinc-800/60">
        <div className="flex items-center gap-3">
          <CreditGauge score={creditScore ?? compositeScore} size="sm" />
          <div className="flex-1 space-y-1.5">
            {/* Trust Score bar */}
            <div>
              <div className="flex justify-between text-[10px] mb-0.5">
                <span className="text-zinc-500">Trust Score</span>
                <span className="text-zinc-300 font-medium">{compositeScore}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all"
                  style={{ width: `${Math.min(compositeScore, 100)}%` }}
                />
              </div>
            </div>
            {/* Credit grade */}
            {creditGrade && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-500">Credit Grade</span>
                <span className="text-emerald-400 font-medium">{creditGrade}{creditConfidence ? ` (${(creditConfidence * 100).toFixed(0)}%)` : ""}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reputation Stats */}
      <div className="px-4 py-3 border-t border-zinc-800/60 space-y-2">
        <StatRow icon={Shield} label="Proofs generated" value={proofCount} />
        <StatRow icon={Clock3} label="Tenure" value={tenureDays > 0 ? `${tenureDays}d` : "—"} />
        <StatRow icon={TrendingUp} label="Transactions" value={txnCount || "—"} />
        {maxLtv != null && maxLtv > 0 && (
          <StatRow icon={Award} label="Max LTV" value={`${(maxLtv * 100).toFixed(0)}%`} />
        )}
        {votingPower > 0 && (
          <StatRow icon={Award} label="Voting Power" value={votingPower.toFixed(0)} />
        )}
      </div>

      {/* View Full Profile link */}
      <div className="px-4 py-2 border-t border-zinc-800/60">
        <Link
          href="/profile"
          className="flex items-center justify-between text-[11px] text-zinc-400 hover:text-emerald-400 transition-colors group"
        >
          <span>View Full Profile</span>
          <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      {/* Divider */}
      <div className="h-px bg-zinc-800/60" />

      {/* Quick Actions */}
      <div className="p-4 pt-3 flex gap-2">
        <button
          onClick={() => onSlideout("fund")}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-violet-700/50 text-violet-400 hover:bg-violet-900/20 text-xs font-medium transition-colors"
        >
          <ArrowDownToLine className="w-3.5 h-3.5" /> Fund
        </button>
        <button
          onClick={() => onSlideout("withdraw")}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs font-medium transition-colors"
        >
          <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdraw
        </button>
      </div>
    </div>
  );
}

function StatRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="flex items-center gap-1.5 text-zinc-500">
        <Icon className="w-3 h-3" />
        {label}
      </span>
      <span className="text-zinc-200 font-medium">{value}</span>
    </div>
  );
}
