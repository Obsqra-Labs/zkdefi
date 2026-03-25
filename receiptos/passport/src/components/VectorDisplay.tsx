"use client";

import type { ReputationVector } from "@/lib/types";
import { SignalCard } from "./SignalCard";

/**
 * Renders the six signals as a grid.
 * Per spec: no aggregate score, no good/bad color, no percentile language.
 * Null values display as "Not enough data" (never zero).
 */
export function VectorDisplay({ vector }: { vector: ReputationVector }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">
          Reputation Vector
        </h2>
        <span className="text-[10px] text-zinc-600">
          Scanned {new Date(vector.scanned_at).toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vector.signals.map((signal) => (
          <SignalCard key={signal.key} signal={signal} />
        ))}
      </div>
    </div>
  );
}
