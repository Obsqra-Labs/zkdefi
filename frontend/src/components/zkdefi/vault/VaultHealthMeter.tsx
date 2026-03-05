"use client";

import { useMemo, useState, useEffect } from "react";

export interface VaultHealthMeterProps {
  adapters: Array<{ name: string; health: string; value: number }>;
  cooldownRemaining: number;
  riskBoundUsed?: number;
}

const ALLOCATION_COLORS: Record<string, string> = {
  "Ekubo LP": "bg-blue-500",
  Ekubo: "bg-blue-500",
  Lending: "bg-emerald-500",
  Staking: "bg-purple-500",
  Idle: "bg-zinc-600",
};

function getAllocationColor(name: string): string {
  return ALLOCATION_COLORS[name] ?? "bg-zinc-500";
}

function formatCooldown(seconds: number): string {
  if (seconds <= 0) return "Ready";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function riskBoundColor(pct: number): string {
  if (pct < 60) return "bg-emerald-500";
  if (pct < 80) return "bg-amber-500";
  return "bg-red-500";
}

function healthDotColor(health: string): string {
  switch (health?.toUpperCase()) {
    case "HEALTHY":
      return "bg-emerald-500";
    case "DEGRADED":
      return "bg-amber-500";
    case "CIRCUIT_BREAKER":
    case "DISABLED":
      return "bg-red-500";
    default:
      return "bg-zinc-500";
  }
}

export function VaultHealthMeter({
  adapters,
  cooldownRemaining,
  riskBoundUsed = 0,
}: VaultHealthMeterProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const allocationSegments = useMemo(() => {
    const total = adapters.reduce((s, a) => s + a.value, 0);
    const idle = Math.max(0, 100 - total);
    const segments: Array<{ name: string; pct: number; color: string }> = adapters
      .filter((a) => a.value > 0)
      .map((a) => ({
        name: a.name,
        pct: a.value,
        color: getAllocationColor(a.name),
      }));
    if (idle > 0) {
      segments.push({ name: "Idle", pct: idle, color: "bg-zinc-600" });
    }
    return segments;
  }, [adapters]);

  if (adapters.length === 0) {
    return (
      <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-lg p-3">
        <p className="text-xs text-zinc-500 text-center py-2">No adapters configured</p>
      </div>
    );
  }

  return (
    <div
      className={`bg-zinc-900/30 border border-zinc-800/50 rounded-lg p-3 transition-all duration-300 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}
      aria-label="Vault health overview"
    >
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4 md:gap-6">
        {/* 1. Risk Bound Used */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-white/40">Risk Bound</span>
          <div className="flex items-center gap-2">
            <div
              className="w-16 h-2 rounded-full bg-zinc-800 overflow-hidden"
              role="meter"
              aria-valuenow={riskBoundUsed}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Risk bound usage: ${riskBoundUsed}%`}
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${riskBoundColor(riskBoundUsed)}`}
                style={{ width: `${Math.min(100, Math.max(0, riskBoundUsed))}%` }}
              />
            </div>
            <span className="text-xs font-mono text-white/80 tabular-nums">
              {riskBoundUsed}%
            </span>
          </div>
        </div>

        {/* 2. Allocation Distribution */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="text-xs text-white/40">Allocation</span>
          <div className="flex items-center gap-0.5" role="img" aria-label={`Allocation: ${allocationSegments.map(s => `${s.name} ${s.pct.toFixed(0)}%`).join(", ")}`}>
            {allocationSegments.map((s) => (
              <div
                key={s.name}
                className={`h-2 rounded-sm min-w-[2px] transition-all duration-500 ${s.color}`}
                style={{ width: `${s.pct}%` }}
                title={`${s.name}: ${s.pct.toFixed(0)}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/50">
            {allocationSegments.map((s) => (
              <span key={s.name}>{s.name}</span>
            ))}
          </div>
        </div>

        {/* 3. Adapter Health */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-white/40">Adapters</span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {adapters.map((a) => (
              <div key={a.name} className="flex items-center gap-1.5">
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${healthDotColor(a.health)}`}
                  title={a.health}
                  aria-label={`${a.name}: ${a.health}`}
                />
                <span className="text-xs text-white/70 truncate max-w-16">
                  {a.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Cooldown Timer */}
        <div className="flex flex-col gap-1 min-w-0 shrink-0">
          <span className="text-xs text-white/40">Cooldown</span>
          <span
            className={`text-xs font-medium ${
              cooldownRemaining <= 0 ? "text-emerald-400" : "text-amber-400"
            }`}
            aria-label={`Cooldown: ${formatCooldown(cooldownRemaining)}`}
          >
            {formatCooldown(cooldownRemaining)}
          </span>
        </div>
      </div>
    </div>
  );
}
