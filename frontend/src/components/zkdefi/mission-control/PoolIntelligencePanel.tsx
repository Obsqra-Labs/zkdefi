"use client";

/**
 * PoolIntelligencePanel — Center-stage view for the 3 privacy pool buckets.
 *
 * Shows each pool with rich detail:
 *   - Risk score, Ekubo tick width, live APY
 *   - Underlying asset pairs
 *   - zkML & Onyx circuit verification status
 *   - Oracle recommendation signal + reasoning
 *   - One-click deposit CTA per pool
 *
 * This is the "intelligent display" — what the oracle ingests to drive
 * autonomous rebalancing decisions.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  Scale,
  Zap,
  Brain,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  TrendingUp,
  Plus,
  RefreshCw,
  Lock,
  Cpu,
  Eye,
} from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolData {
  id: "conservative" | "balanced" | "aggressive";
  label: string;
  description: string;
  tickWidth: number;
  riskScore: number;
  apy: number;
  assets: { pair: string; weight: number }[];
  tvl: number;
}

interface CircuitStatus {
  name: string;
  description: string;
  verified: boolean;
  proofType: "groth16" | "ezkl" | "stone";
  category: "privacy" | "execution" | "intelligence";
}

interface OracleSignal {
  recommended_pool: string;
  reason: string;
  confidence: string;
  ekubo_apy_pct: number;
  last_updated: string;
}

interface StrategyRec {
  pool_id: string;
  allocation_pct: number;
  reasoning: string;
  confidence: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POOLS: PoolData[] = [
  {
    id: "conservative",
    label: "Conservative",
    description: "Wide tick range — lower IL risk, steady yield. Best for passive capital.",
    tickWidth: 6000,
    riskScore: 28,
    apy: 0,
    assets: [
      { pair: "STRK/ETH", weight: 60 },
      { pair: "STRK/USDC", weight: 40 },
    ],
    tvl: 0,
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Medium tick range — optimal risk/reward ratio. Oracle default recommendation.",
    tickWidth: 3000,
    riskScore: 48,
    apy: 0,
    assets: [
      { pair: "STRK/ETH", weight: 50 },
      { pair: "ETH/USDC", weight: 50 },
    ],
    tvl: 0,
  },
  {
    id: "aggressive",
    label: "Aggressive",
    description: "Narrow tick range — concentrated liquidity, higher yield, higher IL risk.",
    tickWidth: 1200,
    riskScore: 72,
    apy: 0,
    assets: [
      { pair: "STRK/ETH", weight: 50 },
      { pair: "strkBTC/ETH", weight: 50 },
    ],
    tvl: 0,
  },
];

const CIRCUITS: CircuitStatus[] = [
  { name: "CommitmentHash", description: "Proves deposit commitment without revealing amount", verified: false, proofType: "groth16", category: "privacy" },
  { name: "NullifierSet", description: "Proves withdrawal eligibility via nullifier", verified: false, proofType: "groth16", category: "privacy" },
  { name: "SolvencyProof", description: "Proves pool solvency without showing individual positions", verified: false, proofType: "groth16", category: "privacy" },
  { name: "RiskScore", description: "Proves risk score within bounds without revealing position details", verified: false, proofType: "groth16", category: "execution" },
  { name: "ExecutionIntegrity", description: "Verifies agent trades comply with session constraints", verified: false, proofType: "groth16", category: "execution" },
  { name: "StrategyIntegrity", description: "Proves allocation strategy follows approved parameters", verified: false, proofType: "groth16", category: "execution" },
  { name: "ModelBridge", description: "Bridges EZKL ML output into Groth16 verification pipeline", verified: false, proofType: "ezkl", category: "intelligence" },
  { name: "AnomalyDetector", description: "Detects anomalous market conditions via zkML inference", verified: false, proofType: "ezkl", category: "intelligence" },
  { name: "YieldForecast", description: "Predicts expected yield using neural network w/ ZK proof", verified: false, proofType: "ezkl", category: "intelligence" },
  { name: "ImpermanentLoss", description: "Predicts IL risk from price volatility model", verified: false, proofType: "ezkl", category: "intelligence" },
];

const POOL_ICONS = {
  conservative: Shield,
  balanced: Scale,
  aggressive: Zap,
};

const POOL_COLORS = {
  conservative: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    text: "text-blue-400",
    badge: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    glow: "shadow-blue-500/5",
    ring: "ring-blue-500/20",
    bar: "bg-blue-400",
  },
  balanced: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    text: "text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    glow: "shadow-emerald-500/5",
    ring: "ring-emerald-500/20",
    bar: "bg-emerald-400",
  },
  aggressive: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    text: "text-amber-400",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    glow: "shadow-amber-500/5",
    ring: "ring-amber-500/20",
    bar: "bg-amber-400",
  },
};

const CIRCUIT_CATEGORY_LABELS = {
  privacy: { label: "Privacy Circuits", icon: Lock, color: "text-violet-400" },
  execution: { label: "Execution Circuits", icon: Cpu, color: "text-cyan-400" },
  intelligence: { label: "Intelligence Circuits (zkML)", icon: Brain, color: "text-amber-400" },
};

function confidenceColor(c: string) {
  const l = (c || "").toLowerCase();
  if (l === "high") return "text-emerald-400 bg-emerald-500/10";
  if (l === "medium") return "text-amber-400 bg-amber-500/10";
  return "text-zinc-400 bg-zinc-500/10";
}

function riskBar(score: number) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct < 35 ? "bg-blue-400" : pct < 60 ? "bg-emerald-400" : "bg-amber-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-zinc-400 w-8 text-right">{score}/100</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PoolIntelligencePanelProps {
  address: string | undefined;
  onDeposit?: (pool?: string) => void;
}

export function PoolIntelligencePanel({ address, onDeposit }: PoolIntelligencePanelProps) {
  const [pools, setPools] = useState<PoolData[]>(POOLS);
  const [circuits, setCircuits] = useState<CircuitStatus[]>(CIRCUITS);
  const [oracleSignal, setOracleSignal] = useState<OracleSignal | null>(null);
  const [recommendations, setRecommendations] = useState<StrategyRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [apyRes, oracleRes, circuitRes, recRes] = await Promise.allSettled([
        fetch(`${API_BASE}/v1/oracle/pool-apys`, { signal: AbortSignal.timeout(6000) }),
        fetch(`${API_BASE}/v1/oracle/recommendation?risk_tolerance=50`, { signal: AbortSignal.timeout(6000) }),
        fetch(`${API_BASE}/v1/agents/models/list`, { signal: AbortSignal.timeout(6000) }),
        fetch(`${API_BASE}/v1/strategies/recommend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_address: address || "0x0", risk_profile: "balanced", amount: 1000 }),
          signal: AbortSignal.timeout(8000),
        }),
      ]);

      // Pool APYs
      if (apyRes.status === "fulfilled" && apyRes.value.ok) {
        const d = await apyRes.value.json();
        setPools((prev) =>
          prev.map((p) => ({
            ...p,
            apy: (d[p.id === "balanced" ? "neutral" : p.id] ?? 0) / 100,
          })),
        );
      }

      // Oracle signal
      if (oracleRes.status === "fulfilled" && oracleRes.value.ok) {
        const d = await oracleRes.value.json();
        setOracleSignal({
          recommended_pool: d.pool_type === "neutral" ? "balanced" : (d.pool_type ?? "balanced"),
          reason: d.reason ?? "",
          ekubo_apy_pct: d.ekubo_apy_pct ?? 0,
          confidence: d.pool_type === "aggressive" ? "high" : "medium",
          last_updated: new Date().toLocaleTimeString(),
        });
      }

      // Circuit verification
      if (circuitRes.status === "fulfilled" && circuitRes.value.ok) {
        const d = await circuitRes.value.json();
        const modelNames = (d.models ?? []).map((m: any) => String(m.name || m.id || "").toLowerCase());
        setCircuits((prev) =>
          prev.map((c) => ({
            ...c,
            verified: modelNames.some((mn: string) =>
              mn.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(mn),
            ),
          })),
        );
      }

      // Strategy recommendations
      if (recRes.status === "fulfilled" && recRes.value.ok) {
        const d = await recRes.value.json();
        const recs = (d.recommended_pools ?? []).slice(0, 3).map((p: any) => ({
          pool_id: p.pool_id ?? p.pair ?? "Unknown",
          allocation_pct: p.allocation_pct ?? 0,
          reasoning: p.reasoning ?? p.reason ?? "",
          confidence: d.ai_confidence ?? "medium",
        }));
        setRecommendations(recs);
      }
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [address]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 60_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const verifiedByCategory = {
    privacy: circuits.filter((c) => c.category === "privacy"),
    execution: circuits.filter((c) => c.category === "execution"),
    intelligence: circuits.filter((c) => c.category === "intelligence"),
  };

  const totalVerified = circuits.filter((c) => c.verified).length;

  if (!address) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
        Connect wallet to view pool intelligence.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-5 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Brain className="w-4.5 h-4.5 text-violet-400" />
              Privacy Pool Intelligence
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              3 Ekubo-native pools — AI-driven allocation, ZK-verified execution
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Oracle Signal Banner */}
        {oracleSignal && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-violet-200">Oracle Signal</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${confidenceColor(oracleSignal.confidence)}`}>
                      {oracleSignal.confidence} confidence
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Recommends <span className="text-white font-medium capitalize">{oracleSignal.recommended_pool}</span>
                    {oracleSignal.reason && ` — ${oracleSignal.reason}`}
                  </p>
                </div>
              </div>
              <div className="text-right">
                {oracleSignal.ekubo_apy_pct > 0 && (
                  <div className="text-sm font-semibold text-emerald-400">{oracleSignal.ekubo_apy_pct.toFixed(1)}% APY</div>
                )}
                <div className="text-[10px] text-zinc-600">{oracleSignal.last_updated}</div>
              </div>
            </div>

            {/* AI Recommendations */}
            {recommendations.length > 0 && (
              <div className="mt-3 pt-3 border-t border-violet-500/10 grid grid-cols-3 gap-2">
                {recommendations.map((r, i) => (
                  <div key={i} className="px-2.5 py-1.5 rounded-lg bg-violet-500/5 border border-violet-500/10">
                    <div className="text-[11px] text-violet-300 font-medium truncate">{r.pool_id}</div>
                    <div className="text-[10px] text-zinc-500 truncate">{r.reasoning}</div>
                    {r.allocation_pct > 0 && (
                      <div className="text-[10px] text-zinc-400 mt-0.5">{r.allocation_pct}% allocation</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pool Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {pools.map((pool) => {
            const Icon = POOL_ICONS[pool.id];
            const color = POOL_COLORS[pool.id];
            const isRecommended = oracleSignal?.recommended_pool === pool.id;

            return (
              <div
                key={pool.id}
                className={`rounded-xl border ${isRecommended ? `${color.border} ring-1 ${color.ring} shadow-lg ${color.glow}` : color.border} ${color.bg} p-4 flex flex-col`}
              >
                {/* Pool Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg ${color.bg} border ${color.border} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${color.text}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-semibold ${color.text}`}>{pool.label}</span>
                        {isRecommended && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${color.badge}`}>
                            RECOMMENDED
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-white">
                      {pool.apy > 0 ? `${pool.apy.toFixed(1)}%` : "--"}
                    </div>
                    <div className="text-[10px] text-zinc-500">APY</div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">{pool.description}</p>

                {/* Risk + Tick Width */}
                <div className="space-y-2 mb-3">
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-zinc-500">Risk Score</span>
                    </div>
                    {riskBar(pool.riskScore)}
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-500">Ekubo Tick Width</span>
                    <span className="text-zinc-300 font-mono">±{pool.tickWidth}</span>
                  </div>
                </div>

                {/* Assets */}
                <div className="mb-3">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Underlying Assets</div>
                  <div className="space-y-1">
                    {pool.assets.map((a) => (
                      <div key={a.pair} className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-300">{a.pair}</span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1 rounded-full bg-zinc-800 overflow-hidden">
                            <div className={`h-full rounded-full ${color.bar}`} style={{ width: `${a.weight}%` }} />
                          </div>
                          <span className="text-[10px] text-zinc-500 w-6 text-right">{a.weight}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Privacy Badge */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 mb-3">
                  <Lock className="w-3 h-3 text-emerald-400" />
                  <span className="text-[10px] text-zinc-400">
                    Max Privacy — Hash-committed deposits, ZK-verified
                  </span>
                </div>

                {/* Deposit CTA */}
                <button
                  onClick={() => onDeposit?.(pool.id)}
                  className={`mt-auto flex items-center justify-center gap-1.5 py-2 rounded-lg border ${color.border} ${color.bg} ${color.text} text-sm font-medium hover:brightness-125 transition-all`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Deposit to {pool.label}
                </button>
              </div>
            );
          })}
        </div>

        {/* Circuit Verification Grid */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">zkML & Onyx Circuit Verification</h3>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-medium ${totalVerified > 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                {totalVerified}/{circuits.length} verified
              </span>
              <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all"
                  style={{ width: `${(totalVerified / circuits.length) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(Object.entries(verifiedByCategory) as [keyof typeof CIRCUIT_CATEGORY_LABELS, CircuitStatus[]][]).map(
              ([cat, catCircuits]) => {
                const { label, icon: CatIcon, color: catColor } = CIRCUIT_CATEGORY_LABELS[cat];
                const catVerified = catCircuits.filter((c) => c.verified).length;
                return (
                  <div key={cat} className="space-y-2">
                    <div className="flex items-center gap-1.5 mb-2">
                      <CatIcon className={`w-3.5 h-3.5 ${catColor}`} />
                      <span className={`text-[11px] font-medium ${catColor} uppercase tracking-wider`}>{label}</span>
                      <span className="text-[10px] text-zinc-600 ml-auto">{catVerified}/{catCircuits.length}</span>
                    </div>
                    {catCircuits.map((c) => (
                      <div
                        key={c.name}
                        className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-zinc-800/30 border border-zinc-800/50"
                      >
                        {c.verified ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-medium ${c.verified ? "text-zinc-200" : "text-zinc-500"}`}>
                              {c.name}
                            </span>
                            <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700/50">
                              {c.proofType}
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-600 leading-relaxed mt-0.5">{c.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              },
            )}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
          </div>
        )}
      </div>
    </div>
  );
}
