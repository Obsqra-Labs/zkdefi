"use client";

/**
 * TrendingBar — Market pulse stats (STRK/ETH 24h, Top Pool, TVL, Depositors, Avg APY).
 * Fetches from /zkdefi/market/surface and /zkdefi/oracle/pool-apys (30s poll) in live mode.
 * Demo mode uses static data from demoCapitalOS.
 */

import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { DEMO_TRENDING } from "@/lib/demoCapitalOS";
import { ErrorAlert } from "@/components/ui/Spinner";

export interface TrendingBarProps {
  isDemo?: boolean;
}

interface TrendingData {
  strkEth24h: number;
  topPool: { name: string; apy: number };
  vaultTvl: number;
  activeDepositors: number;
  avgApy: number;
}

function formatLargeNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

export function TrendingBar({ isDemo }: TrendingBarProps) {
  const [data, setData] = useState<TrendingData | null>(isDemo ? DEMO_TRENDING : null);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  useEffect(() => {
    if (isDemo) return;
    let dead = false;

    const fetchData = async () => {
      try {
        const [marketRes, poolRes] = await Promise.all([
          fetch(`${API_BASE}/v1/zkdefi/market/surface`, { signal: AbortSignal.timeout(8000) }),
          fetch(`${API_BASE}/v1/zkdefi/oracle/pool-apys`, { signal: AbortSignal.timeout(8000) }),
        ]);

        if (dead) return;

        let trending: Partial<TrendingData> = {};

        if (marketRes.ok) {
          const market = await marketRes.json();
          trending.strkEth24h = market.strk_eth_24h_change ?? 0;
          trending.vaultTvl = market.vault_tvl ?? 0;
          trending.activeDepositors = market.active_depositors ?? 0;
        }

        if (poolRes.ok) {
          const pools = await poolRes.json();
          if (Array.isArray(pools) && pools.length > 0) {
            const sorted = [...pools].sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0));
            const top = sorted[0];
            trending.topPool = { name: top.name ?? "Unknown", apy: top.apy ?? 0 };
            const avgApy = pools.reduce((sum, p) => sum + (p.apy ?? 0), 0) / pools.length;
            trending.avgApy = avgApy;
          }
        }

        if (!dead && Object.keys(trending).length > 0) {
          setData(trending as TrendingData);
          setLoading(false);
          setError(null);
          setLastUpdate(Date.now());
        }
      } catch (err) {
        if (!dead) {
          setLoading(false);
          setError("Failed to fetch market data");
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => {
      dead = true;
      clearInterval(interval);
    };
  }, [isDemo]);

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2" role="status" aria-live="polite">
        <div className="flex gap-4 overflow-x-auto">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col gap-1 shrink-0">
              <div className="h-3 w-16 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-20 bg-zinc-700 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading market data</span>
      </div>
    );
  }

  if (!loading && error && !data) {
    return (
      <div role="alert" aria-live="assertive">
        <ErrorAlert message="Unable to load market data" onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (!data) return null;

  const strkEth24h = data.strkEth24h ?? 0;
  const topPool = data.topPool ?? { name: "--", apy: 0 };
  const avgApy = data.avgApy ?? 0;

  const changeColor = strkEth24h >= 0 ? "text-emerald-400" : "text-red-400";
  const ChangeIcon = strkEth24h >= 0 ? TrendingUp : TrendingDown;

  const minutesSinceUpdate = Math.floor((Date.now() - lastUpdate) / 60000);
  const isStale = error && data && minutesSinceUpdate > 2;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2" role="region" aria-label="Market statistics">
      <div className="flex gap-6 overflow-x-auto items-center scrollbar-thin scrollbar-thumb-zinc-700">
        {/* STRK/ETH 24h */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-xs text-zinc-500">STRK/ETH 24h</div>
          <div className={`flex items-center gap-1 text-sm font-medium ${changeColor}`}>
            <ChangeIcon className="w-3 h-3" />
            <span>{strkEth24h > 0 ? "+" : ""}{strkEth24h.toFixed(1)}%</span>
          </div>
        </div>

        <span className="text-zinc-700" aria-hidden>|</span>

        {/* Top Pool */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-xs text-zinc-500">Top Pool</div>
          <div className="text-sm font-medium text-zinc-200">
            {topPool.name} · {topPool.apy.toFixed(1)}%
          </div>
        </div>

        <span className="text-zinc-700" aria-hidden>|</span>

        {/* Vault TVL */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-xs text-zinc-500">Vault TVL</div>
          <div className="text-sm font-medium text-zinc-200">${formatLargeNumber(data.vaultTvl)}</div>
        </div>

        <span className="text-zinc-700" aria-hidden>|</span>

        {/* Active Depositors */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-xs text-zinc-500">Depositors</div>
          <div className="text-sm font-medium text-zinc-200">{data.activeDepositors}</div>
        </div>

        <span className="text-zinc-700" aria-hidden>|</span>

        {/* Avg APY */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-xs text-zinc-500">Avg APY</div>
          <div className="text-sm font-medium text-emerald-400">{avgApy.toFixed(1)}%</div>
        </div>
      </div>
      {isStale && (
        <div className="mt-2 text-xs text-zinc-500">
          Last updated: {minutesSinceUpdate}m ago
        </div>
      )}
    </div>
  );
}
