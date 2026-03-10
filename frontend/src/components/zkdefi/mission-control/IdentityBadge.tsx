"use client";

import { useState } from "react";
import { Copy, Check, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useHealthPassport } from "@/hooks/useHealthPassport";
import { apiFetch } from "@/lib/api/client";
import { CreditGauge } from "../shared/CreditGauge";
import { useEffect } from "react";

const TIER_STYLE: Record<number, { label: string; cls: string }> = {
  1: { label: "T1", cls: "bg-emerald-900/50 text-emerald-400 border-emerald-700/50" },
  2: { label: "T2", cls: "bg-cyan-900/50 text-cyan-400 border-cyan-700/50" },
  3: { label: "T3", cls: "bg-zinc-800 text-zinc-400 border-zinc-700" },
};

interface IdentityBadgeProps {
  address: string;
  onSlideout: (mode: string) => void;
}

export function IdentityBadge({ address, onSlideout }: IdentityBadgeProps) {
  const health = useHealthPassport(address);
  const [copied, setCopied] = useState(false);
  const [creditScore, setCreditScore] = useState<number | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    apiFetch<{ credit_score?: number; composite_score?: number }>(
      `/api/v1/zkdefi/reputation/user/${address}`,
    )
      .then((d) => {
        if (!cancelled) setCreditScore(d?.credit_score ?? d?.composite_score ?? null);
      })
      .catch(() => {
        if (!cancelled) setCreditScore(null);
      });
    return () => { cancelled = true; };
  }, [address]);

  const handleCopy = () => {
    navigator.clipboard?.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const truncated = address ? `${address.slice(0, 6)}…${address.slice(-3)}` : "—";
  const tier = TIER_STYLE[health.tier] ?? TIER_STYLE[3]!;

  if (health.loading) {
    return (
      <div className="w-[240px] flex-shrink-0 p-4 space-y-3 animate-pulse">
        <div className="h-5 w-28 bg-zinc-800 rounded" />
        <div className="h-6 w-16 bg-zinc-800 rounded" />
        <div className="h-4 w-24 bg-zinc-800 rounded" />
        <div className="h-4 w-20 bg-zinc-800 rounded" />
        <div className="h-16 w-16 bg-zinc-800 rounded-full mx-auto" />
        <div className="h-px bg-zinc-800" />
        <div className="flex gap-2">
          <div className="h-8 flex-1 bg-zinc-800 rounded" />
          <div className="h-8 flex-1 bg-zinc-800 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-[240px] flex-shrink-0 p-4 flex flex-col gap-3 overflow-y-auto">
      {/* Address */}
      <div className="flex items-center gap-2">
        <code className="text-sm text-zinc-200 font-mono">{truncated}</code>
        <button onClick={handleCopy} className="p-1 rounded hover:bg-zinc-800 transition-colors" title="Copy address">
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-500" />}
        </button>
      </div>

      {/* Tier */}
      <span className={`inline-flex self-start px-2 py-0.5 rounded border text-[11px] font-semibold ${tier.cls}`}>
        {tier.label} — {health.tier_name}
      </span>

      {/* Trust Score */}
      <div className="flex justify-between text-xs">
        <span className="text-zinc-500">Trust Score</span>
        <span className="text-zinc-200 font-medium">{health.trust_score}%</span>
      </div>

      {/* Proof Count */}
      <div className="flex justify-between text-xs">
        <span className="text-zinc-500">Proofs</span>
        <span className="text-zinc-200 font-medium">{health.proof_count}</span>
      </div>

      {/* Credit Gauge */}
      <div className="flex justify-center">
        {creditScore != null ? (
          <CreditGauge score={creditScore} size="sm" />
        ) : (
          <span className="text-zinc-600 text-xs">—</span>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-zinc-800" />

      {/* Quick Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onSlideout("deposit")}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/20 text-xs font-medium transition-colors"
        >
          <ArrowDownToLine className="w-3.5 h-3.5" /> Fund
        </button>
        <button
          onClick={() => onSlideout("withdraw")}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs font-medium transition-colors"
        >
          <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdraw
        </button>
      </div>
    </div>
  );
}
