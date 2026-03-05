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

function factorValue(opp: OracleOpportunity, factor: (typeof FACTORS)[number]): number {
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
      const res = await fetch(`${API_BASE}/api/v1/strategies/opportunities`, {
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
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
