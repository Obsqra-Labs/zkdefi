"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { CreditCard, AlertCircle, Loader2 } from "lucide-react";
import {
  creditLineService,
  type CreditLineResponse,
  type CreditScoreResponse,
} from "@/services/CreditLineService";

export interface CreditLinePanelProps {
  userAddress: string;
}

type CreditMode = "view" | "borrow" | "repay";

export function CreditLinePanel({ userAddress }: CreditLinePanelProps) {
  const [mode, setMode] = useState<CreditMode>("view");
  const [amount, setAmount] = useState<number>(0);
  const [creditLines, setCreditLines] = useState<CreditLineResponse[]>([]);
  const [creditScore, setCreditScore] = useState<CreditScoreResponse | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCreditData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lines, score] = await Promise.all([
        creditLineService.getCreditLines(userAddress),
        creditLineService.getCreditScore(userAddress),
      ]);
      const nextLines = lines.lines ?? [];
      setCreditLines(nextLines);
      setCreditScore(score);
      if (nextLines.length > 0) {
        setSelectedLineId((prev) => prev ?? nextLines[0].user_address);
      } else {
        setSelectedLineId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load credit data");
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    void loadCreditData();
  }, [loadCreditData]);

  const selectedLine = useMemo(
    () => creditLines.find((line) => line.user_address === selectedLineId) ?? null,
    [creditLines, selectedLineId],
  );

  const handleSubmit = useCallback(async () => {
    if (!selectedLineId || amount <= 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "borrow") {
        await creditLineService.borrow(selectedLineId, {
          user_address: userAddress,
          amount_usd: amount,
          action: "borrow",
        });
      } else if (mode === "repay") {
        await creditLineService.repay(selectedLineId, {
          user_address: userAddress,
          amount_usd: amount,
          action: "repay",
        });
      }
      setAmount(0);
      setMode("view");
      await loadCreditData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Credit transaction failed");
    } finally {
      setSubmitting(false);
    }
  }, [selectedLineId, amount, submitting, mode, userAddress, loadCreditData]);

  const tierClass = useMemo(() => {
    switch (creditScore?.fico_tier) {
      case "excellent":
        return "text-emerald-400";
      case "good":
        return "text-cyan-400";
      case "fair":
        return "text-amber-400";
      case "poor":
        return "text-red-400";
      default:
        return "text-slate-300";
    }
  }, [creditScore?.fico_tier]);

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-slate-200">Credit Lines</h3>
      </div>

      {creditScore && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-slate-400">FICO Score</span>
            <span className={`text-lg font-semibold ${tierClass}`}>{creditScore.fico_score}</span>
          </div>
          <p className="text-[11px] text-slate-500 capitalize">Tier: {creditScore.fico_tier}</p>
        </div>
      )}

      <div className="flex gap-2 rounded-lg border border-slate-700 bg-slate-800 p-1">
        {(["view", "borrow", "repay"] as const).map((nextMode) => (
          <button
            key={nextMode}
            onClick={() => setMode(nextMode)}
            className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
              mode === nextMode
                ? "bg-slate-700 text-cyan-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
            disabled={loading || submitting}
          >
            {nextMode[0].toUpperCase() + nextMode.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {mode === "view" && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {creditLines.length === 0 && (
                <p className="text-xs text-slate-500">No active credit lines.</p>
              )}
              {creditLines.map((line) => (
                <button
                  key={`${line.user_address}-${line.created_at}`}
                  onClick={() => setSelectedLineId(line.user_address)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    selectedLineId === line.user_address
                      ? "border-cyan-700 bg-slate-800"
                      : "border-slate-700 bg-slate-900 hover:border-slate-600"
                  }`}
                >
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Limit</span>
                    <span className="font-medium text-slate-200">${(line.credit_limit_usd ?? 0).toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-slate-400">Available</span>
                    <span className="text-emerald-300">${(line.credit_available_usd ?? 0).toFixed(0)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {mode !== "view" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Credit Line</label>
                <select
                  value={selectedLineId ?? ""}
                  onChange={(e) => setSelectedLineId(e.target.value || null)}
                  className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                  disabled={submitting || creditLines.length === 0}
                >
                  {creditLines.map((line) => (
                    <option key={line.user_address} value={line.user_address}>
                      ${(line.credit_limit_usd ?? 0).toFixed(0)} ({line.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Amount (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={amount || ""}
                  onChange={(e) => setAmount(Number(e.target.value) || 0)}
                  className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                  disabled={submitting}
                />
                {selectedLine && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    {mode === "borrow"
                      ? `Available: $${(selectedLine.credit_available_usd ?? 0).toFixed(0)}`
                      : `Used: $${(selectedLine.credit_used_usd ?? 0).toFixed(0)}`}
                  </p>
                )}
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting || amount <= 0 || !selectedLine}
                className="w-full rounded bg-cyan-600 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {mode === "borrow" ? "Borrow" : "Repay"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CreditLinePanel;
