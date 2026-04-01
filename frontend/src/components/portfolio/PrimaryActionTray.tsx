"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ChevronRight, Copy, ExternalLink, Loader2, ShieldCheck, Wallet, Zap } from "lucide-react";
import type { WorkflowMode } from "./types";

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
  workflowMode: WorkflowMode;
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
  executionReceiptCid?: string | null;
  portableReceiptLink?: string | null;
  overridePrimaryAction: boolean;
  quoteSecondsLeft?: number | null;
};

export function PrimaryActionTray({
  checking,
  executing,
  workflowMode,
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
  executionReceiptCid,
  portableReceiptLink,
  overridePrimaryAction,
  quoteSecondsLeft,
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
    ? "Switch to Starknet mainnet."
    : proposalOutdated
      ? "Re-evaluating the latest draft."
      : overridePrimaryAction
        ? "Fee economics flagged — you can still proceed."
        : executionNote ??
          (label === "Onboarding needed"
            ? "Complete onboarding first."
            : label === "Session key needed"
              ? "Set up an agent session key."
              : label === "Permitted with fee warning"
                ? "High cost for the amount moved."
                : label === "Needs adjustment"
                  ? "Adjust target to clear the Gate."
                  : "Review once, then sign.");
  const trayRefreshing = checking || proposalOutdated;

  return (
    <div
      className={`mt-3.5 rounded-[20px] border border-zinc-800/80 bg-zinc-900/45 p-3.5 transition-[border-color,background-color,transform,box-shadow,opacity] duration-300 ease-out ${
        trayRefreshing ? "border-cyan-500/20 bg-cyan-500/[0.06]" : ""
      }`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 text-sm text-zinc-100">
              {statusIcon}
              <span className="font-medium">{statusTitle}</span>
            </div>
            <StatusPill tone={statusTone}>{label}</StatusPill>
          </div>
          <p className="mt-1.5 text-[13px] text-zinc-400">{statusBody}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <button
              onClick={onRunGateCheck}
              disabled={checking || executing}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck className="h-3 w-3" />
              Recheck
            </button>
            <button
              type="button"
              onClick={onToggleSafetyDetails}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100"
            >
              <ChevronRight className={`h-3 w-3 transition-transform duration-300 ${showSafetyDetails ? "rotate-90" : ""}`} />
              {showSafetyDetails ? "Hide" : "Report"}
            </button>
            {executionLink ? (
              <a
                href={executionLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100"
              >
                Voyager
              </a>
            ) : null}
            {executionReceiptCid ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
                <span className="font-mono text-[11px]" title={executionReceiptCid}>
                  ipfs://{executionReceiptCid.slice(0, 12)}…
                </span>
                <button
                  type="button"
                  title="Copy CID"
                  onClick={() => navigator.clipboard.writeText(executionReceiptCid)}
                  className="text-emerald-400 hover:text-emerald-200"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <a
                  href="/archive"
                  className="text-emerald-400 hover:text-emerald-200"
                  title="View in Archive"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </span>
            ) : null}
          </div>
        </div>
        <button
          onClick={onPrimaryAction}
          disabled={primaryActionDisabled}
          className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-[background-color,transform,box-shadow,opacity] duration-300 ease-out disabled:cursor-not-allowed disabled:opacity-60 lg:min-w-[184px] ${
            overridePrimaryAction
              ? "bg-amber-400 text-zinc-950 hover:bg-amber-300 hover:shadow-[0_16px_40px_rgba(245,158,11,0.24)]"
              : workflowMode === "automated"
                ? "bg-cyan-400 text-zinc-950 hover:bg-cyan-300 hover:shadow-[0_16px_40px_rgba(34,211,238,0.22)]"
                : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 hover:shadow-[0_16px_40px_rgba(16,185,129,0.25)]"
          } ${trayRefreshing ? "scale-[0.99]" : ""}`}
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
          {quoteSecondsLeft != null && !executing && (
            <span className="ml-1.5 tabular-nums text-xs opacity-80">
              ({quoteSecondsLeft}s)
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
