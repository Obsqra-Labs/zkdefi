"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Shield, AlertTriangle, Loader2, Layers, Lock,
  TrendingUp, RefreshCw, Filter,
} from "lucide-react";
import { apiFetch, API_BASE } from "@/lib/api/client";
import { getEkuboPositions, type EkuboPosition } from "@/lib/api/ekubo";
import { tokenLabel, formatAmount } from "@/components/zkdefi/EkuboPositionsList";
import { InlineOracleCard, type OracleSignal } from "@/components/zkdefi/shared/InlineOracleCard";
import { PrivacyPoolAdapter, type PoolStats } from "@/services/adapters/PrivacyPoolAdapter";
import { PoolLiquidityManager, type PoolLiquidity } from "@/services/adapters/PoolLiquidityManager";

interface CapitalTabProps {
  address: string;
  onSlideout: (mode: string) => void;
}

type PoolId = "CONSERVATIVE_POOL" | "MODERATE_POOL" | "AGGRESSIVE_POOL";

const POOLS: Array<{ id: PoolId; label: string; risk: string; riskColor: string }> = [
  { id: "CONSERVATIVE_POOL", label: "Conservative", risk: "Low", riskColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  { id: "MODERATE_POOL", label: "Moderate", risk: "Medium", riskColor: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { id: "AGGRESSIVE_POOL", label: "Aggressive", risk: "High", riskColor: "bg-red-500/20 text-red-400 border-red-500/30" },
];

type PoolRow = {
  stats?: PoolStats;
  liquidity?: PoolLiquidity;
  userDeposited: number;
  error?: string;
  signal?: OracleSignal;
};

const EMPTY_ROWS: Record<PoolId, PoolRow> = {
  CONSERVATIVE_POOL: { userDeposited: 0 },
  MODERATE_POOL: { userDeposited: 0 },
  AGGRESSIVE_POOL: { userDeposited: 0 },
};

function usd(v: number) {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

type OpFilter = "all" | "lp" | "swap" | "stake" | "private";
const FILTER_PILLS: Array<{ key: OpFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "lp", label: "LP" },
  { key: "swap", label: "Swap" },
  { key: "stake", label: "Stake" },
  { key: "private", label: "Private" },
];

export function CapitalTab({ address, onSlideout }: CapitalTabProps) {
  const adapter = useMemo(() => new PrivacyPoolAdapter(), []);
  const liqManager = useMemo(() => new PoolLiquidityManager(), []);

  // ── Privacy Pools ──
  const [poolRows, setPoolRows] = useState<Record<PoolId, PoolRow>>(EMPTY_ROWS);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [poolsError, setPoolsError] = useState<string | null>(null);

  const loadPools = useCallback(async () => {
    setPoolsError(null);
    setPoolsLoading(true);
    try {
      const [settled, signalsRes] = await Promise.allSettled([
        Promise.allSettled(
          POOLS.map(async (pool) => {
            const [stats, liq] = await Promise.all([
              adapter.getPoolStats(pool.id),
              liqManager.getPoolLiquidity(pool.id),
            ]);
            let userDeposited = 0;
            if (address) {
              try {
                const res = await fetch(`${API_BASE}/api/v1/dao/pools/${pool.id}/positions/${address}`);
                if (res.ok) {
                  const json = await res.json();
                  userDeposited = Number(json?.deposited_amount || 0);
                }
              } catch {}
            }
            return { id: pool.id, stats, liquidity: liq, userDeposited };
          }),
        ),
        apiFetch<any>(`/api/v1/zkdefi/trade-desk/v2/opportunities?limit=3`).catch(() => null),
      ]);

      const poolSettled = settled.status === "fulfilled" ? settled.value : [];
      const signals: OracleSignal[] = [];
      if (signalsRes.status === "fulfilled" && signalsRes.value) {
        const opps = Array.isArray(signalsRes.value?.opportunities)
          ? signalsRes.value.opportunities
          : Array.isArray(signalsRes.value) ? signalsRes.value : [];
        for (const o of opps.slice(0, 3)) {
          const yld = Number(o.currentYield ?? o.apy ?? o.yield ?? 0);
          const risk = Number(o.riskScore ?? o.risk_score ?? 50);
          const conf = o.confidence > 0 ? Number(o.confidence) : (100 - risk) / 100;
          const dir: OracleSignal["direction"] = yld > 50 ? "up" : yld > 10 ? "stable" : "down";
          signals.push({
            pair: o.title ?? o.pair ?? o.pool ?? o.name ?? "Signal",
            direction: (o.signal_direction ?? o.direction ?? dir) as OracleSignal["direction"],
            confidence: conf,
            recommendation: o.recommendation ?? o.action ?? `${yld.toFixed(1)}% APY`,
          });
        }
      }

      setPoolRows((prev) => {
        const next = { ...prev };
        (poolSettled as PromiseSettledResult<any>[]).forEach((result, i) => {
          const poolId = POOLS[i].id;
          if (result.status === "fulfilled") {
            const v = result.value;
            next[poolId] = {
              stats: v.stats,
              liquidity: v.liquidity,
              userDeposited: v.userDeposited,
              signal: signals[i],
            };
          } else {
            next[poolId] = {
              ...prev[poolId],
              error: result.reason instanceof Error ? result.reason.message : "Failed to load",
            };
          }
        });
        return next;
      });
    } catch (e) {
      setPoolsError(e instanceof Error ? e.message : "Failed to load privacy pools");
    } finally {
      setPoolsLoading(false);
    }
  }, [adapter, liqManager, address]);

  useEffect(() => {
    loadPools();
    const t = setInterval(loadPools, 30_000);
    return () => clearInterval(t);
  }, [loadPools]);

  // ── Active Positions (Ekubo + commitments) ──
  const [ekuboPositions, setEkuboPositions] = useState<EkuboPosition[]>([]);
  const [commitments, setCommitments] = useState<any[]>([]);
  const [posLoading, setPosLoading] = useState(true);

  useEffect(() => {
    if (!address) { setPosLoading(false); return; }
    let cancelled = false;
    setPosLoading(true);

    Promise.allSettled([
      getEkuboPositions(address),
      apiFetch<any>(`/api/v1/zkdefi/ledger/notes/${address}`),
    ]).then(([ekuboRes, notesRes]) => {
      if (cancelled) return;
      if (ekuboRes.status === "fulfilled") {
        const all = ekuboRes.value.positions ?? [];
        setEkuboPositions(all.filter((p: EkuboPosition) => p.token0 && p.token1));
      }
      if (notesRes.status === "fulfilled") {
        const notes = Array.isArray(notesRes.value?.notes) ? notesRes.value.notes : [];
        setCommitments(notes);
      }
      setPosLoading(false);
    });

    return () => { cancelled = true; };
  }, [address]);

  // ── Opportunities ──
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [oppsLoading, setOppsLoading] = useState(true);
  const [oppsError, setOppsError] = useState<string | null>(null);
  const [opFilter, setOpFilter] = useState<OpFilter>("all");

  const loadOpps = useCallback(async () => {
    setOppsError(null);
    setOppsLoading(true);
    try {
      const res = await apiFetch<any>(`/api/v1/zkdefi/trade-desk/v2/opportunities?type=lp,lending,staking&limit=20`);
      const opps = Array.isArray(res?.opportunities) ? res.opportunities : Array.isArray(res) ? res : [];
      setOpportunities(opps);
    } catch (e) {
      setOppsError(e instanceof Error ? e.message : "Failed to load opportunities");
    } finally {
      setOppsLoading(false);
    }
  }, []);

  useEffect(() => { loadOpps(); }, [loadOpps]);

  const filteredOpps = useMemo(() => {
    if (opFilter === "all") return opportunities;
    return opportunities.filter((o) => {
      const t = (o.type ?? o.category ?? "").toLowerCase();
      if (opFilter === "private") return t.includes("priv") || t.includes("shield");
      return t.includes(opFilter);
    });
  }, [opportunities, opFilter]);

  // ── Render ──
  return (
    <div className="space-y-6">
      {/* ─── Privacy Pools (Hero Section) ─── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Privacy Pools</h3>
        </div>

        {poolsError && (
          <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-3 text-sm text-red-300 mb-3">
            {poolsError}
          </div>
        )}

        {poolsLoading && !poolRows.CONSERVATIVE_POOL.stats ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-zinc-800/40 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {POOLS.map((pool) => {
              const row = poolRows[pool.id];

              if (row?.error) {
                return (
                  <div key={pool.id} className="glass rounded-xl p-4 border border-red-900/40">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span className="text-sm font-semibold text-zinc-100">{pool.label} Pool</span>
                    </div>
                    <p className="text-xs text-red-300 mb-2">{row.error}</p>
                    <button
                      onClick={loadPools}
                      className="flex items-center gap-1 px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800"
                    >
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  </div>
                );
              }

              const stats = row?.stats;
              const util = Number(stats?.utilizationRate ?? 0);
              const tvl = Number(stats?.totalDeposited ?? 0);

              return (
                <div key={pool.id} className="glass rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-violet-400" />
                      <h4 className="text-sm font-semibold text-zinc-100">{pool.label} Pool</h4>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${pool.riskColor}`}>
                        {pool.risk}
                      </span>
                    </div>
                    {row.userDeposited > 0 && (
                      <span className="text-xs text-emerald-400 font-medium">
                        {usd(row.userDeposited)} deposited
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-xs">
                    <div>
                      <span className="text-zinc-500">TVL </span>
                      <span className="text-zinc-200 font-medium">{usd(tvl)}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">APR </span>
                      <span className="text-emerald-400 font-medium">{Number(stats?.daoApr ?? stats?.currentYield ?? 0).toFixed(1)}%</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">Util</span>
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-violet-500/70 rounded-full transition-all"
                            style={{ width: `${Math.min(100, util * 100)}%` }}
                          />
                        </div>
                        <span className="text-zinc-400">{pct(util)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSlideout("deposit")}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors"
                    >
                      Deposit
                    </button>
                    <button
                      onClick={() => onSlideout("withdraw")}
                      className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-200 text-sm font-medium hover:bg-zinc-800 transition-colors"
                    >
                      Withdraw
                    </button>
                  </div>

                  {row.signal && <InlineOracleCard signal={row.signal} />}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Active Positions ─── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Active Positions</h3>
        </div>

        {posLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-zinc-800/40 animate-pulse" />
            ))}
          </div>
        ) : ekuboPositions.length === 0 && commitments.length === 0 ? (
          <div className="glass rounded-xl p-6 text-center">
            <p className="text-sm text-zinc-500">No active positions</p>
            <p className="text-xs text-zinc-600 mt-1">Deploy capital into privacy pools or Ekubo LP to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ekuboPositions.map((pos) => {
              const t0 = tokenLabel(pos.token0);
              const t1 = tokenLabel(pos.token1);
              const inRange =
                pos.lower_tick != null &&
                pos.upper_tick != null &&
                pos.current_tick_at_build != null &&
                pos.current_tick_at_build >= pos.lower_tick &&
                pos.current_tick_at_build <= pos.upper_tick;

              return (
                <div key={pos.position_id} className="glass rounded-lg px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <div>
                      <span className="text-sm font-medium text-zinc-200">{t0}/{t1}</span>
                      <span className="ml-2 text-[10px] text-zinc-500">
                        {pos.lower_tick?.toLocaleString()} – {pos.upper_tick?.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {pos.estimated_fees_apr != null && pos.estimated_fees_apr > 0 && (
                      <span className="text-emerald-400">{pos.estimated_fees_apr.toFixed(1)}% APR</span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      inRange
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : "bg-zinc-700/30 text-zinc-400 border border-zinc-600/30"
                    }`}>
                      {inRange ? "In Range" : "Idle"}
                    </span>
                  </div>
                </div>
              );
            })}

            {commitments.map((note, i) => (
              <div key={note.note_hash ?? i} className="glass rounded-lg px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-zinc-200">
                      {note.token ?? "STRK"} · Privacy Pool
                    </span>
                    <span className="ml-2 text-[10px] text-zinc-500">
                      {formatAmount(note.amount_wei)}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] text-zinc-600 font-mono">
                  {(note.note_hash ?? "").slice(0, 10)}…
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── Opportunities ─── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Opportunities</h3>
          </div>
        </div>

        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto">
          {FILTER_PILLS.map((pill) => (
            <button
              key={pill.key}
              onClick={() => setOpFilter(pill.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
                opFilter === pill.key
                  ? "bg-violet-600/30 text-violet-300 border border-violet-500/40"
                  : "bg-zinc-800/50 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-800"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {oppsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-zinc-800/40 animate-pulse" />
            ))}
          </div>
        ) : oppsError ? (
          <div className="glass rounded-xl p-4 text-center">
            <p className="text-sm text-red-300 mb-2">{oppsError}</p>
            <button
              onClick={loadOpps}
              className="flex items-center gap-1 mx-auto px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        ) : filteredOpps.length === 0 ? (
          <p className="text-xs text-zinc-600 italic text-center py-4">
            {opFilter === "all" ? "No opportunities available" : `No ${opFilter} opportunities`}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredOpps.map((opp, i) => {
              const riskLevel = (opp.risk ?? opp.risk_level ?? "medium").toLowerCase();
              const riskCls = riskLevel === "low"
                ? "text-emerald-400"
                : riskLevel === "high"
                  ? "text-red-400"
                  : "text-amber-400";

              return (
                <div key={opp.id ?? i} className="glass rounded-lg px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">
                        {opp.pair ?? opp.pool ?? opp.name ?? "Opportunity"}
                      </p>
                      <div className="flex items-center gap-2 text-xs mt-0.5">
                        <span className="text-emerald-400 font-medium">
                          {Number(opp.currentYield ?? opp.apy ?? opp.yield ?? opp.apr ?? 0).toFixed(1)}% APY
                        </span>
                        <span className={riskCls}>{riskLevel}</span>
                        {opp.type && <span className="text-zinc-600">{opp.type}</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onSlideout("deposit")}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600/80 text-white text-xs font-medium hover:bg-emerald-500 transition-colors"
                  >
                    Deploy
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
