"use client";

import { Loader2, CheckCircle2, Shield, Zap } from "lucide-react";
import type { AnalysisResult, Pool } from "./TrustDemo";
import type { NarrationResult, BatchSkillResult, PipelineStatus } from "@/hooks/useOracleAnalysis";

/* ── pool protocol colors ── */
const PROTOCOL_COLORS: Record<string, string> = {
  ekubo: "bg-cyan-500",
  vesu: "bg-emerald-500",
  endur: "bg-amber-500",
  nostra: "bg-rose-500",
  troves: "bg-indigo-500",
};

const SAFETY_STYLES: Record<string, { bg: string; text: string }> = {
  safe: { bg: "bg-emerald-500/10", text: "text-emerald-400" },
  moderate: { bg: "bg-amber-500/10", text: "text-amber-400" },
  risky: { bg: "bg-rose-500/10", text: "text-rose-400" },
};

interface OracleResultsProps {
  result: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  profile: string;
  narration: NarrationResult | null;
  narrationLoading: boolean;
  batchResults: BatchSkillResult | null;
  batchLoading: boolean;
  status: PipelineStatus | null;
  onRetry?: () => void;
}

/**
 * Single-column oracle results for the Loop demo.
 * Shows: pipeline status → narration → pool cards → proof summary.
 */
export function OracleResults({
  result,
  loading,
  error,
  profile,
  narration,
  narrationLoading,
  batchResults,
  batchLoading,
  status,
  onRetry,
}: OracleResultsProps) {
  const profileColor =
    profile === "CONSERVATIVE"
      ? "text-emerald-400"
      : profile === "BALANCED"
        ? "text-cyan-400"
        : "text-amber-400";

  /* loading skeleton */
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800/40 bg-zinc-900/20 py-12 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Recalculating…
        </div>
        {/* skeleton cards */}
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-900/40" />
        ))}
      </div>
    );
  }

  /* error state */
  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 px-5 py-8 text-center">
        <p className="text-sm text-rose-400">Couldn&apos;t reach the oracle</p>
        <p className="mt-1 text-[10px] text-zinc-600">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-3 rounded-lg border border-zinc-700 px-4 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  /* no result yet (pre-analysis) */
  if (!result) return null;

  const pools = result.recommended_pools ?? [];
  const totalAlloc = pools.reduce((s, p) => s + p.allocation_mid, 0);
  const bestApy = pools.length > 0 ? Math.max(...pools.map((p) => p.apy)) : 0;
  const avgApy =
    pools.length > 0 ? pools.reduce((s, p) => s + p.apy, 0) / pools.length : 0;

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
        <span className={`font-semibold ${profileColor}`}>{profile}</span>
        <span className="text-zinc-700">·</span>
        <span>{pools.length} pools</span>
        <span className="text-zinc-700">·</span>
        <span>
          Best APY{" "}
          <strong className="text-emerald-400">
            {(bestApy * 100).toFixed(1)}%
          </strong>
        </span>
        <span className="text-zinc-700">·</span>
        <span>
          Confidence{" "}
          <strong className="text-zinc-300">
            {(result.confidence_score * 100).toFixed(0)}%
          </strong>
        </span>
        {batchResults && (
          <>
            <span className="text-zinc-700">·</span>
            <span>
              {batchResults.summary.passed}/{batchResults.summary.total} circuits passed
            </span>
          </>
        )}
      </div>

      {/* Allocation bar */}
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
        {pools.map((pool) => {
          const protocol = pool.pool_id.split("_")[0];
          const widthPct =
            totalAlloc > 0 ? (pool.allocation_mid / totalAlloc) * 100 : 0;
          return (
            <div
              key={pool.pool_id}
              className={`${PROTOCOL_COLORS[protocol] ?? "bg-zinc-500"} transition-all first:rounded-l-full last:rounded-r-full`}
              style={{ width: `${widthPct}%` }}
              title={`${pool.pool_name}: ${pool.allocation_mid}%`}
            />
          );
        })}
      </div>

      {/* AI narration */}
      {(narrationLoading || narration) && (
        <div className="rounded-lg border border-violet-500/15 bg-violet-950/5 p-3">
          <p className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-violet-400">
            AI Oracle · zkML-attested
          </p>
          {narrationLoading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating explanation…
            </div>
          ) : narration ? (
            <p className="text-xs leading-relaxed text-zinc-300">
              {narration.narration}
            </p>
          ) : null}
        </div>
      )}

      {/* Pool cards */}
      <div className="space-y-2">
        {pools.slice(0, 6).map((pool, i) => {
          const safety = SAFETY_STYLES[pool.safety_level] ?? SAFETY_STYLES.moderate;
          const isPrimary = pool.pool_name === result.primary_pool;
          const protocol = pool.pool_id.split("_")[0];

          return (
            <div
              key={pool.pool_id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                isPrimary
                  ? "border-cyan-500/25 bg-cyan-950/10"
                  : "border-zinc-800/60 bg-zinc-900/30 hover:border-zinc-700/60"
              }`}
            >
              {/* Protocol dot */}
              <div
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${PROTOCOL_COLORS[protocol] ?? "bg-zinc-500"}`}
              />

              {/* Pool name */}
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs font-medium text-zinc-200">
                  {pool.pool_name}
                  {isPrimary && (
                    <span className="ml-1.5 inline-block rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[8px] text-cyan-400">
                      TOP
                    </span>
                  )}
                </p>
              </div>

              {/* Allocation */}
              <span className="w-10 text-right font-mono text-[10px] text-zinc-500">
                {pool.allocation_mid}%
              </span>

              {/* Safety */}
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${safety.bg} ${safety.text}`}
              >
                {pool.safety_level}
              </span>

              {/* Risk */}
              <span className="w-8 text-right font-mono text-[10px] text-zinc-500">
                {pool.risk_score}
              </span>

              {/* APY */}
              <span className="w-14 text-right font-mono text-[10px] font-semibold text-emerald-400">
                {(pool.apy * 100).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Proof hashes summary */}
      <div className="flex items-center gap-3 rounded-lg bg-zinc-900/40 px-3 py-2 text-[10px]">
        <Shield className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Analysis proof</span>
            <code className="truncate font-mono text-cyan-400/70">
              {result.analysis_proof_hash}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Pool evals proof</span>
            <code className="truncate font-mono text-violet-400/70">
              {result.pool_evaluations_proof}
            </code>
          </div>
        </div>
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      </div>

      {/* Pipeline status */}
      {status && (
        <div className="flex items-center gap-4 text-[9px] text-zinc-600">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500/60" />
            API
          </span>
          {status.madara && (
            <span className="flex items-center gap-1">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${status.madara.healthy ? "bg-emerald-500/60" : "bg-amber-500/60"}`}
              />
              Madara L3 #{status.madara.latest_block.toLocaleString()}
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500/60" />
            {status.proofs.total_proofs} proofs generated
          </span>
        </div>
      )}
    </div>
  );
}
