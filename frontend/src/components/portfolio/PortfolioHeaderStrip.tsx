"use client";

import { AlertTriangle, Loader2, RefreshCw, ShieldCheck, Wallet, Zap } from "lucide-react";

import { formatUsd } from "./formatters";

function CompactBadge({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warning";
}) {
  const valueClassName =
    tone === "good" ? "text-emerald-200" : tone === "warning" ? "text-amber-200" : "text-white";

  return (
    <div className="rounded-full border border-zinc-800/80 bg-zinc-900/55 px-3 py-1.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label} </span>
      <span className={`text-[11px] font-medium ${valueClassName}`}>{value}</span>
    </div>
  );
}

function HeaderBadge({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-[11px] text-zinc-300">
      {icon}
      {children}
    </span>
  );
}

type Props = {
  address: string;
  loading: boolean;
  totalPortfolioValue: number;
  headerBreakdown: string;
  driftLabel: string;
  driftHint: string;
  safetyLabel: string;
  safetyHint: string;
  trustGrade: string;
  trustTier: number;
  isMainnet: boolean;
  checking: boolean;
  onRefresh: () => void;
  onEmergencyStop: () => void;
  paused: boolean;
};

export function PortfolioHeaderStrip({
  address,
  loading,
  totalPortfolioValue,
  headerBreakdown,
  driftLabel,
  driftHint,
  safetyLabel,
  safetyHint,
  trustGrade,
  trustTier,
  isMainnet,
  checking,
  onRefresh,
  onEmergencyStop,
  paused,
}: Props) {
  const driftTone =
    driftLabel === "On target"
      ? "good"
      : driftLabel === "Rebalance suggested"
        ? "warning"
        : "neutral";
  const safetyTone = safetyLabel === "Safe to sign" ? "good" : safetyLabel === "Needs adjustment" ? "warning" : "neutral";

  return (
    <section className="relative overflow-hidden rounded-[22px] border border-zinc-800/80 bg-zinc-950/88 px-4 py-3.5 shadow-[0_18px_48px_rgba(0,0,0,0.26)]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <HeaderBadge icon={<Wallet className="h-3.5 w-3.5 text-emerald-400" />}>
                {address.slice(0, 6)}...{address.slice(-4)}
              </HeaderBadge>
              <HeaderBadge icon={<Zap className={`h-3.5 w-3.5 ${isMainnet ? "text-emerald-400" : "text-amber-300"}`} />}>
                Wallet signing mode
              </HeaderBadge>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <p className="text-2xl font-semibold tracking-tight text-white">
                {loading ? "..." : formatUsd(totalPortfolioValue)}
              </p>
              <p className="pb-0.5 text-xs text-zinc-500">{headerBreakdown}</p>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">
              {paused
                ? "Trading is paused until you resume wallet signing."
                : "Use the Gate below to decide whether this wallet should move."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300 transition-colors duration-200 hover:border-emerald-500/40 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={onEmergencyStop}
              disabled={checking}
              className={`inline-flex items-center justify-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
                paused
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                  : "border-red-500/30 bg-red-500/10 text-red-100 hover:bg-red-500/20"
              }`}
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : paused ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {paused ? "Resume" : "Emergency stop"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CompactBadge label="Drift" value={driftLabel} tone={driftTone} />
          <CompactBadge label="Safety" value={safetyLabel} tone={safetyTone} />
          <CompactBadge label="Trust" value={`${trustGrade} · Tier ${trustTier}`} tone="neutral" />
          <div className="min-w-0 rounded-full border border-zinc-800/80 bg-zinc-900/55 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Desk </span>
            <span className="text-[11px] text-zinc-300">{safetyHint}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
