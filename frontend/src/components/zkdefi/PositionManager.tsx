"use client";

/**
 * PositionManager — unified position table with search, filter, sort,
 * pagination, and health-summary for 100+ positions.
 *
 * Fetches from Ekubo positions API and merges yield snapshot data.
 * Normalizes both into a single view.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  Filter,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  Circle,
  TrendingUp,
  RefreshCw,
  ChevronDown,
  X,
} from "lucide-react";
import { getEkuboPositions } from "@/lib/api/ekubo";
import { getYieldSnapshot, type YieldSnapshotResponse, type YieldPositionItem } from "@/lib/api/strategies";
import type { EkuboPosition } from "@/types/ekubo";
import { resolveTokenSymbol, resolveTokenDecimals, feeTierLabel, formatRawAmount } from "@/lib/tokens";

// Re-export for backward compat (other components may import from here)
export { resolveTokenSymbol } from "@/lib/tokens";

const resolveDecimals = resolveTokenDecimals;
const formatAmt = formatRawAmount;

// ---------------------------------------------------------------------------
// Normalized position type
// ---------------------------------------------------------------------------

export type RangeStatus = "in-range" | "near-range" | "out-of-range" | "unknown";

export interface NormalizedPosition {
  id: string;
  pair: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  amount0: string;
  amount1: string;
  feeTier: number;
  feeTierStr: string;
  lowerTick: number;
  upperTick: number;
  currentTick: number | null;
  rangeStatus: RangeStatus;
  rangeDist: number; // ticks from range edge, 0 if in range
  apr: number;
  feesUsd: number;
  status: string;
  harvestTx: string | null;
  createdAt: string;
  source: "ekubo" | "yield";
}

// ---------------------------------------------------------------------------
// Health Summary
// ---------------------------------------------------------------------------

export interface PositionHealthSummary {
  total: number;
  inRange: number;
  nearRange: number;
  outOfRange: number;
  unknown: number;
  totalFeesUsd: number;
  totalHarvested: number;
  avgApr: number;
  uniquePairs: number;
}

// ---------------------------------------------------------------------------
// Pair-level aggregate (for grouped dashboard view)
// ---------------------------------------------------------------------------

export interface PairAggregate {
  pair: string;
  token0Symbol: string;
  token1Symbol: string;
  count: number;
  inRange: number;
  outOfRange: number;
  nearRange: number;
  totalFeesUsd: number;
  avgApr: number;
  feeTier: string;
  positions: NormalizedPosition[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type SortKey = "pair" | "apr" | "fees" | "status" | "created";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "in-range" | "near-range" | "out-of-range";

export interface PositionManagerProps {
  address: string | undefined;
  currentTick?: number | null;
  /** Number of positions per page */
  pageSize?: number;
  /** External refresh trigger counter */
  refreshTrigger?: number;
  /** Compact mode — smaller rows */
  compact?: boolean;
  /** Show harvest button */
  showHarvest?: boolean;
  onHarvestAll?: () => void;
  harvesting?: boolean;
  /** Click handler for individual position */
  onPositionClick?: (pos: NormalizedPosition) => void;
  /** Handler to reposition all out-of-range positions (triggers backend rebalance) */
  onRepositionAll?: () => void;
  repositioning?: boolean;
  /** Handler to close stale out-of-range positions */
  onCloseStale?: () => void;
  closingStale?: boolean;
}

