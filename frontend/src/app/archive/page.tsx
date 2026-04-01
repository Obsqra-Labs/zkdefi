"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "@starknet-react/core";
import Link from "next/link";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";

import { AppNavbar } from "@/components/zkdefi/AppNavbar";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { apiFetch } from "@/lib/api/client";
import { receiptVoyagerTxUrl } from "@/lib/explorer";

type ArchiveReceiptSummary = {
  registry_receipt_id: string;
  source: string;
  action_type: string;
  created_at: string;
  cid?: string | null;
  gateway_url?: string | null;
  ipfs_gateway_url?: string | null;
  ipfs_uri?: string | null;
  verification_status?: string | null;
  registry_contract_address?: string | null;
  archive_contract_address?: string | null;
  bundle_summary?: {
    action_type?: string;
    timestamp?: string;
    tier?: string;
    allowed?: boolean;
  };
};

type ArchiveReceiptDetail = ArchiveReceiptSummary & {
  bundle: Record<string, unknown>;
  registry_tx_hash?: string | null;
  archive_tx_hash?: string | null;
  verification?: {
    status: "VERIFIED" | "UPLOADED" | "FAILED";
    verified: boolean;
    anchor_tier?: "gold" | "bronze";
    checks: Record<string, boolean>;
  };
};

type TabFilter = "all" | "executions" | "platform";

