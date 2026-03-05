"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, RefreshCw, AlertTriangle, Shield, ArrowRight, Activity, ChevronDown, ChevronUp, ExternalLink, ArrowUpDown, Flame, Zap } from "lucide-react";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import { API_BASE } from "@/lib/api/client";
import { getMarketSurface } from "@/lib/api/ekubo";
import { formatPct, formatUsd } from "@/lib/numberFormat";
import { MarketSurfaceResponse, MarketOpportunity } from "@/types/ekubo";

/* ── Types ─────────────────────────────────────────────────────────── */

interface RecenterAlert {
  nft_id: string | number;
  pair: string;
  reason: string;
  lower_tick: number;
  upper_tick: number;
  current_tick: number;
}

interface GuardStatus {
  gate_mode: string;
  passport_score: number | null;
  session_active: boolean;
}

interface OpportunityRow {
  pair: string;
  best_venue: string;
  estimated_apy_pct: number;
  reference_apy_pct: number;
  spread_bps: number;
  volume_24h_usd: number;
  risk_score: number;
  change_24h_pct?: number;
  token0?: string;
  token1?: string;
}

interface MarketsTabProps {
  userAddress?: string;
  onTrade?: (pair: string, tab: "swap" | "lp") => void;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function badge(label: string, color: string) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border ${color}`}>
      {label}
    </span>
  );
}

function riskPill(score: number) {
  if (score <= 30) return { label: "Low", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
  if (score <= 60) return { label: "Medium", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
  return { label: "High", cls: "bg-red-500/15 text-red-400 border-red-500/30" };
}

function trendMeta(value?: number): { icon: "up" | "down" | "flat"; cls: string; text: string } {
  const v = Number(value ?? 0);
  if (!Number.isFinite(v) || Math.abs(v) < 0.01) {
    return { icon: "flat", cls: "text-zinc-500", text: "Flat" };
  }
  if (v > 0) return { icon: "up", cls: "text-emerald-400", text: `+${v.toFixed(2)}%` };
  return { icon: "down", cls: "text-red-400", text: `${v.toFixed(2)}%` };
}

function formatVolume(usd: number): string {
  if (!usd || usd < 0.01) return "—";
  return formatUsd(usd);
}

function formatSpreadPct(bps: number): string {
  const pct = bps / 100;
  return `${pct.toFixed(2)}%`;
}

type SortField = "apy" | "spread" | "volume" | "risk" | "trend";
type SortDir = "asc" | "desc";

/* ── Component ─────────────────────────────────────────────────────── */

export function MarketsTab({ userAddress, onTrade }: MarketsTabProps) {
  const [surface, setSurface] = useState<MarketSurfaceResponse | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[]>([]);
  const [recenterAlerts, setRecenterAlerts] = useState<RecenterAlert[]>([]);
  const [guard, setGuard] = useState<GuardStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllOpps, setShowAllOpps] = useState(false);
  const [sortField, setSortField] = useState<SortField>("apy");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [surfaceRes, oppsRes] = await Promise.all([
        getMarketSurface().catch(() => null),
        fetch(`${API_BASE}/api/v1/strategies/opportunities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_address: userAddress ?? "0x0",
            risk_profile: "balanced",
            top_n: 10,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      if (surfaceRes) setSurface(surfaceRes);
      if (oppsRes?.opportunities) setOpps(oppsRes.opportunities);

