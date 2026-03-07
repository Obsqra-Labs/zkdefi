"use client";

import React from "react";
import { motion } from "framer-motion";
import { AlertCircle, Zap, Lock, Eye } from "lucide-react";
import type { Opportunity, ExecutionParams } from "@/services/types";

interface ManualModeProps {
  opportunity: Opportunity;
  parameters: ExecutionParams;
  onParametersChange: (params: ExecutionParams) => void;
  disabled: boolean;
}

export const ManualMode = React.memo(
  ({
    opportunity,
    parameters,
    onParametersChange,
    disabled,
  }: ManualModeProps) => {
    const handleAmountChange = (value: string) => {
      const amount = parseFloat(value) || 0;
      onParametersChange({
        ...parameters,
        amount: Math.max(0, amount),
      });
    };

    const handleSlippageChange = (value: string) => {
      const slippage = parseFloat(value) || 0;
      onParametersChange({
        ...parameters,
        slippage: Math.max(0, Math.min(10000, slippage)),
      });
    };

    const handlePrivacyChange = (level: "public" | "shielded" | "dark_ledger") => {
      if (opportunity.privacyModes.includes(level)) {
        onParametersChange({
          ...parameters,
          privacyLevel: level,
        });
      }
    };

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="space-y-4 mb-4"
      >
        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Amount
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={parameters.amount || ""}
              onChange={(e) => handleAmountChange(e.target.value)}
              disabled={disabled}
              placeholder="Enter amount"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-600">
              Max: 1000
            </div>
          </div>
        </div>

        {/* Slippage Tolerance */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Slippage Tolerance (bps)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={parameters.slippage || ""}
              onChange={(e) => handleSlippageChange(e.target.value)}
              disabled={disabled}
              placeholder="50"
              min="0"
              max="10000"
              step="10"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-600">
              {(parameters.slippage / 100).toFixed(2)}%
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            1 bps = 0.01% maximum loss
          </p>
        </div>

        {/* Privacy Level Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Privacy Level
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["public", "shielded", "dark_ledger"] as const).map((level) => {
              const isAvailable = opportunity.privacyModes.includes(level);
              const isSelected = parameters.privacyLevel === level;

              const icons = {
                public: <Eye className="w-4 h-4" />,
                shielded: <Lock className="w-4 h-4" />,
                dark_ledger: <Zap className="w-4 h-4" />,
              };

              const labels = {
                public: "Public",
                shielded: "Shielded",
                dark_ledger: "Dark Ledger",
              };

              const colors = {
                public: "bg-gray-100 text-gray-700 border-gray-300",
                shielded: "bg-blue-50 text-blue-700 border-blue-300",
                dark_ledger: "bg-purple-50 text-purple-700 border-purple-300",
              };

              return (
                <button
                  key={level}
                  onClick={() => handlePrivacyChange(level)}
                  disabled={!isAvailable || disabled}
                  className={`py-2 px-2 rounded-lg border-2 flex items-center justify-center gap-1 transition-colors text-xs font-medium ${
                    isSelected
                      ? colors[level]
                      : "bg-white border-gray-200 text-gray-600"
                  } ${!isAvailable ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {icons[level]}
                  {labels[level]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Warning for low privacy */}
        {parameters.privacyLevel === "public" && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Public execution exposes transaction details. Consider shielded mode for privacy.
            </p>
          </motion.div>
        )}
      </motion.div>
    );
  }
);

ManualMode.displayName = "ManualMode";
