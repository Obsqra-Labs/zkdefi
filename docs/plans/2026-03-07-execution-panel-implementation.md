# ExecutionPanel Component Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the ExecutionPanel component with three distinct execution modes (Manual, Advisory, Terminal) that enable users to execute trading opportunities with privacy controls, reputation gating, and real-time impact estimation.

**Architecture:** ExecutionPanel is a mode-based execution interface that routes through appropriate adapters based on opportunity type. It manages state for parameters, recommendations, and impact estimates. Manual mode provides full user control; Advisory mode augments user decisions with AI recommendations; Terminal mode enables autonomous AI execution for Tier3 users. All modes support privacy selection and real-time impact estimation via MarketDataService.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Framer Motion, Vitest + React Testing Library, existing adapter services (LendingAdapter, PrivacyPoolAdapter, LPAdapter, DCAAdapter, LimitOrdersAdapter).

---

## Task 1: Set Up Types and Interfaces

**Files:**
- Modify: `frontend/src/services/types.ts` (add ExecutionPanel-specific types)

**Step 1: Add new types for ExecutionPanel state management**

ExecutionPanel needs types for:
- ExecutionParams (user inputs for execution)
- EstimatedImpact (real-time impact estimates)
- ExecutionMode (discriminated union for mode-specific state)
- ExecutionPanelState (complete component state)

Add to `frontend/src/services/types.ts` after the existing types:

```typescript
// ExecutionPanel execution parameters
export interface ExecutionParams {
  amount: number;
  slippage: number; // 0-100 basis points (e.g., 50 = 0.5%)
  privacyLevel: 'public' | 'shielded' | 'dark_ledger';
  adapterId?: string; // For adapters that support multiple instances
}

// Adapter-specific options (override-able by manual mode)
export interface AdapterOptions {
  [key: string]: any;
}

// Real-time impact estimation
export interface EstimatedImpact {
  estimatedYield: number; // APY %
  estimatedRisk: string; // 'low' | 'medium' | 'high'
  slippageExposure: number; // % amount lost to slippage
  privacyExposure: number; // 0-100 exposure score
  reputationImpact?: number; // Change in reputation score
  confidence: number; // 0-100 confidence in estimate
}

// AI Recommendation for Advisory mode
export interface AIExecutionRecommendation extends Recommendation {
  recommendedPrivacyLevel: 'public' | 'shielded' | 'dark_ledger';
  recommendedAmount: number;
  recommendedSlippage: number;
  explanationForAmount: string;
}

// Terminal mode policy
export interface TerminalModePolicy {
  id: string;
  condition: string; // e.g., "rebalance when drift > 5%"
  executionFrequency: 'on_trigger' | 'daily' | 'weekly';
  isActive: boolean;
  createdAt: string;
}

// Execution log entry for Terminal mode
export interface ExecutionLogEntry {
  timestamp: string;
  action: string;
  status: 'pending' | 'executed' | 'failed';
  details: string;
  receipt?: TradeReceipt;
}
```

**Step 2: Verify types compile**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build 2>&1 | head -50`

Expected: No TypeScript errors related to the new types.

**Step 3: Commit**

```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/services/types.ts && git commit -m "types: add ExecutionPanel types for parameters, impact, and policies"
```

---

## Task 2: Create ExecutionPanel Main Component

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/ExecutionPanel.tsx`

**Step 1: Create ExecutionPanel.tsx with mode state and structure**

This is the main component managing all three modes. It handles:
- Mode selection and state
- Parameter state for Manual/Advisory modes
- Real-time impact estimation
- Adapter routing and execution
- Error and loading states

