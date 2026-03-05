"use client";

import { useState, useEffect } from "react";
import { Gift, Clock, ArrowRight, Loader2, AlertTriangle } from "lucide-react";
import { getYieldSnapshot, YieldPositionItem, fetchNarration } from "@/lib/api/strategies";

/* ────────────────────────────────────────────────────────────────────── */
/* Types                                                                 */
/* ────────────────────────────────────────────────────────────────────── */

interface PendingClaimsCardProps {
  ownerAddress: string;
  sessionActive: boolean;
  onClaim?: (positionId: string) => void;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Component                                                              */
/* ────────────────────────────────────────────────────────────────────── */

export function PendingClaimsCard({ ownerAddress, sessionActive, onClaim }: PendingClaimsCardProps) {
  const [claimable, setClaimable] = useState<YieldPositionItem[]>([]);
  const [totalUsd, setTotalUsd] = useState(0);
  const [narration, setNarration] = useState("");
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerAddress) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const snap = await getYieldSnapshot(ownerAddress);
        // Positions with status != "harvested" and fees > 0
        const pending = snap.positions.filter(
          (p) => p.status !== "harvested" && p.total_fees_usd > 0,
        );
        if (!cancelled) {
          setClaimable(pending);
          const total = pending.reduce((s, p) => s + p.total_fees_usd, 0);
          setTotalUsd(total);

          if (pending.length > 0) {
            // Get narration for pending claims
            try {
              const resp = await fetchNarration("pending_claims", {
                claim_count: pending.length,
                claim_amount: total.toFixed(2),
                oldest_days: (() => {
                  const withTs = pending.filter((p) => p.created_at);
                  if (withTs.length === 0) return undefined; // omit if no timestamp data
                  const oldest = Math.min(...withTs.map((p) => new Date(p.created_at!).getTime()));
                  return Math.max(1, Math.ceil((Date.now() - oldest) / 86_400_000));
                })(),
              });
              if (!cancelled) setNarration(resp.narration);
            } catch {
              if (!cancelled) setNarration(`${pending.length} position(s) with unclaimed yield ready to harvest.`);
            }
          }
        }
      } catch {
        if (!cancelled) {
          setClaimable([]);
          setTotalUsd(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [ownerAddress]);

  const handleClaim = async (positionId: string) => {
    if (!sessionActive || !onClaim) return;
    setClaiming(positionId);
    try {
      await onClaim(positionId);
    } finally {
      setClaiming(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading claims…
        </div>
      </div>
    );
  }

  if (claimable.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
        <div className="flex items-center gap-2 text-zinc-500 text-xs">
          <Gift className="h-4 w-4" />
          No pending claims
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-800/40 bg-zinc-900/80 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium text-white">Pending Claims</span>
        </div>
        <span className="text-sm font-semibold text-emerald-400">
          ${totalUsd.toFixed(2)}
        </span>
      </div>

      {/* LLM narration */}
      {narration && (
        <p className="text-xs text-zinc-400 italic mb-3">{narration}</p>
      )}

      {/* Claims list */}
      <div className="space-y-2 mb-3">
        {claimable.slice(0, 4).map((pos) => (
          <div
            key={pos.position_id}
            className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2"
          >
            <div className="flex flex-col">
              <span className="text-xs font-medium text-zinc-300">{pos.pair}</span>
              <span className="text-[10px] text-zinc-500">
                ${pos.total_fees_usd.toFixed(2)} • {pos.status}
              </span>
            </div>
            {onClaim && (
              <button
                onClick={() => handleClaim(pos.position_id)}
                disabled={!sessionActive || claiming === pos.position_id}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                  sessionActive
                    ? "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                    : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                }`}
              >
                {claiming === pos.position_id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    Claim <ArrowRight className="h-3 w-3" />
                  </>
                )}
              </button>
            )}
          </div>
        ))}
        {claimable.length > 4 && (
          <p className="text-[10px] text-zinc-500 text-center">
            + {claimable.length - 4} more position(s)
          </p>
        )}
      </div>

      {/* Session key warning */}
      {!sessionActive && (
        <div className="flex items-center gap-1.5 text-[10px] text-yellow-500/80">
          <AlertTriangle className="h-3 w-3" />
          Grant a session key to enable one-click claims
        </div>
      )}
    </div>
  );
}
