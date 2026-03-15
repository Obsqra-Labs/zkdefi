"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Zap,
  Play,
  CheckCircle2,
  Loader2,
  ArrowRight,
  TrendingUp,
  Shield,
  Fingerprint,
  BarChart3,
  Activity,
  RefreshCw,
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

type LoopPhase =
  | "idle"           // waiting for oracle data or user click
  | "analyzing"      // showing AI picking from oracle data
  | "executing"      // calling simulate-and-execute
  | "proving"        // generating proof-of-performance
  | "complete";      // loop closed — receipt feeds back

interface ExecutedTrade {
  pool: Pool;
  receipt: TradeReceipt;
  proof: ProofReceipt | null;
}

/* ─── constants ────────────────────────────────────────────────────── */

const DEMO_ADDRESS =
  "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";

const PHASE_LABELS: Record<LoopPhase, string> = {
  idle: "Ready",
  analyzing: "AI selecting opportunity…",
  executing: "Executing trade…",
  proving: "Generating receipt…",
  complete: "Loop closed",
};

const SAFETY_COLOR: Record<string, string> = {
  safe: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
  moderate: "text-amber-400 border-amber-500/20 bg-amber-500/5",
  risky: "text-rose-400 border-rose-500/20 bg-rose-500/5",
};

/* ─── component ────────────────────────────────────────────────────── */

interface AgentExecutionLoopProps {
  oracleResult: AnalysisResult | null;
  walletAddress?: string;
}

