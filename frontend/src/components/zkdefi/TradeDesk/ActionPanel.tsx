"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  ShieldCheck,
  Lock,
  CheckCircle,
  Loader2,
  Sparkles,
  EyeOff,
  BarChart3,
  Zap,
} from "lucide-react";
import type {
  UnifiedOpportunity,
  MarketContext,
  SimulationResult,
} from "@/services/TradeDeskApiService";
import { tradeDeskApi } from "@/services/TradeDeskApiService";

interface ActionPanelProps {
  opportunity: UnifiedOpportunity | null;
  marketContext: MarketContext | null;
  userAddress: string | null;
  onExecute: (receipt: any) => void;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/* Market overview (no opportunity selected)                          */
/* ------------------------------------------------------------------ */

function MarketOverview({
  ctx,
  topOpps,
}: {
  ctx: MarketContext | null;
  topOpps: UnifiedOpportunity[];
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        Market Overview
      </h3>

      {ctx && (
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(ctx.prices).map(([token, price]) => (
            <div
              key={token}
              className="px-3 py-2 bg-slate-800 rounded border border-slate-700"
            >
              <div className="text-[10px] text-slate-500 uppercase">{token}</div>
              <div className="text-sm font-semibold">{formatUsd(price)}</div>
            </div>
          ))}
          <div className="px-3 py-2 bg-slate-800 rounded border border-slate-700">
            <div className="text-[10px] text-slate-500">Staking APY</div>
            <div className="text-sm font-semibold text-emerald-400">
              {ctx.stakingApy.toFixed(1)}%
            </div>
          </div>
          <div className="px-3 py-2 bg-slate-800 rounded border border-slate-700">
            <div className="text-[10px] text-slate-500">Network</div>
            <div className="text-sm font-semibold capitalize">{ctx.network}</div>
          </div>
        </div>
      )}

      {topOpps.length > 0 && (
        <>
          <h4 className="text-xs font-semibold text-slate-400 mt-4">Top Opportunities</h4>
          <div className="space-y-2">
            {topOpps.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between px-3 py-2 bg-slate-800 rounded border border-slate-700 text-xs"
              >
                <div>
                  <span className="font-medium">{o.pair}</span>
                  <span className="text-slate-500 ml-1.5">{o.protocol}</span>
                </div>
                <span className="font-semibold text-emerald-400">
                  {o.currentYield.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {!ctx && (
        <div className="text-slate-500 text-sm text-center py-6">
          Loading market data...
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gating status indicator                                            */
/* ------------------------------------------------------------------ */

function GatingStatus({ gating }: { gating: UnifiedOpportunity["gating"] }) {
  if (!gating) return null;
  const cfg: Record<string, { icon: typeof Lock; color: string; bg: string }> = {
    locked: { icon: Lock, color: "text-red-400", bg: "bg-red-900/20 border-red-800" },
    proof_required: { icon: Lock, color: "text-red-400", bg: "bg-red-900/20 border-red-800" },
    advisory: { icon: ShieldCheck, color: "text-amber-400", bg: "bg-amber-900/20 border-amber-800" },
    unlocked: { icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-900/20 border-emerald-800" },
  };
  const c = cfg[gating.status] ?? cfg.unlocked;
  const Icon = c.icon;

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded border text-xs ${c.bg}`}>
      <Icon className={`w-3.5 h-3.5 ${c.color}`} />
      <span className="capitalize font-medium">{gating.status}</span>
      {gating.reason && <span className="text-slate-400">— {gating.reason}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Impact preview (simulation results)                                */
/* ------------------------------------------------------------------ */

function ImpactPreview({ sim }: { sim: SimulationResult }) {
  return (
    <div className="space-y-2 p-3 bg-slate-800 rounded border border-slate-700">
      <h4 className="text-xs font-semibold text-slate-300">Simulation Result</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-slate-500">Est. Yield</span>
          <div className="font-medium text-emerald-400">{sim.estimatedYield.toFixed(2)}%</div>
        </div>
        <div>
          <span className="text-slate-500">Price Impact</span>
          <div className="font-medium text-amber-400">{sim.priceImpact.toFixed(3)}%</div>
        </div>
        <div>
          <span className="text-slate-500">Gas</span>
          <div className="font-medium">{formatUsd(sim.gasEstimate)}</div>
        </div>
        <div>
          <span className="text-slate-500">Fees</span>
          <div className="font-medium">{formatUsd(sim.fees)}</div>
        </div>
      </div>
      <div className="pt-2 border-t border-slate-700 flex justify-between text-xs">
        <span className="text-slate-400">Net Result</span>
        <span className={`font-semibold ${sim.netResult >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {sim.netResult >= 0 ? "+" : ""}
          {formatUsd(sim.netResult)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Opportunity detail + execution controls                            */
/* ------------------------------------------------------------------ */

function OpportunityDetail({
  opportunity,
  userAddress,
  onExecute,
}: {
  opportunity: UnifiedOpportunity;
  userAddress: string | null;
  onExecute: (receipt: any) => void;
}) {
  const [amount, setAmount] = useState<string>("");
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSimulate = useCallback(async () => {
    if (!userAddress || !amount) return;
    setSimulating(true);
    setError(null);
    try {
      const result = await tradeDeskApi.simulate({
        opportunityId: opportunity.id,
        amount: parseFloat(amount),
        userAddress,
      });
      setSimulation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimulating(false);
    }
  }, [opportunity.id, amount, userAddress]);

  const handleExecute = useCallback(async () => {
    if (!userAddress || !amount) return;
    setExecuting(true);
    setError(null);
    try {
      const prepared = await tradeDeskApi.prepare({
        opportunityId: opportunity.id,
        amount: parseFloat(amount),
        params: {},
        userAddress,
      });
      onExecute(prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  }, [opportunity.id, amount, userAddress, onExecute]);

  const isLocked = opportunity.gating?.status === "locked" || opportunity.gating?.status === "proof_required";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">{opportunity.pair}</h3>
          <span className="text-xs text-slate-400">{opportunity.protocol}</span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5 capitalize">{opportunity.type}</div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="px-3 py-2 bg-slate-800 rounded border border-slate-700">
          <div className="text-slate-500">Current Yield</div>
          <div className="text-lg font-bold text-emerald-400">{opportunity.currentYield.toFixed(1)}%</div>
        </div>
        <div className="px-3 py-2 bg-slate-800 rounded border border-slate-700">
          <div className="text-slate-500">Risk Score</div>
          <div className="text-lg font-bold">{opportunity.riskScore}</div>
        </div>
        <div className="px-3 py-2 bg-slate-800 rounded border border-slate-700">
          <div className="text-slate-500">TVL</div>
          <div className="font-semibold">{formatUsd(opportunity.tvlUsd)}</div>
        </div>
        <div className="px-3 py-2 bg-slate-800 rounded border border-slate-700">
          <div className="text-slate-500">24h Volume</div>
          <div className="font-semibold">{formatUsd(opportunity.volume24h)}</div>
        </div>
      </div>

      {/* Privacy level */}
      {opportunity.privacyLevel !== "public" && (
        <div className="flex items-center gap-2 px-3 py-2 bg-violet-900/20 rounded border border-violet-800 text-xs">
          <EyeOff className="w-3.5 h-3.5 text-violet-400" />
          <span className="capitalize text-violet-300">{opportunity.privacyLevel}</span>
        </div>
      )}

      {/* AI Signal */}
      {opportunity.signal && (
        <div className="px-3 py-2 bg-cyan-900/20 rounded border border-cyan-800 text-xs space-y-1">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-medium text-cyan-300">AI Signal</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-slate-300">
            <span>Yield pred: {opportunity.signal.yieldPrediction.toFixed(1)}%</span>
            <span>Risk pred: {opportunity.signal.riskPrediction.toFixed(0)}</span>
            <span>Confidence: {Math.round(opportunity.signal.confidence * 100)}%</span>
            <span>{opportunity.signal.recommended ? "Recommended" : "Not recommended"}</span>
          </div>
          {opportunity.aiNarrative && (
            <p className="text-slate-400 text-[11px] leading-snug mt-1">{opportunity.aiNarrative}</p>
          )}
        </div>
      )}

      {/* Gating */}
      <GatingStatus gating={opportunity.gating} />

      {/* Execution controls */}
      {!isLocked && (
        <div className="space-y-3 pt-2 border-t border-slate-700">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setSimulation(null);
              }}
              placeholder="0.00"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSimulate}
              disabled={!amount || !userAddress || simulating}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {simulating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <TrendingUp className="w-3.5 h-3.5" />
              )}
              Simulate
            </button>
            <button
              onClick={handleExecute}
              disabled={!amount || !userAddress || executing || isLocked}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {executing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              Execute
            </button>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-800">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Simulation result */}
      <AnimatePresence>
        {simulation && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <ImpactPreview sim={simulation} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main ActionPanel                                                   */
/* ------------------------------------------------------------------ */

export function ActionPanel({
  opportunity,
  marketContext,
  userAddress,
  onExecute,
}: ActionPanelProps) {
  const topOpps: UnifiedOpportunity[] = [];

  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-900 rounded-lg border border-slate-700">
      <AnimatePresence mode="wait">
        {opportunity ? (
          <motion.div
            key={`detail-${opportunity.id}`}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
          >
            <OpportunityDetail
              opportunity={opportunity}
              userAddress={userAddress}
              onExecute={onExecute}
            />
          </motion.div>
        ) : (
          <motion.div
            key="market-overview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <MarketOverview ctx={marketContext} topOpps={topOpps} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
