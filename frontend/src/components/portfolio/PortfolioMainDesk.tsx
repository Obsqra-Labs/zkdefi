"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

import { formatAssetAmount, formatPercent, formatUsd } from "./formatters";
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

function SectionCard({
  eyebrow,
  title,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
        </div>
        {actions}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function MixBar({
  label,
  allocations,
  emphasis,
}: {
  label: string;
  allocations: Record<SupportedAsset, number>;
  emphasis: "current" | "target";
}) {
  return (
    <div className={`rounded-2xl border px-3.5 py-3 ${emphasis === "target" ? "border-cyan-500/20 bg-cyan-500/5" : "border-zinc-800 bg-zinc-900/55"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[11px] uppercase tracking-[0.18em] ${emphasis === "target" ? "text-cyan-200" : "text-zinc-400"}`}>
          {label}
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
          {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
            <span key={`${label}-${asset}`}>
              {asset} {formatPercent(allocations[asset] ?? 0, 0)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-zinc-950">
        {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
          <div
            key={`${label}-${asset}-segment`}
            className={
              asset === "ETH"
                ? "bg-cyan-400"
                : asset === "STRK"
                  ? "bg-amber-400"
                  : "bg-emerald-400"
            }
            style={{ width: `${Math.max(0, Math.min(100, allocations[asset] ?? 0))}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function DetailToggle({
  open,
  onToggle,
  showLabel,
  hideLabel,
}: {
  open: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
    >
      <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      {open ? hideLabel : showLabel}
    </button>
  );
}

function PlanStep({
  index,
  title,
  meta,
  value,
}: {
  index: number;
  title: string;
  meta: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-[10px] text-zinc-400">
            {index}
          </span>
          <div>
            <p className="text-sm font-medium text-white">{title}</p>
            <p className="mt-1 text-xs text-zinc-500">{meta}</p>
          </div>
        </div>
        <span className="text-sm text-zinc-300">{value}</span>
      </div>
    </div>
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
  proposalRouteLabel: string | null;
  proposalRouteDetail: string | null;
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
    proposalRouteLabel,
    proposalRouteDetail,
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

  const [showEditor, setShowEditor] = useState(false);
  const [showProposalDetails, setShowProposalDetails] = useState(false);
  const [showDecisionDetails, setShowDecisionDetails] = useState(false);

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
                ...(minimumFeeGateMoveUsd ? [{ label: "Clears fee gate", value: formatUsd(minimumFeeGateMoveUsd) }] : []),
                ...(minimumNormalMoveUsd ? [{ label: "Normal fee band", value: formatUsd(minimumNormalMoveUsd) }] : []),
              ],
            }
          : feeGuardResult?.warning
            ? {
                tone: "neutral" as const,
                title: "This clears, but size still matters",
                body: "The draft is signable, but the fee is still high for the amount moved. Keeping the target focused on the biggest gap will usually feel better in wallet.",
                stats: [
                  { label: "Current move", value: formatUsd(actionValueUsd) },
                  ...(minimumNormalMoveUsd ? [{ label: "Normal fee band", value: formatUsd(minimumNormalMoveUsd) }] : []),
                  ...(feeSharePct != null ? [{ label: "Current fee share", value: `${Math.round(feeSharePct)}%` }] : []),
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
        summary: "The last review is stale. Edit freely, then run a fresh Gate decision before signing.",
        tone: "warning" as const,
      };
    }
    if (!gateResult) {
      return {
        eyebrow: "Gate pending",
        title: "The Gate has not evaluated this draft yet",
        summary: "Shape the proposal first. The desk will re-check before anything reaches wallet signing.",
        tone: "neutral" as const,
      };
    }
    if (!gateResult.allowed) {
      return {
        eyebrow: overridePrimaryAction ? "Gate permits execution with fee warning" : "Gate blocked execution",
        title: overridePrimaryAction ? "Execution is permitted with a fee warning" : "Execution is not currently permitted",
        summary: overridePrimaryAction
          ? "The only failed check is fee efficiency. You can still prepare the wallet route and judge the cost yourself."
          : `${failedGateConstraints.length} blocking check${failedGateConstraints.length === 1 ? "" : "s"} must clear before signing can proceed.`,
        tone: "warning" as const,
      };
    }
    if (warningGateConstraints.length) {
      return {
        eyebrow: "Gate passed with warnings",
        title: "Execution is permitted",
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
  const proposalDeltas = (["ETH", "STRK", "USDC"] as SupportedAsset[])
    .map((asset) => ({ asset, delta: (userTargetAllocations[asset] ?? 0) - (currentAllocations[asset] ?? 0) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  const activeSteps = pendingPreparedCalls?.length ? pendingPreparedCalls.map((item) => item.step) : gateResult?.swap_steps ?? [];
  const routeLabel = (pendingRouteLabel ?? lastPreparedAdapter)?.toUpperCase() ?? "BEST ROUTE";
  const leadPlanStep = activeSteps[0] ?? null;
  const gateRefreshing = checking || proposalOutdated;
  const economicsTitle = feeGuardResult
    ? feeGuardResult.passed
      ? feeGuardResult.warning
        ? "Safe, but expensive for size"
        : "Safe to sign"
      : overridePrimaryAction
        ? "Permitted with fee warning"
        : "Too small to execute efficiently"
    : gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed."
      ? "Insufficient STRK for fee"
      : "Pending gate review";
  const economicsReason = feeGuardResult?.reason ??
    (gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed."
      ? gasReserveResult.reason
      : "Run the Gate to inspect route quality, costs, and reserve preservation.");

  const impactCards = [
    {
      label: "Concentration",
      value: currentLeader && targetLeader ? `${currentLeader[0]} → ${targetLeader[0]}` : "Pending",
      body: currentLeader && targetLeader
        ? `${formatPercent(currentLeader[1], 0)} largest weight becomes ${formatPercent(targetLeader[1], 0)} after the current draft.`
        : "Largest wallet weight updates after the current proposal is applied.",
    },
    {
      label: "Liquidity path",
      value: `${activeSteps.length} trade${activeSteps.length === 1 ? "" : "s"}`,
      body: pendingPreparedCalls?.length
        ? "Wallet calls are already prepared for this exact path."
        : gateResult
          ? "The Gate has translated this proposal into executable spot steps."
          : "No executable path is available until the Gate evaluates the current draft.",
    },
    {
      label: "Network cost",
      value: feeSharePct == null ? formatUsd(estimatedFeeUsd) : `${Math.round(feeSharePct)}%`,
      body:
        feeSharePct == null
          ? "Estimated network cost for the current proposal."
          : `${formatUsd(estimatedFeeUsd)} estimated fee on ${formatUsd(actionValueUsd)} moved value.`,
    },
  ];

  return (
    <section className="space-y-4">
      <section
        className={`overflow-hidden rounded-[28px] border p-5 shadow-[0_28px_80px_rgba(0,0,0,0.34)] transition-[border-color,background,box-shadow,transform,opacity] duration-500 ease-out ${
          gateHero.tone === "good"
            ? "border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),rgba(9,9,11,0.92)_45%)]"
            : gateHero.tone === "warning"
              ? "border-amber-500/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),rgba(9,9,11,0.92)_45%)]"
              : "border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),rgba(9,9,11,0.92)_45%)]"
        } ${gateRefreshing ? "border-cyan-400/30 shadow-[0_30px_90px_rgba(8,145,178,0.18)]" : ""}`}
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">Gate</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">{gateHero.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-200/88">{gateHero.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill tone={gateHero.tone}>{gateHero.eyebrow}</StatusPill>
            <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
              warningGateConstraints.length
                ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                : "border-zinc-700/80 bg-zinc-950/70 text-zinc-300"
            }`}>
              {warningGateConstraints.length} warnings
            </span>
            <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
              failedGateConstraints.length
                ? "border-red-500/20 bg-red-500/10 text-red-200"
                : "border-zinc-700/80 bg-zinc-950/70 text-zinc-300"
            }`}>
              {failedGateConstraints.length} blockers
            </span>
            <span className="rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
              {formatUsd(actionValueUsd)} moved
            </span>
            <span className="rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
              {gateResult ? formatUsd(gateResult.estimated_cost_usd) : "Awaiting"} cost
            </span>
          </div>
          <div
            className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
              gateRefreshing ? "mt-3 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3.5 py-3">
                <div className="flex items-center gap-2 text-sm text-cyan-100">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{proposalOutdated ? "Gate result is stale. Re-evaluating this draft now." : "Gate is checking the current draft."}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-950/70">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-400/80" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
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

        {suggestedSwapFallback ? (
          <div className="mt-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3.5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium text-cyan-100">{suggestedSwapFallback.label}</p>
                <p className="mt-1.5 text-sm text-cyan-50/80">{suggestedSwapFallback.detail}</p>
              </div>
              <button
                type="button"
                onClick={onUseSuggestedSwap}
                className="inline-flex items-center justify-center rounded-full border border-cyan-400/40 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.16em] text-cyan-100 hover:border-cyan-300 hover:bg-cyan-400/10"
              >
                Use simpler swap
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <SectionCard
        eyebrow="Trade ticket"
        title={actionType === "swap" ? "What you can send next" : "What the desk will execute next"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
              {actionType}
            </span>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
              {proposalSourceLabel}
            </span>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
              {routeLabel}
            </span>
          </div>
        }
      >
        <div className="space-y-3">
          <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/55 p-4 transition-opacity duration-300 ${gateRefreshing ? "opacity-80" : "opacity-100"}`}>
            <div className="max-w-3xl">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">System thesis</p>
              <p className="mt-1 text-base font-medium text-white">{proposalHeadline}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-300 line-clamp-2">{proposalReason}</p>
              {proposalRouteLabel ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Best live route</span>
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-cyan-100">
                    {proposalRouteLabel}
                  </span>
                  {proposalRouteDetail ? (
                    <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
                      {proposalRouteDetail}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {recommendationNotice ? <p className="mt-2 text-sm text-amber-200">{recommendationNotice}</p> : null}
            </div>

            {showRecommendationCard ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={onGetRecommendation}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                >
                  Refresh model
                </button>
                <button
                  onClick={onApplyAiTargets}
                  className="rounded-full border border-amber-400/40 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-amber-100 hover:border-amber-300 hover:bg-amber-400/10"
                >
                  Use suggested target
                </button>
              </div>
            ) : null}
          </div>

          <div className={`flex flex-wrap gap-2 transition-opacity duration-300 ${gateRefreshing ? "opacity-80" : "opacity-100"}`}>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300">
              {activeSteps.length} trade{activeSteps.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300">
              {formatUsd(actionValueUsd)} moved
            </span>
            <span
              className={`rounded-full border px-3 py-1.5 text-xs ${
                feeGuardResult?.passed
                  ? "border-zinc-700 bg-zinc-950 text-zinc-300"
                  : "border-amber-500/20 bg-amber-500/10 text-amber-200"
              }`}
            >
              {formatUsd(estimatedFeeUsd)} network cost
            </span>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300">
              {routeLabel}
            </span>
          </div>

          <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/55 p-4 transition-opacity duration-300 ${gateRefreshing ? "opacity-80" : "opacity-100"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Ticket summary</p>
                <p className="mt-1 text-sm text-zinc-400">Lead route, economics, and mix change in one view.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DetailToggle
                  open={showProposalDetails}
                  onToggle={() => setShowProposalDetails((current) => !current)}
                  showLabel="Show mix"
                  hideLabel="Hide mix"
                />
                {(pendingPreparedCalls?.length || activeSteps.length > 1) ? (
                  <DetailToggle
                    open={showDecisionDetails}
                    onToggle={() => setShowDecisionDetails((current) => !current)}
                    showLabel="Show full plan"
                    hideLabel="Hide full plan"
                  />
                ) : null}
              </div>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
              <div className="space-y-3">
                {leadPlanStep ? (
                  <PlanStep
                    index={1}
                    title={`Sell ${leadPlanStep.from_asset}, buy ${leadPlanStep.to_asset}`}
                    meta={`${routeLabel} • expected receive in ${leadPlanStep.to_asset}`}
                    value={formatUsd(leadPlanStep.value_usd)}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-8 text-center">
                    <p className="text-sm font-medium text-zinc-200">No plan yet</p>
                    <p className="mt-2 text-sm text-zinc-500">Set a target or trade amount and the exact path will appear here.</p>
                  </div>
                )}

                <div
                  className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                    showDecisionDetails ? "grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="space-y-2 pt-1">
                      {pendingPreparedCalls?.length ? (
                        pendingPreparedCalls.map((step, index) => (
                          <PlanStep
                            key={`${step.step.from_asset}-${step.step.to_asset}-${index}-prepared`}
                            index={index + 1}
                            title={`Sell ${step.step.from_asset}, buy ${step.step.to_asset}`}
                            meta={`${(step.execution_adapter ?? "best").toUpperCase()}${step.route?.length ? ` • ${step.route.join(" → ")}` : ""}`}
                            value={formatAssetAmount(fromWei(Number(step.step.amount_wei), step.step.from_asset), step.step.from_asset)}
                          />
                        ))
                      ) : activeSteps.length ? (
                        activeSteps.map((step, index) => (
                          <PlanStep
                            key={`${step.from_asset}-${step.to_asset}-${index}`}
                            index={index + 1}
                            title={`Sell ${step.from_asset}, buy ${step.to_asset}`}
                            meta={`${routeLabel} • expected receive in ${step.to_asset}`}
                            value={formatUsd(step.value_usd)}
                          />
                        ))
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                  <p className="text-sm font-medium text-white">{economicsTitle}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">{economicsReason}</p>
                </div>
                {impactCards.slice(0, 2).map((card) => (
                  <div key={`${card.label}-compact`} className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">{card.label}</p>
                      <span className="text-sm text-zinc-300">{card.value}</span>
                    </div>
                  </div>
                ))}
                {gasReserveResult && gasReserveResult.reason !== "No STRK gas reserve adjustment needed." ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                    <p className="text-sm font-medium text-white">Gas reserve</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{gasReserveResult.reason}</p>
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                showProposalDetails ? "mt-3 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                {actionType === "rebalance" ? (
                  <div className="space-y-3 pt-1">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <MixBar label="Current mix" allocations={currentAllocations} emphasis="current" />
                      <MixBar label="Proposed mix" allocations={userTargetAllocations} emphasis="target" />
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      {(["ETH", "STRK", "USDC"] as SupportedAsset[]).map((asset) => (
                        <div key={`${asset}-proposal-detail`} className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-white">{asset}</span>
                            <span className={`text-sm ${userTargetAllocations[asset] >= currentAllocations[asset] ? "text-emerald-200" : "text-amber-200"}`}>
                              {formatPercent(userTargetAllocations[asset] - currentAllocations[asset], 1)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500">
                            {formatPercent(currentAllocations[asset], 1)} now → {formatPercent(userTargetAllocations[asset], 1)} proposed
                          </p>
                          {typeof aiTargetAllocations?.[asset] === "number" ? (
                            <p className="mt-1 text-xs text-zinc-500">Suggested target {formatPercent(aiTargetAllocations[asset] ?? 0, 1)}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 pt-1 sm:grid-cols-2">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Swap ticket</p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {swapAssetIn} → {swapAssetOut}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {swapAmount || "0"} {swapAssetIn} with max {slippageBps || "0"} bps slippage.
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Available balance</p>
                      <p className="mt-2 text-lg font-semibold text-white">{formatAssetAmount(swapAvailableAmount, swapAssetIn)}</p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {formatUsd(swapAvailableUsd)} available in wallet.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

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

      <section className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/88 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
        <button
          type="button"
          onClick={() => setShowEditor((current) => !current)}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Edit trade</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Manual controls</h2>
            <p className="mt-1.5 text-sm text-zinc-400">{economicsHelper}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-full border border-zinc-700/80 bg-zinc-950/80 p-1">
              {(["rebalance", "swap"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetActionType(type);
                  }}
                  className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
                    actionType === type
                      ? "bg-cyan-500/15 text-cyan-100"
                      : "text-zinc-400 transition-colors duration-200 hover:text-zinc-100"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
              {proposalSourceLabel}
            </span>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 text-zinc-300">
              <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${showEditor ? "rotate-180" : ""}`} />
            </span>
          </div>
        </button>

        <div
          className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
            showEditor ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
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
          </div>
        </div>
      </section>
    </section>
  );
}
