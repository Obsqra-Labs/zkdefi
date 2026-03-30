"use client";

import { useState } from "react";
import { Bot, ChevronDown } from "lucide-react";

import { formatPercent, formatUsd } from "./formatters";
import type { SupportedAsset, SwapStep } from "./types";

type RecommendationCardData = {
  drift_monitor?: {
    largest_gap_asset?: SupportedAsset;
    largest_gap_pct?: number;
    total_turnover_pct?: number;
  } | null;
  estimated_swap_count?: number;
  target_allocations?: Partial<Record<SupportedAsset, number>> | null;
  rebalance_summary?: {
    top_changes?: Array<{
      asset: SupportedAsset;
      delta_pct: number;
    }>;
  } | null;
};

type Props = {
  checking: boolean;
  executing: boolean;
  actionType: "swap" | "rebalance";
  recommendation: RecommendationCardData | null;
  recommendationNotice: string | null;
  proposalHeadline: string;
  proposalReason: string;
  aiExecutionPreview: { steps: SwapStep[]; total: number } | null;
  onSetActionType: (value: "swap" | "rebalance") => void;
  onGetRecommendation: () => void;
  onApplyAiTargets: () => void;
  onRunAiGateCheck: () => void;
};

export function AIRecommendationCard({
  checking,
  executing,
  actionType,
  recommendation,
  recommendationNotice,
  proposalHeadline,
  proposalReason,
  aiExecutionPreview,
  onSetActionType,
  onGetRecommendation,
  onApplyAiTargets,
  onRunAiGateCheck,
}: Props) {
  const hasRecommendation = Boolean(recommendation);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">System recommendation</p>
          <h2 className="mt-1 text-lg font-semibold text-white">What the model proposes</h2>
          <p className="mt-1.5 text-sm text-zinc-400">
            Keep your target in control. Use the model as a second opinion.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-zinc-700/80 bg-zinc-950/80 p-1">
            {(["rebalance", "swap"] as const).map((type) => (
              <button
                key={type}
                onClick={() => onSetActionType(type)}
                className={`rounded-full px-3.5 py-1.5 text-[11px] uppercase tracking-[0.2em] ${
                  actionType === type
                    ? "bg-emerald-500 text-zinc-950"
                    : "text-zinc-400 transition-colors duration-200 hover:text-zinc-200"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
          <button
            onClick={onGetRecommendation}
            disabled={checking || executing}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] text-zinc-300 transition-colors duration-200 hover:border-amber-400/50 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Bot className={`h-3.5 w-3.5 ${checking ? "animate-pulse" : ""}`} />
            {hasRecommendation ? "Refresh model" : "Get model view"}
          </button>
        </div>
      </div>

      {hasRecommendation ? (
        <div className="mt-4 rounded-[22px] border border-amber-500/20 bg-[linear-gradient(180deg,rgba(245,158,11,0.14),rgba(24,24,27,0.2))] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl">
              <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">Rebalance suggested</p>
              <p className="mt-1.5 text-lg font-medium text-white">{proposalHeadline}</p>
              <p className="mt-1.5 text-sm leading-5 text-zinc-200/85">{proposalReason}</p>
            </div>
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-200">
              Recommendation ready
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/45 px-3.5 py-3">
            <div className="flex flex-wrap gap-2">
              {recommendation?.drift_monitor ? (
                <>
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-[11px] text-zinc-300">
                    Largest gap {recommendation.drift_monitor.largest_gap_asset ?? "ETH"}{" "}
                    {formatPercent(recommendation.drift_monitor.largest_gap_pct ?? 0, 1)}
                  </span>
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-[11px] text-zinc-300">
                    Turnover {formatPercent(recommendation.drift_monitor.total_turnover_pct ?? 0, 0)}
                  </span>
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-[11px] text-zinc-300">
                    {recommendation?.estimated_swap_count ?? 0} trades
                  </span>
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onApplyAiTargets}
                className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] text-amber-100 transition-colors duration-200 hover:border-amber-300 hover:bg-amber-400/10"
              >
                Use suggested target
              </button>
              <button
                onClick={onRunAiGateCheck}
                className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] text-amber-100 transition-colors duration-200 hover:border-amber-300 hover:bg-amber-400/10"
              >
                Check suggested plan
              </button>
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] text-zinc-300 transition-colors duration-200 hover:border-zinc-500 hover:text-zinc-100"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
                {expanded ? "Hide details" : "Show details"}
              </button>
            </div>
          </div>

          <div
            className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
              expanded ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Suggested mix</p>
                      <p className="mt-1 text-sm text-zinc-400">The suggested target stays separate until you apply it.</p>
                    </div>
                    <span className="text-[11px] text-zinc-500">Target</span>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => {
                      const value = recommendation?.target_allocations?.[asset] ?? 0;
                      return (
                        <div key={`ai-target-${asset}`} className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-white">{asset}</span>
                            <span className="text-zinc-300">{formatPercent(value, 0)}</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-900">
                            <div className="h-full rounded-full bg-amber-400/80 transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Top changes</p>
                      <span className="text-[11px] text-zinc-500">Delta</span>
                    </div>
                    <div className="mt-2.5 space-y-1.5">
                      {(recommendation?.rebalance_summary?.top_changes ?? []).length ? (
                        (recommendation?.rebalance_summary?.top_changes ?? []).slice(0, 4).map((change) => (
                          <div key={`summary-${change.asset}`} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/75 px-3 py-2 text-xs">
                            <span className="text-zinc-100">{change.asset}</span>
                            <span className="text-zinc-400">
                              {change.delta_pct > 0 ? "+" : ""}
                              {formatPercent(change.delta_pct, 0)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-zinc-500">No major delta summary yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Likely trade path</p>
                      <span className="text-[11px] text-zinc-500">Spot route</span>
                    </div>
                    {aiExecutionPreview?.steps.length ? (
                      <div className="mt-2.5 space-y-1.5">
                        {(aiExecutionPreview.steps ?? []).slice(0, 3).map((step, index) => (
                          <div key={`${step.from_asset}-${step.to_asset}-${index}-ai`} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/75 px-3 py-2 text-xs">
                            <span className="text-zinc-100">
                              {step.from_asset} → {step.to_asset}
                            </span>
                            <span className="text-zinc-400">{formatUsd(step.value_usd)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2.5 text-xs text-zinc-500">No spot path prepared yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-[22px] border border-zinc-800 bg-zinc-900/55 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Model target unavailable</p>
              <p className="mt-1.5 text-base font-medium text-white">
                {recommendationNotice ? "Model recommendation is unavailable right now" : "Suggested target is optional"}
              </p>
              <p className="mt-1.5 text-sm leading-5 text-zinc-400">
                {recommendationNotice ??
                  "You can keep building your own target. When the recommendation service is ready, it will appear here without changing your inputs."}
              </p>
            </div>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-300">
              No recommendation yet
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