      // Recenter alerts + guard (only with wallet)
      if (userAddress) {
        const [recRes, guardRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/strategies/recenter-alerts/${userAddress}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`${API_BASE}/api/v1/strategies/guard-status/${userAddress}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
        if (recRes?.alerts) setRecenterAlerts(recRes.alerts);
        if (guardRes) setGuard(guardRes);
      }
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => { void refresh(); }, [refresh]);
  useVisibilityPolling(() => void refresh(), 60_000, [refresh]);

  const venues = surface?.venues ?? [];
  const hasNoData = venues.length === 0 && opps.length === 0;

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const sortedOpps = useMemo(() => {
    const arr = [...opps];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortField) {
        case "apy": return dir * (a.estimated_apy_pct - b.estimated_apy_pct);
        case "spread": return dir * (a.spread_bps - b.spread_bps);
        case "volume": return dir * (a.volume_24h_usd - b.volume_24h_usd);
        case "risk": return dir * (a.risk_score - b.risk_score);
        case "trend": return dir * ((a.change_24h_pct ?? 0) - (b.change_24h_pct ?? 0));
        default: return 0;
      }
    });
    return arr;
  }, [opps, sortField, sortDir]);

  const filteredOpps = sortedOpps;
  const displayOpps = showAllOpps ? filteredOpps : filteredOpps.slice(0, 5);
  const maxApy = useMemo(() => Math.max(...opps.map((o) => o.estimated_apy_pct), 1), [opps]);

  return (
    <div className="space-y-6">
      {/* ─── Empty / Loading state ─── */}
      {hasNoData && (
        loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <RefreshCw className="w-12 h-12 text-zinc-600 mb-4 animate-spin" />
            <h3 className="text-lg font-semibold text-zinc-300 mb-2">Loading market data</h3>
            <p className="text-sm text-zinc-500 max-w-md">
              Connecting to oracle and fetching market signals…
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <TrendingUp className="w-12 h-12 text-zinc-600 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-300 mb-2">No market data available</h3>
            <p className="text-sm text-zinc-500 max-w-md">
              Market data will appear here once the oracle connects. Check back shortly.
            </p>
          </div>
        )
      )}

      {/* ─── Header ─── */}
      {!hasNoData && (
      <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Market Intelligence
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Live signals from Ekubo Sepolia — risk-scored by zkML
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* ─── Recenter Alerts ─── */}
      {recenterAlerts.length > 0 && (
        <div className="glass rounded-xl border border-amber-800/40 bg-amber-900/10 p-4 space-y-2">
          <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Position Recenter Alerts
          </h3>
          <p className="text-xs text-zinc-500">
            These LP positions have drifted significantly out of range.
          </p>
          <div className="space-y-1.5">
            {recenterAlerts.map((a, i) => (
              <div
                key={`${a.nft_id}-${i}`}
                className="flex items-center justify-between rounded-lg bg-zinc-900/60 px-3 py-2 border border-zinc-800"
              >
                <div>
                  <span className="text-sm text-zinc-200 font-mono">{a.pair || `#${a.nft_id}`}</span>
                  <span className="ml-2 text-xs text-amber-400">{a.reason.replace(/_/g, " ")}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onTrade?.(a.pair, "lp")}
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                >
                  Recenter <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Venue Overview ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {loading && venues.length === 0
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass rounded-xl border border-zinc-800 p-4 animate-pulse">
                <div className="h-4 w-24 bg-zinc-800 rounded mb-2" />
                <div className="h-3 w-16 bg-zinc-800 rounded" />
              </div>
            ))
          : venues.map((v) => (
              <div
                key={v.name}
                className="glass rounded-xl border border-zinc-800 p-4 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-zinc-200">{v.name}</span>
                  {badge("live", "border-emerald-600/40 text-emerald-400 bg-emerald-600/10")}
                </div>
                <div className="text-xs text-zinc-500 space-y-0.5">
                  <div>APY: {formatPct(v.apy_pct, 1)}</div>
                  <div>TVL: {formatUsd(v.tvl_usd)}</div>
                  <div>Vol 24h: {formatUsd(v.volume_24h_usd)}</div>
                </div>
              </div>
            ))}
      </div>

      {/* ─── Opportunities Table ─── */}
      <div className="glass rounded-xl border border-zinc-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            Risk-Scored Opportunities
          </h3>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Zap className="w-2.5 h-2.5" /> {filteredOpps.length} signals
          </span>
        </div>

        {loading && filteredOpps.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-500">Loading opportunities…</div>
        ) : filteredOpps.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-500">No opportunities detected right now.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800/50">
                    <th className="w-8 px-2 py-2 font-medium text-center">#</th>
                    <th className="text-left px-4 py-2 font-medium">Pair</th>
                    <th className="text-right px-4 py-2 font-medium">
                      <button type="button" onClick={() => toggleSort("apy")} className="inline-flex items-center gap-1 hover:text-zinc-300 ml-auto">
                        Est. APY {sortField === "apy" && <ChevronDown className={`w-2.5 h-2.5 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
                      </button>
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <button type="button" onClick={() => toggleSort("spread")} className="inline-flex items-center gap-1 hover:text-zinc-300 ml-auto">
                        Spread {sortField === "spread" && <ChevronDown className={`w-2.5 h-2.5 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
                      </button>
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <button type="button" onClick={() => toggleSort("volume")} className="inline-flex items-center gap-1 hover:text-zinc-300 ml-auto">
                        Vol 24h {sortField === "volume" && <ChevronDown className={`w-2.5 h-2.5 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
                      </button>
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      <button type="button" onClick={() => toggleSort("trend")} className="inline-flex items-center gap-1 hover:text-zinc-300 ml-auto">
                        Trend {sortField === "trend" && <ChevronDown className={`w-2.5 h-2.5 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
                      </button>
                    </th>
                    <th className="text-center px-4 py-2 font-medium">
                      <button type="button" onClick={() => toggleSort("risk")} className="inline-flex items-center gap-1 hover:text-zinc-300">
                        Risk {sortField === "risk" && <ChevronDown className={`w-2.5 h-2.5 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
                      </button>
                    </th>
                    <th className="text-right px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {displayOpps.map((o, i) => {
                    const t = trendMeta(o.change_24h_pct);
                    const risk = riskPill(o.risk_score);
                    const rank = i + 1;
                    const isTop = rank <= 3 && sortField === "apy" && sortDir === "desc";
                    const apyRatio = Math.min(o.estimated_apy_pct / maxApy, 1);
                    return (
                    <tr
                      key={`${o.pair}-${i}`}
                      className={`border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors ${
                        isTop && rank === 1 ? "bg-emerald-950/10" : ""
                      }`}
                    >
                      {/* Rank */}
                      <td className="px-2 py-2.5 text-center">
                        {isTop ? (
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                            rank === 1 ? "bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/30"
                            : rank === 2 ? "bg-zinc-400/15 text-zinc-300 ring-1 ring-zinc-500/20"
                            : "bg-amber-600/15 text-amber-500 ring-1 ring-amber-600/20"
                          }`}>{rank}</span>
                        ) : (
                          <span className="text-[10px] text-zinc-600 font-mono">{rank}</span>
                        )}
                      </td>
                      {/* Pair + venue */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {isTop && rank === 1 && <Flame className="w-3.5 h-3.5 text-yellow-400 shrink-0" />}
                          <div>
                            <span className="text-zinc-200 font-mono font-medium">{o.pair}</span>
                            <span className="text-[9px] text-zinc-600 ml-1.5">{o.best_venue}</span>
                          </div>
                        </div>
                      </td>
                      {/* APY with relative bar */}
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                o.estimated_apy_pct >= 25 ? "bg-emerald-400" : o.estimated_apy_pct >= 10 ? "bg-emerald-500/70" : "bg-emerald-600/50"
                              }`}
                              style={{ width: `${apyRatio * 100}%` }}
                            />
                          </div>
                          <span className={`font-mono font-semibold tabular-nums ${
                            o.estimated_apy_pct >= 25 ? "text-emerald-400" : o.estimated_apy_pct >= 10 ? "text-emerald-400/80" : "text-emerald-500/60"
                          }`}>
                            {formatPct(o.estimated_apy_pct, 1)}
                          </span>
                        </div>
                      </td>
                      {/* Spread as % */}
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-zinc-300 font-mono tabular-nums">
                          {formatSpreadPct(o.spread_bps)}
                        </span>
                        <span className="text-[9px] text-zinc-600 ml-1">
                          {o.spread_bps.toFixed(0)}bp
                        </span>
                      </td>
                      {/* Volume */}
                      <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                        o.volume_24h_usd > 0 ? "text-zinc-300" : "text-zinc-600"
                      }`}>
                        {formatVolume(o.volume_24h_usd)}
                      </td>
                      {/* Trend */}
                      <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${t.cls}`}>
                        {t.icon === "flat" ? (
                          <span className="text-zinc-600">—</span>
                        ) : (
                          <span>{t.text}</span>
                        )}
                      </td>
                      {/* Risk pill */}
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full border ${risk.cls}`}>
                          {risk.label}
                        </span>
                      </td>
                      {/* Trade CTA */}
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            const isLp = o.best_venue.toLowerCase() === "ekubo" && o.spread_bps >= 0;
                            onTrade?.(o.pair, isLp ? "lp" : "swap");
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30 transition-colors"
                        >
                          Trade <ExternalLink className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredOpps.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllOpps((v) => !v)}
                className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 text-center hover:bg-zinc-800/30 transition-colors flex items-center justify-center gap-1"
              >
                {showAllOpps ? (
                  <>Show less <ChevronUp className="w-3 h-3" /></>
                ) : (
                  <>Show all {filteredOpps.length} <ChevronDown className="w-3 h-3" /></>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {/* ─── System Health Footer ─── */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] text-zinc-600 px-1">
        <span className="flex items-center gap-1">
          <Shield className="w-3 h-3" />
          Gate: {guard?.gate_mode ?? "—"}
        </span>
        <span>Passport: {guard?.passport_score ?? "—"}</span>
        <span>Session: {guard?.session_active ? "Active" : "None"}</span>
        <span className="ml-auto">
          Last update: {surface?.timestamp ? new Date(surface.timestamp).toLocaleTimeString() : "—"}
        </span>
      </div>
      </>
      )}
    </div>
  );
}
