"use client";

import { useState, useCallback } from "react";
import { Loader2, CheckCircle2, FileCheck } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { ClaimResponse } from "@/lib/receiptos/types";

interface ClaimButtonProps {
  walletAddress: string;
  disabled?: boolean;
}

export function ClaimButton({ walletAddress, disabled }: ClaimButtonProps) {
  const [state, setState] = useState<"idle" | "claiming" | "done" | "error">("idle");
  const [result, setResult] = useState<ClaimResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClaim = useCallback(async () => {
    if (state === "claiming" || !walletAddress) return;
    setState("claiming");
    setError(null);

    try {
      const data = await apiFetch<ClaimResponse>("/api/receiptos/claim", {
        method: "POST",
        body: JSON.stringify({ wallet_address: walletAddress }),
        timeoutMs: 120_000,
      });
      setResult(data);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
      setState("error");
    }
  }, [walletAddress, state]);

  if (state === "done" && result) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-400">
            Receipt Claimed
          </span>
        </div>
        <div className="mt-2 space-y-1 text-[10px] text-zinc-400">
          <p>
            Receipt ID:{" "}
            <span className="font-mono text-zinc-200">{result.receipt_id}</span>
          </p>
          <p>
            Tx:{" "}
            <a
              href={`https://sepolia.voyager.online/tx/${result.tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-cyan-400 underline"
            >
              {result.tx_hash.slice(0, 14)}…
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClaim}
        disabled={disabled || state === "claiming"}
        className="cta-glow inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-6 py-3 text-sm font-semibold text-cyan-400 transition-all hover:bg-cyan-500/20 hover:shadow-lg hover:shadow-cyan-500/10 disabled:opacity-50"
      >
        {state === "claiming" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Claiming Receipt…
          </>
        ) : (
          <>
            <FileCheck className="h-4 w-4" />
            Claim Reputation Receipt
          </>
        )}
      </button>
      {state === "error" && error && (
        <p className="text-center text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
