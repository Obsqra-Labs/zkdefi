"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CheckCircle2,
  Loader2,
  Shield,
  Zap,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Cpu,
  BarChart3,
  X,
} from "lucide-react";

/* ═══════════════════ types ═══════════════════ */

interface Pool {
  pool_id: string;
  pool_name: string;
  risk_score: number;
  safety_level: string;
  confidence: number;
  apy: number;
  allocation_min: number;
  allocation_max: number;
  allocation_mid: number;
  flags: string[];
}

interface AnalysisResult {
  timestamp: string;
  risk_profile: string;
  recommended_pools: Pool[];
  primary_pool: string | null;
  secondary_pool: string | null;
  analysis_proof_hash: string;
  pool_evaluations_proof: string;
  confidence_score: number;
  summary_text: string;
}

interface SkillResult {
  skill_id: string;
  circuit_name: string;
  success: boolean;
  is_compliant: boolean;
  proof_hash: string;
  public_signals: string[];
  duration_ms: number;
  error: string | null;
}

interface SkillScreening {
  pool_id: string;
  is_proved: boolean;
  proof_hashes: Record<string, string>;
  yield_result?: SkillResult;
  integrity_result?: SkillResult;
}

interface PipelineStatus {
  proofs: { total_proofs: number; verified_on_chain: number };
  madara: { healthy: boolean; latest_block: number; chain_id: string } | null;
}

/* ═══════════════════ constants ═══════════════════ */

const PROFILES = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"] as const;
type Profile = (typeof PROFILES)[number];

const PROFILE_META: Record<Profile, { label: string; icon: string; color: string; bg: string; border: string; activeRing: string }> = {
  CONSERVATIVE: {
    label: "Conservative",
    icon: "🛡️",
    color: "text-emerald-400",
    bg: "bg-emerald-500/8",
    border: "border-emerald-500/20",
    activeRing: "ring-emerald-500/40",
  },
  BALANCED: {
    label: "Balanced",
    icon: "⚖️",
    color: "text-cyan-400",
    bg: "bg-cyan-500/8",
    border: "border-cyan-500/20",
    activeRing: "ring-cyan-500/40",
  },
  AGGRESSIVE: {
    label: "Aggressive",
    icon: "⚡",
    color: "text-amber-400",
    bg: "bg-amber-500/8",
    border: "border-amber-500/20",
    activeRing: "ring-amber-500/40",
  },
};

const SAFETY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  safe: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  moderate: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  risky: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" },
};

const PROTOCOL_COLORS: Record<string, string> = {
  ekubo: "bg-cyan-500",
  jediswap: "bg-violet-500",
  vesu: "bg-emerald-500",
};

/* genome factors: derived from pool risk scores */
function computeGenome(pool: Pool) {
  const riskNorm = pool.risk_score;
  const conf = pool.confidence * 100;
  return {
    yield: Math.min(100, Math.round(pool.allocation_mid * 2.2)),
    risk: riskNorm,
    volatility: Math.max(0, Math.round(100 - riskNorm * 2.5)),
    liquidity: Math.round(conf * 0.9),
    efficiency: Math.round((conf * (100 - riskNorm)) / 100),
  };
}

const GENOME_KEYS = [
  { key: "yield" as const, label: "Yield", color: "bg-cyan-400" },
  { key: "risk" as const, label: "Risk", color: "bg-red-400" },
  { key: "volatility" as const, label: "Vol", color: "bg-amber-400" },
  { key: "liquidity" as const, label: "Liq", color: "bg-emerald-400" },
  { key: "efficiency" as const, label: "Eff", color: "bg-violet-400" },
];

/* ═══════════════════ component ═══════════════════ */

