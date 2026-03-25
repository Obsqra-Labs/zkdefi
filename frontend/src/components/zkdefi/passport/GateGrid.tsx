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
  Activity,
  Globe,
  Fingerprint,
} from "lucide-react";
import type { ActivityEntry } from "@/lib/receiptos/types";

type Provenance = "zkdefi" | "portable";

interface GateDef {
  label: string;
  icon: typeof Lock;
  provenance: Provenance;
  protocol: string;         // concrete protocol name
  minTier: number;
  /** keywords in activity description/type/method to attribute to this gate */
  activityMatch: string[];
}

const GATE_META: Record<string, GateDef> = {
  canSwap: {
    label: "Swap",
    icon: ArrowLeftRight,
    provenance: "portable",
    protocol: "Ekubo / DEX",
    minTier: 1,
    activityMatch: ["swap", "exchange", "trade"],
  },
  canLP: {
    label: "Liquidity",
    icon: Droplets,
    provenance: "zkdefi",
    protocol: "zkde.fi LP Rebalancer",
    minTier: 1,
    activityMatch: ["lp", "liquidity", "rebalance", "ekubo"],
  },
  canLend: {
    label: "Lend",
    icon: Landmark,
    provenance: "zkdefi",
    protocol: "zkde.fi Lending Pool",
    minTier: 1,
    activityMatch: ["lend", "supply", "lending"],
  },
  canBorrow: {
    label: "Borrow",
    icon: HandIcon,
    provenance: "zkdefi",
    protocol: "zkde.fi Collateral Vault",
    minTier: 2,
    activityMatch: ["borrow", "loan", "collateral"],
  },
  canStake: {
    label: "Stake",
    icon: Coins,
    provenance: "portable",
    protocol: "STRK Staking",
    minTier: 1,
    activityMatch: ["stake", "staking"],
  },
  canPrivacy: {
    label: "Privacy Pool",
    icon: EyeOff,
    provenance: "zkdefi",
    protocol: "zkde.fi Shielded Pool",
    minTier: 1,
    activityMatch: ["privacy", "shield", "private", "deposit", "withdraw"],
  },
  canDarkLedger: {
    label: "Dark Ledger",
    icon: BookLock,
    provenance: "zkdefi",
    protocol: "zkde.fi Dark Ledger",
    minTier: 2,
    activityMatch: ["dark_ledger", "dark ledger", "commitment", "nullifier"],
  },
  canDCA: {
    label: "DCA",
    icon: RefreshCw,
    provenance: "zkdefi",
    protocol: "zkde.fi Limit Grid",
    minTier: 2,
    activityMatch: ["dca", "recurring", "dollar cost"],
  },
  canLimits: {
    label: "Limit Orders",
    icon: SlidersHorizontal,
    provenance: "zkdefi",
    protocol: "zkde.fi Limit Grid",
    minTier: 1,
    activityMatch: ["limit", "order", "grid"],
  },
};

const TIER_NAMES: Record<number, string> = { 0: "Strict", 1: "Standard", 2: "Express" };

/** Count activity entries that match a gate's keywords. */
function countActivity(entries: ActivityEntry[], match: string[]): number {
  if (match.length === 0) return 0;
  return entries.filter((e) => {
    const haystack = `${e.type} ${e.description} ${e.method}`.toLowerCase();
    return match.some((kw) => haystack.includes(kw));
  }).length;
}

interface GateGridProps {
  gates: Record<string, boolean>;
  activity?: ActivityEntry[];
}

export function GateGrid({ gates, activity = [] }: GateGridProps) {
  const entries = Object.entries(GATE_META);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">Protocol Gates</h2>
        <div className="flex items-center gap-3 text-[9px] text-zinc-600">
          <span className="flex items-center gap-1">
            <Fingerprint className="h-2.5 w-2.5 text-cyan-500" /> zkde.fi native
          </span>
          <span className="flex items-center gap-1">
            <Globe className="h-2.5 w-2.5 text-violet-400" /> portable
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([key, meta]) => {
          const enabled = gates[key] ?? false;
          const Icon = meta.icon;
          const count = countActivity(activity, meta.activityMatch);
          const isZkdefi = meta.provenance === "zkdefi";

          return (
            <div
              key={key}
              className={`relative rounded-xl border px-4 py-3 transition-all ${
                enabled
                  ? "border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:shadow-lg hover:shadow-emerald-500/5"
                  : "border-zinc-800 bg-zinc-900/30 opacity-60 hover:opacity-80"
              }`}
            >
              {/* Row 1: icon + label + status */}
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 flex-shrink-0 ${enabled ? "text-emerald-400" : "text-zinc-600"}`} />
                <span className={`text-xs font-semibold ${enabled ? "text-zinc-200" : "text-zinc-500"}`}>
                  {meta.label}
                </span>
                <span className="ml-auto">
                  {enabled ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Lock className="h-3 w-3 text-zinc-600" />
                  )}
                </span>
              </div>

              {/* Row 2: protocol + provenance badge */}
              <div className="mt-1.5 flex items-center gap-1.5">
                {isZkdefi ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-px text-[8px] font-medium text-cyan-400">
                    <Fingerprint className="h-2 w-2" />
                    native
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-px text-[8px] font-medium text-violet-400">
                    <Globe className="h-2 w-2" />
                    portable
                  </span>
                )}
                <span className="truncate text-[9px] text-zinc-500">
                  {meta.protocol}
                </span>
              </div>

              {/* Row 3: tier req + activity count */}
              <div className="mt-1.5 flex items-center justify-between text-[9px] text-zinc-600">
                <span>
                  {!enabled
                    ? `Requires ${TIER_NAMES[meta.minTier] ?? `Tier ${meta.minTier}`}`
                    : `Tier ${meta.minTier}+`}
                </span>
                {count > 0 && (
                  <span className="flex items-center gap-0.5 text-zinc-400">
                    <Activity className="h-2.5 w-2.5" />
                    {count} {count === 1 ? "event" : "events"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