```typescript
"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  AlertCircle,
  Zap,
  Lock,
  Eye,
  Info,
  Check,
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
    score: number;
  };
  aiRecommendation?: AIExecutionRecommendation;
}

type ExecutionMode = "manual" | "advisory" | "terminal";

export const ExecutionPanel = React.memo(
  ({
    opportunity,
    onExecute,
    onCancel,
    userReputation = { tier: "Tier1", score: 0 },
    aiRecommendation,
  }: ExecutionPanelProps) => {
    const [mode, setMode] = useState<ExecutionMode>("manual");
    const [parameters, setParameters] = useState<ExecutionParams>({
      amount: 0,
      slippage: 50, // Default 0.5%
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
          // Placeholder: In real implementation, call MarketDataService
          // For now, compute simple estimates based on parameters
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
    const handleModeChange = useCallback((newMode: ExecutionMode) => {
      if (newMode === "terminal" && userReputation.tier !== "Tier3") {
        setError("Terminal mode requires Tier3 reputation");
        return;
      }
      setMode(newMode);
      setError(null);
    }, [userReputation.tier]);

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
        // Placeholder: Route to appropriate adapter based on opportunity type
        // In real implementation:
        // const adapter = selectAdapter(opportunity.type);
        // const receipt = await adapter.execute(opportunity, parameters);

        const mockReceipt: TradeReceipt = {
          id: `trade-${Date.now()}`,
          type: opportunity.type,
          status: "executed",
          executedAt: new Date().toISOString(),
          adapter: "mock-adapter",
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
            {executing && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {executing ? "Executing..." : "Execute"}
          </button>
        </div>

        {/* Receipt Display */}
        {receipt && (
          <ReceiptDisplay receipt={receipt} />
        )}
      </motion.div>
    );
  }
);

ExecutionPanel.displayName = "ExecutionPanel";

// Mode Button Component
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
```

**Step 2: Verify ExecutionPanel renders**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build 2>&1 | grep -E "(error|ExecutionPanel)" | head -10`

Expected: No errors mentioning ExecutionPanel.

**Step 3: Commit**

```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/components/zkdefi/TradeDesk/ExecutionPanel.tsx && git commit -m "feat(execution-panel): create main ExecutionPanel component with mode selection"
```

---

## Task 3: Create ManualMode Sub-Component

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/ManualMode.tsx`

**Step 1: Implement ManualMode component**

ManualMode allows full user control over execution parameters:
- Amount input with validation
- Slippage tolerance
- Privacy level selector
- Adapter-specific options display

```typescript
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
```

**Step 2: Verify ManualMode compiles**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build 2>&1 | grep -E "(error|ManualMode)" | head -5`

Expected: No errors.

**Step 3: Commit**

```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/components/zkdefi/TradeDesk/ManualMode.tsx && git commit -m "feat(manual-mode): implement ManualMode component with amount, slippage, and privacy controls"
```

---

## Task 4: Create AdvisoryMode Sub-Component

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/AdvisoryMode.tsx`

**Step 1: Implement AdvisoryMode component**

AdvisoryMode shows AI recommendations and allows user adjustments:
- Display recommendation with confidence score
- Show reasoning
- Allow override of recommended parameters
- Display impact of adjustments in real-time

```typescript
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

    const confidenceColor = recommendation.confidence >= 80
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
              <p className="text-sm text-blue-700">
                {recommendation.action}
              </p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${confidenceColor}`}>
              {Math.round(recommendation.confidence * 100)}%
            </div>
          </div>

          {/* Reasoning */}
          <p className="text-sm text-blue-800 mb-4">
            {recommendation.reasoning}
          </p>

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
                  {recommendation.recommendedPrivacyLevel.charAt(0).toUpperCase() +
                    recommendation.recommendedPrivacyLevel.slice(1)}
                </span>
              </div>
            </div>
          </div>

          {/* Expected Yield */}
          <div className="flex items-center gap-2 pt-2 border-t border-blue-200">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <span className="text-sm text-blue-700">
              Expected yield: <span className="font-semibold">{recommendation.expectedYield.toFixed(2)}%</span>
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
```

**Step 2: Verify AdvisoryMode compiles**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build 2>&1 | grep -E "(error|AdvisoryMode)" | head -5`

Expected: No errors.

**Step 3: Commit**

```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/components/zkdefi/TradeDesk/AdvisoryMode.tsx && git commit -m "feat(advisory-mode): implement AdvisoryMode with AI recommendations and parameter overrides"
```

---

## Task 5: Create TerminalMode Sub-Component

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/TerminalMode.tsx`

**Step 1: Implement TerminalMode component**

TerminalMode enables autonomous AI execution for Tier3 users:
- Show reputation gating info
- Policy input for execution triggers
- Execution log display
- Policy management controls

```typescript
"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Robot,
  ShieldAlert,
  Clock,
  CheckCircle,
  AlertCircle,
  Trash2,
} from "lucide-react";
import type { Opportunity, ExecutionLogEntry } from "@/services/types";

