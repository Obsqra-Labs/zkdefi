"use client";

import { Brain, TrendingUp, Shield, Users, Zap, AlertTriangle } from "lucide-react";
import type { RiskProfileV2 } from "@/hooks/useProfile";

interface AIInsightsCardProps {
  profileV2: RiskProfileV2 | null;
  loading?: boolean;
}

function gradeColor(grade: string | undefined | null): string {
  if (!grade) return "text-zinc-400";
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-cyan-400";
  if (grade.startsWith("C")) return "text-amber-400";
  if (grade.startsWith("D")) return "text-orange-400";
  return "text-zinc-400";
}

function confidenceBar(value: number): string {
  if (value >= 0.8) return "bg-emerald-500";
  if (value >= 0.6) return "bg-cyan-500";
  if (value >= 0.4) return "bg-amber-500";
  return "bg-red-500";
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function AIInsightsCard({ profileV2, loading }: AIInsightsCardProps) {
  const credit = profileV2?.predictive_credit ?? null;

  if (loading) {
    return (
      <div className="rounded-xl border border-violet-700/30 bg-gradient-to-br from-violet-950/30 to-zinc-900/60 p-6 animate-pulse">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-5 w-5 bg-zinc-700/50 rounded" />
          <div className="h-6 w-40 bg-zinc-700/50 rounded" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-zinc-700/50 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!credit) {
    return (
      <div className="rounded-xl border border-violet-700/20 bg-violet-950/10 p-6">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="w-5 h-5 text-violet-400" />
          <h3 className="text-lg font-semibold text-white">AI Credit Insights</h3>
          <span className="text-[10px] font-mono text-violet-300 bg-violet-500/20 px-1.5 py-0.5 rounded">zkML</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p>Predictive credit scoring requires on-chain history. Keep transacting to unlock your AI-powered credit grade.</p>
        </div>
      </div>
    );
  }

  const confidence = typeof credit.grade_confidence === "number" ? credit.grade_confidence : 0;
  const grade = credit.grade ?? "—";
  const creditLineEth = typeof credit.credit_line_eth === "number" ? credit.credit_line_eth : 0;
  const maxLtv = typeof credit.max_ltv === "number" ? credit.max_ltv : 0;
  const rateBps = typeof credit.rate_bps === "number" ? credit.rate_bps : 0;
  const collabMult = typeof credit.collaborative_multiplier === "number" ? credit.collaborative_multiplier : 1;

  return (
    <div className="rounded-xl border border-violet-700/30 bg-gradient-to-br from-violet-950/30 to-zinc-900/60 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-violet-400" />
          <h3 className="text-lg font-semibold text-white">AI Credit Insights</h3>
          <span className="text-[10px] font-mono text-violet-300 bg-violet-500/20 px-1.5 py-0.5 rounded">zkML</span>
        </div>
        <span className="text-[10px] text-zinc-500 font-mono">{credit.model_name ?? "—"}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Predictive Grade */}
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="w-3.5 h-3.5 text-violet-400" />
            <p className="text-xs text-zinc-500">Predicted Grade</p>
          </div>
          <p className={`text-2xl font-bold ${gradeColor(grade)}`}>{grade}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${confidenceBar(confidence)}`}
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-400">{Math.round(confidence * 100)}%</span>
          </div>
        </div>

        {/* Credit Line */}
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <p className="text-xs text-zinc-500">Credit Line</p>
          </div>
          <p className="text-xl font-bold text-white">{creditLineEth.toFixed(3)}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">ETH equivalent</p>
        </div>

        {/* Max LTV & Rate */}
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <p className="text-xs text-zinc-500">Max LTV · Rate</p>
          </div>
          <p className="text-xl font-bold text-white">{Math.round(maxLtv * 100)}%</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">{formatBps(rateBps)} APR</p>
        </div>

        {/* Collaborative Multiplier */}
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="w-3.5 h-3.5 text-amber-400" />
            <p className="text-xs text-zinc-500">Co-op Multiplier</p>
          </div>
          <p className={`text-xl font-bold ${collabMult > 1 ? "text-amber-400" : "text-zinc-300"}`}>
            {collabMult.toFixed(2)}x
          </p>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {collabMult > 1 ? "Network bonus active" : "Build connections"}
          </p>
        </div>
      </div>
    </div>
  );
}
