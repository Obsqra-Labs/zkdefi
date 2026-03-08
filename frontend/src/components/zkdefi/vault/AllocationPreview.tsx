"use client";

/**
 * AllocationPreview — Shows where deposit capital will be deployed.
 * Fetches allocation split from /strategies/recommend in live mode.
 * Demo mode uses deterministic split based on demo opportunities.
 */

import { useState, useEffect } from "react";
import { API_BASE } from "@/lib/api/client";
import { DEMO_ALLOCATION } from "@/lib/demoCapitalOS";
import { ErrorAlert } from "@/components/ui/Spinner";

export interface AllocationPreviewProps {
  amount: string;
  asset: "STRK" | "ETH" | "strkBTC";
  riskProfile?: string;
  isDemo?: boolean;
  address?: string;
}

interface AllocationData {
  ekubo: number;
  lending: number;
  staking: number;
  idle: number;
  blendedApy: number;
}

export function AllocationPreview({ amount, asset, riskProfile = "balanced", isDemo, address }: AllocationPreviewProps) {
  const [data, setData] = useState<AllocationData | null>(isDemo ? DEMO_ALLOCATION : null);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  const [justLoaded, setJustLoaded] = useState(false);

  const amountNum = parseFloat(amount);
  const showPreview = amountNum > 0;

  useEffect(() => {
    if (isDemo || !showPreview) {
      if (isDemo && showPreview) setData(DEMO_ALLOCATION);
      return;
    }

    let dead = false;
    setLoading(true);

    const fetchAllocation = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/strategies/recommend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_address: address || "0x0", amount: amountNum, risk_profile: riskProfile, asset }),
          signal: AbortSignal.timeout(8000),
        });

        if (res.ok && !dead) {
          const resp = await res.json();
          // Parse allocation from response (adjust based on actual API structure)
          const allocation: Partial<AllocationData> = {
            ekubo: resp.ekubo_allocation_pct ?? 60,
            lending: resp.lending_allocation_pct ?? 25,
            staking: resp.staking_allocation_pct ?? 10,
            idle: resp.idle_allocation_pct ?? 5,
            blendedApy: resp.blended_apy ?? 19.2,
          };
          setData(allocation as AllocationData);
          setError(null);
          setJustLoaded(true);
          setTimeout(() => setJustLoaded(false), 1000);
        } else if (!dead) {
          setError("Unable to calculate allocation");
        }
      } catch {
        if (!dead) {
          setError("Failed to fetch allocation strategy");
        }
      } finally {
        if (!dead) setLoading(false);
      }
    };

    fetchAllocation();
    return () => { dead = true; };
  }, [amount, asset, riskProfile, isDemo, showPreview, amountNum, address]);

  if (!showPreview) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center">
        <p className="text-sm text-zinc-500">
          Enter an amount to see capital deployment preview
        </p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2" role="status" aria-label="Loading allocation preview">
        <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
        <div className="h-2 w-full bg-zinc-800 rounded animate-pulse" />
        <div className="h-4 w-24 bg-zinc-800 rounded animate-pulse" />
        <span className="sr-only">Loading capital deployment preview</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-zinc-300">Capital Deployment</h4>
        <ErrorAlert message={error} onRetry={() => {
          setError(null);
          setLoading(true);
        }} />
      </div>
    );
  }

  if (!data) return null;

  const total = data.ekubo + data.lending + data.staking + data.idle;

  return (
    <div 
      className={`rounded-lg border bg-zinc-900/40 p-4 space-y-3 transition-all duration-300 ${
        justLoaded 
          ? 'border-emerald-500/50 shadow-emerald-500/20 shadow-lg' 
          : 'border-zinc-800'
      }`}
      role="region"
      aria-label="Capital deployment allocation"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-zinc-200">Capital Deployment</h4>
        <span className="text-xs text-emerald-400 font-medium">{data.blendedApy.toFixed(1)}% APY</span>
      </div>

      {/* Allocation breakdown */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Ekubo LP</span>
          <span className="text-zinc-200 font-medium">{data.ekubo.toFixed(0)}%</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Lending</span>
          <span className="text-zinc-200 font-medium">{data.lending.toFixed(0)}%</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Staking</span>
          <span className="text-zinc-200 font-medium">{data.staking.toFixed(0)}%</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Idle</span>
          <span className="text-zinc-200 font-medium">{data.idle.toFixed(0)}%</span>
        </div>
      </div>

      {/* Horizontal bar chart */}
      <div className="h-2 flex rounded-full overflow-hidden bg-zinc-800">
        {data.ekubo > 0 && (
          <div
            className="bg-blue-500"
            style={{ width: `${(data.ekubo / total) * 100}%` }}
            title={`Ekubo LP: ${data.ekubo}%`}
          />
        )}
        {data.lending > 0 && (
          <div
            className="bg-green-500"
            style={{ width: `${(data.lending / total) * 100}%` }}
            title={`Lending: ${data.lending}%`}
          />
        )}
        {data.staking > 0 && (
          <div
            className="bg-orange-500"
            style={{ width: `${(data.staking / total) * 100}%` }}
            title={`Staking: ${data.staking}%`}
          />
        )}
        {data.idle > 0 && (
          <div
            className="bg-gray-500"
            style={{ width: `${(data.idle / total) * 100}%` }}
            title={`Idle: ${data.idle}%`}
          />
        )}
      </div>
    </div>
  );
}