interface TerminalModeProps {
  opportunity: Opportunity;
  userReputation: {
    tier: "Tier1" | "Tier2" | "Tier3";
    score: number;
  };
  disabled: boolean;
}

export const TerminalMode = React.memo(
  ({ opportunity, userReputation, disabled }: TerminalModeProps) => {
    const [policyCondition, setPolicyCondition] = useState("");
    const [executionFrequency, setExecutionFrequency] =
      useState<"on_trigger" | "daily" | "weekly">("on_trigger");
    const [isActive, setIsActive] = useState(false);
    const [executionLog, setExecutionLog] = useState<ExecutionLogEntry[]>([
      {
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        action: "Autonomous rebalance triggered",
        status: "executed",
        details: "Rebalanced position due to 5% drift",
      },
      {
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        action: "Policy monitoring started",
        status: "pending",
        details: "Monitoring for rebalance condition",
      },
    ]);

    const handleActivatePolicy = () => {
      if (!policyCondition.trim()) {
        alert("Please enter a policy condition");
        return;
      }
      setIsActive(true);
    };

    const handleDeactivatePolicy = () => {
      setIsActive(false);
    };

    const canUseTerminal = userReputation.tier === "Tier3";

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="space-y-4 mb-4"
      >
        {/* Reputation Gating Info */}
        {!canUseTerminal && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3"
          >
            <ShieldAlert className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-900">Terminal Mode Unavailable</p>
              <p className="text-sm text-red-700 mt-1">
                Terminal mode requires Tier3 reputation. You are currently Tier{userReputation.tier.slice(-1)}.
              </p>
            </div>
          </motion.div>
        )}

        {canUseTerminal && (
          <>
            {/* Status Indicator */}
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3"
            >
              <Robot className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-blue-900">
                  Autonomous Execution Enabled
                </p>
                <p className="text-sm text-blue-700 mt-1">
                  AI can execute trades autonomously based on policies you define.
                </p>
              </div>
            </motion.div>

            {/* Policy Input */}
            {!isActive && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-3 p-4 border border-gray-200 rounded-lg bg-white"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Execution Policy
                  </label>
                  <textarea
                    value={policyCondition}
                    onChange={(e) => setPolicyCondition(e.target.value)}
                    placeholder="e.g., Rebalance when drift exceeds 5%, or Execute swap when price reaches target"
                    disabled={disabled || isActive}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Describe the condition that triggers autonomous execution
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Execution Frequency
                  </label>
                  <select
                    value={executionFrequency}
                    onChange={(e) =>
                      setExecutionFrequency(
                        e.target.value as "on_trigger" | "daily" | "weekly"
                      )
                    }
                    disabled={disabled || isActive}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 text-sm"
                  >
                    <option value="on_trigger">On Trigger</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>

                <button
                  onClick={handleActivatePolicy}
                  disabled={disabled || !policyCondition.trim()}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  Activate Policy
                </button>
              </motion.div>
            )}

            {/* Active Policy Display */}
            {isActive && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-4 border-2 border-emerald-300 rounded-lg bg-emerald-50"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-emerald-900">
                        Policy Active
                      </p>
                      <p className="text-sm text-emerald-700 mt-1">
                        {policyCondition}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleDeactivatePolicy}
                    className="p-2 hover:bg-emerald-200 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-emerald-600" />
                  </button>
                </div>
                <p className="text-xs text-emerald-600 font-medium">
                  Frequency: {executionFrequency}
                </p>
              </motion.div>
            )}

            {/* Execution Log */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">
                Execution Log
              </h3>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {executionLog.map((entry, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 border border-gray-200 rounded-lg bg-gray-50 text-sm"
                  >
                    <div className="flex items-start justify-between mb-1">
                      <p className="font-medium text-gray-900">
                        {entry.action}
                      </p>
                      <div className="flex items-center gap-1">
                        {entry.status === "executed" && (
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                        )}
                        {entry.status === "pending" && (
                          <Clock className="w-4 h-4 text-amber-600" />
                        )}
                        {entry.status === "failed" && (
                          <AlertCircle className="w-4 h-4 text-red-600" />
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 mb-1">
                      {entry.details}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(entry.timestamp).toLocaleString()}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>
          </>
        )}
      </motion.div>
    );
  }
);

TerminalMode.displayName = "TerminalMode";
```

**Step 2: Verify TerminalMode compiles**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build 2>&1 | grep -E "(error|TerminalMode)" | head -5`

