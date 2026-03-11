"use client";
import { TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";

export interface OracleSignal {
  pair: string;
  direction: "up" | "down" | "stable";
  confidence: number;
  recommendation: string;
}

export function InlineOracleCard({ signal, onDeploy }: { signal: OracleSignal; onDeploy?: () => void }) {
  const Icon = signal.direction === "up" ? TrendingUp : signal.direction === "down" ? TrendingDown : Minus;
  const color = signal.direction === "up" ? "text-emerald-400" : signal.direction === "down" ? "text-red-400" : "text-zinc-400";

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800 text-xs group">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className="text-zinc-300 font-medium">{signal.pair}</span>
      <span className="text-zinc-500">{signal.recommendation}</span>
      <span className="ml-auto text-zinc-600">conf {(signal.confidence * 100).toFixed(0)}%</span>
      {onDeploy && (
        <button
          onClick={onDeploy}
          className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 flex items-center gap-1"
        >
          <Zap className="w-3 h-3" /> Deploy
        </button>
      )}
    </div>
  );
}
