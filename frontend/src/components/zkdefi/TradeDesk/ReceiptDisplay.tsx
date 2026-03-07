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
                <p className="text-xs opacity-75 font-medium">Risk Level</p>
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
            {copied && <p className="text-xs mt-1 opacity-75">Copied!</p>}
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
