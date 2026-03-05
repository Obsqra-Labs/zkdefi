"use client";

/**
 * Capital OS Strip — Identity | Gate | Ledger.
 * Replaces CapitalFlowStrip + AIZkmlBanner. No data fetching; parent supplies all data.
 */

import { useCallback } from "react";

export interface CapitalOSStripIdentity {
  addressOrId: string;
  tier: string;
  proofCount: number;
}

export interface CapitalOSStripGate {
  riskTolerance: string;
  allowedCount: number;
  totalCount: number;
  status: "ok" | "warn" | "blocked";
}

export interface CapitalOSStripLedger {
  lastEntryLabel: string;
  receiptCount: number;
}

export interface CapitalOSStripProps {
  identity: CapitalOSStripIdentity;
  gate: CapitalOSStripGate;
  ledger: CapitalOSStripLedger;
  isDemo?: boolean;
  onIdentityClick?: () => void;
  onGateClick?: () => void;
  onLedgerClick?: () => void;
}

function gateStatusColor(status: CapitalOSStripGate["status"]): string {
  if (status === "ok") return "bg-emerald-500";
  if (status === "warn") return "bg-amber-500";
  return "bg-red-500";
}

function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head + 2)}…${addr.slice(-tail)}`;
}

export function CapitalOSStrip({
  identity,
  gate,
  ledger,
  isDemo,
  onIdentityClick,
  onGateClick,
  onLedgerClick,
}: CapitalOSStripProps) {
  const handleIdentity = useCallback(() => {
    onIdentityClick?.();
  }, [onIdentityClick]);

  const handleGate = useCallback(() => {
    onGateClick?.();
  }, [onGateClick]);

  const handleLedger = useCallback(() => {
    onLedgerClick?.();
  }, [onLedgerClick]);

  const displayAddress =
    identity.addressOrId.startsWith("0x")
      ? truncateAddress(identity.addressOrId)
      : identity.addressOrId;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 flex flex-wrap items-center gap-2">
      {isDemo && (
        <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-600/20 text-amber-400 border border-amber-600/30">
          Demo
        </span>
      )}
      {/* Identity */}
      <button
        type="button"
        onClick={handleIdentity}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-left hover:bg-zinc-800/60 transition-colors min-w-0"
      >
        <span className="text-xs font-medium text-zinc-300 truncate" title={identity.addressOrId}>
          {displayAddress}
        </span>
        <span className="text-xs text-emerald-400/90 shrink-0">{identity.tier}</span>
        <span className="text-xs text-zinc-500 shrink-0">{identity.proofCount} proofs</span>
      </button>
      <span className="text-zinc-600" aria-hidden>|</span>
      {/* Gate */}
      <button
        type="button"
        onClick={handleGate}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-zinc-800/60 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${gateStatusColor(gate.status)}`} aria-hidden />
        <span className="text-xs text-zinc-300">{gate.riskTolerance}</span>
        <span className="text-xs text-zinc-500">
          {gate.allowedCount}/{gate.totalCount} strategies
        </span>
      </button>
      <span className="text-zinc-600" aria-hidden>|</span>
      {/* Ledger */}
      <button
        type="button"
        onClick={handleLedger}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-zinc-800/60 transition-colors min-w-0 text-left"
      >
        <span className="text-xs text-zinc-400 truncate" title={ledger.lastEntryLabel}>
          {ledger.lastEntryLabel}
        </span>
        <span className="text-xs text-zinc-500 shrink-0">{ledger.receiptCount} receipts</span>
      </button>
    </div>
  );
}
