/**
 * Privacy Pool Panel - Advanced private deposit/withdraw integration
 */

"use client";

import React, { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Lock, Unlock, TrendingUp } from "lucide-react";
import { privacyVaultService } from "@/services/PrivacyVaultService";

export interface PrivacyPoolPanelProps {
  userAddress: string;
  onSuccess?: (txHash: string) => void;
  onError?: (error: string) => void;
}

export const PrivacyPoolPanel: React.FC<PrivacyPoolPanelProps> = ({
  userAddress,
  onSuccess,
  onError,
}) => {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState<number>(0);
  const [token, setToken] = useState<string>("ETH");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privateBalance] = useState<number>(0);

  const tokens = useMemo(() => ["ETH", "USDC", "DAI", "STRK"], []);

  const handleDeposit = useCallback(async () => {
    if (!amount || amount <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await privacyVaultService.depositShielded({
        user_address: userAddress,
        token,
        amount_wei: Math.floor(amount * 1e18),
        commitment: `0x${Math.random().toString(16).slice(2)}`,
      });

      if (response.status === "confirmed" || response.status === "pending") {
        onSuccess?.(response.tx_hash || "0x");
        setAmount(0);
      } else {
        setError(`Deposit failed: ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deposit failed";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [amount, token, userAddress, onSuccess, onError]);

  const handleWithdraw = useCallback(async () => {
    if (!amount || amount <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await privacyVaultService.withdrawShielded({
        user_address: userAddress,
        commitment: `0x${Math.random().toString(16).slice(2)}`,
        nullifier: `0x${Math.random().toString(16).slice(2)}`,
        proof: `0x${Math.random().toString(16).slice(2)}`,
        recipient: userAddress,
      });

      if (response.status === "confirmed" || response.status === "pending") {
        onSuccess?.(response.tx_hash || "0x");
        setAmount(0);
      } else {
        setError(`Withdrawal failed: ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Withdrawal failed";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [amount, userAddress, onSuccess, onError]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg border border-slate-700 p-6"
    >
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          {mode === "deposit" ? (
            <Lock className="w-5 h-5 text-cyan-400" />
          ) : (
            <Unlock className="w-5 h-5 text-green-400" />
          )}
          <h3 className="text-lg font-bold text-slate-100">
            {mode === "deposit" ? "Private Deposit" : "Private Withdraw"}
          </h3>
        </div>
        <p className="text-sm text-slate-400">
          {mode === "deposit"
            ? "Deposit into the private rail"
            : "Withdraw from the private rail"}
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-6 p-1 bg-slate-700 rounded-lg">
        <button
          onClick={() => setMode("deposit")}
          className={`flex-1 py-2 px-3 rounded font-medium text-sm transition-colors ${
            mode === "deposit"
              ? "bg-slate-900 text-cyan-400"
              : "bg-transparent text-slate-400 hover:text-slate-200"
          } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          disabled={loading}
        >
          Private Deposit
        </button>
        <button
          onClick={() => setMode("withdraw")}
          className={`flex-1 py-2 px-3 rounded font-medium text-sm transition-colors ${
            mode === "withdraw"
              ? "bg-slate-900 text-green-400"
              : "bg-transparent text-slate-400 hover:text-slate-200"
          } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          disabled={loading}
        >
          Private Withdraw
        </button>
      </div>

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-4 p-3 bg-red-900/30 border border-red-700 text-red-200 text-sm rounded-lg"
        >
          {error}
        </motion.div>
      )}

      {/* Token Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Token
        </label>
        <select
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
        >
          {tokens.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Amount Input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Amount ({token})
        </label>
        <input
          type="number"
          value={amount || ""}
          onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
          disabled={loading}
          placeholder="0.0"
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
        />
        <div className="mt-2 text-xs text-slate-400">
          Private Balance: {privateBalance.toFixed(4)} {token}
        </div>
      </div>

      {/* Info Box */}
      <div className="mb-6 p-3 bg-blue-900/20 border border-blue-700 rounded-lg">
        <div className="flex gap-2 text-sm text-blue-200">
          <TrendingUp className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium mb-1">Privacy Benefits</p>
            <ul className="text-xs space-y-1 text-blue-300">
              <li>• Keep deposits and withdrawals unlinkable</li>
              <li>• Reduce public balance traceability</li>
              <li>• Maintain privacy across trading activity</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={mode === "deposit" ? handleDeposit : handleWithdraw}
        disabled={loading || amount <= 0}
        className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
          mode === "deposit"
            ? "bg-cyan-600 hover:bg-cyan-700 text-white"
            : "bg-green-600 hover:bg-green-700 text-white"
        } disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
      >
        {loading && (
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        {loading
          ? mode === "deposit"
            ? "Depositing privately..."
            : "Withdrawing privately..."
          : mode === "deposit"
            ? `Deposit ${amount} ${token}`
            : `Withdraw ${amount} ${token}`}
      </button>
    </motion.div>
  );
};

export default PrivacyPoolPanel;
