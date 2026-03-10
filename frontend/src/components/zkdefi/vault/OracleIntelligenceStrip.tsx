"use client";

/**
 * OracleIntelligenceStrip — shows live AI-driven allocation signals
 * above the portfolio tab. Fetches oracle recommendation + pool APYs
 * to display the "verified AI" hero moment.
 */

import { useState, useEffect } from "react";
import { Brain, TrendingUp, ChevronRight, Activity, Shield } from "lucide-react";
import { API_BASE } from "@/lib/api/client";

interface OracleSignal {
  pool_type: string;
  reason: string;
  ekubo_apy_pct: number;
  confidence: string;
}

interface StrategyRec {
  strategy_name: string;
  allocation_pct: number;
  reasoning: string;
  confidence: string;
  genome_composite: number;
}

interface IntelligenceData {
  oracle: OracleSignal | null;
  recommendations: StrategyRec[];
  poolApys: { conservative: number; balanced: number; aggressive: number };
}

function confidenceBadge(c: string) {
  const lower = (c || "").toLowerCase();
  if (lower === "high") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (lower === "medium") return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  return "text-zinc-400 bg-zinc-500/10 border-zinc-500/20";
}

export interface OracleIntelligenceStripProps {
  address?: string;
  riskProfile?: string;
  onNavigateToOracle?: () => void;
}

export function OracleIntelligenceStrip({
  address,
  riskProfile = "balanced",
  onNavigateToOracle,
}: OracleIntelligenceStripProps) {
  const [data, setData] = useState<IntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;

    const fetchIntelligence = async () => {
      try {
        const riskTolerance = riskProfile === "conservative" ? 30 : riskProfile === "aggressive" ? 70 : 50;

        const [oracleRes, recRes, apyRes] = await Promise.allSettled([
          fetch(`${API_BASE}/v1/oracle/recommendation?risk_tolerance=${riskTolerance}`, {
            signal: AbortSignal.timeout(6000),
          }),
          fetch(`${API_BASE}/v1/strategies/recommend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_address: address || "0x0",
              risk_profile: riskProfile,
              amount: 1000,
            }),
            signal: AbortSignal.timeout(8000),
          }),
          fetch(`${API_BASE}/v1/oracle/pool-apys`, {
            signal: AbortSignal.timeout(6000),
          }),
        ]);

        if (dead) return;

        let oracle: OracleSignal | null = null;
        if (oracleRes.status === "fulfilled" && oracleRes.value.ok) {
          const d = await oracleRes.value.json();
          oracle = {
            pool_type: d.pool_type ?? "neutral",
            reason: d.reason ?? "",
            ekubo_apy_pct: d.ekubo_apy_pct ?? 0,
            confidence: d.pool_type === "aggressive" ? "high" : "medium",
          };
        }

        let recommendations: StrategyRec[] = [];
        if (recRes.status === "fulfilled" && recRes.value.ok) {
          const d = await recRes.value.json();
          const pools = d.recommended_pools ?? [];
          recommendations = pools.slice(0, 3).map((p: any) => ({
            strategy_name: p.pool_id ?? p.pair ?? "Unknown",
            allocation_pct: p.allocation_pct ?? 0,
            reasoning: p.reasoning ?? p.reason ?? "",
            confidence: d.ai_confidence ?? "medium",
            genome_composite: p.genome_score ?? 0,
          }));
        }

        let poolApys = { conservative: 0, balanced: 0, aggressive: 0 };
        if (apyRes.status === "fulfilled" && apyRes.value.ok) {
          const d = await apyRes.value.json();
          poolApys = {
            conservative: (d.conservative ?? 0) / 100,
            balanced: (d.neutral ?? 0) / 100,
            aggressive: (d.aggressive ?? 0) / 100,
          };
        }

        if (!dead) {
          setData({ oracle, recommendations, poolApys });
        }
      } catch {
        /* best-effort — strip just hides */
      } finally {
        if (!dead) setLoading(false);
      }
    };

    fetchIntelligence();
    const interval = setInterval(fetchIntelligence, 60_000);
    return () => { dead = true; clearInterval(interval); };
  }, [address, riskProfile]);

  if (loading || !data) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 animate-pulse">
        <div className="h-4 w-48 bg-zinc-800 rounded mb-2" />
        <div className="h-3 w-full bg-zinc-800 rounded" />
      </div>
    );
  }

  const { oracle, recommendations, poolApys } = data;
  const hasSignals = oracle || recommendations.length > 0;

  if (!hasSignals && poolApys.balanced === 0) return null;

  return (
    <div className="rounded-xl border border-blue-800/30 bg-gradient-to-r from-blue-950/20 via-zinc-900/50 to-zinc-900/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-zinc-100">Oracle Intelligence</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/20 bg-blue-500/10 text-blue-400">
            LIVE
          </span>
        </div>
        {onNavigateToOracle && (
          <button
            onClick={onNavigateToOracle}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Full Analysis <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Pool APY strip */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-zinc-500">Pool APYs:</span>
        <div className="flex items-center gap-1">
          <Shield className="w-3 h-3 text-blue-400" />
          <span className="text-zinc-400">Conservative</span>
          <span className="text-blue-300 font-medium">{poolApys.conservative.toFixed(1)}%</span>
        </div>
        <span className="text-zinc-700">|</span>
        <div className="flex items-center gap-1">
          <Activity className="w-3 h-3 text-emerald-400" />
          <span className="text-zinc-400">Balanced</span>
          <span className="text-emerald-300 font-medium">{poolApys.balanced.toFixed(1)}%</span>
        </div>
        <span className="text-zinc-700">|</span>
        <div className="flex items-center gap-1">
          <TrendingUp className="w-3 h-3 text-amber-400" />
          <span className="text-zinc-400">Aggressive</span>
          <span className="text-amber-300 font-medium">{poolApys.aggressive.toFixed(1)}%</span>
        </div>
      </div>

      {/* Oracle signal */}
      {oracle && oracle.reason && (
        <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-zinc-400">Oracle Signal</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confidenceBadge(oracle.confidence)}`}>
              {oracle.confidence}
            </span>
          </div>
          <p className="text-zinc-300 leading-relaxed">{oracle.reason}</p>
          {oracle.ekubo_apy_pct > 0 && (
            <p className="text-emerald-400 mt-1">
              Ekubo projected: {oracle.ekubo_apy_pct.toFixed(1)}% APY
            </p>
          )}
        </div>
      )}

      {/* AI recommendations */}
      {recommendations.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs text-zinc-500">AI Recommendations</span>
          {recommendations.map((rec, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-zinc-200 font-medium">{rec.strategy_name}</span>
                <span className={`text-[10px] px-1 py-0.5 rounded border ${confidenceBadge(rec.confidence)}`}>
                  {rec.allocation_pct}%
                </span>
              </div>
              <span className="text-zinc-500 max-w-[200px] truncate">{rec.reasoning}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
