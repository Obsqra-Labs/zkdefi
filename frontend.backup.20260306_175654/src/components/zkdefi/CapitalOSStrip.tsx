"use client";

/**
 * Capital OS Strip — Identity | Gate | Ledger.
 * Replaces CapitalFlowStrip + AIZkmlBanner. No data fetching; parent supplies all data.
 */

import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
  /** When set, popover shows these lists; otherwise shows risk tolerance and policy count only. */
  allowedList?: string[];
  blockedList?: string[];
}

export interface CapitalOSStripLedger {
  lastEntryLabel: string;
  receiptCount: number;
}

export interface CapitalOSStripNextStep {
  copy: string;
  action?: "vault" | "oracle" | "brain";
  actionLabel?: string;
}

export interface CapitalOSStripAIInsight {
  message: string;
  reasoning?: string;
}

export interface CapitalOSStripProps {
  identity: CapitalOSStripIdentity;
  gate: CapitalOSStripGate;
  ledger: CapitalOSStripLedger;
  nextStep?: CapitalOSStripNextStep;
  aiInsight?: CapitalOSStripAIInsight;
  isDemo?: boolean;
  onIdentityClick?: () => void;
  onGateClick?: () => void;
  onLedgerClick?: () => void;
  onNextStepClick?: () => void;
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
  nextStep,
  aiInsight,
  isDemo,
  onIdentityClick,
  onGateClick,
  onLedgerClick,
  onNextStepClick,
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

  const handleNextStep = useCallback(() => {
    onNextStepClick?.();
  }, [onNextStepClick]);

  const displayAddress =
    identity.addressOrId.startsWith("0x")
      ? truncateAddress(identity.addressOrId)
      : identity.addressOrId;

  const hasRightHalf = nextStep || aiInsight;

  return (
    <div 
      className={`rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 ${hasRightHalf ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : ""}`}
      role="region"
      aria-label="Capital OS status"
    >
      {/* LEFT HALF: Identity | Gate | Ledger */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2 min-w-0 overflow-x-auto">
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
          aria-label={`Identity: ${displayAddress}, ${identity.tier} tier, ${identity.proofCount} proofs`}
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

      {/* RIGHT HALF: Next Step + AI Insight */}
      {hasRightHalf && (
        <div className="flex flex-col gap-2 min-w-0">
          <AnimatePresence mode="wait">
            {nextStep && (
              <motion.div
                key={nextStep.copy}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
                className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-zinc-800/40 border border-zinc-700/50"
              >
                <span className="text-xs text-zinc-300 truncate">{nextStep.copy}</span>
                {nextStep.action && nextStep.actionLabel && (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="px-2 py-1 text-xs font-medium rounded bg-blue-600/20 text-blue-400 border border-blue-600/30 hover:bg-blue-600/30 transition-colors shrink-0"
                  >
                    {nextStep.actionLabel}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {aiInsight && (
            <div className="px-3 py-1.5 rounded-md bg-blue-900/20 border border-blue-700/30">
              <div className="flex items-start gap-2">
                <span className="text-blue-400 shrink-0" aria-hidden>✨</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-blue-200">{aiInsight.message}</p>
                  {aiInsight.reasoning && (
                    <p className="text-xs text-blue-400/70 mt-0.5">{aiInsight.reasoning}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
