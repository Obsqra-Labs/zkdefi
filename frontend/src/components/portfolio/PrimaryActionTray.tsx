"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ChevronRight, Loader2, ShieldCheck, Wallet, Zap } from "lucide-react";

type DeskTone = "good" | "neutral" | "warning";

function StatusPill({
  tone,
  children,
}: {
  tone: DeskTone;
  children: ReactNode;
}) {
  const className =
    tone === "good"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
        : "border-zinc-700 bg-zinc-950 text-zinc-300";
  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${className}`}>
      {children}
    </span>
  );
}

type Props = {
  checking: boolean;
  executing: boolean;
  showSafetyDetails: boolean;
  onToggleSafetyDetails: () => void;
  onRunGateCheck: () => void;
  onPrimaryAction: () => void;
  primaryActionDisabled: boolean;
  primaryActionLabel: string;
  hasFreshGateCheck: boolean;
  actionType: "swap" | "rebalance";
  pendingWalletCalls: unknown[] | null;
  tone: DeskTone;
  label: string;
  walletMismatch: boolean;
  walletLabel: string;
  proposalOutdated: boolean;
  executionNote: string | null;
  executionLink?: string | null;
};

export function PrimaryActionTray({
  checking,
  executing,
  showSafetyDetails,
  onToggleSafetyDetails,
  onRunGateCheck,
  onPrimaryAction,
  primaryActionDisabled,
  primaryActionLabel,
  hasFreshGateCheck,
  actionType,
  pendingWalletCalls,
  tone,
  label,
  walletMismatch,
  walletLabel,
  proposalOutdated,
  executionNote,
  executionLink,
}: Props) {
  const statusTone = walletMismatch || proposalOutdated ? "warning" : tone;
  const statusIcon = walletMismatch ? (
    <AlertTriangle className="h-4 w-4 text-amber-300" />
  ) : proposalOutdated ? (
    <ShieldCheck className="h-4 w-4 text-amber-300" />
  ) : pendingWalletCalls?.length && actionType === "rebalance" ? (
    <Wallet className="h-4 w-4 text-emerald-300" />
  ) : hasFreshGateCheck ? (
    <Zap className="h-4 w-4 text-emerald-300" />
  ) : (
    <ShieldCheck className="h-4 w-4 text-zinc-400" />
  );
  const statusTitle = walletMismatch
    ? `Wallet mismatch: ${walletLabel}`
    : proposalOutdated
      ? "Refreshing safety state"
      : label;
  const statusBody = walletMismatch
    ? "Switch to Starknet mainnet before signing."
    : proposalOutdated
      ? "The proposal changed, so the desk is checking the latest version."
      : executionNote ??
        (label === "Needs adjustment"
          ? "The latest gate result is blocking this draft. Adjust the target and the desk will re-check automatically."
          : "One clear action lives here. Review once, then sign.");

  return (
    <div className="mt-3.5 rounded-[20px] border border-zinc-800/80 bg-zinc-900/45 p-3.5 transition-[border-color,background-color,transform,box-shadow] duration-300 ease-out">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <button
            onClick={onRunGateCheck}
            disabled={checking || executing}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Check now
          </button>
          <button
            type="button"
            onClick={onToggleSafetyDetails}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-300 ${showSafetyDetails ? "rotate-90" : ""}`} />
            {showSafetyDetails ? "Hide details" : "Safety details"}
          </button>
          <StatusPill tone={statusTone}>{statusTitle}</StatusPill>
        </div>
        <button
          onClick={onPrimaryAction}
          disabled={primaryActionDisabled}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition-[background-color,transform,box-shadow,opacity] duration-300 ease-out hover:bg-emerald-400 hover:shadow-[0_16px_40px_rgba(16,185,129,0.25)] disabled:cursor-not-allowed disabled:opacity-60 lg:min-w-[184px]"
        >
          {executing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : pendingWalletCalls?.length && actionType === "rebalance" ? (
            <Wallet className="h-4 w-4" />
          ) : hasFreshGateCheck ? (
            <Zap className="h-4 w-4" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          {primaryActionLabel}
        </button>
      </div>

      <div
        className={`mt-3 rounded-2xl border px-3.5 py-3 ${
          walletMismatch || proposalOutdated
            ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
            : executionNote
              ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-100"
              : tone === "good"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                : "border-zinc-800 bg-zinc-900/60 text-zinc-200"
        } transition-[border-color,background-color,opacity,transform] duration-300 ease-out`}
        aria-live="polite"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {statusIcon}
            <div>
              <p className="text-sm font-medium">{statusTitle}</p>
              <p className="mt-0.5 text-sm opacity-90">{statusBody}</p>
            </div>
          </div>
          {executionLink ? (
            <a
              href={executionLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs underline underline-offset-4 transition-opacity duration-200 hover:opacity-80"
            >
              View on Voyager
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
