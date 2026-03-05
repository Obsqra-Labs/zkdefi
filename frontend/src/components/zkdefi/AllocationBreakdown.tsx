"use client";

import React from "react";
import { Droplets, Target, Lock, Coins, ChevronRight, Award } from "lucide-react";
import type { AllocationBreakdown as AllocationBreakdownType } from "@/contexts/VaultStore";

interface AllocationBreakdownProps {
  allocation: AllocationBreakdownType;
  onSelect?: (bucket: "lp" | "limit" | "private" | "staking" | "idle") => void;
}

const BUCKETS: { key: keyof AllocationBreakdownType; label: string; icon: React.ElementType; color: string }[] = [
  { key: "lp", label: "LP", icon: Droplets, color: "text-cyan-400" },
  { key: "limit", label: "Limit", icon: Target, color: "text-amber-400" },
  { key: "private", label: "Private", icon: Lock, color: "text-violet-400" },
  { key: "staking", label: "Staking", icon: Award, color: "text-green-400" },
  { key: "idle", label: "Idle", icon: Coins, color: "text-zinc-400" },
];

export function AllocationBreakdown({ allocation, onSelect }: AllocationBreakdownProps) {
  const total = allocation.lp + allocation.limit + allocation.private + (allocation.staking ?? 0) + allocation.idle;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h3 className="font-semibold text-zinc-200 mb-4">Allocation</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {BUCKETS.map(({ key, label, icon: Icon, color }) => {
          const pct = total > 0 ? Math.round((allocation[key] / total) * 100) : (key === "idle" ? 100 : 0);
          const content = (
            <div
              className={`flex items-center justify-between gap-2 p-3 rounded-lg border border-zinc-700/50 bg-zinc-800/30 ${onSelect ? "cursor-pointer hover:border-zinc-600 hover:bg-zinc-800/50" : ""}`}
              onClick={onSelect ? () => onSelect(key) : undefined}
              onKeyDown={onSelect ? (e) => e.key === "Enter" && onSelect(key) : undefined}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                <span className="text-sm font-medium text-zinc-200">{label}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-sm font-bold ${color}`}>{pct}%</span>
                {onSelect && <ChevronRight className="w-4 h-4 text-zinc-500" />}
              </div>
            </div>
          );
          return <React.Fragment key={key}>{content}</React.Fragment>;
        })}
      </div>
      {onSelect && (
        <p className="text-xs text-zinc-500 mt-3">Click a bucket to open Trade with that context.</p>
      )}
    </div>
  );
}
