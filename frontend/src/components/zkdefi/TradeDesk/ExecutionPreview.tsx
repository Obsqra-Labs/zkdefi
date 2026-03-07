"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  AlertTriangle,
  Eye,
  Lock,
  Zap,
  Shield,
} from "lucide-react";
import type { EstimatedImpact } from "@/services/types";

interface ExecutionPreviewProps {
  impact: EstimatedImpact;
  privacyLevel: "public" | "shielded" | "dark_ledger";
  userTier: "Tier1" | "Tier2" | "Tier3";
}

export const ExecutionPreview = React.memo(
  ({ impact, privacyLevel, userTier }: ExecutionPreviewProps) => {
    const riskColor = {
      low: "text-emerald-600 bg-emerald-50",
      medium: "text-amber-600 bg-amber-50",
      high: "text-rose-600 bg-rose-50",
    }[impact.estimatedRisk];

    const riskBorderColor = {
      low: "border-emerald-200",
      medium: "border-amber-200",
      high: "border-rose-200",
    }[impact.estimatedRisk];

    const privacyIcons = {
      public: { icon: Eye, color: "text-gray-600", label: "Public" },
      shielded: { icon: Lock, color: "text-blue-600", label: "Shielded" },
      dark_ledger: {
        icon: Zap,
        color: "text-purple-600",
        label: "Dark Ledger",
      },
    };

    const PrivacyIcon = privacyIcons[privacyLevel].icon;

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`p-4 border-2 ${riskBorderColor} rounded-lg bg-gray-50 mb-4`}
      >
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Execution Preview
        </h3>

        <div className="grid grid-cols-2 gap-3 mb-3">
          {/* Yield Impact */}
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <p className="text-xs font-medium text-blue-600">Yield Impact</p>
            </div>
            <p className="text-lg font-bold text-blue-900">
              {impact.estimatedYield.toFixed(2)}%
            </p>
            <p className="text-xs text-blue-600 mt-0.5">APY</p>
          </div>

          {/* Risk Level */}
          <div
            className={`p-3 rounded-lg border-2 ${riskColor} ${riskBorderColor}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4" />
              <p className="text-xs font-medium">Risk Level</p>
            </div>
            <p className="text-lg font-bold capitalize">
              {impact.estimatedRisk}
            </p>
            <p className="text-xs mt-0.5">Score: {impact.confidence}</p>
          </div>

          {/* Slippage Exposure */}
          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
            <p className="text-xs font-medium text-amber-600 mb-1">
              Slippage Exposure
            </p>
            <p className="text-lg font-bold text-amber-900">
              {impact.slippageExposure.toFixed(3)}%
            </p>
            <p className="text-xs text-amber-600 mt-0.5">Max loss</p>
          </div>

          {/* Privacy Exposure */}
          <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex items-center gap-2 mb-1">
              <PrivacyIcon
                className={`w-4 h-4 ${privacyIcons[privacyLevel].color}`}
              />
              <p className="text-xs font-medium text-purple-600">
                Privacy Exposure
              </p>
            </div>
            <p className="text-lg font-bold text-purple-900">
              {impact.privacyExposure}
            </p>
            <p className="text-xs text-purple-600 mt-0.5">
              {privacyIcons[privacyLevel].label}
            </p>
          </div>
        </div>

        {/* Reputation Impact */}
        {impact.reputationImpact !== undefined && impact.reputationImpact !== 0 && (
          <div className="p-3 bg-white border border-gray-200 rounded-lg flex items-center gap-3">
            <Shield
              className={`w-4 h-4 ${
                impact.reputationImpact > 0
                  ? "text-emerald-600"
                  : "text-rose-600"
              }`}
            />
            <div>
              <p className="text-xs font-medium text-gray-700">
                Reputation Impact
              </p>
              <p
                className={`text-sm font-bold ${
                  impact.reputationImpact > 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }`}
              >
                {impact.reputationImpact > 0 ? "+" : ""}
                {impact.reputationImpact}
                points
              </p>
            </div>
          </div>
        )}

        {/* Confidence Meter */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-gray-700">
              Estimate Confidence
            </p>
            <p className="text-xs font-bold text-gray-900">{impact.confidence}%</p>
          </div>
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${impact.confidence}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="h-full bg-blue-600"
            />
          </div>
        </div>
      </motion.div>
    );
  }
);

ExecutionPreview.displayName = "ExecutionPreview";