const PAGE_SIZE_DEFAULT = 25;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PositionManager({
  address,
  currentTick,
  pageSize = PAGE_SIZE_DEFAULT,
  refreshTrigger = 0,
  compact = false,
  showHarvest = true,
  onHarvestAll,
  harvesting = false,
  onPositionClick,
  onRepositionAll,
  repositioning = false,
  onCloseStale,
  closingStale = false,
}: PositionManagerProps) {
  // --- Data state ---
  const [positions, setPositions] = useState<NormalizedPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- UI state ---
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("fees");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"aggregate" | "individual">("aggregate");
  const [expandedPairs, setExpandedPairs] = useState<Set<string>>(new Set());

  // --- Fetch & normalize ---
  const fetchPositions = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch both sources in parallel
      const [ekuboRes, yieldRes] = await Promise.allSettled([
        getEkuboPositions(address),
        getYieldSnapshot(address),
      ]);

      const normalized: NormalizedPosition[] = [];
      const yieldMap = new Map<string, YieldPositionItem>();

      // Index yield data by position_id
      if (yieldRes.status === "fulfilled" && yieldRes.value?.positions) {
        for (const yp of yieldRes.value.positions) {
          yieldMap.set(yp.position_id, yp);
        }
      }

      // Primary: Ekubo positions
      if (ekuboRes.status === "fulfilled" && ekuboRes.value?.positions) {
        for (const ep of ekuboRes.value.positions) {
          const yp = yieldMap.get(ep.position_id);
          yieldMap.delete(ep.position_id); // remove so we don't double-count

          const tick = currentTick ?? ep.current_tick_at_build ?? null;
          const { rangeStatus, rangeDist } = computeRange(tick, ep.lower_tick, ep.upper_tick);
          const t0s = resolveTokenSymbol(ep.token0);
          const t1s = resolveTokenSymbol(ep.token1);

          normalized.push({
            id: ep.position_id,
            pair: `${t0s}/${t1s}`,
            token0: ep.token0,
            token1: ep.token1,
            token0Symbol: t0s,
            token1Symbol: t1s,
            amount0: formatAmt(ep.amount0, resolveDecimals(ep.token0)),
            amount1: formatAmt(ep.amount1, resolveDecimals(ep.token1)),
            feeTier: ep.fee_tier,
            feeTierStr: feeTierLabel(ep.fee_tier),
            lowerTick: ep.lower_tick,
            upperTick: ep.upper_tick,
            currentTick: tick,
            rangeStatus,
            rangeDist,
            apr: yp?.apr_est ?? ep.estimated_fees_apr ?? 0,
            feesUsd: yp?.total_fees_usd ?? 0,
            status: ep.status,
            harvestTx: yp?.harvest_tx ?? null,
            createdAt: ep.created_at,
            source: "ekubo",
          });
        }
      }

      // Remaining yield-only positions (not in ekubo tracker)
      for (const [, yp] of yieldMap) {
        const tick = currentTick ?? null;
        const lt = yp.lower_tick ?? 0;
        const ut = yp.upper_tick ?? 0;
        const { rangeStatus, rangeDist } = computeRange(tick, lt, ut);
        const parts = (yp.pair || "?/?").split("/");
        normalized.push({
          id: yp.position_id,
          pair: yp.pair || "Unknown",
          token0: "",
          token1: "",
          token0Symbol: parts[0] || "?",
          token1Symbol: parts[1] || "?",
          amount0: "—",
          amount1: "—",
          feeTier: 0,
          feeTierStr: "—",
          lowerTick: lt,
          upperTick: ut,
          currentTick: tick,
          rangeStatus,
          rangeDist,
          apr: yp.apr_est,
          feesUsd: yp.total_fees_usd,
          status: yp.status,
          harvestTx: yp.harvest_tx ?? null,
          createdAt: "",
          source: "yield",
        });
      }

      setPositions(normalized);
    } catch (e: any) {
      setError(e?.message || "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }, [address, currentTick]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions, refreshTrigger]);

  // --- Derived: filtered + sorted ---
  const { filtered, summary } = useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();

    // Filter
    let result = positions;
    if (lowerSearch) {
      result = result.filter(
        (p) =>
          p.pair.toLowerCase().includes(lowerSearch) ||
          p.token0Symbol.toLowerCase().includes(lowerSearch) ||
          p.token1Symbol.toLowerCase().includes(lowerSearch) ||
          p.id.toLowerCase().includes(lowerSearch)
      );
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.rangeStatus === statusFilter);
    }

    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case "pair":
          return dir * a.pair.localeCompare(b.pair);
        case "apr":
          return dir * (a.apr - b.apr);
        case "fees":
          return dir * (a.feesUsd - b.feesUsd);
        case "status": {
          const order: Record<RangeStatus, number> = { "in-range": 0, "near-range": 1, "out-of-range": 2, "unknown": 3 };
          return dir * (order[a.rangeStatus] - order[b.rangeStatus]);
        }
        case "created":
          return dir * (new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
        default:
          return 0;
      }
    });

    // Summary (computed from ALL positions, not filtered)
    const summary: PositionHealthSummary = {
      total: positions.length,
      inRange: positions.filter((p) => p.rangeStatus === "in-range").length,
      nearRange: positions.filter((p) => p.rangeStatus === "near-range").length,
      outOfRange: positions.filter((p) => p.rangeStatus === "out-of-range").length,
      unknown: positions.filter((p) => p.rangeStatus === "unknown").length,
      totalFeesUsd: positions.reduce((s, p) => s + p.feesUsd, 0),
      totalHarvested: positions.filter((p) => p.harvestTx).length,
      avgApr: positions.length > 0 ? positions.reduce((s, p) => s + p.apr, 0) / positions.length : 0,
      uniquePairs: new Set(positions.map((p) => p.pair)).size,
    };

    return { filtered: result, summary };
  }, [positions, search, statusFilter, sortKey, sortDir]);

  // --- Derived: valid vs broken, pair aggregates ---
  const { validPositions, brokenCount, pairAggregates } = useMemo(() => {
    const isBroken = (p: NormalizedPosition) =>
      p.pair === "/" ||
      p.token0Symbol.includes("\u2026") ||
      p.token1Symbol.includes("\u2026") ||
      (p.token0 === "" && p.token1 === "" && p.source === "ekubo");

    const valid = filtered.filter((p) => !isBroken(p));
    const broken = filtered.length - valid.length;

    const groups = new Map<string, NormalizedPosition[]>();
    for (const p of valid) {
      if (!groups.has(p.pair)) groups.set(p.pair, []);
      groups.get(p.pair)!.push(p);
    }

    const aggregates: PairAggregate[] = [];
    for (const [pair, posArr] of groups) {
      const sorted = [...posArr].sort((a, b) => b.feesUsd - a.feesUsd);
      aggregates.push({
        pair,
        token0Symbol: sorted[0].token0Symbol,
        token1Symbol: sorted[0].token1Symbol,
        count: sorted.length,
        inRange: sorted.filter((p) => p.rangeStatus === "in-range").length,
        outOfRange: sorted.filter((p) => p.rangeStatus === "out-of-range").length,
        nearRange: sorted.filter((p) => p.rangeStatus === "near-range").length,
        totalFeesUsd: sorted.reduce((s, p) => s + p.feesUsd, 0),
        avgApr: sorted.length > 0 ? sorted.reduce((s, p) => s + p.apr, 0) / sorted.length : 0,
        feeTier: sorted[0].feeTierStr,
        positions: sorted,
      });
    }

    aggregates.sort((a, b) => b.totalFeesUsd - a.totalFeesUsd || b.count - a.count);
    return { validPositions: valid, brokenCount: broken, pairAggregates: aggregates };
  }, [filtered]);

  // --- Pagination ---
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagePositions = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // Reset page when filters change
  useEffect(() => setPage(0), [search, statusFilter, sortKey, sortDir]);

  // --- Sort toggle helper ---
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div className="space-y-4">
      {/* ── Health Summary Banner ──────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <SummaryPill
          label="Active Pairs"
          value={pairAggregates.length}
          color="text-cyan-400"
          onClick={() => { setStatusFilter("all"); setViewMode("aggregate"); }}
          active={statusFilter === "all"}
        />
        <SummaryPill
          label="In Range"
          value={summary.inRange}
          color="text-emerald-400"
          icon={<CheckCircle className="w-3 h-3" />}
          onClick={() => setStatusFilter(statusFilter === "in-range" ? "all" : "in-range")}
          active={statusFilter === "in-range"}
        />
        <SummaryPill
          label="Near"
          value={summary.nearRange}
          color="text-yellow-400"
          icon={<Circle className="w-3 h-3" />}
          onClick={() => setStatusFilter(statusFilter === "near-range" ? "all" : "near-range")}
          active={statusFilter === "near-range"}
        />
        <SummaryPill
          label="Out of Range"
          value={summary.outOfRange}
          color="text-red-400"
          icon={<AlertTriangle className="w-3 h-3" />}
          onClick={() => setStatusFilter(statusFilter === "out-of-range" ? "all" : "out-of-range")}
          active={statusFilter === "out-of-range"}
        />
        <div className="glass rounded-lg border border-emerald-700/40 bg-emerald-950/10 px-3 py-2 text-center">
          <p className="text-[9px] uppercase tracking-wider text-emerald-500">Fees Earned</p>
          <p className="text-sm font-bold text-emerald-400 font-mono">${summary.totalFeesUsd.toFixed(4)}</p>
          <p className="text-[8px] text-zinc-600">{validPositions.length} positions</p>
        </div>
      </div>

      {/* Hidden broken positions notice */}
      {brokenCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-[10px] text-zinc-500">
          <AlertTriangle className="w-3 h-3 text-zinc-600 shrink-0" />
          <span>{brokenCount} positions with unresolvable tokens hidden</span>
          <button
            type="button"
            onClick={() => setViewMode("individual")}
            className="text-zinc-400 hover:text-zinc-200 ml-auto underline"
          >
            Show all
          </button>
        </div>
      )}

      {/* Range Health Alert — shown when majority of positions are out of range */}
      {(() => {
        const total = summary.inRange + summary.nearRange + summary.outOfRange;
        const healthPct = total > 0 ? Math.round(((summary.inRange + summary.nearRange) / total) * 100) : 100;
        const isUnhealthy = total > 5 && healthPct < 30;
        const isWarning = total > 5 && healthPct >= 30 && healthPct < 60;
        if (!isUnhealthy && !isWarning) return null;
        return (
          <div className={`rounded-xl border p-4 ${isUnhealthy ? "border-red-800/50 bg-red-950/20" : "border-yellow-800/40 bg-yellow-950/10"}`}>
            <div className="flex items-start gap-3">
              <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${isUnhealthy ? "text-red-400" : "text-yellow-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className={`text-sm font-semibold ${isUnhealthy ? "text-red-300" : "text-yellow-300"}`}>
                    {healthPct}% Range Health
                  </h4>
                  {/* Health bar — show inverse (unhealthy portion) when 0% */}
                  <div className="flex-1 max-w-[200px] h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    {healthPct === 0 ? (
                      <div className="h-full w-full rounded-full bg-red-500/60" />
                    ) : (
                      <div
                        className={`h-full rounded-full transition-all ${healthPct > 60 ? "bg-emerald-500" : healthPct > 30 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${healthPct}%` }}
                      />
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 mb-2">
                  {summary.outOfRange} of {total} positions are out of range and not earning fees.
                  {summary.outOfRange > 20 && " Consider closing stale positions and repositioning around current prices."}
                  {summary.outOfRange <= 20 && " Price may have drifted — wider tick ranges or repositioning can help."}
                </p>
                <div className="flex items-center gap-2">
                  {onRepositionAll && (
                    <button
                      type="button"
                      onClick={onRepositionAll}
                      disabled={repositioning}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                        isUnhealthy
                          ? "bg-red-600/20 text-red-300 hover:bg-red-600/30 border border-red-700/40"
                          : "bg-yellow-600/20 text-yellow-300 hover:bg-yellow-600/30 border border-yellow-700/40"
                      }`}
                    >
                      {repositioning ? (
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      Reposition All
                    </button>
                  )}
                  {onCloseStale && summary.outOfRange > 5 && (
                    <button
                      type="button"
                      onClick={onCloseStale}
                      disabled={closingStale}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700/40"
                    >
                      {closingStale ? (
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <X className="w-3 h-3" />
                      )}
                      Close {summary.outOfRange} Stale
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Search + Filter Bar ───────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search pairs, tokens, IDs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-lg border border-zinc-700 bg-zinc-900/60 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-600 focus:outline-none"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
            </button>
          )}
        </div>

        {/* Sort selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900/60 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortKey === "fees" ? "Fees" : sortKey === "apr" ? "APR" : sortKey === "pair" ? "Pair" : sortKey === "status" ? "Status" : "Date"}
            {sortDir === "desc" ? " ↓" : " ↑"}
          </button>
          {showFilters && (
            <div className="absolute right-0 top-full mt-1 z-20 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl py-1 min-w-[140px]">
              {(["fees", "apr", "pair", "status", "created"] as SortKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { toggleSort(k); setShowFilters(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 ${sortKey === k ? "text-emerald-400" : "text-zinc-400"}`}
                >
                  {k === "fees" ? "Fees earned" : k === "apr" ? "APR" : k === "pair" ? "Pair name" : k === "status" ? "Range status" : "Date created"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View toggle */}
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode("aggregate")}
            className={`px-2.5 py-2 text-[10px] font-medium transition-colors ${viewMode === "aggregate" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            By Pair
          </button>
          <button
            type="button"
            onClick={() => setViewMode("individual")}
            className={`px-2.5 py-2 text-[10px] font-medium transition-colors ${viewMode === "individual" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            All
          </button>
        </div>

        {/* Refresh */}
        <button
          type="button"
          onClick={fetchPositions}
          disabled={loading}
          className="px-2.5 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>

        {/* Collect Fees */}
        {showHarvest && onHarvestAll && (
          <button
            type="button"
            onClick={onHarvestAll}
            disabled={harvesting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium"
          >
            {harvesting ? (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <TrendingUp className="w-3.5 h-3.5" />
            )}
            Collect Fees
          </button>
        )}
      </div>

      {/* Filter count / clear */}
      {(search || statusFilter !== "all") && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>Showing {filtered.length} of {positions.length} positions</span>
          <button
            type="button"
            onClick={() => { setSearch(""); setStatusFilter("all"); }}
            className="text-emerald-400 hover:text-emerald-300"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* ── Loading / Error / Empty ───────────────────────── */}
      {loading && positions.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && positions.length === 0 && (
        <div className="glass rounded-xl border border-amber-800/30 p-6 text-center">
          <p className="text-amber-400 text-sm mb-2">{error}</p>
          <button type="button" onClick={fetchPositions} className="text-xs text-zinc-400 hover:text-zinc-200">Retry</button>
        </div>
      )}

      {!loading && !error && positions.length === 0 && (
        <div className="glass rounded-xl border border-zinc-800 p-10 text-center">
          <p className="text-zinc-500 text-sm">No positions found.</p>
        </div>
      )}

      {/* ── Aggregate View (grouped by pair) ────────────── */}
      {viewMode === "aggregate" && pairAggregates.length > 0 && (
        <div className="glass rounded-xl border border-zinc-800 overflow-hidden">
          <div className="grid grid-cols-6 gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
            <span>Pool Pair</span>
            <span className="text-center">Positions</span>
            <span className="text-center">Range Status</span>
            <span className="text-right">Fees Earned</span>
            <span className="text-right">Avg APR</span>
            <span className="text-right">Fee Tier</span>
          </div>

          {pairAggregates.map((agg) => (
            <div key={agg.pair}>
              <div
                onClick={() => {
                  setExpandedPairs((prev) => {
                    const next = new Set(prev);
                    if (next.has(agg.pair)) next.delete(agg.pair);
                    else next.add(agg.pair);
                    return next;
                  });
                }}
                className="grid grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800/50 text-xs hover:bg-zinc-800/30 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform shrink-0 ${expandedPairs.has(agg.pair) ? "" : "-rotate-90"}`} />
                  <span className="text-zinc-200 font-semibold truncate">{agg.pair}</span>
                </div>
                <div className="text-center">
                  <span className="text-zinc-300 font-mono bg-zinc-800 px-2 py-0.5 rounded text-[11px]">{agg.count}</span>
                </div>
                <div className="flex items-center justify-center">
                  {agg.count === 0 ? (
                    <span className="text-zinc-600 text-[10px]">—</span>
                  ) : agg.outOfRange === agg.count ? (
                    /* All out of range — simple pill */
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                      {agg.count} out
                    </span>
                  ) : agg.inRange === agg.count ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {agg.count} in ✓
                    </span>
                  ) : (
                    /* Mixed — compact bar + counts */
                    <div className="flex items-center gap-1.5">
                      <div className="w-14 h-1.5 bg-zinc-800 rounded-full overflow-hidden flex">
                        {agg.inRange > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(agg.inRange / agg.count) * 100}%` }} />}
                        {agg.nearRange > 0 && <div className="h-full bg-yellow-500" style={{ width: `${(agg.nearRange / agg.count) * 100}%` }} />}
                        {agg.outOfRange > 0 && <div className="h-full bg-red-500" style={{ width: `${(agg.outOfRange / agg.count) * 100}%` }} />}
                      </div>
                      <span className="text-[9px] text-zinc-500">
                        {agg.inRange > 0 && <span className="text-emerald-400">{agg.inRange}</span>}
                        {agg.inRange > 0 && agg.outOfRange > 0 && "/"}
                        {agg.outOfRange > 0 && <span className="text-red-400">{agg.outOfRange}</span>}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <span className={`font-mono font-medium ${agg.totalFeesUsd > 0.001 ? "text-emerald-400" : "text-zinc-600"}`}>
                    {agg.totalFeesUsd > 0.001 ? `$${agg.totalFeesUsd.toFixed(4)}` : "—"}
                  </span>
                </div>
                <div className="text-right">
                  <span className={`font-mono ${agg.avgApr > 10 ? "text-emerald-400" : agg.avgApr > 0 ? "text-zinc-300" : "text-zinc-600"}`}>
                    {agg.avgApr > 0 ? `${agg.avgApr.toFixed(1)}%` : "—"}
                  </span>
                </div>
                <div className="text-right text-zinc-500">{agg.feeTier}</div>
              </div>

              {expandedPairs.has(agg.pair) && (
                <div className="bg-zinc-900/40">
                  {/* Sub-header for expanded pair */}
                  <div className="grid grid-cols-6 gap-2 px-4 py-1.5 text-[9px] uppercase tracking-wider text-zinc-600 border-b border-zinc-800/30">
                    <span className="pl-6">Position</span>
                    <span>Liquidity</span>
                    <span className="text-center">Status</span>
                    <span className="text-right">Fees</span>
                    <span className="text-right">APR</span>
                    <span className="text-right">Ticks</span>
                  </div>
                  {agg.positions.map((pos) => {
                    // Skip positions with zero amounts if there are many
                    const hasLiquidity = pos.amount0 !== "0" || pos.amount1 !== "0";
                    return (
                    <div
                      key={pos.id}
                      onClick={() => onPositionClick?.(pos)}
                      className={`grid grid-cols-6 gap-2 px-4 py-2 border-b border-zinc-800/20 text-[11px] hover:bg-zinc-800/20 ${onPositionClick ? "cursor-pointer" : ""} ${!hasLiquidity ? "opacity-40" : ""}`}
                    >
                      <div className="flex items-center gap-1.5 pl-6 min-w-0">
                        <RangeDot status={pos.rangeStatus} />
                        <span className="text-zinc-500 font-mono text-[9px] truncate" title={pos.id}>
                          {pos.id.slice(0, 6)}…{pos.id.slice(-4)}
                        </span>
                      </div>
                      <div className="text-zinc-400 font-mono truncate text-[10px]">
                        {hasLiquidity ? (
                          <>{pos.amount0} <span className="text-zinc-600">{pos.token0Symbol}</span></>
                        ) : (
                          <span className="text-zinc-600">empty</span>
                        )}
                      </div>
                      <div className="flex items-center justify-center">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          pos.rangeStatus === "in-range" ? "bg-emerald-900/30 text-emerald-400" :
                          pos.rangeStatus === "near-range" ? "bg-yellow-900/30 text-yellow-400" :
                          pos.rangeStatus === "out-of-range" ? "bg-red-900/30 text-red-400" :
                          "bg-zinc-800 text-zinc-500"
                        }`}>
                          {pos.rangeStatus === "in-range" ? "In Range" : pos.rangeStatus === "near-range" ? "Near" : pos.rangeStatus === "out-of-range" ? "Out" : "—"}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className={`font-mono ${pos.feesUsd > 0 ? "text-emerald-400" : "text-zinc-600"}`}>
                          {pos.feesUsd > 0.0001 ? `$${pos.feesUsd.toFixed(4)}` : "—"}
                        </span>
                        {pos.harvestTx && <span className="text-[8px] text-cyan-500 block">collected</span>}
                      </div>
                      <div className="text-right">
                        <span className={`font-mono ${pos.apr > 0 ? "text-zinc-300" : "text-zinc-600"}`}>
                          {pos.apr > 0 ? `${pos.apr.toFixed(1)}%` : "—"}
                        </span>
                      </div>
                      <div className="text-right text-[9px] font-mono text-zinc-600" title={`Lower: ${pos.lowerTick} / Upper: ${pos.upperTick}`}>
                        {pos.lowerTick}…{pos.upperTick}
                      </div>
                    </div>
                    );
                  })}
                  {/* Pair subtotal */}
                  {agg.count > 3 && (
                    <div className="flex items-center justify-between px-4 py-1.5 text-[9px] text-zinc-600 bg-zinc-900/20">
                      <span className="pl-6">{agg.count} positions</span>
                      <span>
                        Subtotal: <span className={agg.totalFeesUsd > 0.001 ? "text-emerald-400 font-mono" : "text-zinc-600"}>
                          {agg.totalFeesUsd > 0.001 ? `$${agg.totalFeesUsd.toFixed(4)}` : "—"}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="flex items-center justify-between px-4 py-2 text-[10px] text-zinc-600 bg-zinc-900/30">
            <span>{pairAggregates.length} pairs · {validPositions.length} positions</span>
            <span>Total fees: <span className="text-emerald-400 font-mono">${summary.totalFeesUsd.toFixed(4)}</span></span>
          </div>
        </div>
      )}

      {/* ── Position Table (individual view) ──────────── */}
      {viewMode === "individual" && pagePositions.length > 0 && (
        <div className="glass rounded-xl border border-zinc-800 overflow-hidden">
          {/* Table header */}
          <div className={`grid ${compact ? "grid-cols-5" : "grid-cols-7"} gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500`}>
            <button type="button" onClick={() => toggleSort("pair")} className="flex items-center gap-1 hover:text-zinc-300 text-left">
              Pair {sortKey === "pair" && <ChevronDown className={`w-2.5 h-2.5 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
            </button>
            <button type="button" onClick={() => toggleSort("status")} className="flex items-center gap-1 hover:text-zinc-300">
              Range {sortKey === "status" && <ChevronDown className={`w-2.5 h-2.5 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
            </button>
            {!compact && (
              <>
                <span>Amount 0</span>
                <span>Amount 1</span>
              </>
            )}
            <button type="button" onClick={() => toggleSort("apr")} className="flex items-center gap-1 hover:text-zinc-300 justify-end">
              APR {sortKey === "apr" && <ChevronDown className={`w-2.5 h-2.5 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
            </button>
            <button type="button" onClick={() => toggleSort("fees")} className="flex items-center gap-1 hover:text-zinc-300 justify-end">
              Fees {sortKey === "fees" && <ChevronDown className={`w-2.5 h-2.5 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
            </button>
            <span className="text-right">Fee Tier</span>
          </div>

          {/* Rows */}
          {pagePositions.map((pos) => (
            <div
              key={pos.id}
              onClick={() => onPositionClick?.(pos)}
              className={`grid ${compact ? "grid-cols-5" : "grid-cols-7"} gap-2 px-3 py-2.5 border-b border-zinc-800/50 text-xs hover:bg-zinc-800/30 transition-colors ${onPositionClick ? "cursor-pointer" : ""}`}
            >
              {/* Pair */}
              <div className="flex items-center gap-1.5 min-w-0">
                <RangeDot status={pos.rangeStatus} />
                <span className="text-zinc-200 font-medium truncate">{pos.pair}</span>
              </div>

              {/* Range status */}
              <div className="flex items-center">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  pos.rangeStatus === "in-range"
                    ? "bg-emerald-900/30 text-emerald-400"
                    : pos.rangeStatus === "near-range"
                      ? "bg-yellow-900/30 text-yellow-400"
                      : pos.rangeStatus === "out-of-range"
                        ? "bg-red-900/30 text-red-400"
                        : "bg-zinc-800 text-zinc-500"
                }`}>
                  {pos.rangeStatus === "in-range" ? "In" : pos.rangeStatus === "near-range" ? "Near" : pos.rangeStatus === "out-of-range" ? "Out" : "—"}
                </span>
              </div>

              {/* Amounts (non-compact only) */}
              {!compact && (
                <>
                  <span className="text-zinc-400 font-mono truncate">{pos.amount0} {pos.token0Symbol}</span>
                  <span className="text-zinc-400 font-mono truncate">{pos.amount1} {pos.token1Symbol}</span>
                </>
              )}

              {/* APR */}
              <div className="text-right">
                <span className={`font-mono ${pos.apr > 10 ? "text-emerald-400" : pos.apr > 0 ? "text-zinc-300" : "text-zinc-600"}`}>
                  {pos.apr > 0 ? `${pos.apr.toFixed(1)}%` : "—"}
                </span>
              </div>

              {/* Fees */}
              <div className="text-right">
                <span className={`font-mono ${pos.feesUsd > 0 ? "text-emerald-400" : "text-zinc-600"}`}>
                  {pos.feesUsd > 0 ? `$${pos.feesUsd.toFixed(4)}` : "—"}
                </span>
                {pos.harvestTx && <span className="text-[8px] text-cyan-500 block">harvested</span>}
              </div>

              {/* Fee tier */}
              <div className="text-right text-zinc-500">{pos.feeTierStr}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Pagination ────────────────────────────────────── */}
      {viewMode === "individual" && totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{filtered.length} positions · Page {page + 1} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800 disabled:opacity-30"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            {/* Page numbers — show max 5 */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(0, Math.min(page - 2, totalPages - 5));
              const pageNum = start + i;
              if (pageNum >= totalPages) return null;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setPage(pageNum)}
                  className={`px-2 py-1 rounded border ${
                    pageNum === page
                      ? "border-emerald-600 bg-emerald-600/20 text-emerald-400"
                      : "border-zinc-700 hover:bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800 disabled:opacity-30"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Stats footer ──────────────────────────────────── */}
      {positions.length > 0 && (
        <div className="flex items-center gap-4 text-[10px] text-zinc-600 px-1">
          <span>{summary.uniquePairs} unique pairs</span>
          <span>·</span>
          <span>Avg APR: {summary.avgApr.toFixed(1)}%</span>
          <span>·</span>
          <span>{summary.totalHarvested} harvested</span>
          {loading && <RefreshCw className="w-3 h-3 animate-spin text-zinc-500 ml-auto" />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RangeDot({ status }: { status: RangeStatus }) {
  const color =
    status === "in-range"
      ? "bg-emerald-400"
      : status === "near-range"
        ? "bg-yellow-400"
        : status === "out-of-range"
          ? "bg-red-400"
          : "bg-zinc-600";
  return <span className={`w-2 h-2 rounded-full ${color} shrink-0`} />;
}

function SummaryPill({
  label,
  value,
  color,
  icon,
  onClick,
  active,
}: {
  label: string;
  value: number;
  color: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass rounded-lg border px-3 py-2 text-center transition-colors ${
        active ? "border-emerald-600 bg-emerald-900/10" : "border-zinc-800 hover:border-zinc-700"
      }`}
    >
      <p className="text-[9px] uppercase tracking-wider text-zinc-500 flex items-center justify-center gap-1">
        {icon} {label}
      </p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Range computation
// ---------------------------------------------------------------------------

function computeRange(
  tick: number | null,
  lower: number,
  upper: number
): { rangeStatus: RangeStatus; rangeDist: number } {
  if (tick == null || (lower === 0 && upper === 0)) {
    return { rangeStatus: "unknown", rangeDist: 0 };
  }
  if (tick >= lower && tick <= upper) {
    return { rangeStatus: "in-range", rangeDist: 0 };
  }
  const dist = tick < lower ? lower - tick : tick - upper;
  // Near-range threshold: 25% of position width, min 500 ticks
  const width = Math.max(upper - lower, 1);
  const nearThreshold = Math.max(Math.floor(width * 0.25), 500);
  return {
    rangeStatus: dist < nearThreshold ? "near-range" : "out-of-range",
    rangeDist: dist,
  };
}