function truncate(value: string, left = 10, right = 8) {
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function formatWhen(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function exportJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sourceLabel(source: string) {
  if (source === "portfolio_execute") return "Trade";
  if (source === "passport_claim") return "Passport";
  return source.replace(/_/g, " ");
}

function tierColor(tier: string) {
  if (tier === "trusted" || tier === "gold") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (tier === "verified") return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
  return "border-zinc-700 bg-zinc-900/80 text-zinc-300";
}

/* ------------------------------------------------------------------ */
/*  Receipt Detail Modal                                               */
/* ------------------------------------------------------------------ */
function ReceiptDetailModal({
  detail,
  detailLoading,
  onClose,
}: {
  detail: ArchiveReceiptDetail | null;
  detailLoading: boolean;
  onClose: () => void;
}) {
  if (!detail && !detailLoading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl rounded-[24px] border border-zinc-800/80 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-5 w-5" />
        </button>

        {detailLoading && !detail ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading receipt…
          </div>
        ) : detail ? (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Receipt detail</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">
                  {detail.bundle_summary?.action_type ?? detail.action_type}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">{formatWhen(detail.bundle_summary?.timestamp ?? detail.created_at)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${
                    detail.verification?.verified
                      ? detail.verification?.status === "UPLOADED"
                        ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-300"
                        : "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                      : "border-amber-500/35 bg-amber-500/10 text-amber-300"
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {detail.verification?.status ?? detail.verification_status ?? "Pending"}
                </span>
                {(detail.verification as Record<string, unknown>)?.anchor_tier === "bronze" && (
                  <span className="rounded-full border border-amber-600/30 bg-amber-600/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                    Bronze
                  </span>
                )}
                {(detail.verification as Record<string, unknown>)?.anchor_tier === "gold" && (
                  <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-300">
                    Gold
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => exportJson(`zkdefi-receipt-${detail.registry_receipt_id}.json`, detail.bundle)}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </button>
              </div>
            </div>

            {/* Info grid */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Receipt ID", value: `#${detail.registry_receipt_id}`, mono: true },
                { label: "Source", value: sourceLabel(detail.source) },
                { label: "CID", value: truncate(detail.cid ?? "", 12, 10), mono: true },
                { label: "Policy", value: detail.bundle_summary?.allowed ? "Allowed" : "Not allowed" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-zinc-800/70 bg-zinc-900/35 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{item.label}</p>
                  <p className={`mt-1 text-sm text-zinc-200 break-all ${item.mono ? "font-mono text-xs" : ""}`}>{item.value}</p>
                </div>
              ))}
            </div>

            {/* Bundle links + verification */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/35 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Portable bundle</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.gateway_url ? (
                    <a
                      href={detail.gateway_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20"
                    >
                      <FileText className="h-3 w-3" />
                      View bundle
                    </a>
                  ) : null}
                  {(detail as Record<string, unknown>).ipfs_gateway_url ? (
                    <a
                      href={String((detail as Record<string, unknown>).ipfs_gateway_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                    >
                      <Globe className="h-3 w-3" />
                      IPFS gateway
                    </a>
                  ) : null}
                </div>
                {detail.ipfs_uri ? <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">{detail.ipfs_uri}</p> : null}
                <div className="mt-3 grid gap-1.5 text-xs text-zinc-500">
                  <p>Registry tx: {detail.registry_tx_hash && detail.registry_tx_hash !== "0x0" ? (
                    <a href={receiptVoyagerTxUrl(detail.registry_tx_hash, detail.registry_contract_address)} target="_blank" rel="noreferrer" className="text-cyan-400 hover:text-cyan-300">
                      {truncate(detail.registry_tx_hash)}
                    </a>
                  ) : "N/A"}</p>
                  <p>Archive tx: {detail.archive_tx_hash && detail.archive_tx_hash !== "0x0" ? (
                    <a href={receiptVoyagerTxUrl(detail.archive_tx_hash, detail.archive_contract_address)} target="_blank" rel="noreferrer" className="text-cyan-400 hover:text-cyan-300">
                      {truncate(detail.archive_tx_hash)}
                    </a>
                  ) : "N/A"}</p>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/35 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Verification</p>
                <div className="mt-3 space-y-1.5">
                  {Object.entries(detail.verification?.checks ?? {}).map(([key, ok]) => (
                    <div key={key} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-zinc-400">{key.replace(/_/g, " ")}</span>
                      <span className={`inline-flex items-center gap-1 font-semibold ${ok ? "text-emerald-300" : "text-red-300"}`}>
                        {ok ? <CheckCircle2 className="h-3 w-3" /> : null}
                        {ok ? "ok" : "fail"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bundle JSON */}
            <details className="rounded-xl border border-zinc-800/70 bg-zinc-900/35">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-300">Bundle JSON</summary>
              <pre className="overflow-x-auto px-4 pb-4 font-mono text-[11px] text-zinc-400">
                {JSON.stringify(detail.bundle, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */
export default function ArchivePage() {
  const { address, status } = useAccount();
  const [requestedReceiptId, setRequestedReceiptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ArchiveReceiptSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArchiveReceiptDetail | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setRequestedReceiptId(params.get("receipt"));
  }, []);

  useEffect(() => {
    if (status !== "connected" || !address) {
      setReceipts([]);
      setSelectedId(null);
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<{ owner_address: string; receipts: ArchiveReceiptSummary[] }>(
      `/api/v1/receipt_vault/archive/${address}`,
      { timeoutMs: 30_000 },
    )
      .then((payload) => {
        if (cancelled) return;
        setReceipts(payload.receipts ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load portable receipts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, status]);

  useEffect(() => {
    if (!requestedReceiptId) return;
    setSelectedId(requestedReceiptId);
  }, [requestedReceiptId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    apiFetch<ArchiveReceiptDetail>(`/api/v1/receipt_vault/receipt/${selectedId}`, {
      timeoutMs: 45_000,
    })
      .then((payload) => {
        if (!cancelled) setDetail(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load receipt detail");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    if (tab === "executions") return receipts.filter((r) => r.source === "portfolio_execute");
    if (tab === "platform") return receipts.filter((r) => r.source !== "portfolio_execute");
    return receipts;
  }, [receipts, tab]);

  const executionCount = useMemo(() => receipts.filter((r) => r.source === "portfolio_execute").length, [receipts]);
  const platformCount = useMemo(() => receipts.filter((r) => r.source !== "portfolio_execute").length, [receipts]);

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
  }, []);

  const tabs: { key: TabFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: receipts.length },
    { key: "executions", label: "My Trades", count: executionCount },
    { key: "platform", label: "Platform", count: platformCount },
  ];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <AppNavbar />
      <div className="px-5 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        {/* Hero */}
        <section className="rounded-[28px] border border-zinc-800/80 bg-zinc-950/90 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">Receipt Vault</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-white">Portable trust receipts</h1>
              <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                Shared archive for portfolio execution and passport verification receipts. Every bundle is exported as
                canonical JSON, pinned to Storacha/IPFS, and tied back to Starknet with a CID anchor.
              </p>
            </div>
            <Link
              href="/verify"
              className="inline-flex items-center gap-2 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/15"
            >
              Verify a CID
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>

        {status !== "connected" || !address ? (
          <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Connect a wallet to view its archive</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  The Receipt Vault is wallet-scoped. Connect the wallet that owns the receipt history you want to inspect.
                </p>
              </div>
              <ConnectButton />
            </div>
          </section>
        ) : (
          <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-4">
            {/* Header row */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-3">
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Wallet archive</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{truncate(address, 10, 6)}</h2>
                </div>
                <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
                  {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* Tab bar */}
            <div className="mb-3 flex gap-1 rounded-xl border border-zinc-800/70 bg-zinc-900/35 p-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    tab === t.key
                      ? "bg-zinc-800 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {t.label}
                  <span className="ml-1.5 text-zinc-500">{t.count}</span>
                </button>
              ))}
            </div>

            {/* Receipt list */}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-14 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading archive…
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 px-4 py-6 text-center text-sm text-zinc-400">
                {receipts.length === 0
                  ? "No portable receipts have been archived for this wallet yet."
                  : "No receipts match this filter."}
              </div>
            ) : (
              <div className="max-h-[calc(100vh-280px)] space-y-1.5 overflow-y-auto pr-1">
                {filtered.map((item) => {
                  const tier = item.bundle_summary?.tier ?? "basic";
                  const isOnChain = !!item.registry_contract_address;
                  return (
                    <button
                      key={item.registry_receipt_id}
                      type="button"
                      onClick={() => setSelectedId(item.registry_receipt_id)}
                      className="group flex w-full items-center gap-3 rounded-xl border border-zinc-800/60 bg-zinc-900/25 px-4 py-2.5 text-left transition hover:border-zinc-700 hover:bg-zinc-900/50"
                    >
                      {/* Left: icon indicator */}
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs ${
                        item.source === "portfolio_execute"
                          ? "bg-cyan-500/10 text-cyan-300"
                          : "bg-violet-500/10 text-violet-300"
                      }`}>
                        {item.source === "portfolio_execute" ? "TX" : "PP"}
                      </div>

                      {/* Middle: info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">
                            {item.bundle_summary?.action_type ?? item.action_type}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] ${tierColor(tier)}`}>
                            {tier}
                          </span>
                          {isOnChain ? (
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-emerald-300">
                              on-chain
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {sourceLabel(item.source)} · {formatWhen(item.bundle_summary?.timestamp ?? item.created_at)}
                        </p>
                      </div>

                      {/* Right: verification status */}
                      <div className="shrink-0">
                        {item.verification_status === "anchored" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border border-zinc-700" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {error ? (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}
      </div>

      {/* Detail modal */}
      <ReceiptDetailModal detail={detail} detailLoading={detailLoading} onClose={closeDetail} />
      </div>
    </main>
  );
}
