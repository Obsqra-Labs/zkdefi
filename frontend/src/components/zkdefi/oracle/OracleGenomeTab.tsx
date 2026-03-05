"use client";

import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "@/lib/api/client";
import { DEMO_OPPORTUNITIES, DEMO_ADDRESS } from "@/lib/demoCapitalOS";
import type { OracleOpportunity } from "@/components/zkdefi/oracle/types";
import { Shield } from "lucide-react";

interface OracleGenomeTabProps {
  address: string | undefined;
}

const FACTORS = ["Yield", "Risk", "Volatility", "Liquidity", "Efficiency"] as const;

function factorValue(opp: any, factor: (typeof FACTORS)[number]): number {
  // Phase 2: Use backend-computed genome if available
  if (opp.genome_factors) {
    switch (factor) {
      case "Yield":
        return opp.genome_factors.yield_score;
      case "Risk":
        return opp.genome_factors.risk_score;
      case "Volatility":
        return opp.genome_factors.volatility_score;
      case "Liquidity":
        return opp.genome_factors.liquidity_score;
      case "Efficiency":
        return opp.genome_factors.efficiency_score;
    }
  }
  
  // Fallback to frontend computation (for demo mode)
  const apy = opp.estimated_apy_pct ?? opp.apy ?? 0;
  const risk = opp.risk_score ?? 0;
  const vol = opp.volatility ?? 30;
  const tvl = opp.tvl_usd ?? opp.tvl ?? 0;
  switch (factor) {
    case "Yield":
      return Math.min(100, apy * 5);
    case "Risk":
      return risk;
    case "Volatility":
      return Math.min(100, vol * 2);
    case "Liquidity":
      return Math.min(100, Math.log10(Math.max(1, tvl / 1000)) * 15);
    case "Efficiency":
      return Math.min(100, Math.max(0, (apy / 30) * 100 * (1 - risk / 100)));
    default:
      return 0;
  }
}

