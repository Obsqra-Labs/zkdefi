"use client";

import {
  ArrowLeftRight,
  Droplets,
  Landmark,
  HandIcon,
  Coins,
  EyeOff,
  BookLock,
  RefreshCw,
  SlidersHorizontal,
  Lock,
  Check,
} from "lucide-react";

const GATE_META: Record<string, { label: string; icon: typeof Lock }> = {
  canSwap:       { label: "Swap",         icon: ArrowLeftRight },
  canLP:         { label: "Liquidity",    icon: Droplets },
  canLend:       { label: "Lend",         icon: Landmark },
  canBorrow:     { label: "Borrow",       icon: HandIcon },
  canStake:      { label: "Stake",        icon: Coins },
  canPrivacy:    { label: "Privacy Pool", icon: EyeOff },
  canDarkLedger: { label: "Dark Ledger",  icon: BookLock },
  canDCA:        { label: "DCA",          icon: RefreshCw },
  canLimits:     { label: "Limit Orders", icon: SlidersHorizontal },
};

export function GateGrid({ gates }: { gates: Record<string, boolean> }) {
  const entries = Object.entries(GATE_META);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-300">Protocol Gates</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 lg:grid-cols-3">
        {entries.map(([key, meta]) => {
          const enabled = gates[key] ?? false;
          const Icon = meta.icon;
          return (
            <div
              key={key}
              className={`relative rounded-xl border px-3 py-3 text-center transition-colors ${
                enabled
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-zinc-800 bg-zinc-900/30 opacity-50"
              }`}
            >
              <Icon className={`mx-auto h-4 w-4 ${enabled ? "text-emerald-400" : "text-zinc-600"}`} />
              <p className={`mt-1 text-[10px] font-medium ${enabled ? "text-zinc-300" : "text-zinc-600"}`}>
                {meta.label}
              </p>
              {enabled ? (
                <Check className="absolute right-1.5 top-1.5 h-2.5 w-2.5 text-emerald-400" />
              ) : (
                <Lock className="absolute right-1.5 top-1.5 h-2.5 w-2.5 text-zinc-600" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
