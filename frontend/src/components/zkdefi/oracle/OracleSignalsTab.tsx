"use client";

import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "@/lib/api/client";
import { DEMO_OPPORTUNITIES, DEMO_RECOMMENDATIONS, DEMO_ADDRESS } from "@/lib/demoCapitalOS";
import type { OracleOpportunity, OracleRecommendation } from "@/components/zkdefi/oracle/types";

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
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-zinc-400">Loading signals…</p>
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
