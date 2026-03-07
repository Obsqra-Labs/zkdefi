"use client";

import type { ReceiptWithImpact } from "@/services/ReceiptService";
import { motion } from "framer-motion";

interface MemoryLaneCardProps {
  receipt: ReceiptWithImpact;
  isExpanded: boolean;
  onToggle: () => void;
  actionIcon: string;
}

export function MemoryLaneCard({ receipt, isExpanded, onToggle, actionIcon }: MemoryLaneCardProps) {
  return (
    <motion.div
      className="border border-slate-700 rounded hover:border-slate-600 transition cursor-pointer"
      onClick={onToggle}
    >
      {/* Collapsed View */}
      <div className="p-3 bg-slate-800 rounded">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">{actionIcon}</span>
              <div>
                <p className="font-medium text-sm">{receipt.opportunityName || receipt.action}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {new Date(receipt.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
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
        <div className="flex justify-between mt-3 text-xs text-slate-400 gap-2">
          <span>
            Amount: {receipt.privacyLevel !== "public" ? "***" : receipt.amount.toFixed(4)}
          </span>
          <span className={receipt.yieldImpact >= 0 ? "text-green-400" : "text-red-400"}>
            {receipt.yieldImpact >= 0 ? "+" : ""}{receipt.yieldImpact.toFixed(2)}% yield
          </span>
          <span className="text-blue-400">+{receipt.reputationImpact} rep</span>
        </div>
      </div>

      {/* Expanded View */}
      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="p-3 bg-slate-900 border-t border-slate-700 space-y-3 text-sm overflow-hidden"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-slate-400 text-xs">Type</p>
              <p className="font-medium capitalize">{receipt.action}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Adapter</p>
              <p className="font-medium">{receipt.adapter}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Privacy Level</p>
              <p className="font-medium capitalize">{receipt.privacyLevel}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Trust Delta</p>
              <p className="font-medium">
                {receipt.trustDelta > 0 ? "+" : ""}
                {receipt.trustDelta}
              </p>
            </div>
          </div>

          {receipt.txHash && (
            <div>
              <p className="text-slate-400 text-xs">Transaction</p>
              <p className="font-mono text-xs text-blue-400 truncate">{receipt.txHash}</p>
            </div>
          )}

          {receipt.proofHash && (
            <div>
              <p className="text-slate-400 text-xs">Proof Hash</p>
              <p className="font-mono text-xs text-purple-400 truncate">{receipt.proofHash}</p>
            </div>
          )}

          {receipt.explanationFromAI && (
            <div>
              <p className="text-slate-400 text-xs">AI Explanation</p>
              <p className="text-xs text-slate-300">{receipt.explanationFromAI}</p>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