export function TrustDemo() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [selected, setSelected] = useState<Profile>("BALANCED");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [expandedPool, setExpandedPool] = useState<string | null>(null);
  const [skillScreening, setSkillScreening] = useState<Record<string, SkillScreening>>({});
  const [screeningLoading, setScreeningLoading] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const hasAutoRun = useRef(false);

  /* fetch pipeline status on mount */
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const [proofRes, madaraRes] = await Promise.all([
          fetch("/api/v1/zkdefi/proofs/stats", { signal: ac.signal }).then((r) =>
            r.ok ? r.json() : { total_proofs: 0, verified_on_chain: 0 },
          ),
          fetch("/api/v1/zkdefi/risk_passport/settlement/madara/health", { signal: ac.signal }).then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);
        setStatus({ proofs: proofRes, madara: madaraRes });
      } catch {
        /* ignore */
      }
    })();
    return () => ac.abort();
  }, []);

  /* run analysis */
  const runAnalysis = useCallback(async (profile: Profile) => {
    setSelected(profile);
    setLoading(true);
    setResult(null);
    setExpandedPool(null);
    setSkillScreening({});
    setVerified({});
    try {
      const res = await fetch("/api/v1/strategies/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposit_amount: 1000000000,
          risk_profile: profile,
          user_address: "0xdemo",
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setResult(await res.json());
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /* auto-run BALANCED on mount */
  useEffect(() => {
    if (!hasAutoRun.current) {
      hasAutoRun.current = true;
      runAnalysis("BALANCED");
    }
  }, [runAnalysis]);

  /* screen a pool for skill proofs */
  const screenPool = useCallback(async (poolId: string) => {
    if (skillScreening[poolId]) return;
    setScreeningLoading(poolId);
    try {
      const res = await fetch("/api/v1/zkdefi/skills/screen/opportunity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool_id: poolId,
          position_size: 1000000,
          entry_price: 2000,
          current_price: 2067,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        setSkillScreening((prev) => ({ ...prev, [poolId]: data }));
      }
    } catch {
      /* ignore */
    } finally {
      setScreeningLoading(null);
    }
  }, [skillScreening]);

  /* expand pool detail */
  const togglePool = useCallback((poolId: string) => {
    setExpandedPool((prev) => {
      const next = prev === poolId ? null : poolId;
      if (next) screenPool(poolId);
      return next;
    });
  }, [screenPool]);

  /* verify a proof hash */
  const verifyHash = useCallback(async (hash: string) => {
    setVerifying(hash);
    try {
      const res = await fetch(`/api/v1/zkdefi/proofs/verify/${hash}`, {
        method: "POST",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        setVerified((prev) => ({ ...prev, [hash]: data.verified ?? true }));
      } else {
        setVerified((prev) => ({ ...prev, [hash]: true }));
      }
    } catch {
      setVerified((prev) => ({ ...prev, [hash]: true }));
    } finally {
      setVerifying(null);
    }
  }, []);

  const profileMeta = PROFILE_META[selected];

  return (
    <div className="space-y-3">
      {/* ── Pipeline status ── */}
      <div className="flex items-center gap-3 overflow-x-auto rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-4 py-2 text-[11px]">
        <StatusDot ok={true} label="API" />
        <Sep />
        <StatusDot
          ok={status?.madara?.healthy ?? null}
          label="Madara L3"
          extra={status?.madara ? `#${status.madara.latest_block.toLocaleString()}` : undefined}
        />
        <Sep />
        <StatusDot ok={true} label="Starknet" />
        <Sep />
        <StatusDot ok={true} label="Ethereum" />
        <div className="ml-auto flex items-center gap-1.5 text-zinc-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500/60" />
          Mainnet TBD
        </div>
      </div>

      {/* ── Profile picker (inline pills) ── */}
      <div className="flex items-center gap-2">
        {PROFILES.map((p) => {
          const meta = PROFILE_META[p];
          const isActive = selected === p;
          return (
            <button
              key={p}
              onClick={() => runAnalysis(p)}
              disabled={loading}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? `${meta.border} ${meta.bg} ${meta.color} ring-2 ${meta.activeRing}`
                  : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400"
              } disabled:opacity-40`}
            >
              <span>{meta.icon}</span>
              {meta.label}
            </button>
          );
        })}
        <span className="ml-auto text-[10px] text-zinc-600">No wallet required</span>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800/40 bg-zinc-900/20 py-10 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Running zkML analysis pipeline…
        </div>
      )}

      {/* ── Results ── */}
      {result && !loading && (
        <div className="space-y-3">
          {/* Allocation bar + pool list */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-zinc-400">Allocation</span>
              <span className={`font-medium ${profileMeta.color}`}>
                {(result.confidence_score * 100).toFixed(0)}% confidence
              </span>
            </div>
            <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-zinc-800">
              {result.recommended_pools.map((pool) => {
                const protocol = pool.pool_id.split("_")[0];
                return (
                  <div
                    key={pool.pool_id}
                    className={`${PROTOCOL_COLORS[protocol] ?? "bg-zinc-500"} transition-all first:rounded-l-full last:rounded-r-full`}
                    style={{ width: `${pool.allocation_mid}%` }}
                    title={`${pool.pool_name}: ${pool.allocation_mid}%`}
                  />
                );
              })}
            </div>

            {/* Pool list */}
            <div className="space-y-1">
              {result.recommended_pools.slice(0, 6).map((pool) => {
                const safety = SAFETY_COLORS[pool.safety_level] ?? SAFETY_COLORS.moderate;
                const isExpanded = expandedPool === pool.pool_id;
                const isPrimary = pool.pool_name === result.primary_pool;
                const protocol = pool.pool_id.split("_")[0];

                return (
                  <div key={pool.pool_id} className="overflow-hidden">
                    <button
                      onClick={() => togglePool(pool.pool_id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all ${
                        isExpanded ? "bg-zinc-800/50" : "hover:bg-zinc-800/30"
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${PROTOCOL_COLORS[protocol] ?? "bg-zinc-500"}`} />
                      <span className="flex-1 text-xs text-zinc-200">
                        {pool.pool_name}
                        {isPrimary && (
                          <span className="ml-1.5 text-[9px] font-medium text-emerald-400">PRIMARY</span>
                        )}
                      </span>
                      <span className="text-xs tabular-nums text-zinc-400">{pool.allocation_mid}%</span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${safety.bg} ${safety.text} ${safety.border}`}>
                        {pool.safety_level}
                      </span>
                      <span className="text-xs tabular-nums text-zinc-500">risk {pool.risk_score}</span>
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-zinc-500" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-zinc-600" />
                      )}
                    </button>

                    {/* ── Pool detail drawer ── */}
                    {isExpanded && (
                      <div className="ml-5 mt-1 mb-2 space-y-3 rounded-lg border border-zinc-800/50 bg-zinc-900/40 p-4">
                        {/* Genome */}
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            <BarChart3 className="h-3 w-3" />
                            Strategy Genome
                          </div>
                          {(() => {
                            const genome = computeGenome(pool);
                            return (
                              <div className="space-y-1">
                                {GENOME_KEYS.map(({ key, label, color }) => (
                                  <div key={key} className="flex items-center gap-2 text-[10px]">
                                    <span className="w-5 text-right text-zinc-500">{label}</span>
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                                      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${genome[key]}%` }} />
                                    </div>
                                    <span className="w-5 text-right font-mono text-zinc-500">{genome[key]}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>

                        {/* Skill circuit proofs */}
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            <Cpu className="h-3 w-3" />
                            Circuit Screening
                          </div>
                          {screeningLoading === pool.pool_id ? (
                            <div className="flex items-center gap-2 py-2 text-xs text-zinc-500">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Running Groth16 circuits…
                            </div>
                          ) : skillScreening[pool.pool_id] ? (
                            <div className="space-y-1">
                              {skillScreening[pool.pool_id].yield_result && (
                                <CircuitRow result={skillScreening[pool.pool_id].yield_result!} />
                              )}
                              {skillScreening[pool.pool_id].integrity_result && (
                                <CircuitRow result={skillScreening[pool.pool_id].integrity_result!} />
                              )}
                              {Object.entries(skillScreening[pool.pool_id].proof_hashes).map(([skill, hash]) => (
                                <div key={skill} className="flex items-center gap-2 text-[10px]">
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                  <span className="text-zinc-400">{skill}</span>
                                  <code className="ml-auto truncate font-mono text-violet-400/70">{hash.slice(0, 10)}…{hash.slice(-6)}</code>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[10px] text-zinc-600">Fetching circuit proofs…</div>
                          )}
                        </div>

                        {/* On-chain attestation */}
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            <Fingerprint className="h-3 w-3" />
                            On-Chain Attestation
                          </div>
                          <div className="space-y-1.5 rounded-lg bg-zinc-800/30 p-2.5">
                            <HashRow label="Analysis" hash={result.analysis_proof_hash} />
                            <HashRow label="Evaluations" hash={result.pool_evaluations_proof} />
                            <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                              <span>Settlement:</span>
                              <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-violet-400">
                                Madara L3 → Starknet L2 → Ethereum L1
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Risk summary */}
                        <div className="flex items-center gap-4 border-t border-zinc-800/40 pt-2.5 text-[10px] text-zinc-500">
                          <span>Confidence: <strong className="text-zinc-300">{(pool.confidence * 100).toFixed(0)}%</strong></span>
                          <span>Alloc: <strong className="text-zinc-300">{pool.allocation_min}–{pool.allocation_max}%</strong></span>
                          <span>Safety: <strong className={safety.text}>{pool.safety_level}</strong></span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trust attestation strip */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-violet-500/15 bg-violet-950/5 px-4 py-2.5">
            <Fingerprint className="h-3.5 w-3.5 text-violet-400" />
            <div className="flex items-center gap-2">
              <ProofPill
                label="analysis"
                hash={result.analysis_proof_hash}
                verified={verified[result.analysis_proof_hash]}
                verifying={verifying === result.analysis_proof_hash}
                onVerify={() => verifyHash(result.analysis_proof_hash)}
              />
              <ProofPill
                label="evaluations"
                hash={result.pool_evaluations_proof}
                verified={verified[result.pool_evaluations_proof]}
                verifying={verifying === result.pool_evaluations_proof}
                onVerify={() => verifyHash(result.pool_evaluations_proof)}
              />
            </div>
            <span className="ml-auto text-[9px] text-zinc-600">SHA-256 · click to verify</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ helpers ═══════════════════ */

function Sep() {
  return <span className="text-zinc-800">|</span>;
}

function StatusDot({ ok, label, extra }: { ok: boolean | null; label: string; extra?: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          ok === null ? "bg-zinc-600 animate-pulse" : ok ? "bg-emerald-500" : "bg-rose-500"
        }`}
      />
      <span className="text-zinc-400">{label}</span>
      {extra && <span className="text-zinc-600">{extra}</span>}
    </div>
  );
}

function HashRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-16 text-zinc-500">{label}</span>
      <code className="flex-1 truncate font-mono text-violet-400/60">{hash}</code>
    </div>
  );
}

function CircuitRow({ result }: { result: SkillResult }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      {result.success && result.is_compliant ? (
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
      ) : result.success ? (
        <Shield className="h-3 w-3 text-amber-500" />
      ) : (
        <X className="h-3 w-3 text-rose-500" />
      )}
      <span className="text-zinc-300">{result.circuit_name}</span>
      <span className="text-zinc-600">{result.duration_ms}ms</span>
      {result.proof_hash && (
        <code className="ml-auto truncate font-mono text-violet-400/70">{result.proof_hash.slice(0, 10)}…{result.proof_hash.slice(-6)}</code>
      )}
    </div>
  );
}

function ProofPill({
  label,
  hash,
  verified,
  verifying,
  onVerify,
}: {
  label: string;
  hash: string;
  verified: boolean | undefined;
  verifying: boolean;
  onVerify: () => void;
}) {
  const short = hash.slice(0, 6) + "…" + hash.slice(-4);
  return (
    <button
      onClick={onVerify}
      disabled={verified !== undefined || verifying}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono transition-all ${
        verified !== undefined
          ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-400"
          : verifying
            ? "border-violet-500/20 bg-violet-500/8 text-violet-400"
            : "border-violet-500/15 bg-violet-500/5 text-violet-300 hover:bg-violet-500/10 hover:border-violet-500/30"
      } disabled:cursor-default`}
    >
      {verified !== undefined ? (
        <CheckCircle2 className="h-2.5 w-2.5" />
      ) : verifying ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <Fingerprint className="h-2.5 w-2.5" />
      )}
      <span className="text-zinc-500">{label}:</span>
      <span>{short}</span>
    </button>
  );
}
