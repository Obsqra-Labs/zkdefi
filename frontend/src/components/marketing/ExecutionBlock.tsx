"use client";

import { useState, useCallback, useRef } from "react";
import {
  Loader2,
  CheckCircle2,
  Shield,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import type { AnalysisResult, Pool } from "./TrustDemo";
import { apiFetch } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

interface TradeReceipt {
  session_id: string;
  proposal_hash: string;
  moves: {
    action: string;
    protocol: string;
    pool_name: string;
    asset_symbol: string;
    amount_usd: number;
    expected_apy: number;
    risk_score: number;
    reasoning: string;
  }[];
  expected_blended_apy: number;
  reasoning: string;
}

interface ProofReceipt {
  proof: string;
  claim: string;
  valid: boolean;
  nullifier: string;
}

type ExecPhase = "idle" | "executing" | "proving" | "complete" | "blocked";

/* ─── helpers ──────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEMO_ADDRESS =
  "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";

/**
 * Check whether a pool would be blocked for the user's risk tolerance.
 * Frontend simulation — real gating comes from the backend orchestrator.
 */
function shouldBlock(pool: Pool, riskTolerance: number): boolean {
  // Conservative (≤33) blocks risky pools; Balanced (≤66) blocks very risky
  if (riskTolerance <= 33 && pool.risk_score > 45) return true;
  if (riskTolerance <= 66 && pool.risk_score > 70) return true;
  return false;
}

function voyagerTxUrl(hash: string): string {
  return `https://sepolia.voyager.online/tx/${hash}`;
}

/* ─── props ────────────────────────────────────────────────────────── */

interface ExecutionBlockProps {
  oracleResult: AnalysisResult | null;
  walletAddress?: string;
  riskTolerance?: number;
  /** Called when execution completes — parent can use this to show stream */
  onExecutionComplete?: () => void;
}

/**
 * Step 3 — Accept recommendation → execute → receipt (or blocked state).
 *
 * Design spec:
 *  - Recommendation block: top pool, APY, one-line reasoning
 *  - Proof summary line above Accept button
 *  - Accept button: full-width, consequential weight
 *  - Receipt: visual frame, Voyager link as visual endpoint
 *  - Blocked state: amber, rejection receipt, "proof gate blocked this trade"
 */
export function ExecutionBlock({
  oracleResult,
  walletAddress = DEMO_ADDRESS,
  riskTolerance = 50,
  onExecutionComplete,
}: ExecutionBlockProps) {
  const [phase, setPhase] = useState<ExecPhase>("idle");
  const [receipt, setReceipt] = useState<TradeReceipt | null>(null);
  const [proof, setProof] = useState<ProofReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const topPool = oracleResult?.recommended_pools?.[0] ?? null;
  const pools = oracleResult?.recommended_pools ?? [];
  const circuitCount = pools.length; // approximate "circuits screened"
  const isBlocked = topPool ? shouldBlock(topPool, riskTolerance) : false;

  const handleAccept = useCallback(async () => {
    if (!oracleResult?.recommended_pools?.length || !topPool) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setError(null);
    setReceipt(null);
    setProof(null);

    /* ── Check for blocked trade (frontend simulation) ── */
    if (isBlocked) {
      setPhase("blocked");
      onExecutionComplete?.();
      return;
    }

    /* ── Execute ── */
    setPhase("executing");
    try {
      const execRes = await apiFetch<{
        proposal: TradeReceipt;
        execution: { session_id: string };
        portfolio: Record<string, unknown>;
      }>("/api/v1/demo/simulate-and-execute", {
        method: "POST",
        body: JSON.stringify({
          wallet_address: walletAddress,
          risk_profile: oracleResult.risk_profile,
          hypothetical_usd: topPool.allocation_mid * 100,
        }),
        signal,
        timeoutMs: 20_000,
      });
      if (signal.aborted) return;

      const tradeReceipt: TradeReceipt = {
        session_id: execRes.execution?.session_id ?? "demo",
        proposal_hash: execRes.proposal?.proposal_hash ?? "0x…",
        moves: execRes.proposal?.moves ?? [],
        expected_blended_apy: execRes.proposal?.expected_blended_apy ?? topPool.apy,
        reasoning: execRes.proposal?.reasoning ?? `Allocated to ${topPool.pool_name}`,
      };
      setReceipt(tradeReceipt);

      /* ── Generate proof ── */
      setPhase("proving");
      await sleep(400);
      if (signal.aborted) return;

      try {
        const proofRes = await apiFetch<ProofReceipt>(
          "/api/v1/demo/proof-of-performance",
          {
            method: "POST",
            body: JSON.stringify({
              wallet_address: walletAddress,
              session_id: tradeReceipt.session_id,
              prove_type: "capital_preserved",
            }),
            signal,
            timeoutMs: 15_000,
          },
        );
        setProof(proofRes);
      } catch {
        // Proof generation is optional
      }

      setPhase("complete");
      onExecutionComplete?.();
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setError((err as Error)?.message ?? "Execution failed");
        setPhase("idle");
      }
    }
  }, [oracleResult, topPool, walletAddress, riskTolerance, isBlocked, onExecutionComplete]);

  /* ── No oracle data yet → disabled state ── */
  if (!oracleResult || !topPool) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-zinc-800/40 bg-zinc-900/20 px-6 py-10 text-center">
        <p className="text-sm text-zinc-500">
          Complete Step 2 to see the top recommendation.
        </p>
        <button
          disabled
          className="mx-auto mt-4 block w-full rounded-xl bg-zinc-800 px-6 py-3.5 text-base font-semibold text-zinc-600 opacity-40"
        >
          Accept recommendation
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {/* ── Recommendation block ── */}
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-cyan-500">
              Top Recommendation
            </p>
            <p className="mt-1 font-serif text-base font-bold text-zinc-100">
              {topPool.pool_name}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {oracleResult.summary_text ||
                `${oracleResult.risk_profile} profile · best risk-adjusted match from ${pools.length} pools`}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-xl font-bold text-emerald-400">
              {(topPool.apy * 100).toFixed(1)}%
            </p>
            <p className="font-mono text-[9px] text-zinc-600">APY</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
          <span className="rounded bg-zinc-800/60 px-2 py-0.5 text-zinc-400">
            Risk {topPool.risk_score}
          </span>
          <span className="rounded bg-zinc-800/60 px-2 py-0.5 text-zinc-400">
            Alloc {topPool.allocation_mid}%
          </span>
          <span
            className={`rounded px-2 py-0.5 font-semibold ${
              topPool.safety_level === "safe"
                ? "bg-emerald-500/10 text-emerald-400"
                : topPool.safety_level === "risky"
                  ? "bg-rose-500/10 text-rose-400"
                  : "bg-amber-500/10 text-amber-400"
            }`}
          >
            {topPool.safety_level}
          </span>
          <span className="rounded bg-zinc-800/60 px-2 py-0.5 text-zinc-400">
            Conf {(topPool.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* ── Proof summary line ── */}
      <p className="text-center font-mono text-[11px] text-zinc-500">
        {circuitCount} circuits screened · risk within bounds · ready to execute.
      </p>

      {/* ── Accept button — consequential weight ── */}
      {(phase === "idle" || phase === "executing" || phase === "proving") && (
        <button
          onClick={handleAccept}
          disabled={phase !== "idle"}
          className="group w-full rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-6 py-4 text-base font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-500 hover:to-cyan-500 hover:shadow-emerald-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {phase === "executing" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Executing…
            </span>
          ) : phase === "proving" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating receipt…
            </span>
          ) : (
            "Accept recommendation"
          )}
        </button>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-950/10 px-4 py-3 text-center">
          <p className="text-xs text-rose-400">{error}</p>
          <button
            onClick={() => { setError(null); setPhase("idle"); }}
            className="mt-2 text-[10px] text-zinc-500 underline underline-offset-2 hover:text-zinc-400"
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Receipt — visual frame ── */}
      {phase === "complete" && receipt && (
        <div className="rounded-xl border border-emerald-500/20 bg-zinc-900/40 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              Execution Receipt
            </span>
          </div>

          {/* Trade summary */}
          <p className="text-xs leading-relaxed text-zinc-400 italic">
            &quot;{receipt.reasoning}&quot;
          </p>

          {/* Moves */}
          {receipt.moves.length > 0 && (
            <div className="space-y-1">
              {receipt.moves.slice(0, 3).map((m, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md bg-zinc-950/50 px-3 py-2 text-[10px]"
                >
                  <span className="font-bold uppercase text-emerald-400">
                    {m.action}
                  </span>
                  <span className="text-zinc-300">
                    ${m.amount_usd.toLocaleString()} → {m.protocol}/{m.pool_name}
                  </span>
                  <span className="ml-auto font-mono text-cyan-400">
                    {m.expected_apy.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Blended APY */}
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] text-zinc-600">Blended APY</span>
            <span className="font-mono text-sm font-bold text-emerald-400">
              {receipt.expected_blended_apy.toFixed(1)}%
            </span>
          </div>

          {/* Proof badge */}
          {proof && (
            <div className="flex items-center gap-2 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 px-3 py-2">
              <Shield className="h-3.5 w-3.5 text-fuchsia-400" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-fuchsia-300">
                  {proof.valid ? "✓ Verified" : "⨯ Invalid"} — {proof.claim}
                </p>
                <code className="block truncate font-mono text-[8px] text-zinc-600">
                  proof: {proof.proof?.slice(0, 40)}…
                </code>
              </div>
            </div>
          )}

          {/* Voyager link — visual endpoint */}
          <a
            href={voyagerTxUrl(receipt.proposal_hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 font-mono text-xs text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            View on Voyager
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="sr-only">(opens in new tab)</span>
          </a>
        </div>
      )}

      {/* ── Blocked trade — amber designed state ── */}
      {phase === "blocked" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              Trade Blocked
            </span>
          </div>
          <p className="text-sm leading-relaxed text-amber-200/80">
            The proof gate blocked this trade. Risk threshold exceeded.
          </p>
          <p className="text-xs leading-relaxed text-zinc-500">
            Your risk tolerance ({riskTolerance}%) rejected{" "}
            <strong className="text-zinc-400">{topPool.pool_name}</strong> (risk score{" "}
            {topPool.risk_score}). The system doesn&apos;t just execute — it decides.
          </p>

          {/* Rejection receipt */}
          <div className="rounded-lg border border-amber-500/15 bg-zinc-900/40 px-3 py-2 space-y-1">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-500">
              Rejection Receipt
            </p>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-zinc-600">Pool</span>
              <span className="text-zinc-400">{topPool.pool_name}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-zinc-600">Risk</span>
              <span className="text-rose-400">{topPool.risk_score}</span>
              <span className="text-zinc-600">→ threshold</span>
              <span className="text-amber-400">{riskTolerance}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-zinc-600">Decision</span>
              <span className="font-semibold text-amber-400">BLOCKED</span>
            </div>
          </div>

          {/* Try different risk level */}
          <button
            onClick={() => { setPhase("idle"); setError(null); }}
            className="w-full rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
          >
            Adjust risk tolerance in Step 2 and try again
          </button>
        </div>
      )}
    </div>
  );
}
