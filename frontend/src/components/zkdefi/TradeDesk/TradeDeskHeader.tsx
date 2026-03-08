"use client";

import { Shield, Star, TrendingUp, Wallet } from "lucide-react";
import type { UserReputation } from "@/services/ReputationGatingService";
import type { MarketContext } from "@/services/TradeDeskApiService";

interface TradeDeskHeaderProps {
  reputation: UserReputation | null;
  receipts: any[];
  marketContext: MarketContext | null;
}

const TIER_CONFIG: Record<string, { icon: typeof Shield; color: string; label: string }> = {
  Tier1: { icon: Shield, color: "text-slate-400", label: "Explorer" },
  Tier2: { icon: Star, color: "text-amber-400", label: "Verified" },
  Tier3: { icon: TrendingUp, color: "text-emerald-400", label: "Elite" },
};

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function TradeDeskHeader({ reputation, receipts, marketContext }: TradeDeskHeaderProps) {
  const totalValue = receipts.reduce(
    (sum: number, r: any) => sum + (r.amount || 0),
    0,
  );

  const yield24h = receipts
    .filter((r: any) => {
      const ts = r.timestamp || r.executedAt;
      if (!ts) return false;
      return Date.now() - new Date(ts).getTime() <= 86_400_000;
    })
    .reduce((sum: number, r: any) => sum + (r.yieldImpact || 0), 0);

  const tierCfg = reputation ? TIER_CONFIG[reputation.tier] ?? TIER_CONFIG.Tier1 : null;
  const TierIcon = tierCfg?.icon ?? Shield;

  const ethPrice = marketContext?.prices?.ETH ?? marketContext?.prices?.eth;
  const strkPrice = marketContext?.prices?.STRK ?? marketContext?.prices?.strk;

  return (
    <div className="flex items-center gap-6 px-6 py-3 bg-slate-900 border-b border-slate-700 flex-wrap">
      {/* Title */}
      <h1 className="text-lg font-bold tracking-tight whitespace-nowrap">Trade Desk</h1>

      {/* Reputation badge */}
      {reputation && tierCfg && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
          <TierIcon className={`w-4 h-4 ${tierCfg.color}`} />
          <span className="text-sm font-semibold">{reputation.reputationScore}</span>
          <span className="text-xs text-slate-400">{tierCfg.label}</span>
        </div>
      )}

      {/* Portfolio stats */}
      <div className="flex items-center gap-4 text-sm ml-auto">
        <div className="flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400">Value</span>
          <span className="font-medium text-cyan-400">{formatUsd(totalValue)}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400">24h</span>
          <span className={`font-medium ${yield24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {yield24h >= 0 ? "+" : ""}
            {yield24h.toFixed(2)}%
          </span>
        </div>

        {/* Market prices */}
        {ethPrice != null && (
          <div className="flex items-center gap-1.5 border-l border-slate-700 pl-4">
            <span className="text-slate-500 text-xs">ETH</span>
            <span className="font-medium text-slate-200">{formatUsd(ethPrice)}</span>
          </div>
        )}
        {strkPrice != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-xs">STRK</span>
            <span className="font-medium text-slate-200">{formatUsd(strkPrice)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
