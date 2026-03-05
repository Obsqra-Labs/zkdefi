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

const DEFAULT_TRENDING: TrendingData = {
  strkEth24h: 0,
  topPool: { name: "Unknown", apy: 0 },
  vaultTvl: 0,
  activeDepositors: 0,
  avgApy: 0,
};

function formatLargeNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

export function TrendingBar({ isDemo }: TrendingBarProps) {
  const [data, setData] = useState<TrendingData>(
    isDemo
      ? {
          ...DEFAULT_TRENDING,
          ...DEMO_TRENDING,
          topPool: DEMO_TRENDING.topPool ?? DEFAULT_TRENDING.topPool,
        }
      : DEFAULT_TRENDING
  );
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Entrance animation trigger
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const fetchData = async (signal?: AbortSignal) => {
    try {
      const [marketRes, poolRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/zkdefi/market/surface`, { signal: signal ?? AbortSignal.timeout(8000) }),
        fetch(`${API_BASE}/api/v1/zkdefi/oracle/pool-apys`, { signal: signal ?? AbortSignal.timeout(8000) }),
      ]);

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

      if (Object.keys(trending).length > 0) {
        setData((prev) => {
          const base = prev ?? DEFAULT_TRENDING;
          return {
            ...base,
            ...trending,
            topPool: trending.topPool ?? base.topPool ?? DEFAULT_TRENDING.topPool,
          };
        });
      }
      setError(null);
      setLoading(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Market data unavailable");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();

    fetchData(controller.signal);
    const iv = window.setInterval(() => fetchData(), 30_000);
    return () => {
      controller.abort();
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo]);

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2" aria-busy="true" aria-label="Loading market data">
        <div className="flex gap-4 overflow-x-auto">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col gap-1 shrink-0">
              <div className="h-3 w-16 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-20 bg-zinc-700 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border border-red-800/40 bg-red-900/10 px-4 py-2"
        role="alert"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs text-red-400">{error}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); setError(null); fetchData(); }}
            className="text-xs text-red-300 hover:text-white underline underline-offset-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            aria-label="Retry loading market data"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const changeColor = data.strkEth24h >= 0 ? "text-emerald-400" : "text-red-400";
  const ChangeIcon = data.strkEth24h >= 0 ? TrendingUp : TrendingDown;

  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2 transition-opacity duration-300 ${mounted ? "opacity-100" : "opacity-0"}`}
      role="status"
      aria-label="Market pulse"
    >
      <div className="flex gap-4 sm:gap-6 overflow-x-auto items-center">
        {/* STRK/ETH 24h */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-[10px] sm:text-xs text-zinc-500">STRK/ETH 24h</div>
          <div className={`flex items-center gap-1 text-xs sm:text-sm font-medium ${changeColor}`}>
            <ChangeIcon className="w-3 h-3" aria-hidden="true" />
            <span>{data.strkEth24h > 0 ? "+" : ""}{data.strkEth24h.toFixed(1)}%</span>
          </div>
        </div>

        <span className="text-zinc-700 hidden sm:inline" aria-hidden="true">|</span>

        {/* Top Pool */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-[10px] sm:text-xs text-zinc-500">Top Pool</div>
          <div className="text-xs sm:text-sm font-medium text-zinc-200">
            {data.topPool.name} · {data.topPool.apy.toFixed(1)}%
          </div>
        </div>

        <span className="text-zinc-700 hidden sm:inline" aria-hidden="true">|</span>

        {/* Vault TVL */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-[10px] sm:text-xs text-zinc-500">Vault TVL</div>
          <div className="text-xs sm:text-sm font-medium text-zinc-200">${formatLargeNumber(data.vaultTvl)}</div>
        </div>

        <span className="text-zinc-700 hidden sm:inline" aria-hidden="true">|</span>

        {/* Active Depositors */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-[10px] sm:text-xs text-zinc-500">Depositors</div>
          <div className="text-xs sm:text-sm font-medium text-zinc-200">{data.activeDepositors}</div>
        </div>

        <span className="text-zinc-700 hidden sm:inline" aria-hidden="true">|</span>

        {/* Avg APY */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <div className="text-[10px] sm:text-xs text-zinc-500">Avg APY</div>
          <div className="text-xs sm:text-sm font-medium text-emerald-400">{data.avgApy.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}
