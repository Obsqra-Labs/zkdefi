"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Droplets, Plus, RefreshCw, AlertTriangle,
  ChevronDown, ChevronRight, X, Zap,
  Download, Shield,
} from "lucide-react";
import { useAccount } from "@starknet-react/core";
import { useGateContext } from "@/hooks/useGateContext";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import { useApp, ActivityEvent } from "@/lib/AppContext";
import { getEkuboCapabilities, getEkuboPositions, getMarketSurface, importOnchainPositions } from "@/lib/api/ekubo";
import { EkuboCapabilities, EkuboPosition, MarketSurfaceResponse, MarketOpportunity, LpRecommendationPool } from "@/types/ekubo";
import { EkuboLpPanel } from "./EkuboLpPanel";
import { LpRecommendationCard } from "./LpRecommendationCard";
import { PositionManager } from "./PositionManager";
import type { OperateHubEvent } from "./EkuboSwapPanel";
import { API_BASE, apiFetch } from "@/lib/api/client";
import { toastError, toastSuccess } from "@/lib/toast";
import { formatPct, formatUsd } from "@/lib/numberFormat";

/* ── Types ─────────────────────────────────────────────────────────── */

interface LiquidityTabProps {
  userAddress: string;
  gateMode?: "balanced" | "stress";
  onNavigate?: (tab: string, sub?: string) => void;
}

interface RecenterAlert {
  nft_id: string | number;
  pair: string;
  reason: string;
  lower_tick: number;
  upper_tick: number;
  current_tick: number;
}

/* ── Token Resolution (shared) ─────────────────────────────────────── */

/* ── Component ─────────────────────────────────────────────────────── */

