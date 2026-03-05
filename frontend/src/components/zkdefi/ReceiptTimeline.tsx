"use client";

import { Shield, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import type { AggregatedReceipt } from "@/hooks/useReceiptAggregator";
import { ExplorerLink } from "@/components/zkdefi/ExplorerLink";

// ---------------------------------------------------------------------------
// Receipt status badge
// ---------------------------------------------------------------------------

function ReceiptStatusBadge({ status }: { status: AggregatedReceipt["status"] }) {
  const map = {
    confirmed:  { icon: CheckCircle,   color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Confirmed" },
    pending:    { icon: Clock,          color: "text-amber-400",   bg: "bg-amber-500/10",   label: "Pending" },
    "on-chain": { icon: Shield,         color: "text-blue-400",    bg: "bg-blue-500/10",     label: "On-chain" },
    diverged:   { icon: AlertTriangle,  color: "text-rose-400",    bg: "bg-rose-500/10",     label: "Diverged" },
  } as const;
  const cfg = map[status] ?? map.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${cfg.color} ${cfg.bg}`}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ReceiptTimeline component
// ---------------------------------------------------------------------------

interface ReceiptTimelineProps {
  receipts: AggregatedReceipt[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function ReceiptTimeline({ receipts, loading, error, onRefresh }: ReceiptTimelineProps) {
  const capitalSourceLabel = (raw: unknown): string | null => {
    const value = String(raw || "").trim().toLowerCase();
    if (!value) return null;
    if (value === "wallet_mode") return "Wallet mode";
    if (value === "private_capital") return "Private capital";
    return value.replace(/_/g, " ");
  };

  return (
    <div className="glass rounded-xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          Proof &amp; Receipt Timeline
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          className="px-2 py-1 text-xs rounded-lg border border-zinc-600 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        Reconciled view: backend + on-chain receipts. Each entry shows proof type, action, and confirmation status.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-4 text-amber-500 text-sm">{error}</div>
      ) : receipts.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 text-sm">
          No receipts yet. Deposit, withdraw, or run an allocation to generate proof receipts.
        </div>
      ) : (
        <ul className="space-y-2 max-h-[400px] overflow-y-auto">
          {receipts.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 rounded-lg bg-zinc-800/40 border border-zinc-700/50 text-sm"
            >
              <span className="text-zinc-500 shrink-0 w-20 text-xs">
                {r.timestamp
                  ? new Date(r.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                  : "—"}
              </span>
              <span className="font-medium text-zinc-200 capitalize shrink-0">{r.action}</span>
              <span className="text-xs text-zinc-500">{r.proof_type}</span>
              {typeof r.meta?.asset === "string" && r.meta.asset.trim() && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-700/40 text-zinc-300">
                  {r.meta.asset}
                </span>
              )}
              {capitalSourceLabel(r.meta?.capital_source) && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300">
                  {capitalSourceLabel(r.meta?.capital_source)}
                </span>
              )}
              <ReceiptStatusBadge status={r.status} />
              {r.onChainHash && (
                <ExplorerLink
                  type="tx"
                  txHash={r.onChainHash}
                  chainId={r.chainId ?? undefined}
                  className="text-zinc-300 font-mono text-xs truncate max-w-[180px]"
                >
                  {r.onChainHash.slice(0, 8)}…{r.onChainHash.slice(-4)}
                </ExplorerLink>
              )}
              {r.factHash && (
                <span className="text-zinc-600 font-mono text-xs truncate max-w-[140px]" title={r.factHash}>
                  fact:{r.factHash.slice(0, 8)}…{r.factHash.slice(-4)}
                </span>
              )}
              {r.result && (
                <span className="text-xs text-zinc-500 ml-auto">{r.result}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
