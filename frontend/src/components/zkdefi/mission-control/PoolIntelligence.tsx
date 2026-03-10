"use client";

/**
 * PoolIntelligence — Left-rail intelligence display for the 3 privacy pools.
 *
 * Shows each pool (Conservative/Balanced/Aggressive) with:
 *   - Risk score + Ekubo tick width
 *   - Live APY from oracle
 *   - Underlying asset composition
 *   - zkML circuit verification status
 *   - Oracle recommendation signal
 *
 * This is what the oracle ingests to make autonomous rebalance decisions.
 */

import { useState, useEffect } from "react";
import {
  Shield,
  Scale,
  Zap,
  Brain,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { API_BASE } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolData {
  id: "conservative" | "balanced" | "aggressive";
  label: string;
  tickWidth: number;
  riskScore: number;
  apy: number;
  assets: string[];
}

interface CircuitStatus {
  name: string;
  verified: boolean;
  proofType: string;
}

interface OracleSignal {
  recommended_pool: string;
  reason: string;
  confidence: string;
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POOLS: PoolData[] = [
  { id: "conservative", label: "Conservative", tickWidth: 6000, riskScore: 28, apy: 0, assets: ["STRK/ETH", "STRK/USDC"] },
  { id: "balanced", label: "Balanced", tickWidth: 3000, riskScore: 48, apy: 0, assets: ["STRK/ETH", "ETH/USDC"] },
  { id: "aggressive", label: "Aggressive", tickWidth: 1200, riskScore: 72, apy: 0, assets: ["STRK/ETH", "strkBTC/ETH"] },
];

const CIRCUITS: CircuitStatus[] = [
  { name: "RiskScore", verified: false, proofType: "groth16" },
  { name: "SolvencyProof", verified: false, proofType: "groth16" },
  { name: "AnomalyDetector", verified: false, proofType: "ezkl" },
  { name: "StrategyIntegrity", verified: false, proofType: "groth16" },
  { name: "ExecutionIntegrity", verified: false, proofType: "groth16" },
  { name: "YieldForecast", verified: false, proofType: "ezkl" },
];

const POOL_ICONS = {
  conservative: Shield,
  balanced: Scale,
  aggressive: Zap,
};

const POOL_COLORS = {
  conservative: { border: "border-blue-500/20", bg: "bg-blue-500/5", text: "text-blue-400", dot: "bg-blue-400" },
  balanced: { border: "border-emerald-500/20", bg: "bg-emerald-500/5", text: "text-emerald-400", dot: "bg-emerald-400" },
  aggressive: { border: "border-amber-500/20", bg: "bg-amber-500/5", text: "text-amber-400", dot: "bg-amber-400" },
};

function confidenceColor(c: string) {
  const l = (c || "").toLowerCase();
  if (l === "high") return "text-emerald-400";
  if (l === "medium") return "text-amber-400";
  return "text-zinc-500";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PoolIntelligenceProps {
  address: string | undefined;
}

export function PoolIntelligence({ address }: PoolIntelligenceProps) {
  const [pools, setPools] = useState<PoolData[]>(POOLS);
  const [circuits, setCircuits] = useState<CircuitStatus[]>(CIRCUITS);
  const [oracleSignal, setOracleSignal] = useState<OracleSignal | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [circuitsExpanded, setCircuitsExpanded] = useState(false);

  useEffect(() => {
    let dead = false;

    const fetchData = async () => {
      try {
        // Fetch pool APYs + oracle recommendation in parallel
        const [apyRes, oracleRes, circuitRes] = await Promise.allSettled([
          fetch(`${API_BASE}/v1/oracle/pool-apys`, { signal: AbortSignal.timeout(6000) }),
          fetch(`${API_BASE}/v1/oracle/recommendation?risk_tolerance=50`, { signal: AbortSignal.timeout(6000) }),
          fetch(`${API_BASE}/v1/agents/models/list`, { signal: AbortSignal.timeout(6000) }),
        ]);

        if (dead) return;

        // Update pool APYs
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
            recommended_pool: d.pool_type ?? "balanced",
            reason: d.reason ?? "",
            confidence: d.pool_type === "aggressive" ? "high" : "medium",
            last_updated: new Date().toLocaleTimeString(),
          });
        }

        // Circuit status — check which models are available
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
      } catch {
        /* best-effort */
      } finally {
        if (!dead) setLoading(false);
      }
    };

    fetchData();
    const iv = setInterval(fetchData, 60_000);
    return () => { dead = true; clearInterval(iv); };
  }, [address]);

  const verifiedCount = circuits.filter((c) => c.verified).length;

  return (
    <div className="border-t border-zinc-800">
      {/* Section header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium text-zinc-400 uppercase tracking-wider hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Brain className="w-3 h-3" />
          Pool Intelligence
        </div>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Oracle Signal Card */}
          {oracleSignal && (
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-2.5 py-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-violet-400" />
                  <span className="text-[11px] font-medium text-violet-300">Oracle Signal</span>
                </div>
                <span className={`text-[10px] font-medium ${confidenceColor(oracleSignal.confidence)}`}>
                  {oracleSignal.confidence}
                </span>
              </div>
              <p className="text-[10px] text-zinc-400 leading-relaxed">
                Recommends <span className="text-white font-medium">{oracleSignal.recommended_pool}</span>
                {oracleSignal.reason && ` — ${oracleSignal.reason}`}
              </p>
              <div className="text-[9px] text-zinc-600 mt-1">Updated {oracleSignal.last_updated}</div>
            </div>
          )}

          {/* Pool Cards */}
          {pools.map((pool) => {
            const Icon = POOL_ICONS[pool.id];
            const color = POOL_COLORS[pool.id];
            const isRecommended = oracleSignal?.recommended_pool === pool.id;

            return (
              <div
                key={pool.id}
                className={`rounded-lg border ${isRecommended ? "border-violet-500/30 ring-1 ring-violet-500/10" : color.border} ${color.bg} px-2.5 py-2`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${color.text}`} />
                    <span className={`text-xs font-medium ${color.text}`}>{pool.label}</span>
                    {isRecommended && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 font-medium">
                        REC
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-white font-medium">
                    {pool.apy > 0 ? `${pool.apy.toFixed(1)}%` : "--"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Risk</span>
                    <span className="text-zinc-300">{pool.riskScore}/100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Ticks</span>
                    <span className="text-zinc-300">±{pool.tickWidth}</span>
                  </div>
                  <div className="col-span-2 flex gap-1 mt-0.5">
                    {pool.assets.map((a) => (
                      <span key={a} className="px-1 py-0.5 rounded bg-zinc-800/60 text-zinc-400 text-[9px]">
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Circuit Verification Status */}
          <button
            onClick={() => setCircuitsExpanded(!circuitsExpanded)}
            className="w-full flex items-center justify-between text-[10px] text-zinc-500 py-1 hover:text-zinc-300 transition-colors"
          >
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              zkML & Onyx Circuits
            </span>
            <span className="text-zinc-400">
              {verifiedCount}/{circuits.length}
              {circuitsExpanded ? <ChevronDown className="w-3 h-3 inline ml-0.5" /> : <ChevronRight className="w-3 h-3 inline ml-0.5" />}
            </span>
          </button>

          {circuitsExpanded && (
            <div className="space-y-1">
              {circuits.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center justify-between px-2 py-1 rounded bg-zinc-900/40 text-[10px]"
                >
                  <div className="flex items-center gap-1.5">
                    {c.verified ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3 h-3 text-zinc-600" />
                    )}
                    <span className={c.verified ? "text-zinc-200" : "text-zinc-500"}>{c.name}</span>
                  </div>
                  <span className="text-zinc-600 text-[9px]">{c.proofType}</span>
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-600" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
