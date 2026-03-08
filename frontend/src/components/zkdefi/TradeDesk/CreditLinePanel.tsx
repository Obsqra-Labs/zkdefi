/**
 * Credit Line Panel - Borrowing and FICO integration
 */

"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { CreditCard, TrendingUp, AlertCircle } from "lucide-react";
import { creditLineService } from "@/services/CreditLineService";
import type { CreditLineResponse, CreditScoreResponse } from "@/services/CreditLineService";

export interface CreditLinePanelProps {
  userAddress: string;
  onSuccess?: (txHash: string) => void;
  onError?: (error: string) => void;
}

export const CreditLinePanel: React.FC<CreditLinePanelProps> = ({
  userAddress,
  onSuccess,
  onError,
}) => {
  const [mode, setMode] = useState<"borrow" | "repay" | "view">("view");
  const [amount, setAmount] = useState<number>(0);
  const [creditLines, setCreditLines] = useState<CreditLineResponse[]>([]);
  const [creditScore, setCreditScore] = useState<CreditScoreResponse | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load credit data
  useEffect(() => {
    const loadCreditData = async () => {
      try {
        setLoading(true);
        const [lines, score] = await Promise.all([
          creditLineService.getCreditLines(userAddress),
          creditLineService.getCreditScore(userAddress),
        ]);
        setCreditLines(lines.lines || []);
        setCreditScore(score);
        if (lines.lines && lines.lines.length > 0) {
          setSelectedLineId(lines.lines[0].user_address);
        }
      } catch (err) {
        console.warn("Failed to load credit data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadCreditData();
  }, [userAddress]);

  const handleBorrow = useCallback(async () => {
    if (!amount || amount <= 0 || !selectedLineId) {
      setError("Invalid amount or credit line");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await creditLineService.borrow(selectedLineId, {
        user_address: userAddress,
        amount_usd: amount,
        action: "borrow",
      });

      if (response.status === "confirmed" || response.status === "pending") {
        onSuccess?.(response.tx_hash || "0x");
        setAmount(0);
        setMode("view");
      } else {
        setError(`Borrow failed: ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Borrow failed";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [amount, selectedLineId, userAddress, onSuccess, onError]);

  const handleRepay = useCallback(async () => {
    if (!amount || amount <= 0 || !selectedLineId) {
      setError("Invalid amount or credit line");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await creditLineService.repay(selectedLineId, {
        user_address: userAddress,
        amount_usd: amount,
        action: "repay",
      });

      if (response.status === "confirmed" || response.status === "pending") {
        onSuccess?.(response.tx_hash || "0x");
        setAmount(0);
        setMode("view");
      } else {
        setError(`Repay failed: ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Repay failed";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [amount, selectedLineId, userAddress, onSuccess, onError]);

  const selectedLine = useMemo(
    () => creditLines.find((l) => l.user_address === selectedLineId),
    [creditLines, selectedLineId]
  );

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "excellent":
        return "text-green-400";
      case "good":
        return "text-blue-400";
      case "fair":
        return "text-yellow-400";
      case "poor":
        return "text-red-400";
      default:
        return "text-slate-400";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg border border-slate-700 p-6"
    >
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <CreditCard className="w-5 h-5 text-green-400" />
          <h3 className="text-lg font-bold text-slate-100">Credit Lines</h3>
        </div>
        <p className="text-sm text-slate-400">Borrow against your collateral</p>
      </div>

      {/* FICO Score Display */}
      {creditScore && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-6 p-4 bg-slate-700 rounded-lg border border-slate-600"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-300">FICO Score</span>
            <span className={`text-2xl font-bold ${getTierColor(creditScore.fico_tier)}`}>
              {creditScore.fico_score}
            </span>
          </div>
          <div className="text-xs text-slate-400 capitalize">
            Tier: <span className={getTierColor(creditScore.fico_tier)}>{creditScore.fico_tier}</span>
          </div>
          <div className="mt-2 bg-slate-600 rounded h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-green-600 to-green-400 h-full"
              style={{ width: `${(creditScore.fico_score / 850) * 100}%` }}
            />
          </div>
        </motion.div>
      )}

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-6 p-1 bg-slate-700 rounded-lg">
        <button
          onClick={() => setMode("view")}
          className={`flex-1 py-2 px-3 rounded font-medium text-sm transition-colors ${
            mode === "view"
              ? "bg-slate-900 text-green-400"
              : "bg-transparent text-slate-400 hover:text-slate-200"
          } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          disabled={loading}
        >
          View
        </button>
        <button
          onClick={() => setMode("borrow")}
          className={`flex-1 py-2 px-3 rounded font-medium text-sm transition-colors ${
            mode === "borrow"
              ? "bg-slate-900 text-green-400"
              : "bg-transparent text-slate-400 hover:text-slate-200"
          } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          disabled={loading}
        >
          Borrow
        </button>
        <button
          onClick={() => setMode("repay")}
          className={`flex-1 py-2 px-3 rounded font-medium text-sm transition-colors ${
            mode === "repay"
              ? "bg-slate-900 text-green-400"
              : "bg-transparent text-slate-400 hover:text-slate-200"
          } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          disabled={loading}
        >
          Repay
        </button>
      </div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-4 p-3 bg-red-900/30 border border-red-700 text-red-200 text-sm rounded-lg flex gap-2"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </motion.div>
      )}

      {/* View Mode */}
      {mode === "view" && creditLines.length > 0 && (
        <div className="space-y-3">
          {creditLines.map((line) => (
            <motion.div
              key={line.user_address}
              className="p-3 bg-slate-700 rounded-lg border border-slate-600 cursor-pointer hover:border-slate-500 transition-colors"
              onClick={() => setSelectedLineId(line.user_address)}
            >
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-slate-300">
                  ${line.credit_limit_usd.toFixed(0)}
                </span>
                <span className="text-xs text-slate-400">
                  Available: ${line.credit_available_usd.toFixed(0)}
                </span>
              </div>
              <div className="bg-slate-600 rounded h-1.5 overflow-hidden mb-2">
                <div
                  className="bg-green-600 h-full"
                  style={{
                    width: `${((line.credit_limit_usd - line.credit_available_usd) / line.credit_limit_usd) * 100}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>LTV: {(line.ltv_ratio * 100).toFixed(1)}%</span>
                <span>APR: {(line.interest_rate * 100).toFixed(2)}%</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Borrow/Repay Mode */}
      {(mode === "borrow" || mode === "repay") && selectedLine && (
        <div className="space-y-4">
          {/* Credit Line Selector */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Credit Line
            </label>
            <select
              value={selectedLineId || ""}
              onChange={(e) => setSelectedLineId(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-green-500"
            >
              {creditLines.map((line) => (
                <option key={line.user_address} value={line.user_address}>
                  ${line.credit_limit_usd.toFixed(0)} limit ({line.status})
                </option>
              ))}
            </select>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Amount (USD)
            </label>
            <input
              type="number"
              value={amount || ""}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
              disabled={loading}
              placeholder="0.00"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-green-500"
            />
            <div className="mt-2 text-xs text-slate-400">
              {mode === "borrow"
                ? `Available to borrow: $${selectedLine.credit_available_usd.toFixed(0)}`
                : `Borrowed: $${selectedLine.credit_used_usd.toFixed(0)}`}
            </div>
          </div>

          {/* Info */}
          <div className="p-3 bg-blue-900/20 border border-blue-700 rounded-lg">
            <div className="text-xs text-blue-300 space-y-1">
              <div>Interest Rate: {(selectedLine.interest_rate * 100).toFixed(2)}% APR</div>
              <div>Health Factor: {selectedLine.ltv_ratio.toFixed(2)}</div>
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={mode === "borrow" ? handleBorrow : handleRepay}
            disabled={loading || amount <= 0}
            className="w-full py-2 px-4 rounded-lg font-medium transition-colors bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {loading
              ? mode === "borrow"
                ? "Borrowing..."
                : "Repaying..."
              : mode === "borrow"
                ? `Borrow $${amount.toFixed(0)}`
                : `Repay $${amount.toFixed(0)}`}
          </button>
        </div>
      )}
    </motion.div>
  );
};

export default CreditLinePanel;
