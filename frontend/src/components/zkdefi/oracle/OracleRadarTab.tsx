"use client";

import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "@/lib/api/client";
import { DEMO_OPPORTUNITIES, DEMO_ADDRESS } from "@/lib/demoCapitalOS";
import type { OracleOpportunity } from "@/components/zkdefi/oracle/types";

interface OracleRadarTabProps {
  address: string | undefined;
  onNavigateToVault?: (sub: string) => void;
}

function riskColor(score: number): string {
  if (score <= 35) return "bg-emerald-500";
  if (score <= 65) return "bg-amber-500";
  return "bg-red-500";
}

export function OracleRadarTab({ address, onNavigateToVault }: OracleRadarTabProps) {
  const [opportunities, setOpportunities] = useState<OracleOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isDemo = address === DEMO_ADDRESS;

  const fetchOpportunities = useCallback(async () => {
    if (isDemo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/strategies/opportunities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_address: address || "0x0", risk_profile: "balanced", limit: 20 }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error("Failed to load opportunities");
      const data = await res.json();
      setOpportunities(Array.isArray(data?.opportunities) ? data.opportunities : []);
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

  if (loading && !isDemo) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8">
        <div className="flex justify-center mb-4">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-center text-zinc-400 text-sm">Loading radar…</p>
        <div className="mt-6 h-64 rounded-lg bg-zinc-800/60 animate-pulse" />
      </div>
    );
  }

  if (error && !isDemo) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center">
        <p className="text-amber-400 mb-2">No opportunities right now</p>
        <p className="text-sm text-zinc-500 mb-4">{error}</p>
        <button type="button" onClick={fetchOpportunities} className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm">Retry</button>
      </div>
    );
  }

  if (!loading && !error && opportunities.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center">
        <p className="text-zinc-400 mb-2">No opportunities right now</p>
        <button type="button" onClick={fetchOpportunities} className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm">Retry</button>
      </div>
    );
  }

  const maxApy = Math.max(1, ...opportunities.map((o) => o.estimated_apy_pct ?? o.apy ?? 0));
  const maxRisk = Math.max(1, ...opportunities.map((o) => o.risk_score ?? 0));

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Opportunity map (risk vs yield)</h3>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 min-w-0">
          <div className="relative w-full min-h-[200px] h-48 sm:h-64 bg-zinc-900/80 rounded-lg">
            {opportunities.map((opp, i) => {
              const apy = opp.estimated_apy_pct ?? opp.apy ?? 0;
              const risk = opp.risk_score ?? 0;
              const left = Math.min(100, (risk / 100) * 100);
              const bottom = maxApy > 0 ? Math.min(100, (apy / maxApy) * 100) : 0;
              const size = 8 + (opp.signal_strength ?? 50) / 25;
              const name = opp.pair || opp.name || `#${i + 1}`;
              return (
                <div
                  key={i}
                  className={`absolute rounded-full ${riskColor(risk)} opacity-80 hover:opacity-100 transition-opacity cursor-pointer`}
                  style={{
                    left: `${left}%`,
                    bottom: `${bottom}%`,
                    width: size,
                    height: size,
                    transform: "translate(-50%, 50%)",
                  }}
                  title={`${name} · APY ${apy.toFixed(1)}% · Risk ${risk}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-zinc-500 mt-2">
            <span>Risk →</span>
            <span>APY ↑</span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Top opportunities</h3>
        <ul className="space-y-2">
          {opportunities.map((opp, i) => {
            const apy = opp.estimated_apy_pct ?? opp.apy ?? 0;
            const risk = opp.risk_score ?? 0;
            const name = opp.pair || opp.name || `Strategy ${i + 1}`;
            const strength = opp.signal_strength ?? 50;
            return (
              <li key={i} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-white truncate">{name}</p>
                  <div className="flex gap-3 text-xs text-zinc-500 mt-0.5">
                    <span>APY {apy.toFixed(1)}%</span>
                    <span>Risk {risk}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className={`h-full ${riskColor(risk)}`} style={{ width: `${strength}%` }} />
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateToVault?.("trade")}
                    className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 whitespace-nowrap"
                  >
                    Allocate
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
