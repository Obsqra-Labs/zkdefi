"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

/* ── Types ────────────────────────────────────────────────────────── */

interface ReceiptDetail {
  receipt: Record<string, unknown>;
  level: number;
  source: string;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function statusBadge(status: string) {
  if (status === "pass" || status === "complete" || status === "success")
    return { icon: CheckCircle2, color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", label: status };
  if (status === "failed" || status === "error")
    return { icon: XCircle, color: "text-red-400 border-red-500/30 bg-red-500/10", label: status };
  return { icon: Clock, color: "text-amber-400 border-amber-500/30 bg-amber-500/10", label: status || "pending" };
}

function isHash(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{10,}$/.test(v);
}

function truncateHash(h: string) {
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}

/* ── Copy button ──────────────────────────────────────────────────── */

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-1 opacity-40 transition-opacity hover:opacity-100"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/* ── Hash row ─────────────────────────────────────────────────────── */

function HashRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  const isTxHash = label.toLowerCase().includes("tx") || label.toLowerCase().includes("execution");
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-300">
        {truncateHash(value)}
        <CopyBtn text={value} />
        {isTxHash && isHash(value) && (
          <a
            href={`https://sepolia.voyager.online/tx/${value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-500 hover:text-cyan-400"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </span>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

export default function ReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const receiptId = params.id;

  const [data, setData] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!receiptId) return;
    setLoading(true);
    apiFetch<ReceiptDetail>(
      `/api/v1/zkdefi/mc/receipts/${receiptId}`,
      { timeoutMs: 10_000 },
    )
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load receipt"))
      .finally(() => setLoading(false));
  }, [receiptId]);

  const receipt = data?.receipt ?? {};

  // Extract known fields
  const type = String(receipt.action_type ?? receipt.event_type ?? receipt.type ?? "unknown");
  const timestamp = String(receipt.timestamp ?? receipt.created_at ?? "");
  const gateStatus = String(receipt.result ?? receipt.outcome ?? receipt.gate_status ?? "pending");
  const onChain = Boolean(receipt.on_chain);
  const badge = statusBadge(gateStatus);
  const BadgeIcon = badge.icon;

  // Gather all hash-like fields
  const hashFields: { label: string; value: string }[] = [];
  const hashKeys = [
    ["receipt_id", "Receipt ID"],
    ["policy_hash", "Policy Hash"],
    ["proof_hash", "Proof Hash"],
    ["tx_hash", "Transaction"],
    ["l2_tx_hash", "L2 Transaction"],
    ["l3_tx_hash", "L3 Transaction"],
    ["constraints_hash", "Constraints"],
    ["commitment_hash", "Commitment"],
    ["nullifier", "Nullifier"],
  ];
  for (const [key, label] of hashKeys) {
    const raw = receipt[key] ?? (receipt.metadata as Record<string, unknown> | undefined)?.[key] ?? "";
    const val = String(raw);
    if (val && val !== "0" && val !== "undefined") hashFields.push({ label, value: val });
  }

  // Gather all non-hash scalar fields for the "Details" section
  const skipKeys = new Set([
    ...hashKeys.map(([k]) => k),
    "metadata", "hashes", "result", "outcome", "gate_status", "on_chain",
    "action_type", "event_type", "type", "timestamp", "created_at",
  ]);
  const detailFields: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(receipt)) {
    if (skipKeys.has(k) || v == null || typeof v === "object") continue;
    detailFields.push({ label: k.replace(/_/g, " "), value: String(v) });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Back link */}
      <Link
        href="/passport"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Passport
      </Link>

      {/* Header */}
      <div className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
          Receipt Detail
        </p>
        <h1 className="mt-1 font-serif text-xl font-bold text-zinc-100">
          Receipt #{receiptId}
        </h1>
      </div>

      {/* Loading */}
      {loading && (
        <div className="mt-12 flex justify-center text-sm text-zinc-500">
          Loading receipt…
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Receipt content */}
      {data && !loading && (
        <div className="mt-6 space-y-4">
          {/* Status card */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.color}`}>
                  <BadgeIcon className="h-3 w-3" />
                  {badge.label}
                </span>
                {onChain && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                    on-chain
                  </span>
                )}
              </div>
              <span className="text-[10px] text-zinc-600">
                source: {data.source}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-zinc-400">
              <span>
                Type: <span className="font-semibold text-zinc-200">{type}</span>
              </span>
              {timestamp && (
                <span>
                  Time: <span className="font-mono text-zinc-300">{timestamp}</span>
                </span>
              )}
            </div>
          </div>

          {/* Hashes */}
          {hashFields.length > 0 && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-5 py-4">
              <h2 className="text-xs font-semibold text-zinc-300">Cryptographic Hashes</h2>
              <div className="mt-2 divide-y divide-zinc-800/40">
                {hashFields.map((h) => (
                  <HashRow key={h.label} label={h.label} value={h.value} />
                ))}
              </div>
            </div>
          )}

          {/* Details */}
          {detailFields.length > 0 && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-5 py-4">
              <h2 className="text-xs font-semibold text-zinc-300">Details</h2>
              <div className="mt-2 divide-y divide-zinc-800/40">
                {detailFields.map((d) => (
                  <div key={d.label} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-[10px] text-zinc-500">{d.label}</span>
                    <span className="text-right font-mono text-[10px] text-zinc-300">
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw JSON toggle */}
          <details className="group rounded-xl border border-zinc-800/60 bg-zinc-900/40">
            <summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-300">
              Raw Receipt JSON
            </summary>
            <pre className="overflow-x-auto px-5 pb-4 font-mono text-[10px] text-zinc-500">
              {JSON.stringify(receipt, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
