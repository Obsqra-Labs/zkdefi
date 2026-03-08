"use client";

import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  Zap,
} from "lucide-react";
import type {
  Opportunity,
  ExecutionParams,
  EstimatedImpact,
  TradeReceipt,
  AIExecutionRecommendation,
} from "@/services/types";
import { ManualMode } from "./ManualMode";
import { AdvisoryMode } from "./AdvisoryMode";
import { TerminalMode } from "./TerminalMode";
import { ExecutionPreview } from "./ExecutionPreview";
import { ReceiptDisplay } from "./ReceiptDisplay";

export interface ExecutionPanelProps {
  opportunity: Opportunity;
  onExecute: (receipt: TradeReceipt) => void;
  onCancel: () => void;
  userReputation?: {
    tier: "Tier1" | "Tier2" | "Tier3";
    reputationScore: number;
  };
  aiRecommendation?: AIExecutionRecommendation;
}

type ExecutionMode = "manual" | "advisory" | "terminal";

export const ExecutionPanel = React.memo(
  ({
    opportunity,
    onExecute,
    onCancel,
    userReputation = { tier: "Tier1", reputationScore: 0 },
    aiRecommendation,
  }: ExecutionPanelProps) => {
    const [mode, setMode] = useState<ExecutionMode>("manual");
    const [parameters, setParameters] = useState<ExecutionParams>({
      amount: 0,
      slippage: 50,
      privacyLevel: opportunity.privacyModes.includes("shielded")
        ? "shielded"
        : "public",
      adapterId: undefined,
    });

    const [aiRecommendationState, setAiRecommendationState] =
      useState<AIExecutionRecommendation | null>(aiRecommendation || null);
    const [estimatedImpact, setEstimatedImpact] =
      useState<EstimatedImpact | null>(null);
    const [executing, setExecuting] = useState(false);
    const [receipt, setReceipt] = useState<TradeReceipt | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Estimate impact when parameters change
    useEffect(() => {
      const estimateImpact = async () => {
        try {
          const privacyScores = {
            public: 20,
            shielded: 50,
            dark_ledger: 100,
          };

          const impact: EstimatedImpact = {
            estimatedYield: opportunity.currentYield * 0.95,
            estimatedRisk:
              opportunity.riskScore > 60
                ? "high"
                : opportunity.riskScore > 30
                  ? "medium"
                  : "low",
            slippageExposure: (parameters.slippage / 10000) * 100,
            privacyExposure: privacyScores[parameters.privacyLevel],
            reputationImpact: mode === "terminal" ? -5 : 0,
            confidence: 85,
          };

          setEstimatedImpact(impact);
          setError(null);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          setError(message);
        }
      };

      if (parameters.amount > 0) {
        estimateImpact();
      }
    }, [parameters, opportunity, mode]);

    // Handle mode change
    const handleModeChange = useCallback(
      (newMode: ExecutionMode) => {
        if (newMode === "terminal" && userReputation.tier !== "Tier3") {
          setError("Terminal mode requires Tier3 reputation");
          return;
        }
        setMode(newMode);
        setError(null);
      },
      [userReputation.tier]
    );

    // Handle execution
    const handleExecute = useCallback(async () => {
      if (!parameters.amount || parameters.amount <= 0) {
        setError("Amount must be greater than 0");
        return;
      }

      if (!estimatedImpact) {
        setError("Impact estimate not available");
        return;
      }

      setExecuting(true);
      setError(null);

      try {
        const mockReceipt: TradeReceipt = {
          id: `trade-${Date.now()}`,
          type: (opportunity.type === "staking" ? "swap" : opportunity.type) as any,
          status: "executed",
          executedAt: new Date().toISOString(),
          adapter: opportunity.source,
          transactionHash: `0x${Math.random().toString(16).slice(2)}`,
          details: {
            opportunity: opportunity.name,
            parameters,
            impact: estimatedImpact,
          },
        };

        setReceipt(mockReceipt);
        onExecute(mockReceipt);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Execution failed";
        setError(message);
      } finally {
        setExecuting(false);
      }
    }, [parameters, estimatedImpact, opportunity, onExecute]);

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="bg-white rounded-lg border border-gray-200 shadow-lg p-6 max-w-2xl"
      >
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">
            Execute: {opportunity.name}
          </h2>
          <p className="text-sm text-gray-600 mt-1">{opportunity.description}</p>
        </div>

        {/* Mode Selector */}
        <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-lg">
          <ModeButton
            mode="manual"
            currentMode={mode}
            onClick={() => handleModeChange("manual")}
            label="Manual"
            disabled={executing}
          />
          <ModeButton
            mode="advisory"
            currentMode={mode}
            onClick={() => handleModeChange("advisory")}
            label="Advisory"
            disabled={executing || !aiRecommendationState}
          />
          <ModeButton
            mode="terminal"
            currentMode={mode}
            onClick={() => handleModeChange("terminal")}
            label="Terminal"
            disabled={executing || userReputation.tier !== "Tier3"}
          />
        </div>

        {/* Error Display */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2"
          >
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </motion.div>
        )}

        {/* Mode-Specific Content */}
        <AnimatePresence mode="wait">
          {mode === "manual" && (
            <ManualMode
              key="manual"
              opportunity={opportunity}
              parameters={parameters}
              onParametersChange={setParameters}
              disabled={executing}
            />
          )}

          {mode === "advisory" && aiRecommendationState && (
            <AdvisoryMode
              key="advisory"
              opportunity={opportunity}
              recommendation={aiRecommendationState}
              parameters={parameters}
              onParametersChange={setParameters}
              disabled={executing}
            />
          )}

          {mode === "terminal" && (
            <TerminalMode
              key="terminal"
              opportunity={opportunity}
              userReputation={userReputation}
              disabled={executing}
            />
          )}
        </AnimatePresence>

        {/* Impact Preview */}
        {estimatedImpact && (
          <ExecutionPreview
            impact={estimatedImpact}
            privacyLevel={parameters.privacyLevel}
            userTier={userReputation.tier}
          />
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={onCancel}
            disabled={executing}
            className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExecute}
            disabled={executing || !parameters.amount || !estimatedImpact}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {executing && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {executing ? "Executing..." : "Execute"}
          </button>
        </div>

        {/* Receipt Display */}
        {receipt && <ReceiptDisplay receipt={receipt} />}
      </motion.div>
    );
  }
);

ExecutionPanel.displayName = "ExecutionPanel";

const ModeButton = ({
  mode,
  currentMode,
  onClick,
  label,
  disabled,
}: {
  mode: ExecutionMode;
  currentMode: ExecutionMode;
  onClick: () => void;
  label: string;
  disabled: boolean;
}) => {
  const isActive = mode === currentMode;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 py-2 px-3 rounded font-medium text-sm transition-colors ${
        isActive
          ? "bg-white text-blue-600 shadow-sm"
          : "bg-transparent text-gray-700 hover:text-gray-900"
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
};
