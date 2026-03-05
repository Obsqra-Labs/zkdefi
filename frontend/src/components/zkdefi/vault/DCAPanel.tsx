"use client";

/**
 * DCAPanel — Dollar-Cost Averaging configuration and management.
 * Create recurring swap schedules with privacy-shielded execution.
 */

import { useState, useEffect } from "react";
import { Calendar, TrendingUp, Trash2, Zap, AlertTriangle } from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { DEMO_DCA } from "@/lib/demoCapitalOS";

export interface DCAPanelProps {
  address?: string;
  isDemo?: boolean;
}

interface DCASchedule {
  id: string;
  pair: string;
  tokenIn: string;
  tokenOut: string;
  amountPerInterval: number;
  interval: "hourly" | "daily" | "weekly";
  privacyTier: string;
  maxSlippage: number;
  nextExecution: string;
  totalExecuted: number;
  totalAmount: number;
  active: boolean;
}

export function DCAPanel({ address, isDemo }: DCAPanelProps) {
  const [schedules, setSchedules] = useState<DCASchedule[]>([]);
  const [loading, setLoading] = useState(!isDemo);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Form state
  const [tokenIn, setTokenIn] = useState("STRK");
  const [tokenOut, setTokenOut] = useState("strkBTC");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState<"hourly" | "daily" | "weekly">("daily");
  const [slippage, setSlippage] = useState("1.0");
  const [tier, setTier] = useState("nullifier_set");

  const fetchSchedules = async () => {
    if (!address) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/vault/dca/list/${address}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.schedules)) {
          setSchedules(data.schedules);
        }
      } else {
        setFetchError("Failed to load schedules");
      }
    } catch {
      setFetchError("Network error loading schedules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isDemo) {
      setSchedules([
        {
          id: "demo-1",
          pair: DEMO_DCA.pair,
          tokenIn: "STRK",
          tokenOut: "strkBTC",
          amountPerInterval: DEMO_DCA.amountPerInterval,
          interval: DEMO_DCA.interval as "daily",
          privacyTier: "Nullifier Set",
          maxSlippage: 1.0,
          nextExecution: DEMO_DCA.nextExecution,
          totalExecuted: DEMO_DCA.totalExecuted,
          totalAmount: DEMO_DCA.totalAmount,
          active: true,
        },
      ]);
      setLoading(false);
      return;
    }

    fetchSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isDemo]);

  const handleCreate = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setCreateError(null);
    setCreating(true);

    if (isDemo) {
      const newSchedule: DCASchedule = {
        id: `demo-${Date.now()}`,
        pair: `${tokenIn} → ${tokenOut}`,
        tokenIn,
        tokenOut,
        amountPerInterval: parseFloat(amount),
        interval,
        privacyTier: tier === "nullifier_set" ? "Nullifier Set" : "Commitment Shield",
        maxSlippage: parseFloat(slippage),
        nextExecution: new Date(Date.now() + (interval === "hourly" ? 3600000 : interval === "daily" ? 86400000 : 604800000)).toISOString(),
        totalExecuted: 0,
        totalAmount: 0,
        active: true,
      };
      setSchedules([...schedules, newSchedule]);
      setAmount("");
      setCreating(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/vault/dca/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          token_in: tokenIn,
          token_out: tokenOut,
          amount_per_interval: amount,
          interval,
          privacy_tier: tier,
          max_slippage: parseFloat(slippage),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSchedules([...schedules, data.schedule]);
        setAmount("");
      } else {
        setCreateError("Failed to create schedule — please try again");
      }
    } catch {
      setCreateError("Network error — check connection and retry");
    } finally {
      setCreating(false);
    }
  };

  const handleStop = async (id: string) => {
    if (isDemo) {
      setSchedules(schedules.filter((s) => s.id !== id));
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/vault/dca/stop/${id}`, {
        method: "POST",
      });
      if (res.ok || res.status === 404) {
        setSchedules(schedules.filter((s) => s.id !== id));
      }
    } catch {
      // Optimistic removal on network failure (schedule can be re-fetched)
      setSchedules(schedules.filter((s) => s.id !== id));
    }
  };

  const formatNextExecution = (isoDate: string) => {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `in ${diffDays}d`;
    if (diffHours > 0) return `in ${diffHours}h`;
    return "soon";
  };

  return (
    <div className="space-y-6">
      {/* Configuration Form */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-blue-400" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-white">Configure DCA Schedule</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Token Pair */}
          <div>
            <label htmlFor="dca-token-in" className="block text-xs text-zinc-400 mb-2">Token In</label>
            <select
              id="dca-token-in"
              value={tokenIn}
              onChange={(e) => setTokenIn(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Select input token"
            >
              <option value="STRK">STRK</option>
              <option value="ETH">ETH</option>
            </select>
          </div>

          <div>
            <label htmlFor="dca-token-out" className="block text-xs text-zinc-400 mb-2">Token Out</label>
            <select
              id="dca-token-out"
              value={tokenOut}
              onChange={(e) => setTokenOut(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Select output token"
            >
              <option value="strkBTC">strkBTC</option>
              <option value="ETH">ETH</option>
              <option value="STRK">STRK</option>
            </select>
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="dca-amount" className="block text-xs text-zinc-400 mb-2">Amount per Interval</label>
            <input
              id="dca-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Amount per interval"
            />
          </div>

          {/* Interval */}
          <div>
            <label htmlFor="dca-interval" className="block text-xs text-zinc-400 mb-2">Interval</label>
            <select
              id="dca-interval"
              value={interval}
              onChange={(e) => setInterval(e.target.value as "hourly" | "daily" | "weekly")}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="DCA interval"
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          {/* Privacy Tier */}
          <div>
            <label htmlFor="dca-tier" className="block text-xs text-zinc-400 mb-2">Privacy Tier</label>
            <select
              id="dca-tier"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Privacy tier"
            >
              <option value="commitment_shield">Commitment Shield</option>
              <option value="nullifier_set">Nullifier Set</option>
            </select>
          </div>

          {/* Max Slippage */}
          <div>
            <label htmlFor="dca-slippage" className="block text-xs text-zinc-400 mb-2">Max Slippage (%)</label>
            <input
              id="dca-slippage"
              type="number"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              placeholder="1.0"
              step="0.1"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Maximum slippage percentage"
            />
          </div>
        </div>

        {createError && (
          <div className="flex items-center gap-2 text-sm text-red-400" role="alert">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{createError}</span>
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!amount || parseFloat(amount) <= 0 || creating}
          className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
          aria-label="Create DCA schedule"
        >
          <div className="flex items-center justify-center gap-2">
            <Zap className="w-4 h-4" aria-hidden="true" />
            <span>{creating ? "Creating…" : "Create DCA Schedule"}</span>
          </div>
        </button>
      </div>

      {/* Active Schedules */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-white">Active Schedules</h3>
        </div>

        {loading && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading DCA schedules">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 animate-pulse">
                <div className="h-5 w-40 bg-zinc-700 rounded mb-2" />
                <div className="h-3 w-60 bg-zinc-700 rounded" />
              </div>
            ))}
          </div>
        )}

        {!loading && fetchError && (
          <div className="flex items-center justify-between py-6 px-2" role="alert">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{fetchError}</span>
            </div>
            <button
              type="button"
              onClick={fetchSchedules}
              className="text-xs text-red-300 hover:text-white underline underline-offset-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              aria-label="Retry loading schedules"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !fetchError && schedules.length === 0 && (
          <div className="text-center py-8 text-zinc-500 text-sm">
            No active DCA schedules. Configure one above.
          </div>
        )}

        {!loading && schedules.length > 0 && (
          <div className="space-y-3">
            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-white font-medium">{schedule.pair}</span>
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-600/20 text-blue-400 border border-blue-600/30">
                      {schedule.privacyTier}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-zinc-400">
                    <span>{schedule.amountPerInterval} {schedule.tokenIn} · {schedule.interval}</span>
                    <span className="hidden sm:inline">•</span>
                    <span>Next: {formatNextExecution(schedule.nextExecution)}</span>
                    <span className="hidden sm:inline">•</span>
                    <span>{schedule.totalExecuted} executions · {schedule.totalAmount.toFixed(2)} total</span>
                  </div>
                </div>
                <button
                  onClick={() => handleStop(schedule.id)}
                  className="p-2 rounded-lg hover:bg-red-600/20 text-red-400 transition-colors self-end sm:self-center focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  aria-label={`Stop DCA schedule for ${schedule.pair}`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
