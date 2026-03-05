"use client";

import Link from "next/link";
import { Shield, Star } from "lucide-react";
import type { RiskProfileBundle } from "@/hooks/useProfile";

interface RiskProfileSummaryCardProps {
  profile: RiskProfileBundle | null;
  loading: boolean;
  address: string | undefined;
}

export function RiskProfileSummaryCard({ profile, loading, address }: RiskProfileSummaryCardProps) {
  const onboarding = profile?.onboarding ?? null;
  const passport = profile?.risk_passport ?? null;
  const reputation = profile?.reputation ?? null;
  const hasIdentity = onboarding?.has_agent ?? false;
  const letter = passport?.letter_rating ?? "—";
  const composite = passport?.composite_score ?? 0;
  const tierName = reputation?.tier_name ?? passport?.tier_name ?? "Strict";
  const creditTier = passport?.credit_tier ?? null;
  const activeSessions = profile?.session_summary?.active_count ?? 0;
  const dualWalletSession = profile?.dual_wallet_session ?? null;
  const dualWalletLinked = Boolean(dualWalletSession?.active);
  const dualWalletLabel = dualWalletLinked
    ? `${shortHex(dualWalletSession?.evm_address)} · ${dualWalletSession?.chain ?? "ethereum"}`
    : "Not linked";

  if (loading && address) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 animate-pulse">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-xl bg-zinc-700/50" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-32 bg-zinc-700/50 rounded" />
            <div className="h-4 w-48 bg-zinc-700/50 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!hasIdentity) {
    return (
      <div className="rounded-xl border border-violet-500/30 bg-violet-950/20 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">Risk Profile</h2>
            <p className="text-sm text-zinc-400">Complete onboarding to build your Risk Profile and unlock identity, tier, and proof-backed reputation.</p>
          </div>
          <Link
            href="/agent?tab=onboarding"
            prefetch={false}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium text-white transition-colors"
          >
            <Star className="w-4 h-4" /> Complete onboarding
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-700/30 bg-gradient-to-br from-emerald-950/30 to-zinc-900/60 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" /> Risk Profile
        </h2>
        <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded">Composable</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Letter</p>
          <p className={`text-2xl font-bold ${
            letter === "A" ? "text-emerald-400" :
            letter === "B" ? "text-cyan-400" :
            letter === "C" ? "text-amber-400" : "text-zinc-400"
          }`}>
            {letter}
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Score</p>
          <p className="text-2xl font-bold text-white">{composite}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Tier</p>
          <p className="text-lg font-semibold text-zinc-200">{tierName}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Credit · Sessions</p>
          <p className="text-sm font-medium text-zinc-200">
            {creditTier ?? "—"} · {activeSessions} active
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Dual Wallet</p>
          <p className={`text-sm font-medium ${dualWalletLinked ? "text-emerald-300" : "text-zinc-400"}`}>
            {dualWalletLabel}
          </p>
        </div>
      </div>
    </div>
  );
}

function shortHex(value: string | null | undefined): string {
  if (!value) return "--";
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}
