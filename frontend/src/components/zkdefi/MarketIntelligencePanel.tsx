"use client";

import { MarketOpportunity, MarketSurfaceResponse } from "@/types/ekubo";
import { ArrowRight, RefreshCw, TrendingUp } from "lucide-react";
import { formatPct, formatUsd } from "@/lib/numberFormat";

interface MarketIntelligencePanelProps {
  data: MarketSurfaceResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectPair?: (token0: string, token1: string) => void;
  onTriggerOpportunity?: (row: MarketOpportunity) => void;
}

function formatUpdatedAt(value?: string): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MarketIntelligencePanel({
  data,
  loading,
  error,
  onRefresh,
  onSelectPair,
  onTriggerOpportunity,
}: MarketIntelligencePanelProps) {
  const opportunities = data?.opportunities ?? [];

  return (
    <div className="glass rounded-xl border border-zinc-800 p-5">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-emerald-400" />
        <h3 className="font-semibold">Market Intelligence</h3>
        <span className="ml-auto text-xs text-zinc-500">Updated {formatUpdatedAt(data?.updated_at)}</span>
        {data?.stale && (
          <span className="px-2 py-0.5 text-[10px] rounded border border-amber-600/40 bg-amber-500/10 text-amber-300">
            Stale
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          className="p-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          title="Refresh market surface"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-500/10 text-amber-200 text-xs p-3 mb-4">
          {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {data.venues.map((venue) => (
            <div key={venue.name} className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{venue.name}</span>
                <span className="text-sm text-emerald-400">{formatPct(venue.apy_pct, 2)} APY</span>
              </div>
              <div className="text-xs text-zinc-400 flex items-center gap-3">
                <span>TVL {formatUsd(venue.tvl_usd)}</span>
                <span>Vol {formatUsd(venue.volume_24h_usd)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!data && loading && <div className="text-sm text-zinc-500">Loading market intelligence...</div>}

      {data && opportunities.length > 0 && (
        <div className="space-y-2">
          {opportunities.slice(0, 4).map((row) => (
            <div key={`${row.pair}-${row.token0}-${row.token1}`} className="rounded-lg border border-zinc-700/50 bg-zinc-900/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-200">{row.pair}</p>
                  <p className="text-xs text-zinc-500">
                    Best venue: <span className="text-zinc-300">{row.best_venue}</span> • Spread {row.spread_bps} bps
                  </p>
                  <p className="text-xs text-zinc-500">
                    Suggested action:{" "}
                    <span className="text-zinc-300">
                      {row.best_venue.toLowerCase() === "ekubo" && row.spread_bps >= 0
                        ? "Rebalance to LP"
                        : "Rotate via swap"}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-emerald-300">{formatPct(row.estimated_apy_pct, 2)} est</span>
                  <button
                    type="button"
                    onClick={() => onTriggerOpportunity?.(row)}
                    disabled={!row.token0 || !row.token1}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 hover:border-cyan-600/50 text-xs text-zinc-200 disabled:opacity-40"
                  >
                    Trigger AI
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectPair?.(row.token0, row.token1)}
                    disabled={!row.token0 || !row.token1}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 hover:border-emerald-600/50 text-xs text-zinc-200 disabled:opacity-40"
                  >
                    Use pair <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
