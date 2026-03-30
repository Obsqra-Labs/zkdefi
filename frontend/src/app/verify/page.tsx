"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Search, ShieldAlert, ShieldCheck } from "lucide-react";

import { apiFetch } from "@/lib/api/client";

type VerifyResult = {
  status: "VERIFIED" | "FAILED";
  verified: boolean;
  cid: string;
  fetched_url: string;
  receipt_id: string;
  checks: Record<string, boolean>;
  bundle: Record<string, unknown>;
};

export default function VerifyReceiptPage() {
  const [cid, setCid] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!cid.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload = await apiFetch<VerifyResult>("/api/v1/receipt_vault/verify", {
        method: "POST",
        timeoutMs: 45_000,
        body: JSON.stringify({ cid: cid.trim() }),
      });
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <section className="rounded-[28px] border border-zinc-800/80 bg-zinc-950/90 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">Receipt Vault</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-white">Verify a portable receipt</h1>
              <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                Paste a raw CID, `ipfs://` URI, or a Storacha gateway URL. zkde.fi will fetch the bundle, recompute the
                receipt hash, compare the on-chain CID anchor, and verify the Starknet receipt registry state.
              </p>
            </div>
            <Link
              href="/archive"
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600"
            >
              Back to archive
            </Link>
          </div>
        </section>

        <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">CID or gateway URL</span>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input
                  value={cid}
                  onChange={(event) => setCid(event.target.value)}
                  placeholder="bafy... or ipfs://... or https://...ipfs.storacha.link/receipt-bundle.json"
                  className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/50"
                />
                <button
                  type="submit"
                  disabled={loading || !cid.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-500/35 bg-cyan-500/10 px-5 py-3 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/15 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Verify
                </button>
              </div>
            </label>
          </form>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {result ? (
          <section className="space-y-4 rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Verification result</p>
                <h2 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                  {result.verified ? (
                    <ShieldCheck className="h-6 w-6 text-emerald-300" />
                  ) : (
                    <ShieldAlert className="h-6 w-6 text-red-300" />
                  )}
                  {result.status}
                </h2>
                <p className="mt-2 text-sm text-zinc-400">Receipt #{result.receipt_id || "unknown"} • {result.cid}</p>
              </div>
              <a
                href={result.fetched_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600"
              >
                Open fetched bundle
              </a>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Object.entries(result.checks).map(([key, ok]) => (
                <div key={key} className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{key.replace(/_/g, " ")}</p>
                  <p className={`mt-2 inline-flex items-center gap-1 text-sm font-semibold ${ok ? "text-emerald-300" : "text-red-300"}`}>
                    {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                    {ok ? "match" : "mismatch"}
                  </p>
                </div>
              ))}
            </div>

            <details className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-300">Bundle JSON</summary>
              <pre className="overflow-x-auto px-4 pb-4 font-mono text-[11px] text-zinc-400">
                {JSON.stringify(result.bundle, null, 2)}
              </pre>
            </details>
          </section>
        ) : null}
      </div>
    </main>
  );
}

