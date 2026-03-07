"use client";

import type { ReceiptWithImpact } from "@/services/types";
import { useState, useMemo } from "react";
import { ReceiptDisplay } from "./ReceiptDisplay";

interface MemoryLaneProps {
  receipts: ReceiptWithImpact[];
  loading: boolean;
}

type DateFilter = "24h" | "7d" | "30d" | "all";

export function MemoryLane({ receipts, loading }: MemoryLaneProps) {
  const [dateFilter, setDateFilter] = useState<DateFilter>("24h");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const now = Date.now();
    const filterMs = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      "all": Infinity,
    }[dateFilter];

    return receipts.filter((r) => {
      const receiptTime = new Date(r.timestamp).getTime();
      return now - receiptTime <= filterMs;
    });
  }, [receipts, dateFilter]);

  if (loading && receipts.length === 0) {
    return (
      <div className="bg-slate-900 border-t border-slate-700 p-4">
        <div className="text-slate-400">Loading receipt history...</div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border-t border-slate-700 p-4 flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Memory Lane</h2>

        {/* Date Filters */}
        <div className="flex gap-2">
          {(["24h", "7d", "30d", "all"] as DateFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setDateFilter(f)}
              className={`px-2 py-1 text-xs rounded ${
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

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-4">No trades in this period</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((receipt) => (
              <div
                key={receipt.id}
                className="border border-slate-700 rounded hover:border-slate-600 transition cursor-pointer"
                onClick={() =>
                  setExpandedId(expandedId === receipt.id ? null : receipt.id)
                }
              >
                {/* Collapsed View */}
                <div className="p-3 bg-slate-800 rounded">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-sm">{receipt.opportunityName || receipt.action}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {new Date(receipt.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-block text-xs px-2 py-1 rounded ${
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
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-slate-400">
                    <span>
                      Amount: {receipt.privacyLevel !== "public" ? "***" : receipt.amount.toFixed(4)}
                    </span>
                    <span className="text-green-400">
                      +{receipt.yieldImpact.toFixed(2)}% yield
                    </span>
                  </div>
                </div>

                {/* Expanded View */}
                {expandedId === receipt.id && (
                  <ReceiptDisplay receipt={receipt} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {filtered.length > 0 && (
        <div className="border-t border-slate-700 pt-3 text-xs text-slate-400 grid grid-cols-3 gap-2">
          <div>
            Total Trades: <span className="text-white font-medium">{filtered.length}</span>
          </div>
          <div>
            Total Yield:{" "}
            <span className="text-green-400 font-medium">
              +{filtered.reduce((sum, r) => sum + r.yieldImpact, 0).toFixed(2)}%
            </span>
          </div>
          <div>
            Success Rate:{" "}
            <span className="text-white font-medium">
              {Math.round(
                (filtered.filter((r) => r.status === "confirmed").length / filtered.length) * 100
              )}
              %
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
