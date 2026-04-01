"use client";

import { Loader2, RefreshCw, ShieldCheck, Wallet, Zap } from "lucide-react";

import { formatUsd } from "./formatters";
import type { WorkflowMode } from "./types";

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
  workflowMode: WorkflowMode;
  onWorkflowModeChange: (mode: WorkflowMode) => void;
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
  workflowMode,
  onWorkflowModeChange,
}: Props) {
  const driftTone =
    driftLabel === "On target"
      ? "good"
      : driftLabel === "Rebalance suggested"
        ? "warning"
        : "neutral";
  const safetyTone =
    safetyLabel === "Safe to sign"
      ? "good"
      : safetyLabel === "Needs adjustment" || safetyLabel === "Permitted with fee warning"
        ? "warning"
        : "neutral";

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
                {isMainnet ? "Mainnet" : "Sepolia"}
              </HeaderBadge>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <p className="text-2xl font-semibold tracking-tight text-white">
                {loading ? (
                  <span className="inline-block h-7 w-28 animate-pulse rounded-lg bg-zinc-800" />
                ) : (
                  formatUsd(totalPortfolioValue)
                )}
              </p>
              <p className="pb-0.5 text-xs text-zinc-500">{loading ? "" : headerBreakdown}</p>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">
              {paused
                ? "Trading paused."
                : "Gate below governs wallet execution."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border border-zinc-700/80 bg-zinc-900/60 p-0.5">
              {(["manual", "assisted", "automated"] as const).map((mode) => {
                const labels: Record<WorkflowMode, string> = { manual: "Manual", assisted: "AI Assist", automated: "Autopilot" };
                const selected = workflowMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onWorkflowModeChange(mode)}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors duration-150 ${
                      selected
                        ? mode === "automated"
                          ? "bg-violet-500/20 text-violet-200"
                          : mode === "assisted"
                            ? "bg-cyan-500/20 text-cyan-100"
                            : "bg-zinc-700/60 text-white"
                        : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {labels[mode]}
                  </button>
                );
              })}
            </div>
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-300 transition-colors duration-200 hover:border-emerald-500/40 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            {paused && (
              <button
                onClick={onEmergencyStop}
                disabled={checking}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Resume
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CompactBadge label="Drift" value={driftLabel} tone={driftTone} />
          <CompactBadge label="Safety" value={safetyLabel} tone={safetyTone} />
          <CompactBadge label="Trust" value={`${trustGrade} · Tier ${trustTier}`} tone="neutral" />
        </div>
      </div>
    </section>
  );
}
