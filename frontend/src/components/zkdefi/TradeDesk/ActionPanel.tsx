"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  TrendingUp,
  ShieldCheck,
  Lock,
  CheckCircle,
  Loader2,
  Sparkles,
  EyeOff,
  BarChart3,
  Zap,
  ExternalLink,
  Cpu,
  Workflow,
} from "lucide-react";
import type {
  UnifiedOpportunity,
  MarketContext,
  SimulationResult,
} from "@/services/TradeDeskApiService";
import { tradeDeskApi } from "@/services/TradeDeskApiService";
import { toastSuccess, toastError } from "@/lib/toast";
import { sepoliaStarkscanTxUrl } from "@/lib/explorer";

interface ActionPanelProps {
  opportunity: UnifiedOpportunity | null;
  marketContext: MarketContext | null;
  userAddress: string | null;
  opportunities?: UnifiedOpportunity[];
  onExecute: (receipt: any) => void;
  onBack?: () => void;
  onOpenSwap?: (pair?: string | null) => void;
}

function formatUsd(n: number | unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "$0.00";
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

interface AdapterChoice {
  id: string;
  label: string;
  details: string;
}

function buildAdapterChoices(opportunity: UnifiedOpportunity): AdapterChoice[] {
  const raw = opportunity.metadata?.adapters;
  const fromMetadata: AdapterChoice[] = Array.isArray(raw)
    ? raw
        .map((item, idx) => {
          if (typeof item === "string") {
            return {
              id: item,
              label: item,
              details: "Adapter route provided by opportunity metadata",
            };
          }
          if (item && typeof item === "object") {
            const maybe = item as Record<string, unknown>;
            const id = String(maybe.id ?? maybe.adapter_id ?? `route-${idx + 1}`);
            const label = String(maybe.label ?? maybe.name ?? id);
            const details = String(
              maybe.description ?? maybe.route ?? "Adapter route provided by metadata",
            );
            return { id, label, details };
          }
          return null;
        })
        .filter((x): x is AdapterChoice => Boolean(x))
    : [];

  if (fromMetadata.length > 0) {
    return fromMetadata;
  }

  return [
    {
      id: opportunity.calldataBuilder ?? `${opportunity.protocol.toLowerCase()}-default`,
      label: `${opportunity.protocol} / ${opportunity.executionMode}`,
      details: opportunity.calldataBuilder
        ? `Calldata builder: ${opportunity.calldataBuilder}`
        : "Default route for this opportunity",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Market overview (no opportunity selected)                          */
/* ------------------------------------------------------------------ */

function MarketOverview({
  ctx,
  topOpps,
  onOpenSwap,
}: {
  ctx: MarketContext | null;
  topOpps: UnifiedOpportunity[];
  onOpenSwap?: (pair?: string | null) => void;
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
              {Number(ctx?.stakingApy).toFixed(1)}%
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
                  {Number(o.currentYield).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
          {onOpenSwap && (
            <button
              onClick={() => onOpenSwap(topOpps.find((o) => o.type === "swap")?.pair ?? null)}
              className="w-full mt-2 py-2 rounded text-xs font-medium bg-cyan-700 hover:bg-cyan-600 transition-colors"
            >
              Open Swap Console
            </button>
          )}
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
          <div className="font-medium text-emerald-400">{Number(sim.estimatedYield).toFixed(2)}%</div>
        </div>
        <div>
          <span className="text-slate-500">Price Impact</span>
          <div className="font-medium text-amber-400">{Number(sim.priceImpact).toFixed(3)}%</div>
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
  onBack,
  onOpenSwap,
}: {
  opportunity: UnifiedOpportunity;
  userAddress: string | null;
  onExecute: (receipt: any) => void;
  onBack?: () => void;
  onOpenSwap?: (pair?: string | null) => void;
}) {
  const { account } = useAccount();
  const [amount, setAmount] = useState<string>("");
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [mode, setMode] = useState<"manual" | "advisory" | "terminal">("manual");
  const [slippageBps, setSlippageBps] = useState<number>(50);
  const [privacyMode, setPrivacyMode] = useState<UnifiedOpportunity["privacyLevel"]>(
    opportunity.privacyLevel,
  );
  const adapterChoices = useMemo(() => buildAdapterChoices(opportunity), [opportunity]);
  const [selectedAdapter, setSelectedAdapter] = useState<string>(adapterChoices[0]?.id ?? "");

  useEffect(() => {
    setMode("manual");
    setSimulation(null);
    setError(null);
    setTxHash(null);
    setSlippageBps(50);
    setPrivacyMode(opportunity.privacyLevel);
    setSelectedAdapter(adapterChoices[0]?.id ?? "");
  }, [opportunity.id, opportunity.privacyLevel, adapterChoices]);

  const activeAdapter = useMemo(
    () => adapterChoices.find((a) => a.id === selectedAdapter) ?? adapterChoices[0],
    [adapterChoices, selectedAdapter],
  );

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
    if (!account || !userAddress || !amount) return;
    setExecuting(true);
    setError(null);
    setTxHash(null);
    try {
      // 1. Get prepared calldata from backend
      const prepared = await tradeDeskApi.prepare({
        opportunityId: opportunity.id,
        amount: parseFloat(amount),
        params: {
          adapter_id: selectedAdapter || undefined,
          slippage_bps: slippageBps,
          privacy_mode: privacyMode,
          execution_mode: mode,
        },
        userAddress,
      });

      const contractAddress = (prepared as any).contractAddress as string;
      const calldata = ((prepared as any).calldata as string[]).map((c: string) => c);
      const entryPoint = (prepared as any).entryPoint as string;

      if (!contractAddress || !calldata.length) {
        throw new Error("Backend returned empty calldata — execution not supported for this opportunity yet");
      }

      // 2. Execute via wallet
      const calls: { contractAddress: string; entrypoint: string; calldata: string[] }[] = [
        { contractAddress, entrypoint: entryPoint, calldata },
      ];

      const result = await account.execute(calls);
      const hash = result.transaction_hash;
      setTxHash(hash);

      toastSuccess("Transaction submitted!", {
        action: {
          label: "View on Starkscan",
          onClick: () => window.open(sepoliaStarkscanTxUrl(hash), "_blank"),
        },
      });

      onExecute({ txHash: hash, type: opportunity.type, pair: opportunity.pair, amount: parseFloat(amount) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Execution failed";
      setError(msg);
      toastError(msg);
    } finally {
      setExecuting(false);
    }
  }, [
    account,
    opportunity.id,
    opportunity.type,
    opportunity.pair,
    amount,
    selectedAdapter,
    slippageBps,
    privacyMode,
    mode,
    userAddress,
    onExecute,
  ]);

  const isLocked = opportunity.gating?.status === "locked" || opportunity.gating?.status === "proof_required";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="p-1.5 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors"
                aria-label="Back to workspace"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-slate-300" />
              </button>
            )}
          </div>
          {opportunity.type === "swap" && onOpenSwap && (
            <button
              onClick={() => onOpenSwap(opportunity.pair)}
              className="px-2.5 py-1 rounded text-[11px] font-medium bg-cyan-700 hover:bg-cyan-600 transition-colors"
            >
              Open Swap Console
            </button>
          )}
        </div>
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
          <div className="text-lg font-bold text-emerald-400">{Number(opportunity.currentYield).toFixed(1)}%</div>
        </div>
        <div className="px-3 py-2 bg-slate-800 rounded border border-slate-700">
          <div className="text-slate-500">Risk Score</div>
          <div className="text-lg font-bold">{Number(opportunity.riskScore)}</div>
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

      {/* Adapter route */}
      <div className="space-y-2 rounded border border-slate-700 bg-slate-800/60 px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          Adapter Route
        </div>
        {adapterChoices.length > 1 ? (
          <select
            value={selectedAdapter}
            onChange={(e) => setSelectedAdapter(e.target.value)}
            className="w-full rounded border border-slate-600 bg-slate-900 px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            {adapterChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-xs text-slate-200 font-medium">{activeAdapter?.label}</div>
        )}
        <div className="text-[11px] text-slate-400">{activeAdapter?.details}</div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-700">
          <div>
            <span className="text-slate-500">Execution mode:</span>{" "}
            <span className="text-slate-300">{opportunity.executionMode}</span>
          </div>
          <div>
            <span className="text-slate-500">Builder:</span>{" "}
            <span className="text-slate-300">{opportunity.calldataBuilder ?? "default"}</span>
          </div>
        </div>
      </div>

      {/* Execution mode toggle */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-slate-800 rounded border border-slate-700 text-xs">
        {(["manual", "advisory", "terminal"] as const).map((nextMode) => (
          <button
            key={nextMode}
            onClick={() => setMode(nextMode)}
            className={`py-1.5 rounded font-medium transition-colors ${
              mode === nextMode ? "bg-slate-700 text-cyan-300" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {nextMode === "manual" && "Manual"}
            {nextMode === "advisory" && "Advisory"}
            {nextMode === "terminal" && "Terminal"}
          </button>
        ))}
      </div>

      {mode === "advisory" && (
        <div className="rounded border border-cyan-800 bg-cyan-900/20 px-3 py-2 text-xs text-cyan-200">
          {opportunity.aiNarrative ?? "Advisory mode uses AI signal confidence and risk predictions for guidance."}
        </div>
      )}

      {mode === "terminal" && (
        <div className="rounded border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 flex items-start gap-2">
          <Workflow className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>Terminal mode keeps this route policy-aware and execution-automated once enabled.</span>
        </div>
      )}

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
            <span>Yield pred: {Number(opportunity.signal?.yieldPrediction).toFixed(1)}%</span>
            <span>Risk pred: {Number(opportunity.signal?.riskPrediction).toFixed(0)}</span>
            <span>Confidence: {Math.round(Number(opportunity.signal?.confidence) * 100)}%</span>
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
          {txHash ? (
            <div className="flex flex-col items-center gap-2 py-4">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
              <span className="text-sm font-semibold text-emerald-400">Transaction Submitted</span>
              <a
                href={sepoliaStarkscanTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
              >
                View on Starkscan <ExternalLink className="w-3 h-3" />
              </a>
              <p className="text-[10px] text-slate-500 font-mono break-all">{txHash}</p>
              <button
                onClick={() => { setTxHash(null); setAmount(""); setSimulation(null); }}
                className="mt-1 px-3 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 transition-colors"
              >
                New Transaction
              </button>
            </div>
          ) : (
            <>
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

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Slippage (bps)</label>
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    step="1"
                    value={slippageBps}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      setSlippageBps(Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 5000)) : 50);
                      setSimulation(null);
                    }}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm focus:border-cyan-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">~ {(slippageBps / 100).toFixed(2)}%</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Privacy Mode</label>
                  <select
                    value={privacyMode}
                    onChange={(e) => setPrivacyMode(e.target.value as UnifiedOpportunity["privacyLevel"])}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="public">Public</option>
                    <option value="shielded">Shielded</option>
                    <option value="fully_private">Fully Private</option>
                  </select>
                </div>
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
                  disabled={!amount || !account || !userAddress || executing || isLocked}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {executing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  {!account ? "Connect Wallet" : "Execute"}
                </button>
              </div>

              {error && (
                <div className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-800">
                  {error}
                </div>
              )}
            </>
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
  opportunities = [],
  onExecute,
  onBack,
  onOpenSwap,
}: ActionPanelProps) {
  const topOpps = opportunities.slice(0, 8);

  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-900 rounded-lg border border-slate-700 flex flex-col">
      <div className="mb-3 pb-2 border-b border-slate-700">
        <h2 className="text-sm font-semibold text-slate-200">
          {opportunity ? "Execution Workspace" : "Market Workspace"}
        </h2>
      </div>
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
              onBack={onBack}
              onOpenSwap={onOpenSwap}
            />
          </motion.div>
        ) : (
          <motion.div
            key="market-overview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <MarketOverview
              ctx={marketContext}
              topOpps={topOpps}
              onOpenSwap={onOpenSwap}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
