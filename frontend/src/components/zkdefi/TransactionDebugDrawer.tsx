"use client";

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { ActivityEvent } from "@/lib/AppContext";
import { sepoliaVoyagerContractUrl, sepoliaTxExplorerLinks } from "@/lib/explorer";
import { buildTxDebugInfo } from "@/lib/txDebug";

interface TransactionDebugDrawerProps {
  event: ActivityEvent;
}

export function TransactionDebugDrawer({ event }: TransactionDebugDrawerProps) {
  const debug = useMemo(() => buildTxDebugInfo(event.details), [event.details]);
  const txLinks = useMemo(
    () => (event.txHash ? sepoliaTxExplorerLinks(event.txHash) : []),
    [event.txHash],
  );

  return (
    <div className="rounded-lg border border-zinc-700/70 bg-zinc-900/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Execution Debug</p>
          <p className="text-sm text-zinc-200">{debug.decode.summary}</p>
          <p className="text-xs text-zinc-400 mt-1">{debug.decode.likelyCause}</p>
          <p className="text-xs text-emerald-300 mt-1">{debug.decode.suggestedAction}</p>
        </div>
        {event.status && (
          <span
            className={`px-2 py-0.5 rounded text-[10px] border ${
              event.status === "confirmed"
                ? "border-emerald-600/40 text-emerald-300 bg-emerald-600/10"
                : event.status === "failed"
                  ? "border-red-600/40 text-red-300 bg-red-600/10"
                  : "border-amber-600/40 text-amber-300 bg-amber-600/10"
            }`}
          >
            {event.status}
          </span>
        )}
      </div>

      {txLinks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {txLinks.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:text-zinc-100 hover:border-zinc-500"
            >
              View on {link.label}
              <ExternalLink className="w-3 h-3" />
            </a>
          ))}
        </div>
      )}

      {debug.addresses.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-zinc-500">Implicated contracts</p>
          <div className="space-y-1">
            {debug.addresses.map((addr) => (
              <a
                key={addr.address}
                href={sepoliaVoyagerContractUrl(addr.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/50 px-2 py-1 text-xs hover:border-zinc-600"
              >
                <span className="text-zinc-200">
                  {addr.label} <span className="text-zinc-500">({addr.kind})</span>
                </span>
                <span className="font-mono text-zinc-400">{addr.short}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {debug.raw && (
        <details className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
          <summary className="text-xs text-zinc-500 cursor-pointer">Raw trace</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] text-zinc-400">
            {debug.labeledMessage}
          </pre>
        </details>
      )}
    </div>
  );
}