export function OracleGenomeTab({ address }: OracleGenomeTabProps) {
  const [opportunities, setOpportunities] = useState<OracleOpportunity[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isDemo = address === DEMO_ADDRESS;

  const fetchOpportunities = useCallback(async () => {
    if (isDemo) return;
    setLoading(true);
    setError(null);
    try {
      // Phase 2: Fetch from GET /strategies (backend-computed genome)
      const res = await fetch(
        `${API_BASE}/api/v1/strategies?user_profile=BALANCED&limit=20`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) throw new Error("Failed to load strategies");
      const data = await res.json();
      
      // Convert strategies to opportunity format for display
      const strategies = (data.strategies || []).map((s: any) => ({
        pair: s.pool_id,
        name: s.pool_id,
        best_venue: s.protocol,
        estimated_apy_pct: s.apy,
        risk_score: s.genome.risk_score,
        tvl_usd: s.tvl_usd,
        volume_24h_usd: s.volume_24h_usd,
        confidence: s.confidence,
        zkml_risk_score: s.zkml_risk_score,
        zkml_flags: s.zkml_flags,
        // Backend-computed genome factors (Phase 2)
        genome_factors: s.genome,
      }));
      
      setOpportunities(strategies);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setOpportunities([]);
    } finally {
      setLoading(false);
    }
  }, [address, isDemo]);

  useEffect(() => {
    if (isDemo) {
      setOpportunities(DEMO_OPPORTUNITIES);
      setLoading(false);
      setError(null);
      return;
    }
    fetchOpportunities();
  }, [isDemo, fetchOpportunities]);

  const toggleSelection = (name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name].slice(-3)
    );
  };

  const selectedOpps = opportunities.filter((o) => {
    const name = o.pair || o.name || "";
    return selected.includes(name);
  });

  if (loading && !isDemo) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8">
        <div className="flex justify-center mb-4">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-center text-zinc-400 text-sm">Loading strategies…</p>
        <div className="mt-6 h-10 rounded-lg bg-zinc-800/60 animate-pulse max-w-md mx-auto" />
      </div>
    );
  }

  if (error && !isDemo) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center">
        <p className="text-amber-400 mb-2">Could not load strategies</p>
        <p className="text-sm text-zinc-500 mb-4">{error}</p>
        <button type="button" onClick={fetchOpportunities} className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm">Retry</button>
      </div>
    );
  }

  if (!loading && !error && opportunities.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center">
        <p className="text-zinc-400 mb-2">No strategies to compare</p>
        <p className="text-sm text-zinc-500 mb-4">Load strategies first.</p>
        <button type="button" onClick={fetchOpportunities} className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Strategy selector</h3>
        <select
          className="w-full max-w-md px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white focus:border-emerald-500/50 focus:outline-none"
          value={selected[selected.length - 1] ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v) toggleSelection(v);
          }}
        >
          <option value="">Select a strategy</option>
          {opportunities.map((opp, i) => {
            const name = opp.pair || opp.name || `Strategy ${i + 1}`;
            return (
              <option key={i} value={name}>
                {name}
              </option>
            );
          })}
        </select>
        <p className="text-xs text-zinc-500 mt-2">Select one or more to compare (max 3).</p>
      </section>

      {selectedOpps.length === 0 && (
        <p className="text-zinc-500 text-sm">Select a strategy to view its genome (Yield, Risk, Volatility, Liquidity, Efficiency).</p>
      )}

      {selectedOpps.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Factor bars (0–100)</h3>
          <div className={`grid gap-6 min-w-0 ${selectedOpps.length > 1 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
            {selectedOpps.map((opp) => {
              const name = opp.pair || opp.name || "Strategy";
              return (
                <div key={name} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <p className="font-medium text-white mb-4">{name}</p>
                  <div className="space-y-3">
                    {FACTORS.map((factor) => {
                      const v = factorValue(opp, factor);
                      return (
                        <div key={factor}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-zinc-400">{factor}</span>
                            <span className="text-zinc-300">{Math.round(v)}</span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500/80 rounded-full"
                              style={{ width: `${Math.min(100, v)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* zkML Intelligence Panel */}
                  {(opp as any).zkml_risk_score !== undefined && (
                    <div className="mt-4 pt-4 border-t border-zinc-800/50 rounded-lg border border-blue-700/30 bg-blue-900/10 p-3">
                      <h4 className="text-xs font-semibold text-blue-200 mb-2 flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5" />
                        zkML Verification
                      </h4>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-400">Proof Status:</span>
                          <span className={
                            (opp as any).zkml_signals?.gates_passed === (opp as any).zkml_signals?.gates_total
                              ? "text-emerald-400"
                              : "text-amber-400"
                          }>
                            {(opp as any).zkml_signals
                              ? `${(opp as any).zkml_signals.gates_passed}/${(opp as any).zkml_signals.gates_total} gates`
                              : "Evaluator only"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-400">Risk Score:</span>
                          <span className={`font-medium ${
                            (opp as any).zkml_risk_score < 30 ? 'text-emerald-400' :
                            (opp as any).zkml_risk_score < 60 ? 'text-amber-400' :
                            'text-red-400'
                          }`}>{(opp as any).zkml_risk_score}/100</span>
                        </div>
                        {(opp as any).zkml_confidence !== undefined && (opp as any).zkml_confidence !== null && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-400">Confidence:</span>
                            <span className="text-zinc-200">
                              {((opp as any).zkml_confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}
                        {(opp as any).zkml_flags && (opp as any).zkml_flags.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-zinc-800/30">
                            <span className="text-xs text-zinc-400 block mb-1">Flags:</span>
                            <div className="space-y-0.5">
                              {(opp as any).zkml_flags.map((flag: string, fi: number) => (
                                <div key={fi} className="text-xs text-amber-400/80">
                                  • {flag.replace(/_/g, ' ')}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {(opp as any).zkml_proof_hash && (
                          <div className="mt-2 pt-2 border-t border-zinc-800/30">
                            <div className="p-1.5 rounded bg-zinc-900/50 font-mono text-xs text-zinc-500 break-all">
                              {(opp as any).zkml_proof_hash}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
