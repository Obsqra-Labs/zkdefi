"use client";

import { ArrowUp, CheckCircle2, Clock, Activity, Coins } from "lucide-react";
import type { ReputationProfile } from "@/lib/receiptos/types";

const TIER_NAMES: Record<number, string> = { 0: "Strict", 1: "Standard", 2: "Express" };

export function TierProgress({ profile }: { profile: ReputationProfile }) {
  const { upgrade_eligible, upgrade_requirements, tier } = profile;

  // Already at max tier
  if (tier >= 2) {
    return (
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-5 py-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-cyan-400">Max Tier Reached</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          You&apos;re at Express — the highest tier with optimistic + batched proofs and zero relayer delay.
        </p>
      </div>
    );
  }

  if (upgrade_eligible) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4">
        <div className="flex items-center gap-2">
          <ArrowUp className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-400">Upgrade Available</span>
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          You qualify for <span className="font-semibold text-zinc-200">{TIER_NAMES[(tier + 1)] ?? `Tier ${tier + 1}`}</span>.
          Claim your reputation receipt to be eligible for on-chain tier upgrade.
        </p>
      </div>
    );
  }

  if (!upgrade_requirements) {
    return null;
  }

  const reqs = upgrade_requirements;
  const targetName = TIER_NAMES[reqs.target_tier] ?? `Tier ${reqs.target_tier}`;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-400">
          Next: <span className="text-zinc-200">{targetName}</span>
        </h3>
        <span className="text-[10px] text-zinc-600">Tier {reqs.target_tier}</span>
      </div>

      <div className="space-y-2">
        {reqs.needs_tenure_days != null && reqs.needs_tenure_days > 0 && (
          <RequirementBar
            icon={Clock}
            label="Tenure"
            current={profile.tenure_days}
            target={profile.tenure_days + reqs.needs_tenure_days}
            unit="days"
          />
        )}
        {reqs.needs_successful_txns != null && reqs.needs_successful_txns > 0 && (
          <RequirementBar
            icon={Activity}
            label="Transactions"
            current={profile.successful_txns}
            target={profile.successful_txns + reqs.needs_successful_txns}
            unit="txns"
          />
        )}
        {reqs.needs_collateral_eth != null && reqs.needs_collateral_eth > 0 && (
          <RequirementBar
            icon={Coins}
            label="Collateral"
            current={profile.collateral_eth}
            target={profile.collateral_eth + reqs.needs_collateral_eth}
            unit="ETH"
          />
        )}
      </div>
    </div>
  );
}

function RequirementBar({
  icon: Icon,
  label,
  current,
  target,
  unit,
}: {
  icon: typeof Clock;
  label: string;
  current: number;
  target: number;
  unit: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-zinc-500">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <span className="text-zinc-400">
          {typeof current === "number" && current % 1 !== 0 ? current.toFixed(2) : current} / {typeof target === "number" && target % 1 !== 0 ? target.toFixed(2) : target} {unit}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-zinc-800">
        <div
          className="h-1.5 rounded-full bg-amber-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
