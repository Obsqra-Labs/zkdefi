"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  AlertCircle,
  Lock,
  Eye,
  Zap,
  Target,
  ShieldCheck,
  CheckCircle,
} from "lucide-react";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";

interface OpportunityCardProps {
  opportunity: UnifiedOpportunity;
  selected: boolean;
  onClick: () => void;
}

function compactUsd(n: number | unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return "$0";
  if (x >= 1_000_000_000) return `$${(x / 1_000_000_000).toFixed(1)}B`;
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(1)}K`;
  return `$${x.toFixed(0)}`;
}

function getRiskColor(score: number): string {
  if (score <= 30) return "bg-emerald-50 border-emerald-200 text-emerald-700";
  if (score <= 60) return "bg-amber-50 border-amber-200 text-amber-700";
  return "bg-rose-50 border-rose-200 text-rose-700";
}

function getTypeIcon(type: string) {
  switch (type) {
    case "swap":
      return <TrendingUp className="w-4 h-4" />;
    case "lp":
      return <Zap className="w-4 h-4" />;
    case "lending":
      return <Target className="w-4 h-4" />;
    case "staking":
      return <AlertCircle className="w-4 h-4" />;
    case "dca":
      return <TrendingUp className="w-4 h-4" />;
    case "limit":
      return <Target className="w-4 h-4" />;
    case "privacy":
      return <ShieldCheck className="w-4 h-4" />;
    case "dark_ledger":
      return <Lock className="w-4 h-4" />;
    default:
      return <Zap className="w-4 h-4" />;
  }
}

function getTypeBadgeColor(type: string): string {
  switch (type) {
    case "swap":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "lp":
      return "bg-purple-100 text-purple-700 border-purple-200";
    case "lending":
      return "bg-indigo-100 text-indigo-700 border-indigo-200";
    case "staking":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "dca":
      return "bg-cyan-100 text-cyan-700 border-cyan-200";
    case "limit":
      return "bg-pink-100 text-pink-700 border-pink-200";
    case "privacy":
      return "bg-violet-100 text-violet-700 border-violet-200";
    case "dark_ledger":
      return "bg-slate-200 text-slate-700 border-slate-300";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function gatingBadge(gating: UnifiedOpportunity["gating"]) {
  if (!gating || gating.status === "unlocked") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600">
        <CheckCircle className="w-3 h-3" />
        Open
      </span>
    );
  }
  if (gating.status === "advisory") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-amber-600">
        <ShieldCheck className="w-3 h-3" />
        Advisory
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-rose-600">
      <Lock className="w-3 h-3" />
      Locked
    </span>
  );
}

export const OpportunityCard = React.memo(
  ({ opportunity, selected, onClick }: OpportunityCardProps) => {
    const recommended = Boolean(opportunity.signal?.recommended || opportunity.recommended);
    const confidencePct = Math.round((Number(opportunity.confidence) || 0) * 100);
    const riskScore = Number(opportunity.riskScore) || 0;
    const currentYield = Number(opportunity.currentYield) || 0;

    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -14 }}
        transition={{ duration: 0.25 }}
        onClick={onClick}
        className={`group relative rounded-lg border overflow-hidden cursor-pointer transition-all duration-200 ${
          selected
            ? "bg-white border-cyan-500 shadow-[0_0_0_2px_rgba(6,182,212,0.25)]"
            : "bg-white border-gray-200 hover:border-blue-300 hover:shadow-lg"
        }`}
      >
        {recommended && (
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white px-3 py-1 flex items-center gap-2 text-xs font-semibold">
            <Star className="w-3 h-3" />
            RECOMMENDED {confidencePct > 0 ? `• ${confidencePct}%` : ""}
          </div>
        )}

        <div className={`p-4 ${recommended ? "pt-10" : ""}`}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm truncate">{opportunity.pair}</h3>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                {opportunity.title}
                {opportunity.aiNarrative ? ` • ${opportunity.aiNarrative}` : ""}
              </p>
            </div>
            <div
              className={`flex-shrink-0 ml-2 px-2 py-1 rounded border flex items-center gap-1 text-xs font-medium ${getTypeBadgeColor(opportunity.type)}`}
            >
              {getTypeIcon(opportunity.type)}
              {opportunity.type.toUpperCase()}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-blue-50 rounded p-2">
              <div className="text-xs text-blue-600 font-medium mb-0.5">APY</div>
              <div className="text-lg font-bold text-blue-700">{currentYield.toFixed(1)}%</div>
            </div>

            <div className={`rounded p-2 border ${getRiskColor(riskScore)}`}>
              <div className="text-xs font-medium mb-0.5">RISK</div>
              <div className="text-lg font-bold">{riskScore.toFixed(0)}</div>
            </div>

            <div className="bg-gray-50 rounded p-2">
              <div className="text-xs text-gray-600 font-medium mb-0.5">TVL</div>
              <div className="text-sm font-bold text-gray-700">{compactUsd(opportunity.tvlUsd)}</div>
            </div>
          </div>

          <div className="flex items-center gap-1 mb-3">
            {(opportunity.privacyLevel === "public" || !opportunity.privacyLevel) && (
              <span className="p-1.5 bg-gray-100 rounded border border-gray-200" title="Public">
                <Eye className="w-3 h-3 text-gray-600" />
              </span>
            )}
            {opportunity.privacyLevel === "shielded" && (
              <span className="p-1.5 bg-blue-100 rounded border border-blue-200" title="Shielded">
                <Lock className="w-3 h-3 text-blue-600" />
              </span>
            )}
            {opportunity.privacyLevel === "fully_private" && (
              <span className="p-1.5 bg-purple-100 rounded border border-purple-200" title="Fully Private">
                <Zap className="w-3 h-3 text-purple-600" />
              </span>
            )}
            <span className="ml-auto">{gatingBadge(opportunity.gating)}</span>
          </div>

          <div className="mb-3 pb-3 border-t border-gray-100 pt-2 flex items-center justify-between gap-2">
            <span className="inline-block text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
              {opportunity.protocol}
            </span>
            <span className="inline-block text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded uppercase">
              {opportunity.executionMode}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded transition-colors duration-200 flex items-center justify-center gap-2"
          >
            <Zap className="w-4 h-4" />
            Open Workspace
          </button>
        </div>
      </motion.div>
    );
  },
);

OpportunityCard.displayName = "OpportunityCard";

const Star = ({ className }: { className: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 20 20">
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
);

