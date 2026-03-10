"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown, ChevronUp, Lock, Layers, Coins,
  RefreshCw, AlertTriangle, Bot,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

interface PoolPosition {
  id: string;
  adapter: string;
  pair?: string;
  token?: string;
  value_usd: number;
  apy: number;
  status: string;
  metadata?: Record<string, unknown>;
}

interface PoolComposition {
  pool_id: string;
  total_value_usd: number;
  idle_value_usd: number;
  deployed_value_usd: number;
  blended_apy: number;
  positions: PoolPosition[];
  idle_breakdown: Record<string, number>;
  agent_status: string;
  next_eval_seconds: number;
}

interface PoolBucketCardProps {
  poolId: string;
  label: string;
  risk: string;
  riskColor: string;
  onDeposit: (poolId: string) => void;
  onWithdraw: (poolId: string) => void;
}

const ADAPTER_ICON: Record<string, { icon: string; color: string }> = {
  ekubo_lp: { icon: "\u2B21", color: "text-cyan-400" },
  staking: { icon: "\u26D3", color: "text-violet-400" },
  lending: { icon: "\uD83C\uDFE6", color: "text-amber-400" },
};

function usd(v: number) {
  if (v === 0) return "$0";
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    in_range: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    out_of_range: "bg-red-500/15 text-red-400 border-red-500/30",
    active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    delegated: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    pending_exit: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  };
  const cls = map[status] ?? "bg-zinc-700/30 text-zinc-400 border-zinc-600/30";
  return (
    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function PoolBucketCard({
  poolId,
  label,
  risk,
  riskColor,
  onDeposit,
  onWithdraw,
}: PoolBucketCardProps) {
  const [composition, setComposition] = useState<PoolComposition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<PoolComposition>(
        `/api/v1/zkdefi/pools/${poolId}/composition`
      );
      setComposition(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !composition) {
    return <div className="h-32 rounded-xl bg-zinc-800/40 animate-pulse" />;
  }

  if (error && !composition) {
    return (
      <div className="glass rounded-xl p-4 border border-red-900/40">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span className="text-sm font-semibold text-zinc-100">{label} Pool</span>
        </div>
        <p className="text-xs text-red-300 mb-2">{error}</p>
        <button
          onClick={load}
          className="flex items-center gap-1 px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  const c = composition!;
  const deployedPct = c.total_value_usd > 0
    ? Math.round((c.deployed_value_usd / c.total_value_usd) * 100)
    : 0;

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-4 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Lock className="w-4 h-4 text-violet-400 shrink-0" />
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-zinc-100">{label} Pool</h4>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${riskColor}`}>
                {risk}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="text-zinc-400">
                Total <span className="text-zinc-200 font-medium">{usd(c.total_value_usd)}</span>
              </span>
              <span className="text-zinc-400">
                APY <span className="text-emerald-400 font-medium">{(c.blended_apy ?? 0).toFixed(1)}%</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Idle / Deployed bar */}
          <div className="hidden sm:flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Idle</span>
            <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500/70 rounded-full transition-all"
                style={{ width: `${deployedPct}%` }}
              />
            </div>
            <span className="text-zinc-500">Deployed</span>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          )}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800/60">
          {/* Value breakdown */}
          <div className="grid grid-cols-3 gap-3 pt-3">
            <div className="text-center">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Total</p>
              <p className="text-sm font-bold text-zinc-100">{usd(c.total_value_usd)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Idle</p>
              <p className="text-sm font-bold text-zinc-300">{usd(c.idle_value_usd)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Deployed</p>
              <p className="text-sm font-bold text-emerald-400">{usd(c.deployed_value_usd)}</p>
            </div>
          </div>

          {/* Position breakdown */}
          {c.positions.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Positions</p>
              {c.positions.map((pos) => {
                const ai = ADAPTER_ICON[pos.adapter] ?? { icon: "\u2022", color: "text-zinc-400" };
                return (
                  <div
                    key={pos.id}
                    className="flex items-center justify-between rounded-lg bg-zinc-900/40 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${ai.color}`}>{ai.icon}</span>
                      <div>
                        <span className="text-xs font-medium text-zinc-200">
                          {pos.pair ?? pos.token ?? pos.adapter}
                        </span>
                        {pos.adapter === "staking" && pos.metadata?.pool_name ? (
                          <span className="ml-1.5 text-[10px] text-zinc-500">
                            {String(pos.metadata.pool_name)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-300">{usd(pos.value_usd)}</span>
                      <span className="text-emerald-400">{(pos.apy ?? 0).toFixed(1)}%</span>
                      {statusBadge(pos.status)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="text-xs text-zinc-500">No deployed positions</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">
                Capital is idle — agent will deploy when conditions are favorable
              </p>
            </div>
          )}

          {/* Agent status */}
          <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
            <Bot className="w-3.5 h-3.5" />
            <span>
              Agent: {c.agent_status}
              {c.next_eval_seconds > 0 &&
                ` · next eval in ${Math.ceil(c.next_eval_seconds / 60)}m`}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onDeposit(poolId)}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors"
            >
              Deposit
            </button>
            <button
              onClick={() => onWithdraw(poolId)}
              className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-200 text-sm font-medium hover:bg-zinc-800 transition-colors"
            >
              Withdraw
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
