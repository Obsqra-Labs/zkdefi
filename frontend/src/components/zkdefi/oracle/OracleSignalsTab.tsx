"use client";

import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "@/lib/api/client";
import { DEMO_OPPORTUNITIES, DEMO_RECOMMENDATIONS, DEMO_ADDRESS } from "@/lib/demoCapitalOS";
import type { OracleOpportunity, OracleRecommendation } from "@/components/zkdefi/oracle/types";
import { Check, AlertTriangle, Shield } from "lucide-react";

interface OracleSignalsTabProps {
  address: string | undefined;
}

function yieldTrend(apy: number): "Growing" | "Stable" | "Surging" | "Declining" {
  if (apy >= 25) return "Surging";
  if (apy >= 15) return "Growing";
  if (apy >= 5) return "Stable";
  return "Declining";
}

function riskLabel(score: number): "Safe" | "Warning" | "Elevated" {
  if (score <= 35) return "Safe";
  if (score <= 65) return "Warning";
  return "Elevated";
}

function volLabel(vol?: number): "Low" | "Moderate" | "High" {
  const v = vol ?? 0;
  if (v <= 20) return "Low";
  if (v <= 50) return "Moderate";
  return "High";
}

export function OracleSignalsTab({ address }: OracleSignalsTabProps) {
  const [opportunities, setOpportunities] = useState<OracleOpportunity[]>([]);
  const [recommendations, setRecommendations] = useState<OracleRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isDemo = address === DEMO_ADDRESS;

  const fetchOpportunities = useCallback(async () => {
    if (isDemo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/strategies/opportunities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address || "0x0",
          risk_profile: "balanced",
          limit: 20,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error("Failed to load opportunities");
      const data = await res.json();
      const opps = Array.isArray(data?.opportunities) ? data.opportunities : [];
      setOpportunities(opps);
      const recs: OracleRecommendation[] = [];
      if (opps.length >= 1) {
        const top = opps[0];
        const name = top?.pair || top?.name || "Top strategy";
        recs.push({ label: `Allocate 12% to ${name}`, strategyName: name, allocationPct: 12 });
      }
      if (opps.length >= 2) {
        recs.push({ label: `Diversify with ${opps[1]?.pair ?? "second opportunity"}`, allocationPct: 8 });
      }
      setRecommendations(recs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setOpportunities([]);
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, [address, isDemo]);

  useEffect(() => {
    if (isDemo) {
      setOpportunities(DEMO_OPPORTUNITIES);
      setRecommendations(DEMO_RECOMMENDATIONS);
      setLoading(false);
      setError(null);
      return;
    }
    fetchOpportunities();
  }, [isDemo, fetchOpportunities]);

  if (loading && !isDemo) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8">
        <div className="flex justify-center mb-4">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-center text-zinc-400 text-sm">Loading signals…</p>
        <div className="mt-6 space-y-3 max-w-md mx-auto">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-zinc-800/60 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !isDemo) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center">
        <p className="text-amber-400 mb-2">No opportunities right now</p>
        <p className="text-sm text-zinc-500 mb-4">{error}</p>
        <button type="button" onClick={fetchOpportunities} className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm">
          Retry
        </button>
      </div>
    );
  }

  if (!loading && !error && opportunities.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center">
        <p className="text-zinc-400 mb-2">No opportunities right now</p>
        <button type="button" onClick={fetchOpportunities} className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Signal stream</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {opportunities.map((opp, i) => {
            const apy = opp.estimated_apy_pct ?? opp.apy ?? 0;
            const risk = opp.risk_score ?? 0;
            const name = opp.pair || opp.name || opp.best_venue || `Strategy ${i + 1}`;
            return (
              <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-white">{name}</span>
                  <span className="text-xs text-emerald-400">{yieldTrend(apy)}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="text-zinc-500">Vol: {volLabel(opp.volatility)}</span>
                  <span className="text-zinc-500">Risk: {riskLabel(risk)}</span>
                  <span className="text-zinc-500">{opp.proof_status ?? (opp.confidence === "high" ? "Verified" : "Experimental")}</span>
                </div>
                <p className="text-xs text-zinc-500 mt-2">APY {apy.toFixed(1)}% · Risk {risk}</p>
                
                {/* zkML Intelligence Display */}
                {(opp as any).zkml_risk_score !== undefined && (
                  <div className="mt-3 pt-3 border-t border-zinc-800/50">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="w-3 h-3 text-blue-400" />
                      <span className="text-xs font-medium text-blue-300">zkML Analysis</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Risk Score:</span>
                        <span className={`font-medium ${
                          (opp as any).zkml_risk_score < 30 ? 'text-emerald-400' :
                          (opp as any).zkml_risk_score < 60 ? 'text-amber-400' :
                          'text-red-400'
                        }`}>{(opp as any).zkml_risk_score}/100</span>
                      </div>
                      {(opp as any).zkml_flags && (opp as any).zkml_flags.length > 0 && (
                        <div className="flex items-start gap-1.5 text-xs mt-1">
                          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                          <div className="flex-1 space-y-0.5">
                            {(opp as any).zkml_flags.map((flag: string, fi: number) => (
                              <div key={fi} className="text-zinc-500">{flag.replace(/_/g, ' ')}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(opp as any).zkml_signals && (
                        <details className="mt-2">
                          <summary className="text-xs text-blue-400 cursor-pointer hover:text-blue-300">
                            Circuit Details
                          </summary>
                          <div className="mt-2 pl-2 space-y-1 text-xs text-zinc-400">
                            <div className="flex items-center gap-2">
                              <span className={(opp as any).zkml_signals.il_acceptable ? "text-emerald-400" : "text-red-400"}>
                                {(opp as any).zkml_signals.il_acceptable ? "✓" : "✗"}
                              </span>
                              <span>IL: {(opp as any).zkml_signals.il_acceptable ? "Acceptable" : "High risk"}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={(opp as any).zkml_signals.yield_near_optimal ? "text-emerald-400" : "text-amber-400"}>
                                {(opp as any).zkml_signals.yield_near_optimal ? "✓" : "~"}
                              </span>
                              <span>Yield: {(opp as any).zkml_signals.yield_near_optimal ? "Near optimal" : "Suboptimal"}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={(opp as any).zkml_signals.slippage_ok ? "text-emerald-400" : "text-red-400"}>
                                {(opp as any).zkml_signals.slippage_ok ? "✓" : "✗"}
                              </span>
                              <span>Slippage: {(opp as any).zkml_signals.slippage_ok ? "Within bounds" : "High"}</span>
                            </div>
                            {(opp as any).zkml_proof_hash && (
                              <div className="mt-2 pt-2 border-t border-zinc-800/30">
                                <span className="text-zinc-600">Proof: {(opp as any).zkml_proof_hash.slice(0, 12)}...</span>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Recommended actions</h3>
        <ul className="space-y-2">
          {recommendations.map((rec, i) => (
            <li key={i} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
              <span className="text-zinc-200">{rec.label}</span>
              <div className="flex gap-2">
                <button type="button" className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30">Approve</button>
                <button type="button" className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600">Modify</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Model transparency</h3>
        <p className="text-xs text-zinc-500">Yield Forecast, Anomaly Detector — Model hashes available after proof run.</p>
      </section>
    </div>
  );
}
