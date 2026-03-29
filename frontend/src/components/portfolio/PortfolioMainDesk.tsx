"use client";

import type { ReactNode } from "react";
import { Bot } from "lucide-react";

import { AIRecommendationCard } from "./AIRecommendationCard";
import { ExecutionPlanCard } from "./ExecutionPlanCard";
import { formatPercent, formatUsd } from "./formatters";
import { PrimaryActionTray } from "./PrimaryActionTray";
import { SafetyDrawer } from "./SafetyDrawer";
import { TargetEditor } from "./TargetEditor";
import type { ConstraintResult, GateResult, SupportedAsset, SwapStep } from "./types";

type RecommendationData = {
  drift_monitor?: {
    explanation?: string;
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

type PreparedCallPreview = {
  step: SwapStep;
  execution_adapter?: string;
  route?: string[];
};

type RebalancePreset = {
  id: string;
  label: string;
  allocations: Record<SupportedAsset, number>;
};

type GateGuardResult = {
  passed: boolean;
  warning?: boolean;
  reason: string;
  estimated_fee_usd?: number;
  fee_share_pct?: number;
};

function StatusPill({
  tone,
  children,
}: {
  tone: "good" | "neutral" | "warning";
  children: ReactNode;
}) {
  const className =
    tone === "good"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
        : "border-zinc-700 bg-zinc-950 text-zinc-300";
  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${className}`}>
      {children}
    </span>
  );
}

type Props = {
  checking: boolean;
  executing: boolean;
  actionType: "swap" | "rebalance";
  showRecommendationCard: boolean;
  recommendation: RecommendationData | null;
  recommendationNotice: string | null;
  proposalHeadline: string;
  proposalReason: string;
  aiExecutionPreview: { steps: SwapStep[]; total: number } | null;
  onSetActionType: (value: "swap" | "rebalance") => void;
  onGetRecommendation: () => void;
  onApplyAiTargets: () => void;
  onRunAiGateCheck: () => void;
  proposalSourceLabel: string;
  swapAssetIn: SupportedAsset;
  swapAssetOut: SupportedAsset;
  onSwapAssetInChange: (asset: SupportedAsset) => void;
  onSwapAssetOutChange: (asset: SupportedAsset) => void;
  swapAmount: string;
  onSwapAmountChange: (value: string) => void;
  onSwapAmountPercent: (percent: number) => void;
  swapAmountPercent: number;
  swapAvailableAmount: number;
  swapAvailableUsd: number;
  minSwapAmount: number;
  isBelowMinSwap: boolean;
  slippageBps: string;
  onSlippageChange: (value: string) => void;
  assetSummary: Record<SupportedAsset, { amount: number; valueUsd: number }>;
  currentAllocations: Record<SupportedAsset, number>;
  userTargetAllocations: Record<SupportedAsset, number>;
  aiTargetAllocations: Record<SupportedAsset, number> | null;
  rebalancePresets: RebalancePreset[];
  onApplyPreset: (allocations: Record<SupportedAsset, number>) => void;
  targetWeights: Record<SupportedAsset, string>;
  onTargetChange: (asset: SupportedAsset, value: string) => void;
  targetWeightSum: number;
  gateResult: GateResult | null;
  safetySummaryLine: string;
  deskTone: "good" | "neutral" | "warning";
  deskLabel: string;
  deskHeadline: string;
  deskDetail: string;
  feeGuardResult: GateGuardResult | null;
  gasReserveResult: GateGuardResult | null;
  showSafetyDetails: boolean;
  onToggleSafetyDetails: () => void;
  onRunGateCheck: () => void;
  onPrimaryAction: () => void;
  primaryActionDisabled: boolean;
  primaryActionLabel: string;
  hasFreshGateCheck: boolean;
  pendingWalletCalls: unknown[] | null;
  walletMismatch: boolean;
  walletLabel: string;
  proposalOutdated: boolean;
  executionNote: string | null;
  executionLink?: string | null;
  passedGateCount: number;
  failedGateConstraints: ConstraintResult[];
  warningGateConstraints: ConstraintResult[];
  showFullGateMatrix: boolean;
  onToggleFullMatrix: () => void;
  pendingPreparedCalls: PreparedCallPreview[] | null;
  pendingRouteLabel: string | null;
  lastPreparedAdapter: string | null;
  fromWei: (amountWei: number, asset: SupportedAsset) => number;
  suggestedSwapFallback: {
    label: string;
    detail: string;
  } | null;
  overridePrimaryAction: boolean;
  onUseSuggestedSwap: () => void;
};

export function PortfolioMainDesk(props: Props) {
  const {
    checking,
    executing,
    actionType,
    showRecommendationCard,
    recommendation,
    recommendationNotice,
    proposalHeadline,
    proposalReason,
    aiExecutionPreview,
    onSetActionType,
    onGetRecommendation,
    onApplyAiTargets,
    onRunAiGateCheck,
    proposalSourceLabel,
    swapAssetIn,
    swapAssetOut,
    onSwapAssetInChange,
    onSwapAssetOutChange,
    swapAmount,
    onSwapAmountChange,
    onSwapAmountPercent,
    swapAmountPercent,
    swapAvailableAmount,
    swapAvailableUsd,
    minSwapAmount,
    isBelowMinSwap,
    slippageBps,
    onSlippageChange,
    assetSummary,
    currentAllocations,
    userTargetAllocations,
    aiTargetAllocations,
    rebalancePresets,
    onApplyPreset,
    targetWeights,
    onTargetChange,
    targetWeightSum,
    gateResult,
    safetySummaryLine,
    deskTone,
    deskLabel,
    deskHeadline,
    deskDetail,
    feeGuardResult,
    gasReserveResult,
    showSafetyDetails,
    onToggleSafetyDetails,
    onRunGateCheck,
    onPrimaryAction,
    primaryActionDisabled,
    primaryActionLabel,
    hasFreshGateCheck,
    pendingWalletCalls,
    walletMismatch,
    walletLabel,
    proposalOutdated,
    executionNote,
    executionLink,
    passedGateCount,
    failedGateConstraints,
    warningGateConstraints,
    showFullGateMatrix,
    onToggleFullMatrix,
    pendingPreparedCalls,
    pendingRouteLabel,
    lastPreparedAdapter,
    fromWei,
    suggestedSwapFallback,
    overridePrimaryAction,
    onUseSuggestedSwap,
  } = props;

  const actionValueUsd = gateResult?.swap_steps?.reduce((sum, step) => sum + (Number(step.value_usd) || 0), 0) ?? 0;
  const estimatedFeeUsd = feeGuardResult?.estimated_fee_usd ?? gateResult?.estimated_cost_usd ?? 0;
  const feeSharePct =
    typeof feeGuardResult?.fee_share_pct === "number"
      ? feeGuardResult.fee_share_pct
      : actionValueUsd > 0
        ? (estimatedFeeUsd / actionValueUsd) * 100
        : null;
  const minimumNormalMoveUsd = estimatedFeeUsd > 0 ? estimatedFeeUsd / 0.35 : null;
  const minimumFeeGateMoveUsd = estimatedFeeUsd > 0 ? estimatedFeeUsd / 0.85 : null;
  const draftGuidance =
    actionType !== "rebalance" || !gateResult
      ? null
      : gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed."
        ? {
            tone: "warning" as const,
            title: "Leave more STRK unspent",
            body: "This draft sells too much STRK relative to the fee reserve. Trim the STRK sale or shift the rebalance into one clearer move.",
          }
        : feeGuardResult && !feeGuardResult.passed
          ? {
              tone: "warning" as const,
              title: "Aim for one stronger move",
              body: `The current draft moves ${formatUsd(actionValueUsd)} across ${gateResult?.swap_steps.length ?? 0} trade${gateResult?.swap_steps.length === 1 ? "" : "s"}. At the current fee estimate, this needs a larger move before wallet review makes sense.`,
              stats: [
                { label: "Current move", value: formatUsd(actionValueUsd) },
                ...(minimumFeeGateMoveUsd
                  ? [{ label: "Clears fee gate", value: formatUsd(minimumFeeGateMoveUsd) }]
                  : []),
                ...(minimumNormalMoveUsd
                  ? [{ label: "Normal fee band", value: formatUsd(minimumNormalMoveUsd) }]
                  : []),
              ],
            }
          : feeGuardResult?.warning
            ? {
                tone: "neutral" as const,
                title: "This clears, but size still matters",
                body: "The draft is signable, but the fee is still high for the amount moved. Keeping the target focused on the biggest gap will usually feel better in wallet.",
                stats: [
                  { label: "Current move", value: formatUsd(actionValueUsd) },
                  ...(minimumNormalMoveUsd
                    ? [{ label: "Normal fee band", value: formatUsd(minimumNormalMoveUsd) }]
                    : []),
                  ...(feeSharePct != null
                    ? [{ label: "Current fee share", value: `${Math.round(feeSharePct)}%` }]
                    : []),
                ],
              }
            : {
                tone: "good" as const,
                title: "Target shape looks signable",
                body: "The current draft is concentrated enough to route without obvious small-size friction.",
                stats: [
                  { label: "Current move", value: formatUsd(actionValueUsd) },
                  ...(feeSharePct != null ? [{ label: "Current fee share", value: `${Math.round(feeSharePct)}%` }] : []),
                ],
              };
  const economicsHelper =
    gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed."
      ? "Keep more STRK free for fees before selling it."
      : feeGuardResult && !feeGuardResult.passed
        ? "Increase the amount moved or simplify the draft so fees are a smaller share of value."
        : feeGuardResult?.warning
          ? "The draft is signable, but the fee is still high for the size."
          : "The fee profile is in a normal range for the current draft.";
  const decisiveChecks = [
    ...failedGateConstraints.map((item) => ({ title: item.name, reason: item.reason, tone: "blocked" as const })),
    ...warningGateConstraints.map((item) => ({ title: item.name, reason: item.reason, tone: "warning" as const })),
  ].slice(0, 4);
  const gateHero = (() => {
    if (executionLink) {
      return {
        eyebrow: "Gate passed",
        title: "Execution submitted",
        summary: "The Gate cleared this draft and the wallet submission is already out on Starknet.",
        tone: "good" as const,
      };
    }
    if (proposalOutdated) {
      return {
        eyebrow: "Recheck needed",
        title: "Target edits invalidated the prior Gate result",
        summary: "The previous review is stale. Any meaningful target change now requires a fresh Gate decision.",
        tone: "warning" as const,
      };
    }
    if (!gateResult) {
      return {
        eyebrow: "Gate pending",
        title: "The Gate has not evaluated this draft yet",
        summary: "Shape the target and the desk will trigger a fresh review before anything reaches wallet signing.",
        tone: "neutral" as const,
      };
    }
    if (!gateResult.allowed) {
      return {
        eyebrow: "Gate blocked execution",
        title: "Execution is not currently permitted",
        summary: `${failedGateConstraints.length} blocking check${failedGateConstraints.length === 1 ? "" : "s"} must clear before signing can proceed.`,
        tone: "warning" as const,
      };
    }
    if (warningGateConstraints.length) {
      return {
        eyebrow: "Gate passed with review",
        title: "Execution is permitted with warnings",
        summary: `${warningGateConstraints.length} warning${warningGateConstraints.length === 1 ? "" : "s"} remain, but the Gate still allows this path.`,
        tone: "neutral" as const,
      };
    }
    return {
      eyebrow: "Gate passed",
      title: "Execution permitted",
      summary: "The Gate cleared liquidity, policy, and execution conditions for this draft.",
      tone: "good" as const,
    };
  })();
  const gateConfidence =
    !gateResult ? "Pending" : failedGateConstraints.length ? "Low" : warningGateConstraints.length >= 4 ? "Measured" : "High";
  const currentLeader = (Object.entries(currentAllocations) as Array<[SupportedAsset, number]>).sort((a, b) => b[1] - a[1])[0];
  const targetLeader = (Object.entries(userTargetAllocations) as Array<[SupportedAsset, number]>).sort((a, b) => b[1] - a[1])[0];
  const impactCards = [
    {
      label: "Concentration",
      current: currentLeader ? `${currentLeader[0]} ${formatPercent(currentLeader[1], 0)}` : "n/a",
      projected: targetLeader ? `${targetLeader[0]} ${formatPercent(targetLeader[1], 0)}` : "n/a",
      delta: currentLeader && targetLeader ? `${targetLeader[0] === currentLeader[0] ? "holds" : "shifts"} leadership` : "pending",
      body: "Largest allocation before and after applying the current target.",
    },
    {
      label: "Liquidity path",
      current: `${gateResult?.swap_steps.length ?? 0} trade${(gateResult?.swap_steps.length ?? 0) === 1 ? "" : "s"}`,
      projected: pendingPreparedCalls?.length ? "Prepared for wallet" : pendingRouteLabel?.toUpperCase() ?? lastPreparedAdapter?.toUpperCase() ?? "Best route",
      delta: gateResult?.allowed ? "Executable" : "Needs review",
      body: "How much routing complexity the Gate sees on this draft.",
    },
    {
      label: "Network cost",
      current: formatUsd(estimatedFeeUsd),
      projected: feeSharePct == null ? "n/a" : `${Math.round(feeSharePct)}% fee share`,
      delta: feeGuardResult?.passed ? (feeGuardResult.warning ? "Expensive" : "Normal") : "Pressured",
      body: "Estimated fee and how much of the moved value it consumes.",
    },
  ];

  return (
    <section className="space-y-4">
      <section
        className={`overflow-hidden rounded-[28px] border p-5 shadow-[0_28px_80px_rgba(0,0,0,0.34)] ${
          gateHero.tone === "good"
            ? "border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),rgba(9,9,11,0.92)_45%)]"
            : gateHero.tone === "warning"
              ? "border-amber-500/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),rgba(9,9,11,0.92)_45%)]"
              : "border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),rgba(9,9,11,0.92)_45%)]"
        }`}
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">Gate</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">{gateHero.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-200/88">{gateHero.summary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusPill tone={gateHero.tone}>{gateHero.eyebrow}</StatusPill>
                <StatusPill tone={deskTone}>{deskLabel}</StatusPill>
                <span className="rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
                  Confidence {gateConfidence}
                </span>
                <span className="rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
                  {gateResult ? formatUsd(gateResult.estimated_cost_usd) : "Awaiting"} network cost
                </span>
              </div>
            </div>

            <div className="w-full rounded-[24px] border border-zinc-800/80 bg-zinc-950/60 p-4 xl:w-[360px]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Gate snapshot</p>
                  <p className="mt-1 text-sm font-medium text-white">What the Gate saw on this exact draft</p>
                </div>
                <span className="rounded-full border border-zinc-700/80 bg-zinc-950/80 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
                  {gateResult?.swap_steps.length ?? 0} trade{(gateResult?.swap_steps.length ?? 0) === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: "Passed", value: passedGateCount, tone: "text-emerald-200" },
                  { label: "Warnings", value: warningGateConstraints.length, tone: "text-cyan-200" },
                  { label: "Blockers", value: failedGateConstraints.length, tone: "text-amber-200" },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-zinc-800 bg-zinc-950/75 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{item.label}</p>
                    <p className={`mt-1.5 text-lg font-semibold ${item.tone}`}>{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/75 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Value moved</p>
                  <p className="mt-1.5 text-base font-semibold text-white">{formatUsd(actionValueUsd)}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/75 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Confidence</p>
                  <p className="mt-1.5 text-base font-semibold text-white">{gateConfidence}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/55 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Model proposal</p>
                  <p className="mt-1 text-base font-medium text-white">{proposalHeadline}</p>
                </div>
                <Bot className="h-5 w-5 text-amber-300" />
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-300">{proposalReason}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Before → after</p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {currentLeader ? `${currentLeader[0]} ${formatPercent(currentLeader[1], 0)}` : "n/a"} →{" "}
                    {targetLeader ? `${targetLeader[0]} ${formatPercent(targetLeader[1], 0)}` : "n/a"}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Expected shift</p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {recommendation?.drift_monitor?.largest_gap_asset ?? "ETH"}{" "}
                    {formatPercent(recommendation?.drift_monitor?.largest_gap_pct ?? 0, 0)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Turnover {formatPercent(recommendation?.drift_monitor?.total_turnover_pct ?? 0, 0)}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/55 p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Why the Gate decided this</p>
              <div className="mt-3 grid gap-1.5">
                {decisiveChecks.length ? (
                  decisiveChecks.map((item) => (
                    <div key={`${item.tone}-${item.title}`} className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-1 h-2.5 w-2.5 rounded-full ${
                            item.tone === "blocked" ? "bg-amber-400" : "bg-cyan-400"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-white">{item.title}</p>
                            <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                              {item.tone === "blocked" ? "Blocker" : "Warning"}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs leading-5 text-zinc-400">{item.reason}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">
                    The Gate cleared the current draft without active blockers or warnings.
                  </div>
                )}
              </div>
            </div>
          </div>

          <PrimaryActionTray
            checking={checking}
            executing={executing}
            showSafetyDetails={showSafetyDetails}
            onToggleSafetyDetails={onToggleSafetyDetails}
            onRunGateCheck={onRunGateCheck}
            onPrimaryAction={onPrimaryAction}
            primaryActionDisabled={primaryActionDisabled}
            primaryActionLabel={primaryActionLabel}
            hasFreshGateCheck={hasFreshGateCheck}
            actionType={actionType}
            pendingWalletCalls={pendingWalletCalls}
            tone={deskTone}
            label={deskLabel}
            walletMismatch={walletMismatch}
            walletLabel={walletLabel}
            proposalOutdated={proposalOutdated}
            executionNote={executionNote}
            executionLink={executionLink}
            overridePrimaryAction={overridePrimaryAction}
          />
        </div>
      </section>

      {showRecommendationCard ? (
        <AIRecommendationCard
          checking={checking}
          executing={executing}
          actionType={actionType}
          recommendation={recommendation}
          recommendationNotice={recommendationNotice}
          proposalHeadline={proposalHeadline}
          proposalReason={proposalReason}
          aiExecutionPreview={aiExecutionPreview}
          onSetActionType={onSetActionType}
          onGetRecommendation={onGetRecommendation}
          onApplyAiTargets={onApplyAiTargets}
          onRunAiGateCheck={onRunAiGateCheck}
        />
      ) : null}

        <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Target editor</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Shape the proposal</h2>
              {(feeGuardResult || (gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed.")) && (
                <p className="mt-1.5 text-sm text-zinc-400">{economicsHelper}</p>
              )}
            </div>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
              {proposalSourceLabel}
            </span>
          </div>

        <TargetEditor
          actionType={actionType}
          swapAssetIn={swapAssetIn}
          swapAssetOut={swapAssetOut}
          onSwapAssetInChange={onSwapAssetInChange}
          onSwapAssetOutChange={onSwapAssetOutChange}
          swapAmount={swapAmount}
          onSwapAmountChange={onSwapAmountChange}
          onSwapAmountPercent={onSwapAmountPercent}
          swapAmountPercent={swapAmountPercent}
          swapAvailableAmount={swapAvailableAmount}
          swapAvailableUsd={swapAvailableUsd}
          minSwapAmount={minSwapAmount}
          isBelowMinSwap={isBelowMinSwap}
          slippageBps={slippageBps}
          onSlippageChange={onSlippageChange}
          assetSummary={assetSummary}
          currentAllocations={currentAllocations}
          userTargetAllocations={userTargetAllocations}
          aiTargetAllocations={aiTargetAllocations}
          rebalancePresets={rebalancePresets}
          onApplyPreset={onApplyPreset}
          targetWeights={targetWeights}
          onTargetChange={onTargetChange}
          targetWeightSum={targetWeightSum}
          draftGuidance={draftGuidance}
          suggestedSwapFallback={suggestedSwapFallback}
          onUseSuggestedSwap={onUseSuggestedSwap}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.06fr_0.94fr] xl:items-start">
        <ExecutionPlanCard
          actionType={actionType}
          gateSwapSteps={gateResult?.swap_steps ?? []}
          pendingPreparedCalls={pendingPreparedCalls}
          pendingRouteLabel={pendingRouteLabel}
          lastPreparedAdapter={lastPreparedAdapter}
          fromWei={fromWei}
        />

        <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Impact</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Expected portfolio impact</h2>
            </div>
            <p className="text-xs text-zinc-500">A compact read of the before-and-after effect on this wallet.</p>
          </div>

          <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
            {impactCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-zinc-800 bg-zinc-900/55 p-3.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{card.label}</p>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-500">Current</span>
                  <span className="font-medium text-zinc-100">{card.current}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-500">Projected</span>
                  <span className="font-medium text-white">{card.projected}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-500">Delta</span>
                  <span className="font-medium text-cyan-200">{card.delta}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-400">{card.body}</p>
              </div>
            ))}
          </div>

          {(feeGuardResult || (gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed.")) ? (
            <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
              {feeGuardResult ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5 py-2.5">
                  <p className="text-sm font-medium text-white">
                    {feeGuardResult.passed
                      ? feeGuardResult.warning
                        ? "Safe, but expensive for size"
                        : "Safe to sign"
                      : "Too small to execute efficiently"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">{feeGuardResult.reason}</p>
                </div>
              ) : null}
              {gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed." ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5 py-2.5">
                  <p className="text-sm font-medium text-white">Insufficient STRK for fee</p>
                  <p className="mt-1 text-xs text-zinc-400">{gasReserveResult.reason}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {gateResult ? (
        <SafetyDrawer
          gateResult={gateResult}
          passedGateCount={passedGateCount}
          failedGateConstraints={failedGateConstraints}
          warningGateConstraints={warningGateConstraints}
          showFullGateMatrix={showFullGateMatrix}
          onToggleFullMatrix={onToggleFullMatrix}
        />
      ) : null}

    </section>
  );
}
