"use client";

import React from "react";
import { motion } from "framer-motion";
import { Lightbulb, Zap, Lock, Eye, TrendingUp } from "lucide-react";
import type {
  Opportunity,
  ExecutionParams,
  AIExecutionRecommendation,
} from "@/services/types";

interface AdvisoryModeProps {
  opportunity: Opportunity;
  recommendation: AIExecutionRecommendation;
  parameters: ExecutionParams;
  onParametersChange: (params: ExecutionParams) => void;
  disabled: boolean;
}

export const AdvisoryMode = React.memo(
  ({
    opportunity,
    recommendation,
    parameters,
    onParametersChange,
    disabled,
  }: AdvisoryModeProps) => {
    const handleApplyRecommendation = () => {
      onParametersChange({
        amount: recommendation.recommendedAmount,
        slippage: recommendation.recommendedSlippage,
        privacyLevel: recommendation.recommendedPrivacyLevel,
        adapterId: parameters.adapterId,
      });
    };

    const confidenceColor =
      recommendation.confidence >= 80
        ? "text-emerald-600 bg-emerald-50"
        : recommendation.confidence >= 60
          ? "text-amber-600 bg-amber-50"
          : "text-rose-600 bg-rose-50";

    const privacyIcons = {
      public: <Eye className="w-4 h-4" />,
      shielded: <Lock className="w-4 h-4" />,
      dark_ledger: <Zap className="w-4 h-4" />,
    };

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="space-y-4 mb-4"
      >
        {/* AI Recommendation Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-blue-50 border border-blue-200 rounded-lg"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Lightbulb className="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-blue-900">AI Recommendation</h3>
              <p className="text-sm text-blue-700">{recommendation.action}</p>
            </div>
            <div
              className={`px-3 py-1 rounded-full text-xs font-bold ${confidenceColor}`}
            >
              {Math.round(recommendation.confidence * 100)}%
            </div>
          </div>

          {/* Reasoning */}
          <p className="text-sm text-blue-800 mb-4">{recommendation.reasoning}</p>

          {/* Recommended Parameters */}
          <div className="grid grid-cols-3 gap-2 mb-4 pb-4 border-t border-blue-200">
            <div className="pt-2">
              <p className="text-xs text-blue-600 font-medium">
                Recommended Amount
              </p>
              <p className="text-lg font-bold text-blue-900">
                {recommendation.recommendedAmount}
              </p>
            </div>
            <div className="pt-2">
              <p className="text-xs text-blue-600 font-medium">
                Recommended Slippage
              </p>
              <p className="text-lg font-bold text-blue-900">
                {(recommendation.recommendedSlippage / 100).toFixed(2)}%
              </p>
            </div>
            <div className="pt-2">
              <p className="text-xs text-blue-600 font-medium">
                Recommended Privacy
              </p>
              <div className="flex items-center gap-1">
                {privacyIcons[recommendation.recommendedPrivacyLevel]}
                <span className="text-sm font-bold text-blue-900">
                  {recommendation.recommendedPrivacyLevel
                    .charAt(0)
                    .toUpperCase() +
                    recommendation.recommendedPrivacyLevel.slice(1)}
                </span>
              </div>
            </div>
          </div>

          {/* Expected Yield */}
          <div className="flex items-center gap-2 pt-2 border-t border-blue-200">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <span className="text-sm text-blue-700">
              Expected yield:{" "}
              <span className="font-semibold">
                {recommendation.expectedYield.toFixed(2)}%
              </span>
            </span>
          </div>
        </motion.div>

        {/* Apply/Override Section */}
        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-600 mb-2 font-medium">
            Use recommendation or adjust below
          </p>
          <button
            onClick={handleApplyRecommendation}
            disabled={disabled}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded transition-colors disabled:opacity-50"
          >
            Apply Recommendation
          </button>
        </div>

        {/* Override Controls */}
        <div className="space-y-3 p-3 border border-gray-200 rounded-lg bg-white">
          <p className="text-xs font-medium text-gray-700">
            Or customize parameters:
          </p>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">
              Amount
            </label>
            <input
              type="number"
              value={parameters.amount || ""}
              onChange={(e) =>
                onParametersChange({
                  ...parameters,
                  amount: parseFloat(e.target.value) || 0,
                })
              }
              disabled={disabled}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">
              Slippage (bps)
            </label>
            <input
              type="number"
              value={parameters.slippage || ""}
              onChange={(e) =>
                onParametersChange({
                  ...parameters,
                  slippage: parseFloat(e.target.value) || 0,
                })
              }
              disabled={disabled}
              min="0"
              max="10000"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-2">
              Privacy Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["public", "shielded", "dark_ledger"] as const).map((level) => (
                <button
                  key={level}
                  onClick={() =>
                    onParametersChange({
                      ...parameters,
                      privacyLevel: level,
                    })
                  }
                  disabled={
                    !opportunity.privacyModes.includes(level) || disabled
                  }
                  className={`py-2 px-2 rounded text-xs font-medium flex items-center justify-center gap-1 transition-colors ${
                    parameters.privacyLevel === level
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  } disabled:opacity-50`}
                >
                  {privacyIcons[level]}
                  {level === "dark_ledger"
                    ? "Dark"
                    : level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    );
  }
);

AdvisoryMode.displayName = "AdvisoryMode";
