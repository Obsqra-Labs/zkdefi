"use client";

/**
 * AllocationPreview — Shows where deposit capital will be deployed.
 * Fetches allocation split from /strategies/recommend in live mode.
 * Demo mode uses deterministic split based on demo opportunities.
 */

import { useState, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { DEMO_ALLOCATION } from "@/lib/demoCapitalOS";

export interface AllocationPreviewProps {
  amount: string;
  asset: "STRK" | "ETH" | "strkBTC";
  riskProfile?: string;
  isDemo?: boolean;
}

interface AllocationData {
  ekubo: number;
  lending: number;
  staking: number;
  idle: number;
  blendedApy: number;
}

export function AllocationPreview({ amount, asset, riskProfile = "balanced", isDemo }: AllocationPreviewProps) {
  const [data, setData] = useState<AllocationData | null>(isDemo ? DEMO_ALLOCATION : null);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  const [animateIn, setAnimateIn] = useState(false);

  const amountNum = parseFloat(amount);
  const showPreview = amountNum > 0;

  const fetchAllocation = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/strategies/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountNum, risk_profile: riskProfile, asset }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const resp = await res.json();
        const allocation: AllocationData = {
          ekubo: resp.ekubo_allocation_pct ?? 60,
          lending: resp.lending_allocation_pct ?? 25,
          staking: resp.staking_allocation_pct ?? 10,
          idle: resp.idle_allocation_pct ?? 5,
          blendedApy: resp.blended_apy ?? 19.2,
        };
        setData(allocation);
      } else {
        setData(DEMO_ALLOCATION);
      }
    } catch {
      setError("Failed to fetch allocation");
      setData(DEMO_ALLOCATION);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isDemo) {
      if (showPreview) setData(DEMO_ALLOCATION);
      return;
    }
    if (!showPreview) return;

    fetchAllocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, asset, riskProfile, isDemo, showPreview]);

  // Trigger bar animation after data loads
  useEffect(() => {
    if (data && !loading) {
      const t = setTimeout(() => setAnimateIn(true), 50);
      return () => clearTimeout(t);
    }
    setAnimateIn(false);
  }, [data, loading]);

  if (!showPreview) return null;

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2" aria-busy="true" aria-label="Loading allocation preview">
        <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
        <div className="h-2 w-full bg-zinc-800 rounded animate-pulse" />
        <div className="h-4 w-24 bg-zinc-800 rounded animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-4" role="alert">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
          <span className="text-sm text-red-400 flex-1">{error}</span>
          <button
            type="button"
            onClick={fetchAllocation}
            className="text-xs text-red-300 hover:text-white underline underline-offset-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            aria-label="Retry fetching allocation"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const total = data.ekubo + data.lending + data.staking + data.idle;

  const segments = [
    { key: "ekubo", label: "Ekubo LP", pct: data.ekubo, color: "bg-blue-500" },
    { key: "lending", label: "Lending", pct: data.lending, color: "bg-green-500" },
    { key: "staking", label: "Staking", pct: data.staking, color: "bg-orange-500" },
    { key: "idle", label: "Idle", pct: data.idle, color: "bg-gray-500" },
  ].filter((s) => s.pct > 0);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-zinc-200">Capital Deployment</h4>
        <span className="text-xs text-emerald-400 font-medium">{data.blendedApy.toFixed(1)}% APY</span>
      </div>

      {/* Allocation breakdown */}
      <div className="space-y-1.5 sm:space-y-2">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">{s.label}</span>
            <span className="text-zinc-200 font-medium">{s.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {/* Horizontal bar chart */}
      <div
        className="h-2 flex rounded-full overflow-hidden bg-zinc-800"
        role="img"
        aria-label={`Allocation: ${segments.map(s => `${s.label} ${s.pct.toFixed(0)}%`).join(", ")}`}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            className={`${s.color} transition-all duration-700 ease-out`}
            style={{ width: animateIn ? `${(s.pct / total) * 100}%` : "0%" }}
            title={`${s.label}: ${s.pct}%`}
          />
        ))}
      </div>

      {error && (
        <p className="text-[10px] text-amber-400/70">Using estimated allocation — live data unavailable</p>
      )}
    </div>
  );
}
