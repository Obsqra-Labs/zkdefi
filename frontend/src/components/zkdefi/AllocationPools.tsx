"use client";

import { useState, useEffect } from "react";
import { Shield, Zap, Scale } from "lucide-react";
import { API_BASE } from "@/lib/api/client";

interface PoolData {
  type: "conservative" | "neutral" | "aggressive";
  label: string;
  tickWidth: number;
  riskScore: number;
  projectedApy: number;
}

interface AllocationPoolsProps {
  currentPool?: string;
  onSelectPool?: (pool: string) => void;
}

const POOLS: PoolData[] = [
  { type: "conservative", tickWidth: 6000, label: "Conservative", riskScore: 32, projectedApy: 4.2 },
  { type: "neutral", tickWidth: 3000, label: "Balanced", riskScore: 48, projectedApy: 5.5 },
  { type: "aggressive", tickWidth: 1200, label: "Aggressive", riskScore: 67, projectedApy: 7.8 },
];

export function AllocationPools({ currentPool, onSelectPool }: AllocationPoolsProps) {
  const [pools, setPools] = useState<PoolData[]>(POOLS);

  useEffect(() => {
    fetch(`${API_BASE}/v1/zkdefi/oracle/pool-apys`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setPools(pools.map((p) => ({ ...p, projectedApy: (data[p.type] || p.projectedApy * 100) / 100 })));
        }
      })
      .catch(() => {});
  }, []);

  const getIcon = (type: string) => {
    if (type === "conservative") return <Shield className="w-6 h-6 text-blue-400" />;
    if (type === "neutral") return <Scale className="w-6 h-6 text-emerald-400" />;
    return <Zap className="w-6 h-6 text-orange-400" />;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {pools.map((pool) => (
        <button
          key={pool.type}
          onClick={() => onSelectPool?.(pool.type)}
          className={`p-6 rounded-xl border transition-all text-left ${currentPool === pool.type ? "bg-emerald-600/20 border-emerald-500" : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"}`}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${pool.type === "conservative" ? "bg-blue-500/20" : pool.type === "neutral" ? "bg-emerald-500/20" : "bg-orange-500/20"}`}>
              {getIcon(pool.type)}
            </div>
            <div>
              <div className="font-semibold text-lg">{pool.label}</div>
              <div className="text-sm text-zinc-400">Risk: {pool.riskScore}/100</div>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-zinc-400">Ekubo Tick Width</span><span>±{pool.tickWidth}</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">APY</span><span className="text-emerald-400">{pool.projectedApy.toFixed(1)}%</span></div>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full mt-4 overflow-hidden">
            <div className={`h-full ${pool.type === "conservative" ? "bg-blue-500" : pool.type === "neutral" ? "bg-emerald-500" : "bg-orange-500"}`} style={{ width: `${Math.round(100 - pool.tickWidth / 60)}%` }} />
          </div>
        </button>
      ))}
    </div>
  );
}
