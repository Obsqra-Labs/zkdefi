"use client";

import { useState, useCallback, useRef } from "react";
import {
  Loader2,
  CheckCircle2,
  Shield,
  ExternalLink,
  AlertTriangle,
  Layers,
} from "lucide-react";
import type { AnalysisResult, Pool } from "./TrustDemo";

/* ─── types ────────────────────────────────────────────────────────── */

interface MockMove {
  action: string;
  protocol: string;
  pool_name: string;
  asset: string;
  amount_usd: number;
  apy: number;
}

interface MockReceipt {
  session_id: string;
  tx_hash: string;
  moves: MockMove[];
  blended_apy: number;
  reasoning: string;
  settled_on: "L3";
  settlement_block: number;
  timestamp: string;
}

interface MockProof {
  proof_hash: string;
  nullifier: string;
  claim: string;
  valid: boolean;
  circuit: string;
}

type ExecPhase =
  | "idle"
  | "simulating"
  | "settling"
  | "proving"
  | "complete"
  | "blocked";

/* ─── helpers ──────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deterministic-looking hex hash from a seed string */
function mockHash(seed: string): string {
  let h = 0x1a2b3c4d;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return (
    "0x" +
    Math.abs(h).toString(16).padStart(8, "0") +
    Math.abs(h * 31)
      .toString(16)
      .padStart(8, "0") +
    "…"
  );
}

const L3_EXPLORER = "https://starknet.obsqra.fi/forge/explorer";

function l3TxUrl(hash: string): string {
  return `${L3_EXPLORER}?tx=${encodeURIComponent(hash)}`;
}

/**
 * Check whether a pool would be blocked for the user's risk tolerance.
 * Frontend simulation — real gating comes from the backend orchestrator.
 */
function shouldBlock(pool: Pool, riskTolerance: number): boolean {
  if (riskTolerance <= 33 && pool.risk_score > 45) return true;
  if (riskTolerance <= 66 && pool.risk_score > 70) return true;
  return false;
}

/* ─── props ────────────────────────────────────────────────────────── */

interface ExecutionBlockProps {
  oracleResult: AnalysisResult | null;
  walletAddress?: string;
  riskTolerance?: number;
  onExecutionComplete?: () => void;
}

/**
 * Step 3 — Accept recommendation → mock execute on L3 → receipt.
 *
 * Fully mocked for the landing page demo. Real settlement happens
 * inside the Capital OS app via the backend orchestrator.
 */
