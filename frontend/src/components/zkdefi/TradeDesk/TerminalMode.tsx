"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
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
    reputationScore: number;
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
              <p className="font-semibold text-red-900">
                Terminal Mode Unavailable
              </p>
              <p className="text-sm text-red-700 mt-1">
                Terminal mode requires Tier3 reputation. You are currently Tier
                {userReputation.tier.slice(-1)}.
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
              <Bot className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-blue-900">
                  Autonomous Execution Enabled
                </p>
                <p className="text-sm text-blue-700 mt-1">
                  AI can execute trades autonomously based on policies you
                  define.
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
                    <p className="text-xs text-gray-600 mb-1">{entry.details}</p>
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