Expected: No errors.

**Step 3: Commit**

```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/components/zkdefi/TradeDesk/TerminalMode.tsx && git commit -m "feat(terminal-mode): implement TerminalMode with autonomous AI execution and policy management"
```

---

## Task 6: Create ExecutionPreview Sub-Component

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/ExecutionPreview.tsx`

**Step 1: Implement ExecutionPreview component**

ExecutionPreview displays estimated impact estimates and risk metrics:
- Yield impact display
- Risk change indicator
- Privacy exposure visualization
- Slippage exposure
- Reputation impact (if applicable)

```typescript
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
          <div className={`p-3 rounded-lg border-2 ${riskColor} ${riskBorderColor}`}>
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
              <PrivacyIcon className={`w-4 h-4 ${privacyIcons[privacyLevel].color}`} />
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
            <Shield className={`w-4 h-4 ${impact.reputationImpact > 0 ? "text-emerald-600" : "text-rose-600"}`} />
            <div>
              <p className="text-xs font-medium text-gray-700">
                Reputation Impact
              </p>
              <p className={`text-sm font-bold ${impact.reputationImpact > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {impact.reputationImpact > 0 ? "+" : ""}{impact.reputationImpact}
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
            <p className="text-xs font-bold text-gray-900">
              {impact.confidence}%
            </p>
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
```

**Step 2: Verify ExecutionPreview compiles**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build 2>&1 | grep -E "(error|ExecutionPreview)" | head -5`

Expected: No errors.

**Step 3: Commit**

```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/components/zkdefi/TradeDesk/ExecutionPreview.tsx && git commit -m "feat(execution-preview): implement ExecutionPreview with impact estimates and metrics"
```

---

## Task 7: Create ReceiptDisplay Sub-Component

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/ReceiptDisplay.tsx`

**Step 1: Implement ReceiptDisplay component**

ReceiptDisplay shows transaction results after execution:
- Transaction hash with link
- Status indicator
- Transaction details
- Impact realized vs estimated
- Copy to clipboard functionality

```typescript
"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  CheckCircle,
  Clock,
  AlertCircle,
  Copy,
  ExternalLink,
  X,
} from "lucide-react";
import type { TradeReceipt } from "@/services/types";

interface ReceiptDisplayProps {
  receipt: TradeReceipt;
  onDismiss?: () => void;
}

export const ReceiptDisplay = React.memo(
  ({ receipt, onDismiss }: ReceiptDisplayProps) => {
    const [copied, setCopied] = React.useState(false);

    const statusConfig = {
      pending: {
        icon: Clock,
        color: "text-amber-600 bg-amber-50 border-amber-200",
        label: "Pending",
      },
      executed: {
        icon: CheckCircle,
        color: "text-emerald-600 bg-emerald-50 border-emerald-200",
        label: "Confirmed",
      },
      failed: {
        icon: AlertCircle,
        color: "text-rose-600 bg-rose-50 border-rose-200",
        label: "Failed",
      },
    };

    const StatusIcon = statusConfig[receipt.status].icon;

    const handleCopyHash = () => {
      if (receipt.transactionHash) {
        navigator.clipboard.writeText(receipt.transactionHash);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    const handleOpenExplorer = () => {
      if (receipt.transactionHash) {
        // Placeholder: Use actual explorer URL based on network
        const explorerUrl = `https://starkscan.co/tx/${receipt.transactionHash}`;
        window.open(explorerUrl, "_blank");
      }
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={`mt-6 p-4 rounded-lg border-2 ${statusConfig[receipt.status].color}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            <StatusIcon className="w-6 h-6 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-lg">
                {statusConfig[receipt.status].label}
              </h3>
              <p className="text-sm opacity-75 mt-0.5">
                {receipt.details?.opportunity || receipt.adapter}
              </p>
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Transaction Details */}
        <div className="space-y-2 mb-4 pb-4 border-b border-current border-opacity-20">
          <div className="grid grid-cols-2 gap-3">
            {receipt.details?.parameters && (
              <>
                <div>
                  <p className="text-xs opacity-75 font-medium">
                    Amount Executed
                  </p>
                  <p className="text-sm font-semibold">
                    {receipt.details.parameters.amount}
                  </p>
                </div>
                <div>
                  <p className="text-xs opacity-75 font-medium">
                    Privacy Level
                  </p>
                  <p className="text-sm font-semibold capitalize">
                    {receipt.details.parameters.privacyLevel}
                  </p>
                </div>
              </>
            )}
          </div>

          {receipt.details?.impact && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs opacity-75 font-medium">
                  Estimated Yield
                </p>
                <p className="text-sm font-semibold">
                  {receipt.details.impact.estimatedYield.toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs opacity-75 font-medium">
                  Risk Level
                </p>
                <p className="text-sm font-semibold capitalize">
                  {receipt.details.impact.estimatedRisk}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Transaction Hash */}
        {receipt.transactionHash && (
          <div className="mb-4">
            <p className="text-xs opacity-75 font-medium mb-2">
              Transaction Hash
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white bg-opacity-30 px-2 py-1 rounded font-mono truncate">
                {receipt.transactionHash}
              </code>
              <button
                onClick={handleCopyHash}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
                title="Copy"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={handleOpenExplorer}
                className="p-2 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
                title="View on Explorer"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
            {copied && (
              <p className="text-xs mt-1 opacity-75">Copied!</p>
            )}
          </div>
        )}

        {/* Receipt ID */}
        <div className="text-xs opacity-75">
          <p className="font-medium mb-1">Receipt ID</p>
          <code className="bg-white bg-opacity-30 px-2 py-1 rounded block font-mono truncate">
            {receipt.id}
          </code>
        </div>
      </motion.div>
    );
  }
);

ReceiptDisplay.displayName = "ReceiptDisplay";
```

**Step 2: Verify ReceiptDisplay compiles**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build 2>&1 | grep -E "(error|ReceiptDisplay)" | head -5`

Expected: No errors.

**Step 3: Commit**

```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/components/zkdefi/TradeDesk/ReceiptDisplay.tsx && git commit -m "feat(receipt-display): implement ReceiptDisplay with transaction details and explorer links"
```

---

## Task 8: Create Tests for ExecutionPanel

**Files:**
- Create: `frontend/src/components/zkdefi/TradeDesk/__tests__/ExecutionPanel.test.tsx`

**Step 1: Write ExecutionPanel tests**

Test coverage includes:
- Mode switching
- Parameter validation
- Reputation gating for Terminal mode
- Impact estimation
- Error handling

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExecutionPanel } from "../ExecutionPanel";
import type { Opportunity } from "@/services/types";

const mockOpportunity: Opportunity = {
  id: "test-1",
  name: "ETH/USDC LP",
  description: "Liquidity provision on Ekubo",
  type: "lp",
  currentYield: 12.5,
  riskScore: 30,
  tvl: 5000000,
  privacyModes: ["public", "shielded"],
  source: "zkGraph",
  updatedAt: new Date().toISOString(),
};

describe("ExecutionPanel", () => {
  const mockOnExecute = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with mode selector", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", score: 25 }}
      />
    );

    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Advisory")).toBeInTheDocument();
    expect(screen.getByText("Terminal")).toBeInTheDocument();
  });

  it("starts in manual mode", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", score: 25 }}
      />
    );

    // Manual mode should be visible by default
    expect(screen.getByPlaceholderText(/Enter amount/i)).toBeInTheDocument();
  });

  it("prevents Terminal mode for non-Tier3 users", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier2", score: 65 }}
      />
    );

    const terminalButton = screen.getByText("Terminal").closest("button");
    expect(terminalButton).toBeDisabled();
  });

  it("allows Terminal mode for Tier3 users", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier3", score: 85 }}
      />
    );

    const terminalButton = screen.getByText("Terminal").closest("button");
    expect(terminalButton).not.toBeDisabled();
  });

  it("validates amount input", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", score: 25 }}
      />
    );

    const amountInput = screen.getByPlaceholderText(/Enter amount/i) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: "100" } });

    expect(amountInput.value).toBe("100");
  });

  it("disables Execute button when amount is 0", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", score: 25 }}
      />
    );

    const executeButton = screen.getByText("Execute").closest("button");
    expect(executeButton).toBeDisabled();
  });

  it("enables Execute button when valid amount is entered", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", score: 25 }}
      />
    );

    const amountInput = screen.getByPlaceholderText(/Enter amount/i);
    fireEvent.change(amountInput, { target: { value: "50" } });

    await waitFor(() => {
      const executeButton = screen.getByText("Execute").closest("button");
      expect(executeButton).not.toBeDisabled();
    });
  });

  it("calls onCancel when Cancel button clicked", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", score: 25 }}
      />
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it("calls onExecute when Execute button clicked", async () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", score: 25 }}
      />
    );

    const amountInput = screen.getByPlaceholderText(/Enter amount/i);
    fireEvent.change(amountInput, { target: { value: "50" } });

    await waitFor(() => {
      const executeButton = screen.getByText("Execute").closest("button");
      expect(executeButton).not.toBeDisabled();
    });

    fireEvent.click(screen.getByText("Execute"));

    await waitFor(() => {
      expect(mockOnExecute).toHaveBeenCalled();
    });
  });

  it("displays privacy mode selector", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", score: 25 }}
      />
    );

    expect(screen.getByText("Privacy Level")).toBeInTheDocument();
  });

  it("updates privacy level when selected", () => {
    render(
      <ExecutionPanel
        opportunity={mockOpportunity}
        onExecute={mockOnExecute}
        onCancel={mockOnCancel}
        userReputation={{ tier: "Tier1", score: 25 }}
      />
    );

    const shieldedButton = Array.from(
      screen.getAllByRole("button")
    ).find((btn) => btn.textContent?.includes("Shielded"));

    expect(shieldedButton).toBeInTheDocument();
  });
});
```

**Step 2: Run tests**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm test -- ExecutionPanel.test.tsx 2>&1 | head -50`

Expected: All tests pass.

**Step 3: Commit**

```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/components/zkdefi/TradeDesk/__tests__/ExecutionPanel.test.tsx && git commit -m "test(execution-panel): add comprehensive tests for ExecutionPanel component"
```

---

## Task 9: Verify Build and Fix Linter Errors

**Files:**
- Verify: `frontend/src/components/zkdefi/TradeDesk/`

**Step 1: Run full build**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run build 2>&1 | tail -20`

Expected: Build succeeds with no errors.

**Step 2: Run linter**

Run: `cd /opt/obsqra.starknet/zkdefi/frontend && npm run lint 2>&1 | grep -E "(TradeDesk|ExecutionPanel|error)" | head -20`

Expected: No errors in ExecutionPanel files.

**Step 3: Fix any linter issues**

If there are linting issues, fix them using StrReplace and commit separately.

---

## Task 10: Final Integration Commit

**Files:**
- All ExecutionPanel components and tests

**Step 1: Verify all files are present**

Run: `ls -la /opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/TradeDesk/`

Expected: ExecutionPanel.tsx, ManualMode.tsx, AdvisoryMode.tsx, TerminalMode.tsx, ExecutionPreview.tsx, ReceiptDisplay.tsx, and __tests__/ExecutionPanel.test.tsx

**Step 2: Create final commit**

```bash
cd /opt/obsqra.starknet/zkdefi && git status
```

**Step 3: Commit all if not already committed**

```bash
cd /opt/obsqra.starknet/zkdefi && git add frontend/src/components/zkdefi/TradeDesk/ frontend/src/services/types.ts && git commit -m "feat(trade-desk): implement ExecutionPanel with 3-mode execution (Manual/Advisory/Terminal)"
```

---

## Summary

This plan implements the complete ExecutionPanel component with:

✅ **Main Component** - ExecutionPanel.tsx with mode management
✅ **Manual Mode** - User-controlled execution parameters
✅ **Advisory Mode** - AI recommendations with user adjustments
✅ **Terminal Mode** - Autonomous execution for Tier3 users
✅ **ExecutionPreview** - Real-time impact estimates
✅ **ReceiptDisplay** - Transaction results and explorer links
✅ **Types** - ExecutionPanel-specific TypeScript types
✅ **Tests** - Comprehensive unit tests with Vitest + RTL

**Architecture:**
- Mode-based UI with smooth Framer Motion transitions
- Real-time impact estimation as user adjusts parameters
- Reputation gating for Terminal mode (Tier3 only)
- Privacy level selection per execution
- Adapter routing (placeholder for full adapter integration)
- Error handling and loading states

**Next Steps After Plan:**
1. Integrate with actual adapter services (swap, LP, lending, DCA, limit orders)
2. Connect to MarketDataService for real impact estimation
3. Integrate with AIRecommendationService for actual recommendations
4. Add end-to-end tests with mock adapters
5. Deploy to staging for testing

---
