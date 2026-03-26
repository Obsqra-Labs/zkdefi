"use client";

import { ArrowUp, CheckCircle2, Clock, Activity, Coins, AlertTriangle, Zap } from "lucide-react";
import type { ReputationProfile } from "@/lib/receiptos/types";

const TIER_NAMES: Record<number, string> = { 0: "Strict", 1: "Standard", 2: "Express" };

/* ── Tier benefits (mirrors backend TIER_INFO) ─────────────────── */

interface TierBen {
  deposits: string;
  maxPos: string;
  fee: string;
  relayer: string;
  proof: string;
}

const TIER_BEN: Record<number, TierBen> = {
  0: { deposits: "2/day",   maxPos: "10 ETH",   fee: "0.5%", relayer: "None",     proof: "Full ZKML" },
  1: { deposits: "10/day",  maxPos: "50 ETH",   fee: "0.3%", relayer: "1hr delay", proof: "Setup only" },
  2: { deposits: "255/day", maxPos: "Unlimited", fee: "0.1%", relayer: "Instant",  proof: "Optimistic" },
};

export function TierProgress({ profile }: { profile: ReputationProfile }) {
  const { upgrade_eligible, upgrade_requirements, tier } = profile;

  /* Compute failure ratio (backend blocks upgrade if > 30%) */
  const totalTxns = profile.successful_txns + profile.failed_txns;
  const failureRatio = totalTxns > 0 ? profile.failed_txns / totalTxns : 0;
  const failureBlocked = failureRatio > 0.3;

  // Already at max tier
  if (tier >= 2) {
    const ben = TIER_BEN[2];
    return (
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-5 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-cyan-400">Max Tier — Express</span>
        </div>
        <p className="text-xs text-zinc-500">
          Optimistic + batched proofs, instant relayer, unlimited position size, {ben.fee} fees.
        </p>
      </div>
    );
  }

  if (upgrade_eligible && !failureBlocked) {
    const nextBen = TIER_BEN[tier + 1];
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <ArrowUp className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-400">Upgrade Available</span>
        </div>
        <p className="text-xs text-zinc-400">
          You qualify for <span className="font-semibold text-zinc-200">{TIER_NAMES[tier + 1]}</span>.
          Claim your reputation receipt to upgrade on-chain.
        </p>
        <BenefitsPreview current={TIER_BEN[tier]} next={nextBen} nextName={TIER_NAMES[tier + 1]} />
      </div>
    );
  }

  if (!upgrade_requirements) {
    return null;
  }

  const reqs = upgrade_requirements;
  const targetName = TIER_NAMES[reqs.target_tier] ?? `Tier ${reqs.target_tier}`;

  /* Compute which requirements are already met to identify blocker */
  const blockers: string[] = [];
  if (reqs.needs_tenure_days != null && reqs.needs_tenure_days > 0) blockers.push("tenure");
  if (reqs.needs_successful_txns != null && reqs.needs_successful_txns > 0) blockers.push("transactions");
  if (reqs.needs_collateral_eth != null && reqs.needs_collateral_eth > 0) blockers.push("collateral");
  if (failureBlocked) blockers.push("failure rate");

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-400">
          Next: <span className="text-zinc-200">{targetName}</span>
        </h3>
        <span className="text-[10px] text-zinc-600">Tier {reqs.target_tier}</span>
      </div>

      {/* Failure ratio warning */}
      {failureBlocked && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
          <div className="text-[10px] text-red-300">
            <span className="font-semibold">Failure rate blocks upgrade</span>
            <span className="ml-1 text-red-400/80">
              ({Math.round(failureRatio * 100)}% — must be below 30%)
            </span>
          </div>
        </div>
      )}

      {/* Sole blocker insight */}
      {blockers.length === 1 && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
          <Zap className="h-3 w-3" />
          <span className="font-medium">{capitalize(blockers[0])}</span> is your only remaining requirement.
        </div>
      )}

      {/* Progress bars */}
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

      {/* Benefits preview */}
      <BenefitsPreview
        current={TIER_BEN[tier]}
        next={TIER_BEN[reqs.target_tier]}
        nextName={targetName}
      />
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────── */

function BenefitsPreview({
  current,
  next,
  nextName,
}: {
  current: TierBen;
  next: TierBen;
  nextName: string;
}) {
  const rows: { label: string; now: string; then: string }[] = [
    { label: "Deposits", now: current.deposits, then: next.deposits },
    { label: "Max Position", now: current.maxPos, then: next.maxPos },
    { label: "Fee", now: current.fee, then: next.fee },
    { label: "Relayer", now: current.relayer, then: next.relayer },
    { label: "Proof", now: current.proof, then: next.proof },
  ];

  return (
    <div className="space-y-1">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">
        What {nextName} gives you
      </p>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-0.5 text-[10px]">
        <span />
        <span className="text-zinc-600">Now</span>
        <span className="text-zinc-600">{nextName}</span>
        {rows.map((r) => (
          <Row key={r.label} {...r} />
        ))}
      </div>
    </div>
  );
}

function Row({ label, now, then }: { label: string; now: string; then: string }) {
  const improved = now !== then;
  return (
    <>
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-500">{now}</span>
      <span className={improved ? "font-medium text-emerald-400" : "text-zinc-500"}>
        {then}
      </span>
    </>
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
