"use client";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface OracleSignal {
  pair: string;
  direction: "up" | "down" | "stable";
  confidence: number;
  recommendation: string;
}

export function InlineOracleCard({ signal }: { signal: OracleSignal }) {
  const Icon = signal.direction === "up" ? TrendingUp : signal.direction === "down" ? TrendingDown : Minus;
  const color = signal.direction === "up" ? "text-emerald-400" : signal.direction === "down" ? "text-red-400" : "text-zinc-400";

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800 text-xs">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className="text-zinc-300 font-medium">{signal.pair}</span>
      <span className="text-zinc-500">{signal.recommendation}</span>
      <span className="ml-auto text-zinc-600">conf {(signal.confidence * 100).toFixed(0)}%</span>
    </div>
  );
}
