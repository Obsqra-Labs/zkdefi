"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { ShieldCheck, SlidersHorizontal, CheckCircle2 } from "lucide-react";
import { useOpportunities } from "@/hooks/useOpportunities";
import { OpportunityExplorer } from "@/components/zkdefi/TradeDesk/OpportunityExplorer";
import type { UnifiedOpportunity } from "@/services/TradeDeskApiService";
import type { SignalForExecution } from "@/components/zkdefi/mission-control/SignalExecutionDrawer";

interface MarketsTabProps {
  onDeploy?: (signal: SignalForExecution) => void;
}

export function MarketsTab({ onDeploy }: MarketsTabProps) {
  const { opportunities, loading, error } = useOpportunities(50);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planAmount, setPlanAmount] = useState(250);
  const [slippageBps, setSlippageBps] = useState(50);
  const [executionWindow, setExecutionWindow] = useState("24h");

  const selectedOpportunity = useMemo(
    () => opportunities.find((opp) => opp.id === selectedId) ?? null,
    [opportunities, selectedId],
  );

  const targetPlan = useMemo(() => {
    const top = [...opportunities]
      .sort((a, b) => Number(b.currentYield) - Number(a.currentYield))
      .slice(0, 3);
    const totalYield = top.reduce((sum, opp) => sum + Math.max(0, Number(opp.currentYield)), 0);

    return top.map((opp, idx) => {
      const weight = totalYield > 0 ? Math.round((Number(opp.currentYield) / totalYield) * 100) : Math.max(10, 40 - idx * 10);
      return {
        opp,
        weight,
        amount: Math.round((planAmount * weight) / 100),
      };
    });
  }, [opportunities, planAmount]);

  useEffect(() => {
    if (selectedId || opportunities.length === 0) return;
    const recommended = opportunities.find((opp) => opp.recommended);
    setSelectedId((recommended ?? opportunities[0]).id);
  }, [opportunities, selectedId]);

  const handleSelect = useCallback(
    (opp: UnifiedOpportunity) => {
      setSelectedId(opp.id);
    },
    [],
  );

  const pushToExecution = useCallback(() => {
    if (!onDeploy || !selectedOpportunity) return;
    onDeploy({
      id: selectedOpportunity.id,
      name: selectedOpportunity.title ?? `${selectedOpportunity.type} ${selectedOpportunity.pair}`,
      type: selectedOpportunity.type,
      venue: selectedOpportunity.protocol,
      currentYield: selectedOpportunity.currentYield,
      apy_bps: Math.round((selectedOpportunity.currentYield ?? 0) * 100),
      riskScore: selectedOpportunity.riskScore,
      signal_reason: selectedOpportunity.aiNarrative ?? "Plan-approved action",
    });
  }, [onDeploy, selectedOpportunity]);

  if (error && opportunities.length === 0) {
    return (
      <div className="h-full p-3 flex items-center justify-center">
        <p className="text-[11px] text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 p-3">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-100">Plan Builder</h3>
            <p className="mt-1 text-[11px] text-zinc-500">
              Review one plan, approve one action path, then send it to execution.
            </p>
          </div>
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400">
            {targetPlan.length} actions
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Recommended Action Stack</div>
            <div className="mb-2 space-y-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
              <div className="text-xs uppercase tracking-wider text-zinc-500">Target Allocation</div>
              {targetPlan.length === 0 ? (
                <p className="text-xs text-zinc-500">No opportunities available.</p>
              ) : (
                targetPlan.map(({ opp, weight }) => (
                  <div key={opp.id} className="flex items-center justify-between text-xs">
                    <span className="truncate text-zinc-300">{opp.title || opp.pair}</span>
                    <span className="font-medium text-cyan-300">{weight}%</span>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-1.5">
              {targetPlan.map(({ opp, amount }, index) => (
                <div key={opp.id} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
                  <div className="text-zinc-200">Step {index + 1}: {opp.title || opp.pair}</div>
                  <div className="mt-1 text-zinc-500">
                    ${amount.toLocaleString()} notional · {Number(opp.currentYield).toFixed(1)}% APY · risk {Number(opp.riskScore).toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
            <div className="mb-2 inline-flex items-center gap-1.5 text-zinc-200">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Rationale and Gating
            </div>
            <p className="text-zinc-400">{selectedOpportunity?.aiNarrative || "Select an opportunity to inspect AI rationale and constraints."}</p>
            {selectedOpportunity?.gating && (
              <p className="mt-2 text-zinc-500">
                Gate: {selectedOpportunity.gating.status} {selectedOpportunity.gating.reason ? `- ${selectedOpportunity.gating.reason}` : ""}
              </p>
            )}

            <div className="mt-3 border-t border-zinc-800 pt-3">
              <div className="mb-2 inline-flex items-center gap-1.5 text-zinc-200">
                <SlidersHorizontal className="h-3.5 w-3.5 text-amber-400" />
                Approve / Edit Controls
              </div>
              <div className="space-y-2 text-zinc-400">
                <label className="block">
                  <span>Total plan amount: ${planAmount}</span>
                  <input
                    type="range"
                    min={50}
                    max={5000}
                    step={50}
                    value={planAmount}
                    onChange={(e) => setPlanAmount(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>
                <label className="block">
                  <span>Slippage ({slippageBps} bps)</span>
                  <input
                    type="range"
                    min={10}
                    max={200}
                    step={5}
                    value={slippageBps}
                    onChange={(e) => setSlippageBps(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block">Execution window</span>
                  <select
                    value={executionWindow}
                    onChange={(e) => setExecutionWindow(e.target.value)}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200"
                  >
                    <option value="1h">1h</option>
                    <option value="24h">24h</option>
                    <option value="7d">7d</option>
                  </select>
                </label>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={pushToExecution}
                    disabled={!selectedOpportunity || !onDeploy}
                    className="inline-flex items-center gap-2 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 font-medium text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Approve and Open Execution
                  </button>
                </div>
            </div>
          </div>
          </div>
        </div>
      </section>

      <div className="h-[520px]">
        <OpportunityExplorer
          opportunities={opportunities}
          selectedId={selectedId}
          onSelect={handleSelect}
          loading={loading}
        />
      </div>
    </div>
  );
}