export function AgentExecutionLoop({
  oracleResult,
  walletAddress = DEMO_ADDRESS,
}: AgentExecutionLoopProps) {
  const [phase, setPhase] = useState<LoopPhase>("idle");
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [trades, setTrades] = useState<ExecutedTrade[]>([]);
  const [currentReceipt, setCurrentReceipt] = useState<TradeReceipt | null>(null);
  const [currentProof, setCurrentProof] = useState<ProofReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loopCount, setLoopCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Reset when oracle result changes
  useEffect(() => {
    if (oracleResult) {
      setPhase("idle");
      setTrades([]);
      setSelectedPool(null);
      setCurrentReceipt(null);
      setCurrentProof(null);
      setError(null);
      setLoopCount(0);
    }
  }, [oracleResult]);

  const runLoop = useCallback(async () => {
    if (!oracleResult?.recommended_pools?.length) return;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setError(null);

    // Pick the next pool the agent hasn't traded yet
    const tradedIds = new Set(trades.map((t) => t.pool.pool_id));
    const nextPool =
      oracleResult.recommended_pools.find((p) => !tradedIds.has(p.pool_id)) ??
      oracleResult.recommended_pools[0];

    /* ── Phase 1: AI analyzes ── */
    setPhase("analyzing");
    setSelectedPool(nextPool);
    await sleep(1800); // let user see the oracle data + selection
    if (signal.aborted) return;

    /* ── Phase 2: Execute trade ── */
    setPhase("executing");
    try {
      const execRes = await apiFetch<{
        proposal: TradeReceipt;
        execution: { session_id: string };
        portfolio: Record<string, unknown>;
      }>("/api/v1/paper-trade/simulate-and-execute", {
        method: "POST",
        body: JSON.stringify({
          wallet_address: walletAddress,
          risk_profile: oracleResult.risk_profile,
          hypothetical_usd: nextPool.allocation_mid * 100,
        }),
        timeoutMs: 20_000,
      });
      if (signal.aborted) return;

      const receipt: TradeReceipt = {
        session_id: execRes.execution?.session_id ?? "demo",
        proposal_hash: execRes.proposal?.proposal_hash ?? "0x…",
        moves: execRes.proposal?.moves ?? [],
        expected_blended_apy: execRes.proposal?.expected_blended_apy ?? nextPool.apy,
        reasoning: execRes.proposal?.reasoning ?? `AI allocated to ${nextPool.pool_name}`,
      };
      setCurrentReceipt(receipt);

      /* ── Phase 3: Generate proof ── */
      setPhase("proving");
      await sleep(600);
      if (signal.aborted) return;

      let proof: ProofReceipt | null = null;
      try {
        proof = await apiFetch<ProofReceipt>("/api/v1/paper-trade/proof-of-performance", {
          method: "POST",
          body: JSON.stringify({
            wallet_address: walletAddress,
            session_id: receipt.session_id,
            prove_type: "capital_preserved",
          }),
          timeoutMs: 15_000,
        });
      } catch {
        // proof generation is optional; trade still succeeded
      }
      if (signal.aborted) return;
      setCurrentProof(proof ?? null);

      /* ── Phase 4: Complete ── */
      const executed: ExecutedTrade = { pool: nextPool, receipt, proof };
      setTrades((prev) => [...prev, executed]);
      setLoopCount((c) => c + 1);
      setPhase("complete");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Execution failed");
      setPhase("idle");
    }
  }, [oracleResult, walletAddress, trades]);

  const isRunning = phase !== "idle" && phase !== "complete";

  const topPools = oracleResult?.recommended_pools?.slice(0, 4) ?? [];

  return (
    <div className="space-y-6">
      {/* ── Oracle feed ── */}
      {oracleResult && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/50">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              Oracle Feed → Agent Input
            </span>
            <span className="ml-auto text-[9px] text-zinc-600">
              {oracleResult.confidence_score
                ? `${(oracleResult.confidence_score * 100).toFixed(0)}% confidence`
                : ""}
            </span>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">
              {oracleResult.summary_text ||
                `${oracleResult.risk_profile} profile · ${topPools.length} pools scored · proof ${oracleResult.analysis_proof_hash?.slice(0, 12)}…`}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {topPools.map((pool) => {
                const isSelected = selectedPool?.pool_id === pool.pool_id;
                const isTraded = trades.some((t) => t.pool.pool_id === pool.pool_id);
                const safetyClass = SAFETY_COLOR[pool.safety_level] ?? SAFETY_COLOR.moderate;
                return (
                  <div
                    key={pool.pool_id}
                    className={`relative rounded-lg border p-2.5 transition-all ${
                      isSelected
                        ? "border-emerald-500/40 bg-emerald-500/5 ring-1 ring-emerald-500/20"
                        : isTraded
                          ? "border-zinc-700 bg-zinc-900/30 opacity-60"
                          : "border-zinc-800 bg-zinc-900/50"
                    }`}
                  >
                    {isSelected && phase === "analyzing" && (
                      <div className="absolute -top-1.5 -right-1.5">
                        <div className="h-3 w-3 animate-ping rounded-full bg-emerald-400/60" />
                      </div>
                    )}
                    {isTraded && (
                      <div className="absolute -top-1 -right-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      </div>
                    )}
                    <p className="text-[10px] font-semibold text-zinc-200 truncate">
                      {pool.pool_name}
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-cyan-400">
                        {pool.apy.toFixed(1)}%
                      </span>
                      <span
                        className={`rounded-full border px-1.5 py-0 text-[8px] font-medium ${safetyClass}`}
                      >
                        {pool.safety_level}
                      </span>
                    </div>
                    <div className="mt-1">
                      <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-cyan-500/60 transition-all"
                          style={{ width: `${Math.min(100, pool.allocation_mid)}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-[8px] text-zinc-600">
                        {pool.allocation_mid.toFixed(0)}% alloc
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Execution timeline ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/50">
          <Zap className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            Agent Execution Loop
          </span>
          {phase !== "idle" && phase !== "complete" && (
            <span className="ml-auto flex items-center gap-1 text-[9px] text-emerald-400">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {PHASE_LABELS[phase]}
            </span>
          )}
          {phase === "complete" && (
            <span className="ml-auto flex items-center gap-1 text-[9px] text-emerald-400">
              <CheckCircle2 className="h-2.5 w-2.5" />
              {loopCount} trade{loopCount !== 1 ? "s" : ""} executed
            </span>
          )}
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Phase pipeline indicator */}
          <div className="flex items-center justify-center gap-0 text-[9px] font-semibold">
            <PhaseStep
              label="Oracle Data"
              active={phase === "analyzing"}
              done={phase === "executing" || phase === "proving" || phase === "complete"}
              color="cyan"
            />
            <PhaseArrow />
            <PhaseStep
              label="AI Select"
              active={phase === "analyzing"}
              done={phase === "executing" || phase === "proving" || phase === "complete"}
              color="violet"
            />
            <PhaseArrow />
            <PhaseStep
              label="Execute"
              active={phase === "executing"}
              done={phase === "proving" || phase === "complete"}
              color="emerald"
            />
            <PhaseArrow />
            <PhaseStep
              label="Receipt"
              active={phase === "proving"}
              done={phase === "complete"}
              color="fuchsia"
            />
            <PhaseArrow />
            <PhaseStep
              label="Reputation ↻"
              active={false}
              done={phase === "complete"}
              color="amber"
            />
          </div>

          {/* Currently executing trade detail */}
          {selectedPool && phase !== "idle" && (
            <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[11px] font-semibold text-zinc-200">
                  {phase === "analyzing"
                    ? `Evaluating ${selectedPool.pool_name}…`
                    : phase === "executing"
                      ? `Executing on ${selectedPool.pool_name}`
                      : phase === "proving"
                        ? "Generating ZK receipt…"
                        : `Traded ${selectedPool.pool_name}`}
                </span>
                <span className="ml-auto text-[10px] font-mono text-cyan-400">
                  {selectedPool.apy.toFixed(1)}% APY
                </span>
              </div>

              {/* Trade reasoning */}
              {currentReceipt && (phase === "executing" || phase === "proving" || phase === "complete") && (
                <div className="space-y-2">
                  <p className="text-[10px] text-zinc-500 italic">
                    &quot;{currentReceipt.reasoning}&quot;
                  </p>
                  {currentReceipt.moves.length > 0 && (
                    <div className="space-y-1">
                      {currentReceipt.moves.slice(0, 3).map((m, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-md border border-zinc-800/30 bg-zinc-950/50 px-2.5 py-1.5"
                        >
                          <span className="text-[9px] font-bold uppercase text-emerald-400">
                            {m.action}
                          </span>
                          <span className="text-[10px] text-zinc-300">
                            ${m.amount_usd.toLocaleString()} → {m.protocol}/{m.pool_name}
                          </span>
                          <span className="ml-auto text-[9px] font-mono text-cyan-400">
                            {m.expected_apy.toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Proof receipt */}
                  {currentProof && (phase === "proving" || phase === "complete") && (
                    <div className="flex items-center gap-2 rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 px-2.5 py-1.5">
                      <Shield className="h-3 w-3 text-fuchsia-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-fuchsia-300">
                          {currentProof.valid ? "✓ Verified" : "⨯ Invalid"} — {currentProof.claim}
                        </p>
                        <p className="font-mono text-[8px] text-zinc-600 truncate">
                          proof: {currentProof.proof?.slice(0, 32)}…
                        </p>
                      </div>
                      <Fingerprint className="h-3 w-3 text-fuchsia-400/40" />
                    </div>
                  )}

                  {/* Loop feedback */}
                  {phase === "complete" && (
                    <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
                      <Activity className="h-3 w-3 text-amber-400" />
                      <p className="text-[10px] text-amber-300">
                        Receipt feeds back → reputation updated → next opportunity unlocked
                      </p>
                      <RefreshCw className="h-3 w-3 text-amber-400/40" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Past trades */}
          {trades.length > 0 && phase === "complete" && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">
                Executed Trades
              </p>
              {trades.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-zinc-800/30 bg-zinc-900/20 px-2.5 py-1.5"
                >
                  <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                  <span className="text-[10px] text-zinc-300 flex-1 truncate">
                    {t.pool.pool_name}
                  </span>
                  <span className="text-[9px] font-mono text-cyan-400">
                    {t.pool.apy.toFixed(1)}%
                  </span>
                  {t.proof?.valid && (
                    <Shield className="h-2.5 w-2.5 text-fuchsia-400" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* CTA */}
          {!oracleResult && (
            <div className="text-center py-4">
              <p className="text-xs text-zinc-600">
                Run the ZK Oracle above to feed data into the agent.
              </p>
            </div>
          )}

          {oracleResult && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <button
                onClick={runLoop}
                disabled={isRunning || !oracleResult.recommended_pools?.length}
                className="group inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-6 py-3 font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-500 hover:to-cyan-500 hover:shadow-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {PHASE_LABELS[phase]}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    {loopCount === 0
                      ? "Let the Agent Run"
                      : `Run Again (${loopCount} done)`}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
              <p className="text-[9px] text-zinc-600">
                {loopCount === 0
                  ? "AI picks the top oracle opportunity, executes a paper trade, and generates a ZK receipt"
                  : "Each execution produces a receipt that feeds back into your reputation passport"}
              </p>
            </div>
          )}

          {error && (
            <p className="text-center text-[10px] text-rose-400">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── sub-components ───────────────────────────────────────────────── */

function PhaseStep({
  label,
  active,
  done,
  color,
}: {
  label: string;
  active: boolean;
  done: boolean;
  color: string;
}) {
  const base = done
    ? `border-${color}-500/40 bg-${color}-500/10 text-${color}-400`
    : active
      ? `border-${color}-500/30 bg-${color}-500/5 text-${color}-400 animate-pulse`
      : "border-zinc-800 bg-zinc-900/50 text-zinc-600";
  return (
    <span className={`rounded-md border px-2.5 py-1.5 text-[9px] font-semibold transition-all ${base}`}>
      {done && <CheckCircle2 className="mr-1 inline h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function PhaseArrow() {
  return (
    <span className="px-1 text-zinc-700">→</span>
  );
}

/* ─── helpers ──────────────────────────────────────────────────────── */

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
