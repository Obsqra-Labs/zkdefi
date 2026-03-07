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
} from "lucide-react";
import type { Opportunity } from "@/services/types";

interface OpportunityCardProps {
  opportunity: Opportunity;
  isRecommended: boolean;
  recommendationConfidence?: number;
  onExecute: () => void;
}

export const OpportunityCard = React.memo(
  ({
    opportunity,
    isRecommended,
    recommendationConfidence,
    onExecute,
  }: OpportunityCardProps) => {
    const getRiskColor = (score: number) => {
      if (score <= 30) return "bg-emerald-50 border-emerald-200 text-emerald-700";
      if (score <= 60) return "bg-amber-50 border-amber-200 text-amber-700";
      return "bg-rose-50 border-rose-200 text-rose-700";
    };

    const getRiskBgColor = (score: number) => {
      if (score <= 30) return "bg-emerald-100";
      if (score <= 60) return "bg-amber-100";
      return "bg-rose-100";
    };

    const getTypeIcon = (type: string) => {
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
        case "limit_orders":
          return <Target className="w-4 h-4" />;
        default:
          return <Zap className="w-4 h-4" />;
      }
    };

    const getTypeBadgeColor = (type: string) => {
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
        case "limit_orders":
          return "bg-pink-100 text-pink-700 border-pink-200";
        default:
          return "bg-gray-100 text-gray-700 border-gray-200";
      }
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="group relative bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-lg transition-all duration-300 overflow-hidden"
      >
        {/* Recommended Badge */}
        {isRecommended && (
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white px-3 py-1 flex items-center gap-2 text-xs font-semibold">
            <Star className="w-3 h-3" />
            RECOMMENDED {recommendationConfidence && `• ${Math.round(recommendationConfidence * 100)}%`}
          </div>
        )}

        <div className={`p-4 ${isRecommended ? "pt-10" : ""}`}>
          {/* Header: Name + Type Badge */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-sm mb-1">
                {opportunity.name}
              </h3>
              <p className="text-xs text-gray-500 line-clamp-2">
                {opportunity.description}
              </p>
            </div>
            <div
              className={`flex-shrink-0 ml-2 px-2 py-1 rounded border flex items-center gap-1 text-xs font-medium ${getTypeBadgeColor(opportunity.type)}`}
            >
              {getTypeIcon(opportunity.type)}
              {opportunity.type.toUpperCase()}
            </div>
          </div>

          {/* Metrics Row */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {/* Yield */}
            <div className="bg-blue-50 rounded p-2">
              <div className="text-xs text-blue-600 font-medium mb-0.5">
                APY
              </div>
              <div className="text-lg font-bold text-blue-700">
                {opportunity.currentYield.toFixed(1)}%
              </div>
            </div>

            {/* Risk Score */}
            <div className={`rounded p-2 border ${getRiskColor(opportunity.riskScore)}`}>
              <div className="text-xs font-medium mb-0.5">RISK</div>
              <div className="text-lg font-bold">
                {opportunity.riskScore}
              </div>
            </div>

            {/* TVL if available */}
            {opportunity.tvl && (
              <div className="bg-gray-50 rounded p-2">
                <div className="text-xs text-gray-600 font-medium mb-0.5">
                  TVL
                </div>
                <div className="text-lg font-bold text-gray-700">
                  ${(opportunity.tvl / 1e6).toFixed(0)}M
                </div>
              </div>
            )}
          </div>

          {/* Privacy Modes */}
          <div className="flex gap-1 mb-3">
            {opportunity.privacyModes.includes("public") && (
              <div
                title="Public"
                className="p-1.5 bg-gray-100 rounded border border-gray-200"
              >
                <Eye className="w-3 h-3 text-gray-600" />
              </div>
            )}
            {opportunity.privacyModes.includes("shielded") && (
              <div
                title="Shielded"
                className="p-1.5 bg-blue-100 rounded border border-blue-200"
              >
                <Lock className="w-3 h-3 text-blue-600" />
              </div>
            )}
            {opportunity.privacyModes.includes("dark_ledger") && (
              <div
                title="Dark Ledger"
                className="p-1.5 bg-purple-100 rounded border border-purple-200"
              >
                <Zap className="w-3 h-3 text-purple-600" />
              </div>
            )}
          </div>

          {/* Source */}
          <div className="mb-3 pb-3 border-t border-gray-100">
            <span className="inline-block text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
              {opportunity.source}
            </span>
          </div>

          {/* Execute Button */}
          <button
            onClick={onExecute}
            className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded transition-colors duration-200 flex items-center justify-center gap-2"
          >
            <Zap className="w-4 h-4" />
            Execute
          </button>
        </div>
      </motion.div>
    );
  }
);

OpportunityCard.displayName = "OpportunityCard";

const Star = ({ className }: { className: string }) => (
  <svg
    className={className}
    fill="currentColor"
    viewBox="0 0 20 20"
  >
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
);
