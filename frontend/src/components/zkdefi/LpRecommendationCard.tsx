"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, ChevronRight, RefreshCw, Sparkles, TrendingUp } from "lucide-react";
import { getLpRecommendation } from "@/lib/api/ekubo";
import { LpRecommendationResponse, LpRecommendationPool, RiskProfile } from "@/types/ekubo";
import { feeTierLabel as sharedFeeTierLabel } from "@/lib/tokens";

interface LpRecommendationCardProps {
  userAddress: string;
  onApplyRecommendation?: (pool: LpRecommendationPool) => void;
  /** Shared risk profile from parent context bar. When set, hides local selector. */
  riskProfile?: "conservative" | "balanced" | "neutral" | "aggressive";
}

function formatCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}

export function LpRecommendationCard({ userAddress, onApplyRecommendation, riskProfile: sharedRisk }: LpRecommendationCardProps) {
  const [recommendation, setRecommendation] = useState<LpRecommendationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Map "balanced" → "neutral" for ekubo API
  const mapRisk = (r: string | undefined): RiskProfile => {
    if (r === "balanced") return "neutral";
    if (r === "conservative" || r === "neutral" || r === "aggressive") return r;
    return "neutral";
  };
  const [riskProfile, setRiskProfile] = useState<RiskProfile>(mapRisk(sharedRisk));
  const [expanded, setExpanded] = useState(false);

  // Sync from shared prop
  useEffect(() => {
    if (sharedRisk) {
      const mapped = mapRisk(sharedRisk);
      setRiskProfile(mapped);
    }
  }, [sharedRisk]);

  const fetchRecommendation = useCallback(async (profile?: RiskProfile) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLpRecommendation(userAddress, profile ?? riskProfile);
      setRecommendation(data);
      if (data.recommendations.length > 0) setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get recommendation");
    } finally {
      setLoading(false);
    }
  }, [userAddress, riskProfile]);

  useEffect(() => {
    void fetchRecommendation();
  }, [fetchRecommendation]);

  const handleProfileChange = (profile: RiskProfile) => {
    setRiskProfile(profile);
    void fetchRecommendation(profile);
  };

  const feeTierLabel = sharedFeeTierLabel;

  return (
    <div className="glass rounded-xl border border-violet-800/30 bg-gradient-to-br from-violet-950/20 to-zinc-900/50 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-violet-900/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
            <Brain className="w-4 h-4 text-violet-400" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              AI LP Recommendation
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            </h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              {recommendation?.portfolio_context || "Analyzing your portfolio..."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw className="w-3.5 h-3.5 text-violet-400 animate-spin" />}
          <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-violet-800/20">
          {/* Risk profile selector — hidden when controlled by parent context bar */}
          {!sharedRisk && (
          <div className="flex items-center gap-2 pt-3">
            <span className="text-[10px] text-zinc-500 mr-1">Risk:</span>
            {(["conservative", "neutral", "aggressive"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleProfileChange(p)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                  riskProfile === p
                    ? "bg-violet-600/20 text-violet-300 border-violet-500/40"
                    : "bg-zinc-800/50 text-zinc-500 border-zinc-700/50 hover:text-zinc-400"
                }`}
              >
                {p === "conservative" ? "🛡️ Safe" : p === "neutral" ? "⚖️ Balanced" : "🔥 Max Yield"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void fetchRecommendation()}
              disabled={loading}
              className="ml-auto text-zinc-600 hover:text-zinc-400 disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Summary */}
          {recommendation && recommendation.summary && (
            <div className="rounded-lg border border-violet-800/20 bg-violet-950/10 p-3">
              <p className="text-xs text-zinc-300 leading-relaxed">{recommendation.summary}</p>
            </div>
          )}

          {/* Recommendations */}
          {recommendation?.recommendations.map((rec, i) => (
            <div
              key={`${rec.pair}-${i}`}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-mono font-semibold text-zinc-100">{rec.pair}</span>
                  {i === 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-600/20 text-violet-300 border border-violet-500/30 font-medium">
                      Top Pick
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-sm font-mono text-emerald-400 font-bold">
                    {rec.estimated_apy_pct.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-zinc-500 ml-1">APY</span>
                </div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span className="text-zinc-500">Deposit</span>
                  <p className="text-zinc-200 font-mono mt-0.5">
                    {rec.suggested_amount0_human} {rec.token0_symbol}
                  </p>
                  <p className="text-zinc-200 font-mono">
                    {rec.suggested_amount1_human} {rec.token1_symbol}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-500">Pool TVL</span>
                  <p className="text-zinc-200 font-mono mt-0.5">${formatCompact(rec.tvl_usd)}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Fee Tier</span>
                  <p className="text-zinc-200 font-mono mt-0.5">{feeTierLabel(rec.fee_tier)}</p>
                </div>
              </div>

              {/* Reasoning */}
              <p className="text-[10px] text-zinc-500 leading-relaxed">{rec.reasoning}</p>

              {/* Apply button */}
              {onApplyRecommendation && (
                <button
                  type="button"
                  onClick={() => onApplyRecommendation(rec)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Use This Recommendation
                </button>
              )}
            </div>
          ))}

          {recommendation && recommendation.recommendations.length === 0 && !error && (
            <div className="text-center py-4">
              <p className="text-sm text-zinc-500">No matching pools for your wallet tokens.</p>
              <p className="text-[10px] text-zinc-600 mt-1">Try swapping to get both sides of a pair first.</p>
            </div>
          )}

          {/* Model / source transparency */}
          {recommendation && (
            <div className="flex items-center justify-end gap-1.5 pt-2 pb-1 text-[10px] text-zinc-500">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500/50" />
              {recommendation.model
                ? <>generated by <span className="text-violet-400 font-mono">{recommendation.model}</span></>
                : <>powered by <span className="text-violet-400 font-mono">{recommendation.source ?? "deterministic engine"}</span></>
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}
