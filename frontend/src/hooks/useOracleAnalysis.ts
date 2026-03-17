"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api/client";
import type { AnalysisResult, Pool } from "@/components/marketing/TrustDemo";

/* ────────────────────────────────────────── types ── */

export interface SkillResult {
  skill_id: string;
  circuit_name: string;
  success: boolean;
  is_compliant: boolean;
  proof_hash: string;
  public_signals: string[];
  duration_ms: number;
  error: string | null;
}

export interface BatchSkillResult {
  pool_id: string;
  results: SkillResult[];
  summary: { total: number; passed: number; failed: number };
}

export interface PoolExplanation {
  pool_id: string;
  pool_name: string;
  explanation: string;
}

export interface NarrationResult {
  narration: string;
  source: string;
  pool_explanations: PoolExplanation[];
}

export interface PipelineStatus {
  proofs: { total_proofs: number; verified_on_chain: number };
  madara: { healthy: boolean; latest_block: number; chain_id: string } | null;
}

type RiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

function riskToProfile(tolerance: number): RiskProfile {
  if (tolerance <= 33) return "CONSERVATIVE";
  if (tolerance <= 66) return "BALANCED";
  return "AGGRESSIVE";
}

/* ────────────────────────────────────────── hook config ── */

export interface UseOracleAnalysisConfig {
  riskTolerance: number;
  enabledSkills: string[];
  protocolWeights: { ekubo: number; vesu: number; lending: number };
}

export interface UseOracleAnalysisReturn {
  /* core result */
  result: AnalysisResult | null;
  loading: boolean;
  error: string | null;

  /* derived profile label */
  profile: RiskProfile;

  /* parallel data */
  narration: NarrationResult | null;
  narrationLoading: boolean;
  batchResults: BatchSkillResult | null;
  batchLoading: boolean;

  /* pipeline status (fetched once) */
  status: PipelineStatus | null;

  /* actions */
  analyze: () => Promise<void>;
}

/* ────────────────────────────────────────── hook ── */

/**
 * Encapsulates oracle analysis data-fetching:
 *  - POST /strategies/analyze
 *  - POST /strategies/narrate  (parallel)
 *  - POST /zkdefi/skills/batch (parallel)
 *  - GET  /zkdefi/proofs/stats + madara health (on mount)
 *
 * All calls go through `apiFetch` (timeout + base URL resolution).
 */
export function useOracleAnalysis(
  config: UseOracleAnalysisConfig,
): UseOracleAnalysisReturn {
  const { riskTolerance, enabledSkills } = config;

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [narration, setNarration] = useState<NarrationResult | null>(null);
  const [narrationLoading, setNarrationLoading] = useState(false);

  const [batchResults, setBatchResults] = useState<BatchSkillResult | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  const [status, setStatus] = useState<PipelineStatus | null>(null);

  const profile = riskToProfile(riskTolerance);
  const abortRef = useRef<AbortController | null>(null);

  /* fetch pipeline status once on mount */
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const [proofRes, madaraRes] = await Promise.all([
          apiFetch<{ total_proofs: number; verified_on_chain: number }>(
            "/api/v1/zkdefi/proofs/stats",
            { signal: ac.signal, timeoutMs: 8000 },
          ).catch(() => ({ total_proofs: 0, verified_on_chain: 0 })),
          apiFetch<{ healthy: boolean; latest_block: number; chain_id: string }>(
            "/api/v1/zkdefi/risk_passport/settlement/madara/health",
            { signal: ac.signal, timeoutMs: 8000 },
          ).catch(() => null),
        ]);
        setStatus({ proofs: proofRes, madara: madaraRes });
      } catch {
        /* ignore */
      }
    })();
    return () => ac.abort();
  }, []);

  /* main analysis */
  const analyze = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const p = riskToProfile(riskTolerance);

    setLoading(true);
    setError(null);
    setResult(null);
    setNarration(null);
    setBatchResults(null);

    try {
      const data = await apiFetch<AnalysisResult>("/api/v1/strategies/analyze", {
        method: "POST",
        body: JSON.stringify({
          deposit_amount: 1000000000,
          risk_profile: p,
          user_address: "0xdemo",
        }),
        signal: ac.signal,
        timeoutMs: 25000,
      });

      setResult(data);

      /* — parallel: narration + batch skills — */
      const narrationPromise = (async () => {
        setNarrationLoading(true);
        try {
          const res = await apiFetch<NarrationResult>("/api/v1/strategies/narrate", {
            method: "POST",
            body: JSON.stringify({
              risk_profile: p,
              pools: data.recommended_pools ?? [],
              confidence_score: data.confidence_score ?? 0,
            }),
            signal: ac.signal,
            timeoutMs: 15000,
          });
          setNarration(res);
        } catch {
          /* non-critical */
        } finally {
          setNarrationLoading(false);
        }
      })();

      const batchPromise = (async () => {
        if (enabledSkills.length > 0 && data.recommended_pools?.[0]) {
          setBatchLoading(true);
          try {
            const topPool = data.recommended_pools[0];
            const perSkillParams: Record<string, Record<string, unknown>> = {};
            for (const sid of enabledSkills) {
              perSkillParams[sid] = {
                pool_id: topPool.pool_id,
                position_size: 1000000,
                entry_price: 2000,
                current_price: 2067,
                allocations: [5000, 3000, 2000],
                predicted_yields: [800, 600, 400],
              };
            }
            const raw = await apiFetch<{
              results: SkillResult[];
              total: number;
              succeeded: number;
              failed: number;
            }>("/api/v1/zkdefi/skills/batch", {
              method: "POST",
              body: JSON.stringify({
                skill_ids: enabledSkills,
                params: perSkillParams,
              }),
              signal: ac.signal,
              timeoutMs: 20000,
            });
            setBatchResults({
              pool_id: topPool.pool_id,
              results: raw.results ?? [],
              summary: {
                total: raw.total ?? 0,
                passed: raw.succeeded ?? 0,
                failed: raw.failed ?? 0,
              },
            });
          } catch {
            /* non-critical */
          } finally {
            setBatchLoading(false);
          }
        }
      })();

      await Promise.allSettled([narrationPromise, batchPromise]);
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError((err as Error)?.message ?? "Analysis failed");
        setResult(null);
      }
    } finally {
      setLoading(false);
    }
  }, [riskTolerance, enabledSkills]);

  /* cleanup on unmount */
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    result,
    loading,
    error,
    profile,
    narration,
    narrationLoading,
    batchResults,
    batchLoading,
    status,
    analyze,
  };
}
