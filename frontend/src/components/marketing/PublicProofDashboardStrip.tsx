"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/api/client";
import type { PublicProofDashboardEntry, PublicProofDashboardPayload } from "@/lib/types/publicProofDashboard";
import { isPublicProofDashboardPayload } from "@/lib/types/publicProofDashboard";

function shortHash(h: string): string {
  const t = h.trim();
  if (t.length <= 14) return t;
  return `${t.slice(0, 8)}…${t.slice(-6)}`;
}

function entryLink(e: PublicProofDashboardEntry): string | undefined {
  const v = typeof e.voyager_url === "string" ? e.voyager_url.trim() : "";
  const s = typeof e.starkscan_url === "string" ? e.starkscan_url.trim() : "";
  return v || s || undefined;
}

export function PublicProofDashboardStrip() {
  const [data, setData] = useState<PublicProofDashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch(apiUrl("/api/v1/zkdefi/public-proof-dashboard"), {
          cache: "no-store",
          signal: controller.signal,
        });
        const json: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError("Could not load the public proof dashboard right now.");
          setData(null);
          return;
        }
        if (!isPublicProofDashboardPayload(json)) {
          setError("Unexpected response from the proof dashboard.");
          setData(null);
          return;
        }
        setData(json);
        setError(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError("Could not reach the API to load live receipts.");
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 py-12 text-sm text-zinc-500"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" aria-hidden="true" />
        Loading latest public receipts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-5 py-4 text-sm text-amber-200/90">
        <p>{error}</p>
        <p className="mt-2 text-xs text-zinc-500">
          This page still lists contract addresses below. When the backend has a fresh showcase report, mirror transactions
          show up here automatically.
        </p>
      </div>
    );
  }

  const entries = Array.isArray(data?.entries) ? data!.entries! : [];
  const empty =
    data?.status === "empty" ||
    entries.length === 0 ||
    (data?.summary?.public_entries_total === 0 && entries.length === 0);

  if (empty) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-5 py-6 text-sm text-zinc-400">
        <p className="text-zinc-300">
          No public mirror receipts are published for this deployment yet.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          That usually means the lab report has not been regenerated on this server, or no lane currently has a
          Starknet-sepolia mirror tx we can show without leaking internal-only data. The contract list below is still
          valid for independent checks.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/docs/"
            className="text-xs font-medium text-blue-400 underline decoration-blue-400/30 underline-offset-2 hover:decoration-blue-400"
          >
            Read the docs
          </Link>
          <a
            href="https://github.com/Obsqra-Labs/zkdefi"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-300"
          >
            Source on GitHub
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </div>
    );
  }

  const show = entries.slice(0, 3);

  return (
    <div className="space-y-4">
      {show.map((e, i) => {
        const href = entryLink(e);
        const tx = typeof e.tx_hash === "string" ? e.tx_hash : "";
        const title = typeof e.title === "string" && e.title.trim() ? e.title : e.lane || "Receipt";
        return (
          <div
            key={`${e.tx_hash ?? i}-${e.lane ?? i}`}
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
                {e.lane ? (
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{e.lane}</p>
                ) : null}
              </div>
              {e.verified_on_chain ? (
                <span className="shrink-0 rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-emerald-400">
                  Verified on-chain
                </span>
              ) : null}
            </div>
            <dl className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
              {tx ? (
                <div>
                  <dt className="text-zinc-600">Transaction</dt>
                  <dd className="mt-0.5 font-mono text-zinc-400">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-400 underline decoration-blue-400/30 underline-offset-2 hover:decoration-blue-400"
                      >
                        {shortHash(tx)}
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="sr-only">(opens in new tab)</span>
                      </a>
                    ) : (
                      shortHash(tx)
                    )}
                  </dd>
                </div>
              ) : null}
              {e.mode ? (
                <div>
                  <dt className="text-zinc-600">Mode</dt>
                  <dd className="mt-0.5 text-zinc-400">{String(e.mode)}</dd>
                </div>
              ) : null}
              {e.model ? (
                <div>
                  <dt className="text-zinc-600">Model / route</dt>
                  <dd className="mt-0.5 text-zinc-400">{String(e.model)}</dd>
                </div>
              ) : null}
              {e.verification_backend ? (
                <div>
                  <dt className="text-zinc-600">Verification</dt>
                  <dd className="mt-0.5 text-zinc-400">{String(e.verification_backend)}</dd>
                </div>
              ) : null}
            </dl>
            {typeof e.note === "string" && e.note.trim() ? (
              <p className="mt-3 border-t border-zinc-800/80 pt-3 text-xs leading-relaxed text-zinc-600">{e.note}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
