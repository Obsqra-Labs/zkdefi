"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Shield, Loader2, TrendingUp, RefreshCw, Filter,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { PoolBucketCard } from "@/components/zkdefi/shared/PoolBucketCard";
import { DEMO_OPPORTUNITIES } from "@/lib/demoCapitalOS";
import type { VaultCommitment } from "@/hooks/usePrivacyVault";
import { useTokenPrices, priceOf } from "@/hooks/useTokenPrices";

interface CapitalTabProps {
  address: string;
  onSlideout: (mode: string, poolId?: string) => void;
  isDemo?: boolean;
  commitments?: VaultCommitment[];
}

const POOLS = [
  {
    id: "conservative",
    label: "Conservative",
    risk: "Low",
    riskColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  },
  {
    id: "moderate",
    label: "Moderate",
    risk: "Medium",
    riskColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    risk: "High",
    riskColor: "bg-red-500/20 text-red-400 border-red-500/30",
  },
];

type OpFilter = "all" | "lp" | "swap" | "stake" | "private";
const FILTER_PILLS: Array<{ key: OpFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "lp", label: "LP" },
  { key: "swap", label: "Swap" },
  { key: "stake", label: "Stake" },
  { key: "private", label: "Private" },
];

export function CapitalTab({ address, onSlideout, isDemo, commitments }: CapitalTabProps) {
  // ── Opportunities ──
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [oppsLoading, setOppsLoading] = useState(true);
  const [oppsError, setOppsError] = useState<string | null>(null);
  const [opFilter, setOpFilter] = useState<OpFilter>("all");
  const { prices } = useTokenPrices();

  // Per-pool user deposits from commitments
  const poolUserData = useMemo(() => {
    const map: Record<string, { count: number; usd: number }> = {};
    for (const c of (commitments ?? [])) {
      const variant = c.pool_variant ?? "unassigned";
      const price = priceOf(prices, c.asset ?? "STRK");
      const amt = Number(c.amount_wei) / 1e18 * price;
      if (!map[variant]) map[variant] = { count: 0, usd: 0 };
      map[variant].count++;
      map[variant].usd += amt;
    }
    return map;
  }, [commitments, prices]);

  const loadOpps = useCallback(async (signal?: AbortSignal) => {
    if (isDemo) {
      // Use demo opportunities directly
      setOpportunities(DEMO_OPPORTUNITIES.map((o) => ({
        pair: o.pair,
        currentYield: o.estimated_apy_pct,
        risk_score: o.risk_score,
        risk: (o.risk_score ?? 50) < 30 ? "low" : (o.risk_score ?? 50) < 50 ? "medium" : "high",
        confidence: o.confidence,
        type: "lp",
      })));
      setOppsLoading(false);
      return;
    }

    setOppsError(null);
    setOppsLoading(true);
    try {
      const res = await apiFetch<any>(
        `/api/v1/zkdefi/trade-desk/v2/opportunities?type=lp,lending,staking&limit=20`,
        { signal },
      );
      const opps = Array.isArray(res?.opportunities)
        ? res.opportunities
        : Array.isArray(res)
          ? res
          : [];
      setOpportunities(opps);
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setOppsError(e instanceof Error ? e.message : "Failed to load opportunities");
    } finally {
      setOppsLoading(false);
    }
  }, [isDemo]);

  useEffect(() => {
    const ac = new AbortController();
    loadOpps(ac.signal);
    return () => ac.abort();
  }, [loadOpps]);

  const filteredOpps = useMemo(() => {
    if (opFilter === "all") return opportunities;
    return opportunities.filter((o) => {
      const t = (o.type ?? o.category ?? "").toLowerCase();
      if (opFilter === "private") return t.includes("priv") || t.includes("shield");
      return t.includes(opFilter);
    });
  }, [opportunities, opFilter]);

  return (
    <div className="space-y-6">
      {/* ─── Privacy Pool Buckets ─── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">
            Privacy Pools
          </h3>
        </div>

        <div className="space-y-3">
          {POOLS.map((pool) => {
            const userData = poolUserData[pool.id];
            return (
              <PoolBucketCard
                key={pool.id}
                poolId={pool.id}
                label={pool.label}
                risk={pool.risk}
                riskColor={pool.riskColor}
                onDeposit={(pid) => onSlideout("deposit", pid)}
                onWithdraw={(pid) => onSlideout("withdraw", pid)}
                isDemo={isDemo}
                userDeposits={userData?.count}
                userValueUsd={userData?.usd}
              />
            );
          })}
        </div>
      </section>

      {/* ─── Opportunities ─── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">
              Opportunities
            </h3>
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
              onClick={() => loadOpps()}
              className="flex items-center gap-1 mx-auto px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        ) : filteredOpps.length === 0 ? (
          <p className="text-xs text-zinc-600 italic text-center py-4">
            {opFilter === "all"
              ? "No opportunities available"
              : `No ${opFilter} opportunities`}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredOpps.map((opp, i) => {
              const riskLevel = (opp.risk ?? opp.risk_level ?? "medium").toLowerCase();
              const riskCls =
                riskLevel === "low"
                  ? "text-emerald-400"
                  : riskLevel === "high"
                    ? "text-red-400"
                    : "text-amber-400";

              return (
                <div
                  key={opp.id ?? i}
                  className="glass rounded-lg px-4 py-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">
                        {opp.pair ?? opp.pool ?? opp.name ?? "Opportunity"}
                      </p>
                      <div className="flex items-center gap-2 text-xs mt-0.5">
                        <span className="text-emerald-400 font-medium">
                          {Number(
                            opp.currentYield ?? opp.apy ?? opp.yield ?? opp.apr ?? 0
                          ).toFixed(1)}
                          % APY
                        </span>
                        <span className={riskCls}>{riskLevel}</span>
                        {opp.type && (
                          <span className="text-zinc-600">{opp.type}</span>
                        )}
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
