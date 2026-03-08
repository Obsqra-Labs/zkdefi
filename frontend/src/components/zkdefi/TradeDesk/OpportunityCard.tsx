"use client";

import React from "react";
import {
  Lock,
  ShieldCheck,
  CheckCircle,
  Sparkles,
  EyeOff,
} from "lucide-react";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";

interface OpportunityCardProps {
  opportunity: UnifiedOpportunity;
  selected: boolean;
  onClick: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  swap: "bg-cyan-600/20 text-cyan-300 border-cyan-700",
  lp: "bg-emerald-600/20 text-emerald-300 border-emerald-700",
  lending: "bg-amber-600/20 text-amber-300 border-amber-700",
  staking: "bg-purple-600/20 text-purple-300 border-purple-700",
  limit: "bg-blue-600/20 text-blue-300 border-blue-700",
  dca: "bg-orange-600/20 text-orange-300 border-orange-700",
  privacy: "bg-violet-600/20 text-violet-300 border-violet-700",
  dark_ledger: "bg-slate-600/20 text-slate-300 border-slate-600",
};

function yieldColor(y: number): string {
  if (y > 50) return "text-red-400";
  if (y > 20) return "text-amber-400";
  if (y > 5) return "text-emerald-400";
  return "text-slate-300";
}

function riskBarColor(s: number): string {
  if (s <= 30) return "bg-emerald-500";
  if (s <= 60) return "bg-amber-500";
  return "bg-red-500";
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function gatingIcon(gating: UnifiedOpportunity["gating"]) {
  if (!gating) return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
  switch (gating.status) {
    case "locked":
    case "proof_required":
      return <Lock className="w-3.5 h-3.5 text-red-400" />;
    case "advisory":
      return <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />;
    default:
      return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
  }
}

export const OpportunityCard = React.memo(
  ({ opportunity, selected, onClick }: OpportunityCardProps) => {
    const badgeClass = TYPE_COLORS[opportunity.type] ?? TYPE_COLORS.swap;

    return (
      <button
        onClick={onClick}
        className={`w-full text-left p-3 rounded-lg border transition-colors ${
          selected
            ? "bg-slate-800 border-cyan-600"
            : "bg-slate-800/60 border-slate-700 hover:border-slate-500"
        }`}
      >
        {/* Row 1: type badge + pair + gating */}
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border ${badgeClass}`}
          >
            {opportunity.type}
          </span>
          <span className="text-sm font-semibold truncate flex-1">
            {opportunity.pair}
          </span>
          {gatingIcon(opportunity.gating)}
        </div>

        {/* Row 2: protocol + privacy badge + AI signal */}
        <div className="flex items-center gap-2 mb-2 text-xs text-slate-400">
          <span>{opportunity.protocol}</span>
          {opportunity.privacyLevel !== "public" && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 text-[10px]">
              <EyeOff className="w-2.5 h-2.5" />
              {opportunity.privacyLevel}
            </span>
          )}
          {opportunity.signal?.recommended && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cyan-900/40 text-cyan-300 text-[10px] font-medium">
              <Sparkles className="w-2.5 h-2.5" />
              AI {Math.round(opportunity.confidence * 100)}%
            </span>
          )}
        </div>

        {/* Row 3: yield (big), risk bar, TVL, volume */}
        <div className="flex items-end gap-3">
          <span className={`text-xl font-bold leading-none ${yieldColor(opportunity.currentYield)}`}>
            {opportunity.currentYield.toFixed(1)}%
          </span>

          <div className="flex-1 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${riskBarColor(opportunity.riskScore)}`}
                  style={{ width: `${Math.min(opportunity.riskScore, 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-500 w-5 text-right">
                {opportunity.riskScore}
              </span>
            </div>
            <div className="flex gap-3 text-[10px] text-slate-500">
              <span>TVL ${compactNumber(opportunity.tvlUsd)}</span>
              <span>24h ${compactNumber(opportunity.volume24h)}</span>
            </div>
          </div>
        </div>
      </button>
    );
  },
);

OpportunityCard.displayName = "OpportunityCard";