export function ExecutionBlock({
  oracleResult,
  walletAddress = "0x05fe…1b3d",
  riskTolerance = 50,
  onExecutionComplete,
}: ExecutionBlockProps) {
  const [phase, setPhase] = useState<ExecPhase>("idle");
  const [receipt, setReceipt] = useState<MockReceipt | null>(null);
  const [proof, setProof] = useState<MockProof | null>(null);
  const abortRef = useRef(false);

  const topPool = oracleResult?.recommended_pools?.[0] ?? null;
  const pools = oracleResult?.recommended_pools ?? [];
  const circuitCount = pools.length;
  const isBlocked = topPool ? shouldBlock(topPool, riskTolerance) : false;

  /* ── Build mock receipt from oracle data ── */
  const buildReceipt = useCallback((): MockReceipt => {
    const top3 = pools.slice(0, 3);
    const totalAlloc = top3.reduce((s, p) => s + p.allocation_mid, 0) || 100;

    const moves: MockMove[] = top3.map((p) => {
      const parts = p.pool_name.split(/[\/\-]/);
      return {
        action: "DEPOSIT",
        protocol: p.pool_id.split("-")[0] ?? "ekubo",
        pool_name: p.pool_name,
        asset: parts[0] ?? "ETH",
        amount_usd: Math.round((p.allocation_mid / totalAlloc) * 10000),
        apy: p.apy,
      };
    });

    const blended =
      top3.reduce((s, p) => s + p.apy * p.allocation_mid, 0) / totalAlloc;

    return {
      session_id: `demo-${Date.now().toString(36)}`,
      tx_hash: mockHash(topPool!.pool_name + Date.now()),
      moves,
      blended_apy: blended,
      reasoning:
        oracleResult?.summary_text ??
        `${oracleResult?.risk_profile ?? "Balanced"} allocation across ${top3.length} pools`,
      settled_on: "L3",
      settlement_block: 84_200 + Math.floor(Math.random() * 100),
      timestamp: new Date().toISOString(),
    };
  }, [pools, topPool, oracleResult]);

  const buildProof = useCallback(
    (receipt: MockReceipt): MockProof => ({
      proof_hash: mockHash(receipt.session_id + "proof"),
      nullifier: mockHash(receipt.session_id + "null"),
      claim: "capital_preserved ∧ risk_bounded",
      valid: true,
      circuit: "execution_integrity_v3",
    }),
    [],
  );

  /* ── Execute (all mocked, smooth timing) ── */
  const handleAccept = useCallback(async () => {
    if (!oracleResult?.recommended_pools?.length || !topPool) return;

    abortRef.current = false;
    setReceipt(null);
    setProof(null);

    /* Blocked? */
    if (isBlocked) {
      setPhase("blocked");
      onExecutionComplete?.();
      return;
    }

    /* Phase 1: simulate */
    setPhase("simulating");
    await sleep(900);
    if (abortRef.current) return;

    /* Phase 2: settle on L3 */
    setPhase("settling");
    const r = buildReceipt();
    await sleep(1200);
    if (abortRef.current) return;
    setReceipt(r);

    /* Phase 3: generate proof */
    setPhase("proving");
    await sleep(800);
    if (abortRef.current) return;
    setProof(buildProof(r));

    setPhase("complete");
    onExecutionComplete?.();
  }, [
    oracleResult,
    topPool,
    isBlocked,
    buildReceipt,
    buildProof,
    onExecutionComplete,
  ]);

  /* ── No oracle data → disabled placeholder ── */
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
        {circuitCount} circuits screened · risk within bounds · ready to execute
        on{" "}
        <span className="text-fuchsia-400">Madara L3</span>.
      </p>

      {/* ── Accept button ── */}
      {(phase === "idle" ||
        phase === "simulating" ||
        phase === "settling" ||
        phase === "proving") && (
        <button
          onClick={handleAccept}
          disabled={phase !== "idle"}
          className="group w-full rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-6 py-4 text-base font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-500 hover:to-cyan-500 hover:shadow-emerald-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {phase === "simulating" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Simulating agent strategy…
            </span>
          ) : phase === "settling" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Settling on Madara L3…
            </span>
          ) : phase === "proving" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating ZK receipt…
            </span>
          ) : (
            "Accept recommendation"
          )}
        </button>
      )}

      {/* ── Receipt — visual frame ── */}
      {phase === "complete" && receipt && (
        <div className="rounded-xl border border-emerald-500/20 bg-zinc-900/40 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              Execution Receipt
            </span>
            <span className="ml-auto flex items-center gap-1 rounded bg-fuchsia-500/10 px-1.5 py-0.5 font-mono text-[8px] text-fuchsia-400">
              <Layers className="h-2.5 w-2.5" />
              L3 · block {receipt.settlement_block.toLocaleString()}
            </span>
          </div>

          {/* Trade summary */}
          <p className="text-xs leading-relaxed text-zinc-400 italic">
            &quot;{receipt.reasoning}&quot;
          </p>

          {/* Moves */}
          {receipt.moves.length > 0 && (
            <div className="space-y-1">
              {receipt.moves.map((m, i) => (
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
                    {(m.apy * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Blended APY */}
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] text-zinc-600">Blended APY</span>
            <span className="font-mono text-sm font-bold text-emerald-400">
              {(receipt.blended_apy * 100).toFixed(1)}%
            </span>
          </div>

          {/* Proof badge */}
          {proof && (
            <div className="flex items-center gap-2 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 px-3 py-2">
              <Shield className="h-3.5 w-3.5 text-fuchsia-400" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-fuchsia-300">
                  ✓ Verified — {proof.claim}
                </p>
                <code className="block truncate font-mono text-[8px] text-zinc-600">
                  circuit: {proof.circuit} · nullifier: {proof.nullifier}
                </code>
              </div>
            </div>
          )}

          {/* L3 explorer link — visual endpoint */}
          <a
            href={l3TxUrl(receipt.tx_hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-2.5 font-mono text-xs text-fuchsia-400 transition-colors hover:bg-fuchsia-500/10 hover:text-fuchsia-300"
          >
            View on Obsqra L3 Explorer
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
            <strong className="text-zinc-400">{topPool.pool_name}</strong> (risk
            score {topPool.risk_score}). The system doesn&apos;t just execute — it
            decides.
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

          <button
            onClick={() => {
              setPhase("idle");
              abortRef.current = true;
            }}
            className="w-full rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
          >
            Adjust risk tolerance in Step 2 and try again
          </button>
        </div>
      )}
    </div>
  );
}
