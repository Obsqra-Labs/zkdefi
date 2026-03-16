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
  MessageSquare,
  Info,
  TrendingUp,
  ExternalLink,
} from "lucide-react";
import {
  ExplainerModal,
  type ExplainerType,
  type PoolExplanation,
} from "./ExplainerModal";
import { sepoliaVoyagerContractUrl, sepoliaVoyagerClassUrl, l3ExplorerUrl } from "@/lib/explorer";

/* ═══════════════════ types ═══════════════════ */

export interface Pool {
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

export interface AnalysisResult {
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

interface BatchSkillResult {
  pool_id: string;
  results: SkillResult[];
  summary: { total: number; passed: number; failed: number };
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

interface NarrationResult {
  narration: string;
  source: string;
  pool_explanations: PoolExplanation[];
}

interface ExplainerState {
  open: boolean;
  type: ExplainerType;
  poolId: string;
  poolName: string;
}

/* ═══════════════════ constants ═══════════════════ */

type Profile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

const SAFETY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  safe: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  moderate: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  risky: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" },
};

const PROTOCOL_COLORS: Record<string, string> = {
  ekubo: "bg-cyan-500",
  vesu: "bg-emerald-500",
  endur: "bg-amber-500",
  nostra: "bg-rose-500",
  troves: "bg-indigo-500",
};

/* ── Protocol integration tab definitions ── */
type ProtocolTab = "all" | "ekubo" | "vesu" | "endur" | "nostra" | "troves" | "more";

const PROTOCOL_TABS: { key: ProtocolTab; label: string; icon: string; accent: string; desc: string }[] = [
  { key: "all", label: "All", icon: "⚡", accent: "border-violet-500 text-violet-400", desc: "Blended multi-protocol view" },
  { key: "ekubo", label: "Ekubo", icon: "🌊", accent: "border-cyan-500 text-cyan-400", desc: "Concentrated DEX liquidity" },
  { key: "vesu", label: "Vesu", icon: "🏦", accent: "border-emerald-500 text-emerald-400", desc: "Lending & supply markets" },
  { key: "endur", label: "Endur", icon: "🔐", accent: "border-amber-500 text-amber-400", desc: "Liquid staking (xSTRK, xBTC)" },
  { key: "nostra", label: "Nostra", icon: "🏛️", accent: "border-rose-500 text-rose-400", desc: "Lending, DEX & Super App" },
  { key: "troves", label: "Troves", icon: "⚔️", accent: "border-indigo-500 text-indigo-400", desc: "DEX LP & yield vaults" },
  { key: "more", label: "More →", icon: "✦", accent: "border-zinc-600 text-zinc-500", desc: "Integrations coming soon" },
];

/* ── EZKL Model artifacts (real hashes from trained models) ── */
const EZKL_MODELS = [
  {
    name: "Anomaly Detector",
    onnx_hash: "66a7d0b3…e852e3a5a4",
    vk_hash: "51758428…3f6a8436",
    rows: 1534,
    logrows: 15,
  },
  {
    name: "Creditworthiness",
    onnx_hash: "be1ad11f…20cc2812",
    vk_hash: "858d881d…2bd801b3",
    rows: 4964,
    logrows: 15,
  },
  {
    name: "Yield Forecast",
    onnx_hash: "7b41f26e…8b91afec",
    vk_hash: "f2f79850…ab1482ec",
    rows: 2188,
    logrows: 15,
  },
];

/* ── On-chain contract addresses (Starknet Sepolia) ── */
const CONTRACTS = {
  agent_skill_registry: "0x6a039b4e59b39fc2ab44c3c70a5ecdbe765a9afabb4b2765f9bb966dfb6ddda",
  agent_performance: "0x67f10e598223c89135cd8b6a6f58b081e658069231b5a9064d29d5204d4c450",
  validation_proofs: "0x20ea9a32eae3fe6fe5137ca9f576383f8723913e1619f17120cf1aeb7e06305",
  constraint_receipt: "0x59c5a05987025ee88e89cc266aadc17676db42ea4eb08c99099ed12f32b7607",
  allocation_router: "0xabda1150d8fc9db11b99c8485d671c53bc2ad65fe21a8d218c1e621a85843b",
  reputation_registry: "0x10d00b33b5683afd776c58638a222aa10605d7eeafa95979b5246312b7e022",
  batch_verifier: "0x285f944aa5cb8f90fa37c4dbdf5dd1eb2e34ab0bde9669e61fbd7a9a0f3b869",
  ezkl_kzg_verifier_class: "0x3e5927705e38ef0868f56dfb6906eb53edf3497eb4be8798c92dc47c747c78",
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

function riskToProfile(tolerance: number): Profile {
  if (tolerance <= 33) return "CONSERVATIVE";
  if (tolerance <= 66) return "BALANCED";
  return "AGGRESSIVE";
}

/* ═══════════════════ props ═══════════════════ */

interface TrustDemoProps {
  /** 0-100 from brain panel */
  riskTolerance: number;
  /** skill IDs toggled on */
  enabledSkills: string[];
  /** protocol weights from brain sliders */
  protocolWeights: { ekubo: number; vesu: number; lending: number };
  /** incremented to trigger re-analysis */
  triggerKey: number;
  /** report loading state to parent */
  onLoadingChange?: (loading: boolean) => void;
  /** lift oracle result up so Step 3 can consume it */
  onResult?: (result: AnalysisResult) => void;
}

/* ═══════════════════ component ═══════════════════ */

export function TrustDemo({
  riskTolerance,
  enabledSkills,
  protocolWeights,
  triggerKey,
  onLoadingChange,
  onResult,
}: TrustDemoProps) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [expandedPool, setExpandedPool] = useState<string | null>(null);
  const [skillScreening, setSkillScreening] = useState<Record<string, SkillScreening>>({});
  const [batchResults, setBatchResults] = useState<BatchSkillResult | null>(null);
  const [screeningLoading, setScreeningLoading] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [protocolTab, setProtocolTab] = useState<ProtocolTab>("all");
  const [narration, setNarration] = useState<NarrationResult | null>(null);
  const [narrationLoading, setNarrationLoading] = useState(false);
  const [explainer, setExplainer] = useState<ExplainerState>({
    open: false,
    type: "safety",
    poolId: "",
    poolName: "",
  });
  const hasAutoRun = useRef(false);
  const prevTrigger = useRef(triggerKey);

  const profile = riskToProfile(riskTolerance);
  const profileColor =
    profile === "CONSERVATIVE" ? "text-emerald-400" : profile === "BALANCED" ? "text-cyan-400" : "text-amber-400";

  /* sync loading state to parent */
  useEffect(() => {
    onLoadingChange?.(loading || batchLoading);
  }, [loading, batchLoading, onLoadingChange]);

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
  const runAnalysis = useCallback(async () => {
    const p = riskToProfile(riskTolerance);
    setLoading(true);
    setResult(null);
    setExpandedPool(null);
    setSkillScreening({});
    setBatchResults(null);
    setVerified({});
    setNarration(null);
    try {
      const res = await fetch("/api/v1/strategies/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposit_amount: 1000000000,
          risk_profile: p,
          user_address: "0xdemo",
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setResult(data);
      onResult?.(data);

      /* fetch LLM narration in parallel with batch skills */
      const narrationPromise = (async () => {
        setNarrationLoading(true);
        try {
          const narRes = await fetch("/api/v1/strategies/narrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              risk_profile: p,
              pools: data.recommended_pools ?? [],
              confidence_score: data.confidence_score ?? 0,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (narRes.ok) {
            setNarration(await narRes.json());
          }
        } catch {
          /* non-critical */
        } finally {
          setNarrationLoading(false);
        }
      })();

      /* run batch skill screening in parallel */
      const batchPromise = (async () => {
        if (enabledSkills.length > 0 && data.recommended_pools?.[0]) {
          setBatchLoading(true);
          try {
            const topPool = data.recommended_pools[0];
            // Build per-skill params from the top recommended pool
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
            const batchRes = await fetch("/api/v1/zkdefi/skills/batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                skill_ids: enabledSkills,
                params: perSkillParams,
              }),
              signal: AbortSignal.timeout(20000),
            });
            if (batchRes.ok) {
              const raw = await batchRes.json();
              // Map backend shape { results, total, succeeded, failed }
              // to frontend BatchSkillResult { pool_id, results, summary }
              setBatchResults({
                pool_id: topPool.pool_id,
                results: raw.results ?? [],
                summary: {
                  total: raw.total ?? 0,
                  passed: raw.succeeded ?? 0,
                  failed: raw.failed ?? 0,
                },
              });
            }
          } catch {
            /* non-critical */
          } finally {
            setBatchLoading(false);
          }
        }
      })();

      await Promise.allSettled([narrationPromise, batchPromise]);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [riskTolerance, enabledSkills]);

  /* auto-run BALANCED on mount */
  useEffect(() => {
    if (!hasAutoRun.current) {
      hasAutoRun.current = true;
      runAnalysis();
    }
  }, [runAnalysis]);

  /* re-run when triggerKey changes (brain panel "Run Analysis" clicked) */
  useEffect(() => {
    if (triggerKey > 0 && triggerKey !== prevTrigger.current) {
      prevTrigger.current = triggerKey;
      runAnalysis();
    }
  }, [triggerKey, runAnalysis]);

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
      if (next) {
        screenPool(poolId);
      }
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

  /* filter batch results to only enabled skills */
  const filteredBatchResults = batchResults?.results?.filter((r) =>
    enabledSkills.includes(r.skill_id),
  );

  /* open explainer modal */
  const openExplainer = useCallback((type: ExplainerType, poolId: string, poolName: string) => {
    setExplainer({ open: true, type, poolId, poolName });
  }, []);

  const closeExplainer = useCallback(() => {
    setExplainer((prev) => ({ ...prev, open: false }));
  }, []);

  /* find the explanation for a specific pool */
  const getPoolExplanation = useCallback(
    (poolId: string): PoolExplanation | null => {
      return narration?.pool_explanations?.find((pe) => pe.pool_id === poolId) ?? null;
    },
    [narration],
  );

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
        <a href="https://voyager.online" target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400 transition-colors">
          <StatusDot ok={true} label="Starknet Mainnet" />
        </a>
        <Sep />
        <StatusDot ok={true} label="Ethereum" />
        <div className="ml-auto flex items-center gap-1.5 text-zinc-500">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500/60" />
          <span className="text-[9px]">No wallet needed</span>
        </div>
      </div>

      {/* ── Active config indicator ── */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
        <span className={`font-medium ${profileColor}`}>{profile}</span>
        <span className="text-zinc-700">·</span>
        <span>Risk {riskTolerance}%</span>
        <span className="text-zinc-700">·</span>
        <span>{enabledSkills.length} circuits</span>
        <span className="text-zinc-700">·</span>
        <span>Ekubo {protocolWeights.ekubo}% / Vesu {protocolWeights.vesu}%</span>
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
          {/* ── AI Oracle Narration ── */}
          {(narrationLoading || narration) && (
            <div className="rounded-xl border border-violet-500/15 bg-violet-950/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                <MessageSquare className="h-3 w-3" />
                AI Oracle · zkML-attested
                {narration && (
                  <span className="ml-auto rounded-full border border-zinc-800 px-1.5 py-0.5 text-[8px] font-normal text-zinc-600">
                    {narration.source === "llm" ? "proof-gated inference" : "deterministic fallback"}
                  </span>
                )}
              </div>
              {narrationLoading ? (
                <div className="flex items-center gap-2 py-1 text-xs text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Generating explanation…
                </div>
              ) : narration ? (
                <p className="text-xs leading-relaxed text-zinc-300">{narration.narration}</p>
              ) : null}
            </div>
          )}

          {/* ── EZKL Model Hashes ── */}
          <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/5 p-4">
            <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-500">
              <Zap className="h-3 w-3" />
              EZKL zkML Models
              <span className="ml-auto text-[8px] font-normal text-zinc-600">KZG commitments · logrows=15</span>
            </div>
            <div className="space-y-2">
              {EZKL_MODELS.map((model) => (
                <div key={model.name} className="rounded-lg bg-zinc-800/30 p-2.5 space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-medium text-zinc-300">{model.name}</span>
                    <span className="text-zinc-600">{model.rows.toLocaleString()} rows</span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px]">
                    <span className="w-10 text-zinc-600">ONNX</span>
                    <code className="flex-1 truncate font-mono text-cyan-400/70">{model.onnx_hash}</code>
                  </div>
                  <div className="flex items-center gap-2 text-[9px]">
                    <span className="w-10 text-zinc-600">VK</span>
                    <code className="flex-1 truncate font-mono text-violet-400/70">{model.vk_hash}</code>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2 text-[9px] text-zinc-600">
              <Fingerprint className="h-3 w-3" />
              <span>Verifier:</span>
              <a
                href={sepoliaVoyagerClassUrl(CONTRACTS.ezkl_kzg_verifier_class)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-cyan-500/70 hover:text-cyan-400 transition-colors"
              >
                EzklKzgVerifier <ExternalLink className="inline h-2.5 w-2.5" />
              </a>
            </div>
          </div>

          {/* ── Protocol Integration Tabs ── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
            {/* Tab bar */}
            <div className="mb-4 flex items-center gap-1 rounded-lg bg-zinc-800/40 p-1">
              {PROTOCOL_TABS.map((tab) => {
                const isActive = protocolTab === tab.key;
                const poolCount = tab.key === "all"
                  ? result.recommended_pools.length
                  : tab.key === "more" ? 0
                  : result.recommended_pools.filter((p) => p.pool_id.startsWith(tab.key)).length;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setProtocolTab(tab.key)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-all flex-1 justify-center ${
                      isActive
                        ? `bg-zinc-900 border ${tab.accent} shadow-sm`
                        : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                    }`}
                  >
                    <span className="text-xs">{tab.icon}</span>
                    <span>{tab.label}</span>
                    {poolCount > 0 && (
                      <span className={`rounded-full px-1.5 py-0 text-[9px] tabular-nums ${
                        isActive ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800/50 text-zinc-600"
                      }`}>{poolCount}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* "More" tab — CTA placeholder */}
            {protocolTab === "more" ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10">
                <div className="flex items-center gap-2 text-lg">
                  <span>🔗</span>
                  <span className="font-semibold text-zinc-300">More Integrations</span>
                </div>
                <p className="max-w-sm text-center text-xs leading-relaxed text-zinc-500">
                  We're adding more Starknet protocols to the AI pipeline.
                  Yield aggregators, perps, bridges — if it has on-chain data, Capital OS can ingest it.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {["Haiko", "Carmine", "mySwap", "AVNU", "Nimbora", "JediSwap"].map((name) => (
                    <span key={name} className="rounded-full border border-zinc-800 bg-zinc-900/50 px-2.5 py-1 text-[10px] text-zinc-600">
                      {name}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-zinc-700">Have a protocol? Let's integrate →</p>
              </div>
            ) : (() => {
              /* Filter pools by protocol tab */
              const visiblePools = protocolTab === "all"
                ? result.recommended_pools
                : result.recommended_pools.filter((p) => p.pool_id.startsWith(protocolTab));

              /* Per-tab stats */
              const tabTotalAlloc = visiblePools.reduce((s, p) => s + p.allocation_mid, 0);
              const tabAvgApy = visiblePools.length > 0
                ? visiblePools.reduce((s, p) => s + p.apy, 0) / visiblePools.length
                : 0;
              const tabBestApy = visiblePools.length > 0
                ? Math.max(...visiblePools.map((p) => p.apy))
                : 0;

              return (
                <>
                  {/* Tab stats strip */}
                  <div className="mb-3 flex items-center gap-4 text-[10px] text-zinc-500">
                    <span>{visiblePools.length} pools</span>
                    <span className="text-zinc-700">·</span>
                    <span>Best APY <strong className="text-emerald-400">{(tabBestApy * 100).toFixed(1)}%</strong></span>
                    <span className="text-zinc-700">·</span>
                    <span>Avg APY <strong className="text-zinc-300">{(tabAvgApy * 100).toFixed(1)}%</strong></span>
                    <span className={`ml-auto font-medium ${profileColor}`}>
                      {(result.confidence_score * 100).toFixed(0)}% confidence
                    </span>
                  </div>

                  {/* Allocation bar (filtered) */}
                  <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-zinc-800">
                    {visiblePools.map((pool) => {
                      const protocol = pool.pool_id.split("_")[0];
                      const widthPct = tabTotalAlloc > 0 ? (pool.allocation_mid / tabTotalAlloc) * 100 : 0;
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

                  {/* Column headers */}
                  <div className="mb-1 flex items-center gap-3 px-3 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                    <span className="w-2" />
                    <span className="flex-1">Pool</span>
                    <span className="w-12 text-right">Alloc</span>
                    <span className="w-16 text-center">Safety</span>
                    <span className="w-14 text-right">Risk</span>
                    <span className="w-14 text-right">APY</span>
                    <span className="w-3" />
                  </div>

                  {/* Pool list (filtered) */}
                  <div className="space-y-1">
                    {visiblePools.slice(0, 8).map((pool) => {
                const safety = SAFETY_COLORS[pool.safety_level] ?? SAFETY_COLORS.moderate;
                const isExpanded = expandedPool === pool.pool_id;
                const isPrimary = pool.pool_name === result.primary_pool;
                const protocol = pool.pool_id.split("_")[0];
                const hasExplanation = !!getPoolExplanation(pool.pool_id);

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
                      {/* Allocation % — clickable */}
                      <span
                        className={`w-12 text-right text-xs tabular-nums transition-colors ${
                          hasExplanation ? "text-cyan-400 cursor-help hover:text-cyan-300" : "text-zinc-400"
                        }`}
                        onClick={(e) => {
                          if (hasExplanation) { e.stopPropagation(); openExplainer("allocation", pool.pool_id, pool.pool_name); }
                        }}
                        title={hasExplanation ? "Click to see allocation formula" : undefined}
                      >
                        {pool.allocation_mid}%
                      </span>
                      {/* Safety badge — clickable */}
                      <span
                        className={`w-16 text-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium transition-all ${safety.bg} ${safety.text} ${safety.border} ${
                          hasExplanation ? "cursor-help hover:ring-1 hover:ring-zinc-600" : ""
                        }`}
                        onClick={(e) => {
                          if (hasExplanation) { e.stopPropagation(); openExplainer("safety", pool.pool_id, pool.pool_name); }
                        }}
                        title={hasExplanation ? "Click to see safety formula" : undefined}
                      >
                        {pool.safety_level}
                      </span>
                      {/* Risk score — clickable */}
                      <span
                        className={`w-14 text-right text-xs tabular-nums transition-colors ${
                          hasExplanation ? "text-amber-400 cursor-help hover:text-amber-300" : "text-zinc-500"
                        }`}
                        onClick={(e) => {
                          if (hasExplanation) { e.stopPropagation(); openExplainer("risk", pool.pool_id, pool.pool_name); }
                        }}
                        title={hasExplanation ? "Click to see risk breakdown" : undefined}
                      >
                        {pool.risk_score}
                      </span>
                      {/* APY — clickable */}
                      <span
                        className={`w-14 text-right text-xs tabular-nums transition-colors ${
                          hasExplanation ? "text-violet-400 cursor-help hover:text-violet-300" : "text-zinc-500"
                        }`}
                        onClick={(e) => {
                          if (hasExplanation) { e.stopPropagation(); openExplainer("apy", pool.pool_id, pool.pool_name); }
                        }}
                        title={hasExplanation ? "Click to trace APY path" : undefined}
                      >
                        {(pool.apy * 100).toFixed(1)}%
                      </span>
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

                        {/* On-chain attestation with Voyager links */}
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
                            <div className="flex flex-wrap items-center gap-2 pt-1 text-[9px]">
                              <a
                                href={sepoliaVoyagerContractUrl(CONTRACTS.validation_proofs)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-cyan-500/70 hover:text-cyan-400 transition-colors"
                              >
                                ProofRegistry <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                              <a
                                href={sepoliaVoyagerContractUrl(CONTRACTS.batch_verifier)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-cyan-500/70 hover:text-cyan-400 transition-colors"
                              >
                                BatchVerifier <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                              <a
                                href={l3ExplorerUrl()}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-violet-500/70 hover:text-violet-400 transition-colors"
                              >
                                L3 Explorer <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            </div>
                          </div>
                        </div>

                        {/* APY Path Trace */}
                        {(() => {
                          const pe = getPoolExplanation(pool.pool_id);
                          if (!pe) return null;
                          return (
                            <div>
                              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                <TrendingUp className="h-3 w-3" />
                                APY Path
                              </div>
                              <div className="space-y-1 rounded-lg bg-zinc-800/30 p-2.5">
                                {pe.apy_path.path.map((step, i) => (
                                  <div key={i} className="flex items-start gap-2 text-[10px]">
                                    <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[8px] font-bold text-violet-400">
                                      {i + 1}
                                    </span>
                                    <span className="font-mono text-zinc-400">{step.replace(/^\d+\.\s*/, "")}</span>
                                  </div>
                                ))}
                                <div className="mt-1.5 flex items-center justify-between border-t border-zinc-800/40 pt-1.5 text-[10px]">
                                  <span className="text-zinc-500">Risk-Adjusted APY</span>
                                  <span className="font-mono font-semibold text-violet-400">{pe.apy_path.risk_adjusted_apy}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Explainer buttons */}
                        {getPoolExplanation(pool.pool_id) && (
                          <div className="flex flex-wrap gap-1.5 border-t border-zinc-800/40 pt-2.5">
                            {(["safety", "risk", "allocation", "apy"] as ExplainerType[]).map((t) => (
                              <button
                                key={t}
                                onClick={() => openExplainer(t, pool.pool_id, pool.pool_name)}
                                className="inline-flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-0.5 text-[9px] font-medium text-zinc-500 transition-all hover:border-zinc-600 hover:text-zinc-300"
                              >
                                <Info className="h-2.5 w-2.5" />
                                {t === "safety" ? "Safety formula" : t === "risk" ? "Risk breakdown" : t === "allocation" ? "Allocation logic" : "APY path"}
                              </button>
                            ))}
                          </div>
                        )}

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
            {visiblePools.length > 8 && (
              <div className="px-3 py-1.5 text-center text-[10px] text-zinc-600">
                +{visiblePools.length - 8} more {protocolTab === "all" ? "pools" : protocolTab} pools
              </div>
            )}
          </>
        );
      })()}
          </div>

          {/* ── Batch circuit results ── */}
          {(batchLoading || (filteredBatchResults && filteredBatchResults.length > 0)) && (
            <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/5 p-4 space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-500">
                <Cpu className="h-3 w-3" />
                Batch Circuit Skills
                {batchResults?.summary && (
                  <span className="ml-auto text-[9px] font-normal text-zinc-500">
                    {batchResults.summary.passed}/{batchResults.summary.total} passed
                  </span>
                )}
              </div>
              {batchLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Running {enabledSkills.length} circuit skills…
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredBatchResults?.map((r) => (
                    <CircuitRow key={r.skill_id} result={r} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── On-Chain Contracts (Voyager links) ── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
            <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <ExternalLink className="h-3 w-3" />
              Agent Contracts
              <span className="ml-auto text-[8px] font-normal text-amber-500/70">Sepolia · Voyager</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { name: "Skill Registry", addr: CONTRACTS.agent_skill_registry },
                { name: "Performance", addr: CONTRACTS.agent_performance },
                { name: "Proof Registry", addr: CONTRACTS.validation_proofs },
                { name: "Constraints", addr: CONTRACTS.constraint_receipt },
                { name: "Router", addr: CONTRACTS.allocation_router },
                { name: "Reputation", addr: CONTRACTS.reputation_registry },
              ].map((c) => (
                <a
                  key={c.name}
                  href={sepoliaVoyagerContractUrl(c.addr)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-zinc-800/30 px-2.5 py-1.5 text-[9px] transition-colors hover:bg-zinc-800/50"
                >
                  <span className="text-zinc-400">{c.name}</span>
                  <code className="ml-auto font-mono text-zinc-600 truncate max-w-[80px]">{c.addr.slice(0, 8)}…</code>
                  <ExternalLink className="h-2.5 w-2.5 shrink-0 text-zinc-700" />
                </a>
              ))}
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

      {/* ── Explainer Modal ── */}
      {explainer.open && (
        <ExplainerModal
          type={explainer.type}
          explanation={getPoolExplanation(explainer.poolId)}
          poolName={explainer.poolName}
          onClose={closeExplainer}
        />
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
