"use client";

import {
  Clock,
  User,
  Activity,
  Layers,
  AlertTriangle,
  ArrowDownToLine,
} from "lucide-react";
import type { SignalEntry } from "@/lib/receiptos/types";

const SIGNAL_ICON: Record<string, typeof Clock> = {
  wallet_age_days: Clock,
  account_type: User,
  transaction_count: Activity,
  protocol_categories: Layers,
  liquidation_count: AlertTriangle,
  bridge_inflow: ArrowDownToLine,
};

/**
 * Renders a single reputation signal.
 * Per spec: null values show "Not enough data", never zero.
 * No color ranking or percentile language.
 */
export function SignalCard({ signal }: { signal: SignalEntry }) {
  const Icon = SIGNAL_ICON[signal.key] ?? Activity;
  const isNull = signal.value == null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 transition-colors hover:border-zinc-700">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-zinc-500" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          {signal.label}
        </span>
      </div>

      <div className="mt-2">
        {isNull ? (
          <p className="text-sm italic text-zinc-600">Not enough data</p>
        ) : signal.key === "account_type" ? (
          <p className="text-lg font-bold text-zinc-200">{signal.unit}</p>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-zinc-100">
              {typeof signal.value === "number"
                ? signal.value.toLocaleString()
                : signal.value}
            </span>
            <span className="text-xs text-zinc-500">{signal.unit}</span>
          </div>
        )}
      </div>
    </div>
  );
}
