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
  overridePrimaryAction: boolean;
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
  overridePrimaryAction,
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
      : overridePrimaryAction
        ? "The Gate is flagging fee economics, not route safety. You can still prepare the wallet path and inspect the exact cost yourself."
      : executionNote ??
        (label === "Needs adjustment"
          ? "The latest gate result is blocking this draft. Adjust the target and the desk will re-check automatically."
          : "One clear action lives here. Review once, then sign.");

  return (
    <div className="mt-3.5 rounded-[20px] border border-zinc-800/80 bg-zinc-900/45 p-3.5 transition-[border-color,background-color,transform,box-shadow] duration-300 ease-out">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-zinc-100">
              {statusIcon}
              <span className="font-medium">{statusTitle}</span>
            </div>
            <StatusPill tone={statusTone}>{label}</StatusPill>
          </div>
          <p className="mt-2 text-sm text-zinc-400">{statusBody}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <button
              onClick={onRunGateCheck}
              disabled={checking || executing}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Recheck
            </button>
            <button
              type="button"
              onClick={onToggleSafetyDetails}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100"
            >
              <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-300 ${showSafetyDetails ? "rotate-90" : ""}`} />
              {showSafetyDetails ? "Hide report" : "Gate report"}
            </button>
            {executionLink ? (
              <a
                href={executionLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100"
              >
                View on Voyager
              </a>
            ) : null}
          </div>
        </div>
        <button
          onClick={onPrimaryAction}
          disabled={primaryActionDisabled}
          className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-[background-color,transform,box-shadow,opacity] duration-300 ease-out disabled:cursor-not-allowed disabled:opacity-60 lg:min-w-[184px] ${
            overridePrimaryAction
              ? "bg-amber-400 text-zinc-950 hover:bg-amber-300 hover:shadow-[0_16px_40px_rgba(245,158,11,0.24)]"
              : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 hover:shadow-[0_16px_40px_rgba(16,185,129,0.25)]"
          }`}
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
    </div>
  );
}
