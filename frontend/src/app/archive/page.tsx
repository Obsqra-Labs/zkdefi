"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "@starknet-react/core";
import Link from "next/link";
import { CheckCircle2, Download, ExternalLink, Loader2, ShieldCheck } from "lucide-react";

import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { apiFetch } from "@/lib/api/client";

type ArchiveReceiptSummary = {
  registry_receipt_id: string;
  source: string;
  action_type: string;
  created_at: string;
  cid?: string | null;
  gateway_url?: string | null;
  ipfs_uri?: string | null;
  verification_status?: string | null;
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
    status: "VERIFIED" | "FAILED";
    verified: boolean;
    checks: Record<string, boolean>;
  };
};

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

export default function ArchivePage() {
  const { address, status } = useAccount();
  const [requestedReceiptId, setRequestedReceiptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ArchiveReceiptSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArchiveReceiptDetail | null>(null);

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
        setSelectedId((current) => current ?? payload.receipts?.[0]?.registry_receipt_id ?? null);
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

  const selectedSummary = useMemo(
    () => receipts.find((item) => item.registry_receipt_id === selectedId) ?? null,
    [receipts, selectedId],
  );

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
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
          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-4">
              <div className="flex items-center justify-between gap-3 px-2 pb-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Wallet archive</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{truncate(address, 10, 6)}</h2>
                </div>
                <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
                  {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
                </span>
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-14 text-sm text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading archive…
                </div>
              ) : receipts.length === 0 ? (
                <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 px-4 py-6 text-sm text-zinc-400">
                  No portable receipts have been archived for this wallet yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {receipts.map((item) => {
                    const active = item.registry_receipt_id === selectedId;
                    return (
                      <button
                        key={item.registry_receipt_id}
                        type="button"
                        onClick={() => setSelectedId(item.registry_receipt_id)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                          active
                            ? "border-cyan-500/45 bg-cyan-500/10"
                            : "border-zinc-800/70 bg-zinc-900/35 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                              {item.source.replace(/_/g, " ")}
                            </p>
                            <h3 className="mt-1 text-sm font-semibold text-white">
                              {item.bundle_summary?.action_type ?? item.action_type}
                            </h3>
                          </div>
                          <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300">
                            {item.bundle_summary?.tier ?? "basic"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-zinc-400">{formatWhen(item.bundle_summary?.timestamp ?? item.created_at)}</p>
                        <p className="mt-1 font-mono text-[11px] text-zinc-500">
                          Receipt #{item.registry_receipt_id}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-5">
              {detailLoading && !detail ? (
                <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading receipt…
                </div>
              ) : detail ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Receipt detail</p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">
                        {detail.bundle_summary?.action_type ?? detail.action_type}
                      </h2>
                      <p className="mt-2 text-sm text-zinc-400">{formatWhen(detail.bundle_summary?.timestamp ?? detail.created_at)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${
                          detail.verification?.verified
                            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                            : "border-amber-500/35 bg-amber-500/10 text-amber-300"
                        }`}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {detail.verification?.status ?? detail.verification_status ?? "Pending"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          exportJson(`zkdefi-receipt-${detail.registry_receipt_id}.json`, detail.bundle)
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export JSON
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 p-4">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Receipt ID</p>
                      <p className="mt-2 font-mono text-sm text-zinc-200">#{detail.registry_receipt_id}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 p-4">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Source</p>
                      <p className="mt-2 text-sm text-zinc-200">{detail.source.replace(/_/g, " ")}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 p-4">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">CID</p>
                      <p className="mt-2 font-mono text-xs text-zinc-200">{truncate(detail.cid ?? "", 12, 10)}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 p-4">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Policy</p>
                      <p className="mt-2 text-sm text-zinc-200">
                        {detail.bundle_summary?.allowed ? "Allowed" : "Not allowed"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 p-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Portable bundle</p>
                      <div className="mt-3 space-y-2 text-sm text-zinc-300">
                        <a
                          href={detail.gateway_url ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-cyan-300 hover:text-cyan-200"
                        >
                          Open via Storacha gateway
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        {detail.ipfs_uri ? <p className="font-mono text-xs text-zinc-500">{detail.ipfs_uri}</p> : null}
                        <div className="grid gap-2 pt-2 text-xs text-zinc-400">
                          <p>Registry tx: {detail.registry_tx_hash ? truncate(detail.registry_tx_hash) : "Unavailable"}</p>
                          <p>Archive tx: {detail.archive_tx_hash ? truncate(detail.archive_tx_hash) : "Unavailable"}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 p-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Verification checks</p>
                      <div className="mt-3 space-y-2">
                        {Object.entries(detail.verification?.checks ?? {}).map(([key, ok]) => (
                          <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/60 px-3 py-2">
                            <span className="text-xs text-zinc-400">{key.replace(/_/g, " ")}</span>
                            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${ok ? "text-emerald-300" : "text-red-300"}`}>
                              {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                              {ok ? "match" : "mismatch"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <details className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-300">
                      Bundle JSON
                    </summary>
                    <pre className="overflow-x-auto px-4 pb-4 font-mono text-[11px] text-zinc-400">
                      {JSON.stringify(detail.bundle, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-800/80 px-5 py-16 text-center text-sm text-zinc-500">
                  {selectedSummary ? "Loading receipt detail…" : "Choose a receipt from the archive to inspect the portable bundle."}
                </div>
              )}
            </section>
          </div>
        )}

        {error ? (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}
      </div>
    </main>
  );
}
