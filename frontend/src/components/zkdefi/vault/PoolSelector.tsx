"use client";

import { useState, useEffect } from "react";
import { Layers, Shield, TrendingUp, Zap } from "lucide-react";
import { API_BASE } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Pool definitions — map to Ekubo tick widths on the backend
// ---------------------------------------------------------------------------

export type PoolBucket = "conservative" | "balanced" | "aggressive";

export interface PoolOption {
  id: PoolBucket;
  label: string;
  description: string;
  /** Backend pool_type value used in deposit calls */
  poolType: number;
  /** Ekubo tick-width (for display) */
  tickWidth: number;
  icon: typeof Shield;
  color: string;
  borderColor: string;
  bgColor: string;
}

export const POOL_OPTIONS: PoolOption[] = [
  {
    id: "conservative",
    label: "Conservative",
    description: "Wide range, lower IL risk. Ideal for passive holders.",
    poolType: 0,
    tickWidth: 6000,
    icon: Shield,
    color: "text-blue-400",
    borderColor: "border-blue-500/30",
    bgColor: "bg-blue-500/10",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Medium range, balanced yield vs. risk.",
    poolType: 1,
    tickWidth: 3000,
    icon: Layers,
    color: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    bgColor: "bg-emerald-500/10",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    description: "Tight range, max yield, higher rebalance frequency.",
    poolType: 2,
    tickWidth: 1200,
    icon: Zap,
    color: "text-amber-400",
    borderColor: "border-amber-500/30",
    bgColor: "bg-amber-500/10",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PoolSelectorProps {
  selected: PoolBucket;
  onSelect: (pool: PoolBucket) => void;
}

export function PoolSelector({ selected, onSelect }: PoolSelectorProps) {
  const [apys, setApys] = useState<Record<string, number>>({});

  // Fetch APYs from oracle
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/oracle/pool-apys`, {
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok && !dead) {
          const data = await res.json();
          setApys({
            conservative: (data.conservative ?? 0) / 100,
            balanced: (data.neutral ?? 0) / 100,
            aggressive: (data.aggressive ?? 0) / 100,
          });
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => { dead = true; };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Allocation Strategy
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {POOL_OPTIONS.map((pool) => {
          const isSelected = selected === pool.id;
          const Icon = pool.icon;
          const apy = apys[pool.id];

          return (
            <button
              key={pool.id}
              type="button"
              onClick={() => onSelect(pool.id)}
              className={`relative rounded-xl border p-3 text-left transition-all ${
                isSelected
                  ? `${pool.borderColor} ${pool.bgColor} ring-1 ring-white/10`
                  : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/15"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon className={`w-3.5 h-3.5 ${isSelected ? pool.color : "text-zinc-500"}`} />
                <span className={`text-xs font-semibold ${isSelected ? "text-white" : "text-zinc-300"}`}>
                  {pool.label}
                </span>
              </div>

              <p className="text-[10px] text-zinc-500 leading-relaxed mb-2">
                {pool.description}
              </p>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-600">
                  ±{(pool.tickWidth / 100).toFixed(0)}% range
                </span>
                {apy != null && apy > 0 && (
                  <span className={`text-[10px] font-medium ${isSelected ? pool.color : "text-zinc-400"}`}>
                    {apy.toFixed(1)}% APY
                  </span>
                )}
              </div>

              {/* Selected indicator */}
              {isSelected && (
                <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${pool.color.replace("text-", "bg-")}`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Resolve a PoolBucket to its backend pool_type int. */
export function poolBucketToType(bucket: PoolBucket): number {
  return POOL_OPTIONS.find((p) => p.id === bucket)?.poolType ?? 1;
}
