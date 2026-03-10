"use client";

/**
 * DCAPanel — Dollar-Cost Averaging configuration and management.
 * Create recurring swap schedules with privacy-shielded execution.
 */

import { useState, useEffect } from "react";
import { Calendar, TrendingUp, Trash2, Zap, Repeat } from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { DEMO_DCA } from "@/lib/demoCapitalOS";
import { useToast } from "@/lib/toastContext";

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
  const { showToast } = useToast();

  // Form state
  const [tokenIn, setTokenIn] = useState("STRK");
  const [tokenOut, setTokenOut] = useState("strkBTC");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState<"hourly" | "daily" | "weekly">("daily");
  const [slippage, setSlippage] = useState("1.0");
  const [tier, setTier] = useState("nullifier_set");
  const [errors, setErrors] = useState<{
    amount?: string;
    tokenOut?: string;
  }>({});

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

    if (!address) return;
    let dead = false;

    const fetchSchedules = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/vault/dca/list/${address}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok && !dead) {
          const data = await res.json();
          if (Array.isArray(data.schedules)) {
            setSchedules(data.schedules);
          }
        }
      } catch {
        // Fallback to empty
      } finally {
        if (!dead) setLoading(false);
      }
    };

    fetchSchedules();
    return () => {
      dead = true;
    };
  }, [address, isDemo]);

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};
    
    if (!amount || parseFloat(amount) <= 0) {
      newErrors.amount = "Amount must be greater than 0";
    }
    
    if (tokenIn === tokenOut) {
      newErrors.tokenOut = "Output token must differ from input token";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;

    if (isDemo) {
      // Demo mode: just add to local state
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
      showToast("DCA schedule created successfully", "success");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/v1/vault/dca/schedule`, {
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
        showToast("DCA schedule created successfully", "success");
      } else {
        showToast("Failed to create DCA schedule", "error");
      }
    } catch {
      showToast("Failed to create DCA schedule", "error");
    }
  };

  const handleStop = async (id: string) => {
    if (isDemo) {
      setSchedules(schedules.filter((s) => s.id !== id));
      showToast("DCA schedule stopped", "success");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/v1/vault/dca/stop/${id}`, {
        method: "POST",
      });
      if (res.ok) {
        setSchedules(schedules.filter((s) => s.id !== id));
        showToast("DCA schedule stopped", "success");
      } else {
        showToast("Failed to stop schedule", "error");
      }
    } catch {
      showToast("Failed to stop schedule", "error");
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
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 space-y-4" role="region" aria-label="DCA schedule configuration">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-white">Configure DCA Schedule</h3>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Token Pair */}
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Token In</label>
            <select
              value={tokenIn}
              onChange={(e) => setTokenIn(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="STRK">STRK</option>
              <option value="ETH">ETH</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-2">Token Out</label>
            <select
              value={tokenOut}
              onChange={(e) => {
                setTokenOut(e.target.value);
                if (errors.tokenOut) {
                  setErrors((prev) => ({ ...prev, tokenOut: undefined }));
                }
              }}
              className={`w-full rounded-lg border bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 ${
                errors.tokenOut
                  ? 'border-red-500/50 focus:ring-red-500/30'
                  : 'border-zinc-700 focus:ring-emerald-500/30'
              }`}
            >
              <option value="strkBTC">strkBTC</option>
              <option value="ETH">ETH</option>
              <option value="STRK">STRK</option>
            </select>
            {errors.tokenOut && (
              <p className="text-xs text-red-400 mt-1">{errors.tokenOut}</p>
            )}
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Amount per Interval</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (errors.amount) {
                  setErrors((prev) => ({ ...prev, amount: undefined }));
                }
              }}
              placeholder="0.00"
              className={`w-full rounded-lg border bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 ${
                errors.amount
                  ? 'border-red-500/50 focus:ring-red-500/30'
                  : 'border-zinc-700 focus:ring-emerald-500/30'
              }`}
            />
            {errors.amount && (
              <p className="text-xs text-red-400 mt-1">{errors.amount}</p>
            )}
          </div>

          {/* Interval */}
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Interval</label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value as "hourly" | "daily" | "weekly")}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          {/* Privacy Tier */}
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Privacy Tier</label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="commitment_shield">Commitment Shield</option>
              <option value="nullifier_set">Nullifier Set</option>
            </select>
          </div>

          {/* Max Slippage */}
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Max Slippage (%)</label>
            <input
              type="number"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              placeholder="1.0"
              step="0.1"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={!amount || parseFloat(amount) <= 0}
          className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center justify-center gap-2">
            <Zap className="w-4 h-4" />
            <span>Create DCA Schedule</span>
          </div>
        </button>
      </div>

      {/* Active Schedules */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-emerald-400" />
          <h3 className="text-lg font-semibold text-white">Active Schedules</h3>
        </div>

        {loading && (
          <div className="space-y-2 animate-pulse" role="status">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                <div className="h-4 bg-zinc-700 rounded w-1/4" />
                <div className="h-4 bg-zinc-700 rounded w-1/3" />
                <div className="h-4 bg-zinc-700 rounded w-1/4" />
              </div>
            ))}
            <span className="sr-only">Loading DCA schedules</span>
          </div>
        )}

        {!loading && schedules.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Repeat className="w-12 h-12 text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-400 mb-1">No DCA schedules yet</p>
            <p className="text-xs text-zinc-500">Set up automated, privacy-preserving swaps</p>
          </div>
        )}

        {!loading && schedules.length > 0 && (
          <div className="space-y-3">
            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 flex items-center justify-between"
              >
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-white font-medium">{schedule.pair}</span>
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-600/20 text-blue-400 border border-blue-600/30">
                      {schedule.privacyTier}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-zinc-400">
                    <span>{schedule.amountPerInterval} {schedule.tokenIn} · {schedule.interval}</span>
                    <span>•</span>
                    <span>Next: {formatNextExecution(schedule.nextExecution)}</span>
                    <span>•</span>
                    <span>{schedule.totalExecuted} executions · {(schedule.totalAmount ?? 0).toFixed(2)} total</span>
                  </div>
                </div>
                <button
                  onClick={() => handleStop(schedule.id)}
                  className="p-2 rounded-lg hover:bg-red-600/20 text-red-400 transition-colors"
                  title="Stop DCA"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
