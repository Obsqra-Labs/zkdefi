"use client";

import { useMemo, useState, useEffect } from "react";
import { Clock, RefreshCw, Sparkles, Shield } from "lucide-react";

export interface NextRebalanceStripProps {
  pendingProposal: boolean;
  cooldownRemaining: number;
  vaultState: string;
  reason?: string;
  /** Whether the rebalance decision was AI-powered (Onyx LLM). Defaults true. */
  aiPowered?: boolean;
  /** Whether the execution is ZK-proof-gated. Defaults true. */
  proofGated?: boolean;
}

function formatCooldown(seconds: number): string {
  if (seconds <= 0) return "Now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export function NextRebalanceStrip({
  pendingProposal,
  cooldownRemaining,
  vaultState,
  reason,
  aiPowered = true,
  proofGated = true,
}: NextRebalanceStripProps) {
  const { status, statusBadgeClass, reasonText, earliest } = useMemo(() => {
    const isReady = cooldownRemaining <= 0 && !pendingProposal;
    const isPending = pendingProposal;
    const isCooldown = cooldownRemaining > 0 && !pendingProposal;

    let status: string;
    let statusBadgeClass: string;
    let reasonText: string;
    let earliest: string;

    if (isPending) {
      status = "Pending (MEV protected)";
      statusBadgeClass = "bg-blue-500/20 text-blue-400 border-blue-500/30";
      reasonText = reason ?? "APY +1.2% / Risk improvement";
      earliest = "Now";
    } else if (isCooldown) {
      const remaining = formatCooldown(cooldownRemaining);
      status = `Cooldown (${remaining} remaining)`;
      statusBadgeClass = "bg-amber-500/20 text-amber-400 border-amber-500/30";
      reasonText = reason ?? "Waiting for cooldown";
      earliest = remaining;
    } else {
      status = "Ready";
      statusBadgeClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      reasonText = reason ?? "No rebalance needed";
      earliest = "Now";
    }

    return { status, statusBadgeClass, reasonText, earliest };
  }, [pendingProposal, cooldownRemaining, vaultState, reason]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`bg-zinc-900/30 border border-zinc-800/50 rounded-lg p-3 transition-all duration-300 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}
      role="status"
      aria-label={`Next rebalance: ${status}. Reason: ${reasonText}. Earliest: ${earliest}`}
    >
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-4">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" />
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${statusBadgeClass}`}
            aria-label={`Status: ${status}`}
          >
            {status}
          </span>
        </div>

        {/* Reason */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs text-white/40 shrink-0">Reason:</span>
          <span className="text-xs text-white/70 break-words sm:truncate">{reasonText}</span>
        </div>

        {/* Earliest */}
        <div className="flex items-center gap-2 shrink-0">
          <Clock className="w-4 h-4 text-white/40" aria-hidden="true" />
          <span className="text-xs text-white/50">Earliest:</span>
          <span className="text-xs font-medium text-white/80">{earliest}</span>
        </div>

        {/* AI / ZK attribution */}
        <div className="flex items-center gap-1.5 shrink-0 sm:border-l sm:border-zinc-700 sm:pl-3 sm:ml-1">
          {aiPowered && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-violet-500/10 text-violet-400 border border-violet-600/30"
              aria-label="Powered by Onyx AI"
            >
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              Onyx AI
            </span>
          )}
          {proofGated && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-600/30"
              aria-label="ZK proof gated execution"
            >
              <Shield className="w-3 h-3" aria-hidden="true" />
              ZK-Gated
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
