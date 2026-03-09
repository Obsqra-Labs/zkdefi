"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Droplets, Loader2, Shield, TrendingUp } from "lucide-react";
import { apiUrl } from "@/lib/api/client";
import { PrivacyPoolAdapter } from "@/services/adapters/PrivacyPoolAdapter";
import { PoolLiquidityManager } from "@/services/adapters/PoolLiquidityManager";

type PoolId = "CONSERVATIVE_POOL" | "MODERATE_POOL" | "AGGRESSIVE_POOL";

const POOLS: Array<{ id: PoolId; label: string; risk: string }> = [
  { id: "CONSERVATIVE_POOL", label: "Conservative", risk: "Low" },
  { id: "MODERATE_POOL", label: "Moderate", risk: "Medium" },
  { id: "AGGRESSIVE_POOL", label: "Aggressive", risk: "High" },
];

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function usd(v: number) {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

interface PrivacyPoolsPanelProps {
  address?: string;
}

export function PrivacyPoolsPanel({ address }: PrivacyPoolsPanelProps) {
  const adapter = useMemo(() => new PrivacyPoolAdapter(), []);
  const liquidity = useMemo(() => new PoolLiquidityManager(), []);

  const [loading, setLoading] = useState(true);
  const [busyPool, setBusyPool] = useState<PoolId | null>(null);
  const [amounts, setAmounts] = useState<Record<PoolId, string>>({
    CONSERVATIVE_POOL: "",
    MODERATE_POOL: "",
    AGGRESSIVE_POOL: "",
  });
  const [rows, setRows] = useState<
    Record<
      PoolId,
      {
        stats?: any;
        liquidity?: any;
        userDeposited: number;
      }
    >
  >({
    CONSERVATIVE_POOL: { userDeposited: 0 },
    MODERATE_POOL: { userDeposited: 0 },
    AGGRESSIVE_POOL: { userDeposited: 0 },
  });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const entries = await Promise.all(
        POOLS.map(async (pool) => {
          const [stats, liq] = await Promise.all([
            adapter.getPoolStats(pool.id),
            liquidity.getPoolLiquidity(pool.id),
          ]);
          let userDeposited = 0;
          if (address) {
            try {
              const res = await fetch(apiUrl(`/api/v1/dao/pools/${pool.id}/positions/${address}`));
              if (res.ok) {
                const json = await res.json();
                userDeposited = Number(json?.deposited_amount || 0);
              }
            } catch {}
          }
          return [pool.id, { stats, liquidity: liq, userDeposited }] as const;
        })
      );
      setRows((prev) => {
        const next = { ...prev };
        for (const [poolId, payload] of entries) next[poolId] = payload;
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load privacy pools");
    } finally {
      setLoading(false);
    }
  }, [adapter, liquidity, address]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const onDeposit = useCallback(
    async (pool: PoolId) => {
      const amount = Number(amounts[pool] || 0);
      if (!Number.isFinite(amount) || amount <= 0) return;
      setBusyPool(pool);
      setError(null);
      try {
        const r = await adapter.depositToPool({
          pool,
          amount,
          privacyMode: "shielded",
          userAddress: address,
          source: "simulated",
        });
        setRows((prev) => ({
          ...prev,
          [pool]: {
            ...prev[pool],
            userDeposited: Number(r?.userPosition ?? prev[pool]?.userDeposited ?? 0),
          },
        }));
        setAmounts((prev) => ({ ...prev, [pool]: "" }));
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Deposit failed");
      } finally {
        setBusyPool(null);
      }
    },
    [adapter, address, amounts, load]
  );

  const onWithdraw = useCallback(
    async (pool: PoolId) => {
      const amount = Number(amounts[pool] || 0);
      if (!Number.isFinite(amount) || amount <= 0 || !address) return;
      setBusyPool(pool);
      setError(null);
      try {
        const r = await adapter.withdrawFromPool({
          pool,
          amount,
          address,
        });
        setRows((prev) => ({
          ...prev,
          [pool]: {
            ...prev[pool],
            userDeposited: Number(r?.userPosition ?? prev[pool]?.userDeposited ?? 0),
          },
        }));
        setAmounts((prev) => ({ ...prev, [pool]: "" }));
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Withdraw failed");
      } finally {
        setBusyPool(null);
      }
    },
    [adapter, address, amounts, load]
  );

  if (loading && !rows.CONSERVATIVE_POOL.stats) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400 flex items-center gap-2">
        <Shield className="w-4 h-4 text-violet-400" />
        DAO-governed privacy pools. Source is marked as simulated until live pool adapters are enabled.
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {POOLS.map((pool) => {
        const row = rows[pool.id];
        const stats = row?.stats || {};
        const util = Number(stats.utilizationRate || 0);
        const idlePct = 1 - util;
        const busy = busyPool === pool.id;
        return (
          <section key={pool.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">{pool.label} Pool</h3>
                <p className="text-xs text-zinc-500">{pool.id} · {pool.risk} risk</p>
              </div>
              <div className="text-right">
                <div className="text-xs text-zinc-500">Source</div>
                <div className="text-xs uppercase tracking-wide text-cyan-300">
                  {String(stats.source || "simulated")}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <Metric label="TVL" value={usd(stats.totalDeposited || 0)} icon={Droplets} />
              <Metric label="Idle %" value={pct(Math.max(0, idlePct))} icon={TrendingUp} />
              <Metric label="DAO APR" value={`${Number(stats.daoApr || 0).toFixed(2)}%`} icon={TrendingUp} />
              <Metric label="Utilization" value={pct(util)} icon={TrendingUp} />
              <Metric label="Your Deposit" value={usd(row?.userDeposited || 0)} icon={Shield} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={amounts[pool.id]}
                onChange={(e) => setAmounts((prev) => ({ ...prev, [pool.id]: e.target.value }))}
                className="w-44 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                placeholder="Amount (USD)"
              />
              <button
                onClick={() => onDeposit(pool.id)}
                disabled={busy || Number(amounts[pool.id] || 0) <= 0}
                className="px-3 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
              >
                Deposit
              </button>
              <button
                onClick={() => onWithdraw(pool.id)}
                disabled={busy || Number(amounts[pool.id] || 0) <= 0 || !address}
                className="px-3 py-2 rounded border border-zinc-700 text-zinc-200 text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
              >
                Withdraw
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
      <div className="flex items-center gap-1 text-zinc-500 text-[11px]">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-zinc-200 text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}
