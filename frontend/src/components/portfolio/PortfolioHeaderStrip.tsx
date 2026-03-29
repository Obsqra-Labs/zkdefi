"use client";

import type { ReactNode } from "react";
import { Activity, AlertTriangle, Loader2, RefreshCw, ShieldCheck, Wallet, Zap } from "lucide-react";

import { formatUsd } from "./formatters";

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "good" | "warning";
}) {
  const valueClassName =
    tone === "good" ? "text-emerald-200" : tone === "warning" ? "text-amber-200" : "text-white";
  return (
    <div className="rounded-[18px] border border-zinc-800/80 bg-zinc-900/55 px-3.5 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <p className={`mt-1.5 text-lg font-semibold ${valueClassName}`}>{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

function HeaderBadge({ icon, children }: { icon: ReactNode; children: ReactNode }) {
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
    <section className="relative overflow-hidden rounded-[28px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur sm:p-5">
      <div className="hero-glow absolute -right-24 -top-24 h-72 w-72" aria-hidden="true" />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <HeaderBadge icon={<Wallet className="h-3.5 w-3.5 text-emerald-400" />}>
              {address.slice(0, 6)}...{address.slice(-4)}
            </HeaderBadge>
            <HeaderBadge icon={<Activity className="h-3.5 w-3.5 text-cyan-300" />}>
              Agent active
            </HeaderBadge>
            <HeaderBadge icon={<Zap className={`h-3.5 w-3.5 ${isMainnet ? "text-emerald-400" : "text-amber-300"}`} />}>
              Wallet signing mode
            </HeaderBadge>
          </div>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">Portfolio value</p>
          <div className="mt-1.5 flex flex-wrap items-end gap-3">
            <h1 className="font-serif text-4xl font-bold tracking-tight text-white sm:text-[3.1rem]">
              {loading ? "..." : formatUsd(totalPortfolioValue)}
            </h1>
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300 transition-colors duration-200 hover:border-emerald-500/40 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
          <p className="mt-1.5 text-sm text-zinc-400">{headerBreakdown}</p>
        </div>

        <div className="grid gap-2.5 xl:min-w-[460px]">
          <div className="grid gap-2.5 sm:grid-cols-[118px_1fr_1fr]">
            <div className="rounded-[18px] border border-cyan-500/20 bg-cyan-500/5 px-3.5 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Trust</p>
              <p className="mt-1.5 text-2xl font-semibold text-white">{trustGrade}</p>
              <div className="mt-0.5 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
                <span>Tier {trustTier}</span>
                <span>History</span>
              </div>
            </div>
            <StatCard label="Drift status" value={driftLabel} hint={driftHint} tone={driftTone} />
            <StatCard label="Safety status" value={safetyLabel} hint={safetyHint} tone={safetyTone} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-zinc-800/80 bg-zinc-900/45 px-3.5 py-2.5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Trading controls</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {paused
                  ? "Trading is paused until you resume wallet signing."
                  : "Pause activity immediately if wallet or market context changes."}
              </p>
            </div>
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
              {paused ? "Resume trading" : "Emergency stop"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
