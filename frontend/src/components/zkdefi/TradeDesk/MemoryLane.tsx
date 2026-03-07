"use client";

import type { ReceiptWithImpact } from "@/services/ReceiptService";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { MemoryLaneCard } from "./MemoryLaneCard";
import { MemoryLaneAnalytics } from "./MemoryLaneAnalytics";

interface MemoryLaneProps {
  receipts: ReceiptWithImpact[];
  userAddress?: string;
  compact?: boolean; // Default false (full view)
  showFilters?: boolean; // Default true
  limit?: number; // Default 50
  loading?: boolean;
}

type DateFilter = "24h" | "7d" | "30d" | "all";

const actionIcons: Record<string, string> = {
  swap: "🔄",
  lp_add: "💰",
  lp_remove: "📉",
  borrow: "🏦",
  repay: "💳",
  stake: "📊",
  dca: "📈",
  limit_order: "⏱️",
};

const actionLabels: Record<string, string> = {
  swap: "Swap",
  lp_add: "Added LP",
  lp_remove: "Removed LP",
  borrow: "Borrowed",
  repay: "Repaid",
  stake: "Staked",
  dca: "DCA Execute",
  limit_order: "Limit Order",
};

export function MemoryLane({
  receipts,
  userAddress,
  compact = false,
  showFilters = true,
  limit = 50,
  loading = false,
}: MemoryLaneProps) {
  const [dateFilter, setDateFilter] = useState<DateFilter>("24h");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const now = Date.now();
    const filterMs = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      "all": Infinity,
    }[dateFilter];

    let result = receipts
      .filter((r) => {
        const receiptTime = new Date(r.timestamp).getTime();
        return now - receiptTime <= filterMs;
      })
      .slice(0, limit);

    if (typeFilter !== "all") {
      result = result.filter((r) => r.action === typeFilter);
    }

    return result;
  }, [receipts, dateFilter, typeFilter, limit]);

  // Get unique action types from receipts
  const actionTypes = useMemo(() => {
    const types = new Set(receipts.map((r) => r.action));
    return Array.from(types).sort();
  }, [receipts]);

  if (loading && receipts.length === 0) {
    return (
      <div className="bg-slate-900 border-t border-slate-700 p-4">
        <div className="text-slate-400">Loading receipt history...</div>
      </div>
    );
  }

  const analytics = useMemo(() => {
    const totalExecutions = filtered.length;
    const totalYield = filtered.reduce((sum, r) => sum + r.yieldImpact, 0);
    const successCount = filtered.filter((r) => r.status === "confirmed").length;
    const successRate = totalExecutions > 0 ? Math.round((successCount / totalExecutions) * 100) : 0;
    const totalReputation = filtered.reduce((sum, r) => sum + r.reputationImpact, 0);
    const avgReputation = totalExecutions > 0 ? (totalReputation / totalExecutions).toFixed(1) : "0";

    return {
      totalExecutions,
      totalYield: totalYield.toFixed(2),
      successRate,
      avgReputation,
    };
  }, [filtered]);

  const renderCompactView = () => (
    <div
      data-testid="memory-lane-compact"
      className="flex flex-col gap-2"
    >
      <div className="flex gap-2 items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Recent Trades</h3>
        <div className="flex gap-1">
          {(["24h", "7d", "30d", "all"] as DateFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setDateFilter(f)}
              className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
                dateFilter === f
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {filtered.length === 0 ? (
          <p className="text-slate-400 text-xs text-center py-2">No trades in this period</p>
        ) : (
          filtered.map((receipt) => (
            <motion.div
              key={receipt.id}
              className="p-2 bg-slate-800 rounded border border-slate-700 hover:border-slate-600 transition-colors cursor-pointer text-xs"
              onClick={() =>
                setExpandedId(expandedId === receipt.id ? null : receipt.id)
              }
              layout
            >
              <div className="flex justify-between items-center">
                <span>
                  {actionIcons[receipt.action] || "📝"} {receipt.opportunityName}
                </span>
                <span
                  className={`px-1 py-0.5 rounded text-xs ${
                    receipt.status === "confirmed"
                      ? "bg-green-900/30 text-green-400"
                      : receipt.status === "pending"
                        ? "bg-yellow-900/30 text-yellow-400"
                        : "bg-red-900/30 text-red-400"
                  }`}
                >
                  {receipt.status}
                </span>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );

  const renderFullView = () => (
    <div className="bg-slate-900 border-t border-slate-700 p-4 flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Memory Lane</h2>

        {/* Date Filters */}
        <div className="flex gap-2">
          {(["24h", "7d", "30d", "all"] as DateFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setDateFilter(f)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                dateFilter === f
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
      </div>

      {/* Type Filters */}
      {showFilters && actionTypes.length > 0 && (
        <div className="flex gap-2 flex-wrap" data-testid="filter-type">
          <button
            onClick={() => setTypeFilter("all")}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              typeFilter === "all"
                ? "bg-purple-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            All Types
          </button>
          {actionTypes.map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                typeFilter === type
                  ? "bg-purple-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {actionLabels[type] || type}
            </button>
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-4">No trades in this period</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((receipt, index) => (
              <motion.div
                key={receipt.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <MemoryLaneCard
                  receipt={receipt}
                  isExpanded={expandedId === receipt.id}
                  onToggle={() =>
                    setExpandedId(expandedId === receipt.id ? null : receipt.id)
                  }
                  actionIcon={actionIcons[receipt.action] || "📝"}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {filtered.length > 0 && (
        <MemoryLaneAnalytics
          totalExecutions={analytics.totalExecutions}
          totalYield={analytics.totalYield}
          successRate={analytics.successRate}
          avgReputation={analytics.avgReputation}
        />
      )}
    </div>
  );

  return compact ? renderCompactView() : renderFullView();
}
