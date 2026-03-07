"use client";

import React, { useState } from "react";
import type { Opportunity, TradeReceipt } from "@/services/types";
import type { UserReputation } from "@/services/ReputationGatingService";

export interface ExecutionPanelProps {
  opportunity: Opportunity;
  onExecute: (receipt: TradeReceipt) => void;
  onCancel: () => void;
  userReputation?: UserReputation | {
    tier: "Tier1" | "Tier2" | "Tier3";
    score: number;
  };
}

const LTV_BY_TIER = {
  Tier1: 0,
  Tier2: 0.5,
  Tier3: 1.5,
} as const;

export const ExecutionPanel = React.memo(
  ({
    opportunity,
    onExecute,
    onCancel,
    userReputation,
  }: ExecutionPanelProps) => {
    const [amount, setAmount] = useState("");
    const [privacy, setPrivacy] = useState<"public" | "shielded" | "dark_ledger">(
      opportunity.privacyModes[0] || "public"
    );
    const [executing, setExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const maxAmount = userReputation
      ? LTV_BY_TIER[userReputation.tier as "Tier1" | "Tier2" | "Tier3"] * 1000
      : 0;

    const handleExecute = async () => {
      if (!amount) {
        setError("Amount is required");
        return;
      }

      const numAmount = parseFloat(amount);
      if (numAmount > maxAmount) {
        setError(`Amount exceeds max of ${maxAmount.toFixed(2)}`);
        return;
      }

      setExecuting(true);
      setError(null);

      try {
        const receipt: TradeReceipt = {
          id: `receipt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          action: opportunity.type,
          adapter: opportunity.source,
          opportunityName: opportunity.name,
          amount: numAmount,
          privacyLevel: privacy,
          yieldImpact: opportunity.currentYield,
          trustDelta: 1,
          status: "pending",
        };
        onExecute(receipt);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Execution failed");
      } finally {
        setExecuting(false);
      }
    };

    return (
      <div className="bg-slate-900 rounded border border-slate-700 p-4 flex flex-col gap-4 h-full overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Execute</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        {/* Opportunity Summary */}
        <div className="bg-slate-800 p-3 rounded">
          <p className="text-sm text-slate-400">Opportunity</p>
          <p className="font-semibold">{opportunity.name}</p>
          <div className="text-xs text-slate-400 mt-2 grid grid-cols-2 gap-2">
            <div>APY: {opportunity.currentYield.toFixed(2)}%</div>
            <div>Risk: {opportunity.riskScore}</div>
          </div>
        </div>

        {/* User Tier */}
        {userReputation && (
          <div className="bg-slate-800 p-3 rounded text-sm">
            <span className="text-slate-400">Your Tier: </span>
            <span className="font-medium">
              {userReputation.tier || "Unknown"}
            </span>
            <span className="text-slate-400 ml-2">Max Borrow: {maxAmount.toFixed(2)}</span>
          </div>
        )}

        {/* Amount Input */}
        <div>
          <label className="text-sm text-slate-400">
            Amount
            <span className="ml-2 text-xs font-normal">Max: {maxAmount.toFixed(2)}</span>
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            max={maxAmount}
            className="w-full px-3 py-2 mt-1 bg-slate-800 border border-slate-600 rounded text-white"
            placeholder="0.00"
          />
          {amount && parseFloat(amount) > maxAmount && (
            <p className="text-xs text-red-400 mt-1">Exceeds maximum amount</p>
          )}
        </div>

        {/* Privacy Mode */}
        <div>
          <label className="text-sm text-slate-400">Privacy Mode</label>
          <select
            value={privacy}
            onChange={(e) => setPrivacy(e.target.value as any)}
            className="w-full px-3 py-2 mt-1 bg-slate-800 border border-slate-600 rounded text-white text-sm"
          >
            {opportunity.privacyModes.map((m) => (
              <option key={m} value={m}>
                {m === "dark_ledger"
                  ? "Dark Ledger (Most Private)"
                  : m.charAt(0).toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-2 bg-red-900/20 border border-red-700 rounded text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Execute Button */}
        <button
          onClick={handleExecute}
          disabled={executing || !amount || parseFloat(amount) > maxAmount}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded font-medium transition"
        >
          {executing ? "Executing..." : "Execute"}
        </button>
      </div>
    );
  }
);

ExecutionPanel.displayName = "ExecutionPanel";
