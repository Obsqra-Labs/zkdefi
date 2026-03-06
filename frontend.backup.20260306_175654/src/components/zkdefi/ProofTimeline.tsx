"use client";

import { useState } from "react";
import { Shield, FileCheck, Copy, ChevronDown } from "lucide-react";
import { ExplorerLink } from "@/components/zkdefi/ExplorerLink";
import { toastSuccess } from "@/lib/toast";

export interface ProofReceipt {
  receipt_id?: string;
  user?: string;
  proof_type: string;
  threshold_or_model: string;
  result: string;
  timestamp: string;
  snapshot_hash?: string | null;
  tx_hash?: string | null;
  fact_hash?: string | null;
  model_hash?: string | null;
  pool_id?: string | null;
  on_chain?: boolean;
}

function truncateHash(hash: string | null | undefined, head = 6, tail = 4): string {
  if (!hash || typeof hash !== "string") return "—";
  const clean = hash.startsWith("0x") ? hash.slice(2) : hash;
  if (clean.length <= head + tail) return hash;
  return `0x${clean.slice(0, head)}…${clean.slice(-tail)}`;
}

function formatProofType(type: string): string {
  const map: Record<string, string> = {
    risk_score: "Risk score",
    pool_safety: "Pool safety",
    rebalance: "Rebalance",
  };
  return map[type] ?? type;
}

const LAZY_RECEIPTS_CAP = 50;

interface ProofTimelineProps {
  receipts: ProofReceipt[];
  compact?: boolean;
  /** Optional title above the list */
  title?: string;
}

export function ProofTimeline({ receipts, compact = false, title }: ProofTimelineProps) {
  const [showAll, setShowAll] = useState(false);
  if (!receipts?.length) {
    return (
      <div className="text-sm text-zinc-500 py-2">
        No proof receipts yet.
      </div>
    );
  }
  const capped = receipts.length > LAZY_RECEIPTS_CAP && !showAll;
  const visible = capped ? receipts.slice(0, LAZY_RECEIPTS_CAP) : receipts;

  return (
    <div className="space-y-1">
      {title && (
        <div className="text-sm text-zinc-400 mb-2">{title}</div>
      )}
      <ul className={compact ? "space-y-1" : "space-y-2"}>
        {visible.map((r, i) => (
          <li
            key={r.receipt_id ?? i}
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${compact ? "text-xs" : "text-sm"} text-zinc-300`}
          >
            <span className="flex items-center gap-1.5">
              {r.proof_type === "rebalance" ? (
                <FileCheck className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
              ) : (
                <Shield className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              )}
              <span className="font-medium">{formatProofType(r.proof_type)}</span>
              <span className="text-zinc-500">·</span>
              <span className={r.result === "compliant" || r.result === "safe" || r.result === "completed" ? "text-emerald-400" : "text-amber-400"}>
                {r.result}
              </span>
            </span>
            {!compact && (
              <>
                {r.threshold_or_model && r.proof_type !== "rebalance" && (
                  <span className="text-zinc-500">threshold {r.threshold_or_model}</span>
                )}
                {r.model_hash && (
                  <span className="text-zinc-500 font-mono" title={r.model_hash}>
                    {truncateHash(r.model_hash, 6, 0)}
                  </span>
                )}
                {r.snapshot_hash && (
                  <span className="text-zinc-500 font-mono" title={r.snapshot_hash}>
                    snap {truncateHash(r.snapshot_hash)}
                  </span>
                )}
              </>
            )}
            <span className="text-zinc-500 ml-auto flex-shrink-0">
              {r.timestamp ? new Date(r.timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" }) : "—"}
            </span>
            {r.receipt_id && (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(r.receipt_id!).then(() => toastSuccess("Copied receipt ID"));
                }}
                className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50"
                title="Copy receipt ID"
              >
                <Copy className="w-3 h-3" />
              </button>
            )}
            {r.snapshot_hash && (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(r.snapshot_hash!).then(() => toastSuccess("Copied snapshot hash"));
                }}
                className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50"
                title="Copy snapshot hash"
              >
                <Copy className="w-3 h-3" />
              </button>
            )}
            {r.tx_hash && <ExplorerLink type="tx" txHash={r.tx_hash} />}
          </li>
        ))}
      </ul>
      {capped && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
        >
          <ChevronDown className="w-3 h-3" /> Show all ({receipts.length})
        </button>
      )}
    </div>
  );
}
