"use client";

import { useState, useEffect } from "react";

/**
 * LiveStatsBanner — fetches real protocol stats from the backend /stats endpoint
 * and renders a compact data bar showing live Starknet mainnet coverage.
 *
 * Falls back to static values if the API is unreachable.
 */

interface StatsData {
  protocols: number;
  pools: number;
  tvl_usd: number;
  protocol_names: string[];
}

const FALLBACK: StatsData = {
  protocols: 5,
  pools: 80,
  tvl_usd: 75_000_000,
  protocol_names: ["ekubo", "endur", "nostra", "troves", "vesu"],
};

const DISPLAY_NAMES: Record<string, string> = {
  ekubo: "Ekubo",
  vesu: "Vesu",
  endur: "Endur",
  nostra: "Nostra",
  troves: "Troves",
};

function formatTvl(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

export function LiveStatsBanner() {
  const [stats, setStats] = useState<StatsData>(FALLBACK);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchStats() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "";
        const res = await fetch(`${apiBase}/api/v1/strategies/stats`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data: StatsData = await res.json();
        if (data.pools > 0) {
          setStats(data);
          setLive(true);
        }
      } catch {
        // keep fallback
      }
    }

    fetchStats();
    // Refresh every 5 minutes
    const interval = setInterval(fetchStats, 5 * 60 * 1000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs">
      <span className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            live ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
          }`}
        />
        <span className="text-zinc-500">
          {live ? "Live Mainnet" : "Starknet Mainnet"}
        </span>
      </span>

      {[
        { value: String(stats.protocols), label: "protocols", color: "text-emerald-400" },
        { value: `${stats.pools}+`, label: "pools", color: "text-cyan-400" },
        { value: `${formatTvl(stats.tvl_usd)}+`, label: "TVL tracked", color: "text-amber-400" },
      ].map((s) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span className={`font-semibold ${s.color}`}>{s.value}</span>
          <span className="text-zinc-600">{s.label}</span>
        </span>
      ))}

      <span className="flex items-center gap-1.5 text-zinc-600">
        {stats.protocol_names
          .map((n) => DISPLAY_NAMES[n] ?? n)
          .join(" · ")}
      </span>
    </div>
  );
}