export function LiquidityTab({ userAddress, gateMode: gateModeProp = "balanced", onNavigate }: LiquidityTabProps) {
  const { setActivityFeed } = useApp();
  const { account, address } = useAccount();

  /* ── Shared state ─── */
  const [capabilities, setCapabilities] = useState<EkuboCapabilities | null>(null);
  const [marketData, setMarketData] = useState<MarketSurfaceResponse | null>(null);
  const [positions, setPositions] = useState<EkuboPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [recenterAlerts, setRecenterAlerts] = useState<RecenterAlert[]>([]);
  const { gateConfig } = useGateContext(userAddress, gateModeProp);
  const [marketLoading, setMarketLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);

  /* Pool expansion / inline LP form state */
  const [expandedPool, setExpandedPool] = useState<string | null>(null);
  const [addingToPool, setAddingToPool] = useState<string | null>(null);
  const [prefillCounter, setPrefillCounter] = useState(0);
  /* Pool pagination */
  const POOLS_PER_PAGE = 25;
  const [poolPage, setPoolPage] = useState(0);

  /* ── Data loading ─── */

  useEffect(() => {
    let c = false;
    getEkuboCapabilities().then((d) => { if (!c) setCapabilities(d); }).catch(() => {});
    return () => { c = true; };
  }, []);

  const fetchMarket = useCallback(async () => {
    setMarketLoading(true);
    try {
      const surface = await getMarketSurface();
      setMarketData(surface);
    } catch { /* silent */ } finally {
      setMarketLoading(false);
    }
  }, []);

  useEffect(() => { void fetchMarket(); }, [fetchMarket]);
  useVisibilityPolling(() => void fetchMarket(), 60_000, [fetchMarket]);

  const fetchPositions = useCallback(async () => {
    setPositionsLoading(true);
    try {
      const result = await getEkuboPositions(userAddress);
      setPositions(result?.positions ?? []);
    } catch {
      setPositions([]);
    } finally {
      setPositionsLoading(false);
    }
  }, [userAddress]);

  useEffect(() => { void fetchPositions(); }, [fetchPositions]);
  useVisibilityPolling(() => void fetchPositions(), 30_000, [fetchPositions]);

  /* Recenter alerts */
  const loadRecenterAlerts = useCallback(async () => {
    try {
      const data = await apiFetch<{ alerts?: RecenterAlert[] }>(`/api/v1/strategies/recenter-alerts/${userAddress}`);
      setRecenterAlerts(data.alerts ?? []);
    } catch { /* silent */ }
  }, [userAddress]);
  useEffect(() => { void loadRecenterAlerts(); }, [loadRecenterAlerts]);
  useVisibilityPolling(() => void loadRecenterAlerts(), 60_000, [loadRecenterAlerts]);

  /* ── Derived ─── */

  /* Available pools from market surface */
  const pools = useMemo(() => {
    return (marketData?.opportunities ?? [])
      .sort((a, b) => b.estimated_apy_pct - a.estimated_apy_pct);
  }, [marketData]);

  /* Recommendation-driven LP prefill */
  const handleApplyRecommendation = useCallback((rec: LpRecommendationPool) => {
    const idx = pools.findIndex((p) => p.pair === rec.pair);
    if (idx >= 0) {
      const key = `${pools[idx].pair}-${idx}`;
      // Write prefill BEFORE expanding so the panel reads it on mount
      try {
        window.localStorage.setItem("zkdefi_lp_seed_prefill", JSON.stringify({
          source: "ai_recommendation",
          pair: rec.pair,
          token0: rec.token0,
          token1: rec.token1,
          amount0: rec.suggested_amount0_human,
          amount1: rec.suggested_amount1_human,
          feeTier: rec.fee_tier,
          riskProfile: undefined,
          timestamp: new Date().toISOString(),
          note: rec.reasoning,
        }));
      } catch { /* localStorage may be unavailable */ }
      // Bump counter to force EkuboLpPanel remount (re-reads localStorage)
      setPrefillCounter((c) => c + 1);
      setExpandedPool(key);
      setAddingToPool(key);

      // Scroll the target pool into view after React renders
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-pool-key="${key}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [pools]);

  /* ── Import on-chain positions ─── */
  const handleImportPositions = useCallback(async () => {
    setImportLoading(true);
    try {
      const result = await importOnchainPositions(userAddress);
      if (result.imported > 0) {
        toastSuccess(`Imported ${result.imported} on-chain position${result.imported > 1 ? "s" : ""}`);
        void fetchPositions();
      } else if (result.skipped > 0) {
        toastSuccess("All on-chain positions already imported");
      } else {
        toastSuccess("No new on-chain positions found");
      }
      if (result.errors.length > 0) {
        toastError(`${result.errors.length} error(s) during import`);
      }
    } catch (e: any) {
      toastError(e?.message ?? "Failed to import positions");
    } finally {
      setImportLoading(false);
    }
  }, [userAddress, fetchPositions]);

  const pushActivity = useCallback(
    (event: OperateHubEvent) => {
      const entry: ActivityEvent = {
        id: Math.random().toString(36).slice(2, 10),
        type: event.type,
        pool: "ekubo",
        text: event.text,
        details: event.details,
        txHash: event.txHash,
        status: event.status,
        time: new Date(),
      };
      setActivityFeed((prev) => [entry, ...prev].slice(0, 100));
    },
    [setActivityFeed],
  );

  /* ── Render ─── */

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-400/80 flex items-center gap-2 mb-4">
        <Shield className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          LP positions are managed through the vault&apos;s privacy layer. Pool allocations are verified by zkML risk models before deployment — position sizes stay private.
        </span>
      </div>

      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Droplets className="w-5 h-5 text-cyan-400" />
            Liquidity
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Provide concentrated liquidity to Ekubo pools · Manage positions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchPositions()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${positionsLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleImportPositions()}
            disabled={importLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-cyan-700/50 text-cyan-400 hover:text-cyan-200 hover:border-cyan-600/50 transition-colors disabled:opacity-50"
          >
            <Download className={`w-3.5 h-3.5 ${importLoading ? "animate-pulse" : ""}`} />
            {importLoading ? "Importing..." : "Import On-Chain"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (pools.length > 0) {
                const key = `${pools[0].pair}-0`;
                setExpandedPool(key);
                setAddingToPool(key);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Position
          </button>
        </div>
      </div>

      {/* ═══ Your Positions (PositionManager) ═══ */}
      <div className="glass rounded-xl border border-zinc-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-200">Your Positions</h3>
        </div>
        {recenterAlerts.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{recenterAlerts.length} position{recenterAlerts.length > 1 ? "s" : ""} need recentering</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.("strategies", "recenter")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-600/40 bg-amber-600/10 text-[10px] text-amber-300 hover:bg-amber-600/20 transition-colors"
              >
                Review Alerts
              </button>
            </div>
          </div>
        )}
        <PositionManager
          address={userAddress}
          refreshTrigger={positionsRefreshKey}
          showHarvest={false}
          pageSize={25}
        />
      </div>

      {/* ═══ AI Recommendation ═══ */}
      <LpRecommendationCard
        userAddress={userAddress}
        onApplyRecommendation={handleApplyRecommendation}
      />

      {/* ═══ Available Pools ═══ */}
      <div className="glass rounded-xl border border-zinc-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-200">Available Pools</h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600">{pools.length} pools</span>
            <button
              type="button"
              onClick={() => void fetchMarket()}
              className="text-zinc-600 hover:text-zinc-400"
            >
              <RefreshCw className={`w-3 h-3 ${marketLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        {pools.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-500">
            {marketLoading ? "Loading pools..." : "No pools available"}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/40">
            {pools.slice(poolPage * POOLS_PER_PAGE, (poolPage + 1) * POOLS_PER_PAGE).map((pool, i) => {
              const poolKey = `${pool.pair}-${i}`;
              const isExpanded = expandedPool === poolKey;
              const isAdding = addingToPool === poolKey;
              const pairSymbols = pool.pair.split("/").map((s) => s.trim());
              const riskScore = pool.risk_score ?? 0;
              const riskColor =
                riskScore <= 30
                  ? "text-emerald-400 border-emerald-600/40 bg-emerald-600/10"
                  : riskScore <= 60
                  ? "text-amber-400 border-amber-600/40 bg-amber-600/10"
                  : "text-red-400 border-red-600/40 bg-red-600/10";
              const riskLabel =
                riskScore <= 30 ? "Low" : riskScore <= 60 ? "Medium" : "High";
              const change = pool.change_24h_pct ?? 0;
              const changeArrow = Math.abs(change) < 0.01 ? "→" : change > 0 ? "↗" : "↘";
              const changeClass = Math.abs(change) < 0.01 ? "text-zinc-500" : change > 0 ? "text-emerald-400" : "text-red-400";

              return (
                <div key={poolKey} data-pool-key={poolKey} className="transition-colors">
                  {/* ── Pool summary row (always visible) ── */}
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedPool(isExpanded ? null : poolKey);
                      if (isExpanded) setAddingToPool(null);
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-zinc-800/20 transition-colors text-left"
                  >
                    <div className="flex items-center justify-center w-5">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-zinc-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-zinc-600" />
                      )}
                    </div>
                    <span className="text-sm text-zinc-200 font-mono font-medium min-w-[120px]">
                      {pool.pair}
                    </span>
                    <span className="text-[10px] text-zinc-500 min-w-[60px]">
                      {pool.best_venue}
                    </span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right min-w-[55px]">
                        <span className="text-emerald-400 font-mono font-medium">
                          {formatPct(pool.estimated_apy_pct, 1)}
                        </span>
                        <div className="text-[9px] text-zinc-600">APY</div>
                      </div>
                      <div className="text-right min-w-[50px]">
                        <span className="text-zinc-400 font-mono">
                          {formatUsd(pool.tvl_usd)}
                        </span>
                        <div className="text-[9px] text-zinc-600">TVL</div>
                      </div>
                      <div className="text-right min-w-[50px]">
                        <span className="text-zinc-400 font-mono">
                          {formatUsd(pool.volume_24h_usd)}
                        </span>
                        <div className="text-[9px] text-zinc-600">Vol 24h</div>
                      </div>
                      <div className="text-right min-w-[68px]">
                        <span className={`font-mono ${changeClass}`}>
                          {changeArrow} {change > 0 ? "+" : ""}{change.toFixed(2)}%
                        </span>
                        <div className="text-[9px] text-zinc-600">Price/Flow</div>
                      </div>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border ${riskColor}`}
                      >
                        {riskLabel}
                      </span>
                    </div>
                  </button>

                  {/* ── Expanded details panel ── */}
                  {isExpanded && (
                    <div className="border-t border-zinc-800/30 bg-zinc-900/40 px-5 pb-4 pt-3 space-y-4">
                      {/* Pool overview - simplified, human-readable */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                          <div className="text-[10px] text-zinc-500 mb-1">Estimated Yield</div>
                          <div className="text-base font-mono font-bold text-emerald-400">
                            {formatPct(pool.estimated_apy_pct, 1)}
                            <span className="text-[10px] ml-1 font-normal text-zinc-500">APY</span>
                          </div>
                          {pool.reference_apy_pct != null && pool.reference_apy_pct > 0 && (
                            <p className="text-[10px] text-zinc-600 mt-0.5">
                              Avg for this pair: {formatPct(pool.reference_apy_pct, 1)}
                            </p>
                          )}
                        </div>

                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                          <div className="text-[10px] text-zinc-500 mb-1">Pool Depth</div>
                          <div className="text-base font-mono font-bold text-zinc-200">
                            {formatUsd(pool.tvl_usd)}
                          </div>
                          <p className="text-[10px] text-zinc-600 mt-0.5">
                            {pool.tvl_usd >= 100_000 ? "Deep liquidity" : pool.tvl_usd >= 10_000 ? "Moderate liquidity" : "Low liquidity"}
                          </p>
                        </div>

                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                          <div className="text-[10px] text-zinc-500 mb-1">24h Volume</div>
                          <div className="text-base font-mono font-bold text-zinc-200">
                            {formatUsd(pool.volume_24h_usd)}
                          </div>
                          <p className="text-[10px] text-zinc-600 mt-0.5">
                            {pool.volume_24h_usd > pool.tvl_usd ? "High activity" : "Normal activity"}
                          </p>
                        </div>

                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                          <div className="text-[10px] text-zinc-500 mb-1">Risk Level</div>
                          <div className={`text-base font-bold ${
                            riskScore <= 30 ? "text-emerald-400" : riskScore <= 60 ? "text-amber-400" : "text-red-400"
                          }`}>
                            {riskLabel}
                          </div>
                          <p className="text-[10px] text-zinc-600 mt-0.5">
                            {riskScore <= 30
                              ? "Low impermanent loss risk"
                              : riskScore <= 60
                              ? "Monitor your position range"
                              : "Active management recommended"}
                          </p>
                        </div>
                      </div>

                      {/* What is this pool? */}
                      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-3">
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          <span className="text-zinc-300 font-medium">{pool.pair}</span> on <span className="text-zinc-300">{pool.best_venue}</span> —
                          {" "}You earn a share of trading fees whenever someone swaps between these tokens.
                          {pool.estimated_apy_pct > 50 && " This pool currently has above-average returns."}
                          {riskScore > 60 && " Prices are volatile — your position may go out of range faster."}
                          {pool.tvl_usd < 10_000 && " This is a smaller pool, which means higher fees per trade but more price impact."}
                        </p>
                      </div>

                      {/* Action bar */}
                      {!isAdding && (
                        <button
                          type="button"
                          onClick={() => setAddingToPool(poolKey)}
                          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          Add Liquidity to {pool.pair}
                        </button>
                      )}

                      {/* ── Inline Add Liquidity form ── */}
                      {isAdding && (
                        <div className="rounded-xl border border-cyan-800/30 bg-cyan-950/5 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                              <Plus className="w-4 h-4 text-cyan-400" />
                              Add to {pool.pair}
                            </h4>
                            <button
                              type="button"
                              onClick={() => setAddingToPool(null)}
                              className="text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <EkuboLpPanel
                            key={`${poolKey}-prefill-${prefillCounter}`}
                            inline
                            pairLabel={pool.pair}
                            token0Symbol={pairSymbols[0]}
                            token1Symbol={pairSymbols[1]}
                            token0={pool.token0}
                            token1={pool.token1}
                            onTokenChange={() => {}}
                            capabilities={capabilities}
                            gateConfig={gateConfig}
                            onEvent={pushActivity}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {/* Pool pagination */}
        {pools.length > POOLS_PER_PAGE && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800">
            <button
              type="button"
              disabled={poolPage === 0}
              onClick={() => setPoolPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-[10px] text-zinc-500">
              Page {poolPage + 1} of {Math.ceil(pools.length / POOLS_PER_PAGE)}
            </span>
            <button
              type="button"
              disabled={(poolPage + 1) * POOLS_PER_PAGE >= pools.length}
              onClick={() => setPoolPage((p) => p + 1)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
