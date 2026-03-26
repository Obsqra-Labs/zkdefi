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
  protocol: string;
  minTier: number;
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
    activityMatch: ["lp", "liquidity", "rebalance"],
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
    activityMatch: ["borrow", "loan"],
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
    activityMatch: ["privacy", "shield", "private"],
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

/* ── Tier benefits (mirrors backend TIER_INFO) ─────────────────── */

interface TierBenefits {
  name: string;
  maxDeposits: string;
  maxPos: string;
  fee: string;
  relayer: string;
  proof: string;
}

const TIER_BENEFITS: Record<number, TierBenefits> = {
  0: { name: "Strict",   maxDeposits: "2/day",   maxPos: "10 ETH",    fee: "0.5%", relayer: "None",     proof: "Full ZKML per action" },
  1: { name: "Standard", maxDeposits: "10/day",  maxPos: "50 ETH",    fee: "0.3%", relayer: "1hr delay", proof: "Setup proof only" },
  2: { name: "Express",  maxDeposits: "255/day", maxPos: "Unlimited",  fee: "0.1%", relayer: "Instant",   proof: "Optimistic + batched" },
};

function countActivity(entries: ActivityEntry[], match: string[]): number {
  if (match.length === 0) return 0;
  return entries.filter((e) => {
    const haystack = `${e.type} ${e.description} ${e.method}`.toLowerCase();
    return match.some((kw) => haystack.includes(kw));
  }).length;
}

interface GateGridProps {
  gates: Record<string, boolean>;
  currentTier: number;
  activity?: ActivityEntry[];
}

export function GateGrid({ gates, currentTier, activity = [] }: GateGridProps) {
  // Group gates by minTier
  const tier1Gates = Object.entries(GATE_META).filter(([, m]) => m.minTier === 1);
  const tier2Gates = Object.entries(GATE_META).filter(([, m]) => m.minTier === 2);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">Protocol Gates</h2>
        <div className="flex items-center gap-3 text-[9px] text-zinc-600">
          <span className="flex items-center gap-1">
            <Fingerprint className="h-2.5 w-2.5 text-cyan-500" /> native
          </span>
          <span className="flex items-center gap-1">
            <Globe className="h-2.5 w-2.5 text-violet-400" /> portable
          </span>
        </div>
      </div>

      {/* Tier 1 group */}
      <TierGateGroup
        tierNum={1}
        gateEntries={tier1Gates}
        gates={gates}
        activity={activity}
        currentTier={currentTier}
      />

      {/* Tier 2 group */}
      <TierGateGroup
        tierNum={2}
        gateEntries={tier2Gates}
        gates={gates}
        activity={activity}
        currentTier={currentTier}
      />
    </div>
  );
}

function TierGateGroup({
  tierNum,
  gateEntries,
  gates,
  activity,
  currentTier,
}: {
  tierNum: number;
  gateEntries: [string, GateDef][];
  gates: Record<string, boolean>;
  activity: ActivityEntry[];
  currentTier: number;
}) {
  const benefits = TIER_BENEFITS[tierNum];
  const unlocked = currentTier >= tierNum;
  const allEnabled = gateEntries.every(([k]) => gates[k]);

  return (
    <div className="space-y-2">
      {/* Tier group header */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${
          unlocked ? "text-emerald-400" : "text-zinc-600"
        }`}>
          {benefits.name} (Tier {tierNum})
        </span>
        {allEnabled && (
          <Check className="h-3 w-3 text-emerald-400" />
        )}
      </div>

      {/* Benefits callout for locked tiers */}
      {!unlocked && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[9px] text-zinc-500">
          <span className="font-medium text-amber-400">Unlock all {gateEntries.length} gates</span>
          <span className="mx-1">→</span>
          {benefits.maxDeposits} deposits · {benefits.maxPos} max · {benefits.fee} fee · {benefits.relayer} relayer · {benefits.proof}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {gateEntries.map(([key, meta]) => {
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

              {count > 0 && (
                <div className="mt-1.5 flex items-center text-[9px] text-zinc-400">
                  <Activity className="mr-0.5 h-2.5 w-2.5" />
                  {count} {count === 1 ? "event" : "events"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
