"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, ExternalLink, Loader2, X, RotateCcw, Cpu, Brain, ShieldCheck } from "lucide-react";

import { formatAssetAmount, formatPercent, formatUsd } from "./formatters";
import { PrimaryActionTray } from "./PrimaryActionTray";
import { ReceiptVaultHero } from "./ReceiptVaultHero";
import { SafetyDrawer } from "./SafetyDrawer";
import { TargetEditor } from "./TargetEditor";
import { SessionKeyManager } from "@/components/zkdefi/SessionKeyManager";
import { ProofStepper, type ProofStepperProps } from "@/components/zkdefi/vault/ProofStepper";
import type { ConstraintResult, GateResult, PortableReceiptData, RecommendationRouteOption, SupportedAsset, SwapStep, WorkflowMode } from "./types";

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

export function MixBar({
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
          {(["ETH", "STRK", "USDC", "WBTC"] as SupportedAsset[]).map((asset) => (
            <span key={`${label}-${asset}`}>
              {asset} {formatPercent(allocations[asset] ?? 0, 0)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-zinc-950">
        {(["ETH", "STRK", "USDC", "WBTC"] as SupportedAsset[]).map((asset) => (
          <div
            key={`${label}-${asset}-segment`}
            className={
              asset === "ETH"
                ? "bg-cyan-400"
                : asset === "STRK"
                  ? "bg-amber-400"
                  : asset === "WBTC"
                    ? "bg-orange-400"
                    : "bg-emerald-400"
            }
            style={{ width: `${Math.max(0, Math.min(100, allocations[asset] ?? 0))}%` }}
          />
        ))}
      </div>
    </div>
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

function SlideUpModal({
  open,
  onClose,
  title,
  eyebrow,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-[24px] border border-zinc-800/80 bg-zinc-950 p-5 shadow-2xl sm:mx-4 sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            {eyebrow ? <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">{eyebrow}</p> : null}
            <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function LlmBadge({ provider }: { provider: string | null }) {
  if (!provider) return null;
  const isDeterministic = provider === "deterministic";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] ${
        isDeterministic
          ? "border-zinc-700 bg-zinc-900/80 text-zinc-400"
          : "border-violet-500/25 bg-violet-500/10 text-violet-200"
      }`}
      title={isDeterministic ? "Deterministic heuristic fallback" : `LLM reasoning via ${provider}`}
    >
      {isDeterministic ? <Cpu className="h-3 w-3" /> : <Brain className="h-3 w-3" />}
      {isDeterministic ? "Deterministic" : "LLM"}
    </span>
  );
}

type Props = {
  checking: boolean;
  executing: boolean;
  workflowMode: WorkflowMode;
  onWorkflowModeChange: (mode: WorkflowMode) => void;
  actionType: "swap" | "rebalance";
  showRecommendationCard: boolean;
  recommendation: RecommendationData | null;
  recommendationNotice: string | null;
  proposalHeadline: string;
  proposalReason: string;
  walletAddress: string;
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
  executionReceiptCid?: string | null;
  executionReceipt?: PortableReceiptData | null;
  executionTxHash?: string | null;
  quoteSecondsLeft?: number | null;
  portableReceiptLink?: string | null;
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
  recommendedSwapStarter: {
    label: string;
    detail: string;
  } | null;
  recommendedSwapAlternatives: RecommendationRouteOption[];
  overridePrimaryAction: boolean;
  loadingRecommendation: boolean;
  intentSet: boolean;
  onIntentSet: () => void;
  onResetIntent: () => void;
  llmProvider: string | null;
  automatedProfileFallback: {
    hasOnboarding: boolean;
    hasAgent: boolean;
    activeSessionCount: number;
    governedState: "disarmed" | "armed" | "policy_fallback" | "session_unavailable" | "executing";
    controlState: "armed" | "disarmed";
    executionMode: "allow" | "advisory" | "block";
    primaryHint: string;
    passportScore: number;
    letterRating: string;
    profileSource: "onboarding_constraints" | "portfolio_policy";
    riskProfile: string;
    riskTolerance: number;
    policyExecutionMode: string;
    readinessStatus: "ready" | "needs_onboarding" | "needs_session_key" | "policy_fallback";
    readinessLabel: string;
    readinessDetail: string;
    nextActionType: "swap" | "rebalance" | "wait";
    nextActionLabel: string;
    nextActionDetail: string;
    nextActionRouteLabel: string | null;
    nextActionRouteDetail: string | null;
    nextActionTradeCount: number;
    nextActionValueUsd: number;
  };
  governedExecutionDisarmed: boolean;
  onToggleGovernedExecution: () => void;
  onUseSuggestedSwap: () => void;
  onUseRecommendedSwapStarter: () => void;
  onUseRecommendedSwapAlternative: (option: RecommendationRouteOption) => void;
  showSessionKeyModal: boolean;
  onDismissSessionKeyModal: () => void;
  onSessionKeyGranted: (sessionId: string) => void;
  privateMode: boolean;
  privacyUnavailableReason: string | null;
  onTogglePrivateMode: () => void;
  mistPrivacyStep: string;
  mistPrivacyMessage: string;
  mistPrivacyBusy: boolean;
  mistPrivacyError: string | null;
  pendingKeyDownload: boolean;
  onConfirmKeyDownloaded: () => void;
  onCancelKeyDownload: () => void;
  showRecoveryPanel: boolean;
  onToggleRecoveryPanel: () => void;
  onRecoverFromKey: (recoveryJson: string) => Promise<void>;
};

export function PortfolioMainDesk(props: Props) {
  const {
    checking,
    executing,
    workflowMode,
    onWorkflowModeChange,
    actionType,
    recommendation,
    recommendationNotice,
    proposalHeadline,
    proposalReason,
    walletAddress,
    onSetActionType,
    onGetRecommendation,
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
    deskTone,
    deskLabel,
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
    executionReceiptCid,
    executionReceipt,
    executionTxHash,
    quoteSecondsLeft,
    portableReceiptLink,
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
    recommendedSwapStarter,
    recommendedSwapAlternatives,
    overridePrimaryAction,
    loadingRecommendation,
    intentSet,
    onIntentSet,
    onResetIntent,
    llmProvider,
    onUseSuggestedSwap,
    onUseRecommendedSwapStarter,
    onUseRecommendedSwapAlternative,
    showSessionKeyModal,
    onDismissSessionKeyModal,
    onSessionKeyGranted,
    privateMode,
    privacyUnavailableReason,
    onTogglePrivateMode,
    mistPrivacyStep,
    mistPrivacyMessage,
    mistPrivacyBusy,
    mistPrivacyError,
    pendingKeyDownload,
    onConfirmKeyDownloaded,
    onCancelKeyDownload,
    showRecoveryPanel,
    onToggleRecoveryPanel,
    onRecoverFromKey,
  } = props;

  const [showTradeTicketModal, setShowTradeTicketModal] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showEditorModal, setShowEditorModal] = useState(false);

  // Suppress auto-recommendation until user picks an action
  useEffect(() => {
    if (!intentSet) return;
    if (workflowMode === "manual") return;
    if (recommendation || recommendationNotice || checking) return;
    onGetRecommendation();
  }, [intentSet, workflowMode, recommendation, recommendationNotice, checking, onGetRecommendation]);

  // In manual mode, skip the picker entirely — go straight to editor
  // In assisted mode, show the ZKML CTA
  // In automated mode, show the governance dashboard
  const showActionPicker = !intentSet && !executing;

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
        summary: "Gate cleared — submission is on Starknet.",
        tone: "good" as const,
      };
    }
    if (proposalOutdated) {
      return {
        eyebrow: "Recheck needed",
        title: "Target edits invalidated the prior result",
        summary: "Run a fresh Gate check before signing.",
        tone: "warning" as const,
      };
    }
    if (!gateResult) {
      return {
        eyebrow: workflowMode === "manual" ? "Manual mode" : "Gate pending",
        title: workflowMode === "manual" ? "Shape a route first" : "Gate has not evaluated this draft",
        summary: workflowMode === "manual"
          ? "Set a target or amount, then the Gate scores the route."
          : "Shape the proposal first. Gate re-checks before anything reaches wallet.",
        tone: "neutral" as const,
      };
    }
    if (!gateResult.allowed) {
      return {
        eyebrow:
          workflowMode === "manual" && (gateResult?.swap_steps?.length ?? 0) > 0
            ? "Manual mode keeps the route available"
            : overridePrimaryAction
              ? "Gate permits execution with fee warning"
              : "Gate blocked execution",
        title:
          workflowMode === "manual" && (gateResult?.swap_steps?.length ?? 0) > 0
            ? "Gate flagged this route — manual mode can still send"
            : overridePrimaryAction
              ? "Permitted with fee warning"
              : "Execution blocked",
        summary:
          workflowMode === "manual" && (gateResult?.swap_steps?.length ?? 0) > 0
            ? "Gate result shown below. Manual mode treats it as advisory."
            : overridePrimaryAction
              ? "Only fee efficiency failed. You can still proceed."
              : `${failedGateConstraints.length} check${failedGateConstraints.length === 1 ? "" : "s"} must clear.`,
        tone: "warning" as const,
      };
    }
    if (warningGateConstraints.length) {
      return {
        eyebrow: "Gate passed with warnings",
        title: "Execution permitted",
        summary: `${warningGateConstraints.length} warning${warningGateConstraints.length === 1 ? "" : "s"}, but Gate allows this path.`,
        tone: "neutral" as const,
      };
    }
    return {
      eyebrow: "Gate passed",
      title: "Execution permitted",
      summary: "Liquidity, policy, and conditions cleared.",
      tone: "good" as const,
    };
  })();

  const currentLeader = (Object.entries(currentAllocations) as Array<[SupportedAsset, number]>).sort((a, b) => b[1] - a[1])[0];
  const targetLeader = (Object.entries(userTargetAllocations) as Array<[SupportedAsset, number]>).sort((a, b) => b[1] - a[1])[0];
  const activeSteps = pendingPreparedCalls?.length ? pendingPreparedCalls.map((item) => item.step) : gateResult?.swap_steps ?? [];
  const routeLabel = (pendingRouteLabel ?? lastPreparedAdapter)?.toUpperCase() ?? "BEST ROUTE";
  const gateRefreshing = checking || proposalOutdated;

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

  const editorHeading =
    workflowMode === "manual" ? "Manual controls" : workflowMode === "assisted" ? "Adjust guided draft" : "Manual override";
  const editorEyebrow = workflowMode === "manual" ? "Edit trade" : workflowMode === "assisted" ? "Adjust draft" : "Intervene manually";
  const editorIntro =
    workflowMode === "manual"
      ? recommendedSwapStarter && actionType === "rebalance"
        ? "Start from the direct route. Open target mix to shape the broader allocation."
        : economicsHelper
      : workflowMode === "assisted"
        ? "Guided draft is loaded. Edit only if you want to override."
        : "Governed draft is running. Override only if needed.";

  /* ------------------------------------------------------------------ */
  /*  Has the user just completed a run? Show done state.                */
  /* ------------------------------------------------------------------ */
  const executionDone = !executing && Boolean(executionTxHash || executionReceipt?.cid);

  /* ------------------------------------------------------------------ */
  /*  ACTION PICKER — mode-specific entry point                         */
  /* ------------------------------------------------------------------ */
  const {
    automatedProfileFallback: autoProfile,
    governedExecutionDisarmed,
    onToggleGovernedExecution,
  } = props;

  const manualPickerSection = showActionPicker && workflowMode === "manual" ? (
    <section className="overflow-hidden rounded-[28px] border border-zinc-700/60 bg-zinc-950/90 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.34)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">Manual mode</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">Build your own trade</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
        Full control. Pick a swap or rebalance, set every parameter, and gate-score before signing.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => { onIntentSet(); onSetActionType("swap"); setShowEditorModal(true); }}
          className="group rounded-2xl border border-zinc-700/80 bg-zinc-900/60 p-5 text-left transition-all hover:border-cyan-500/40 hover:bg-zinc-800/60"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-lg">↔</span>
          <h3 className="mt-3 text-base font-semibold text-white">Swap</h3>
          <p className="mt-1.5 text-sm leading-5 text-zinc-500 group-hover:text-zinc-400">
            Exchange one token for another. Set the pair, amount, and slippage tolerance yourself.
          </p>
        </button>

        <button
          type="button"
          onClick={() => { onIntentSet(); onSetActionType("rebalance"); setShowEditorModal(true); }}
          className="group rounded-2xl border border-zinc-700/80 bg-zinc-900/60 p-5 text-left transition-all hover:border-cyan-500/40 hover:bg-zinc-800/60"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-lg">⚖</span>
          <h3 className="mt-3 text-base font-semibold text-white">Rebalance</h3>
          <p className="mt-1.5 text-sm leading-5 text-zinc-500 group-hover:text-zinc-400">
            Set target allocation weights across ETH, STRK, USDC, and WBTC. Gate scores the route.
          </p>
        </button>
      </div>
    </section>
  ) : null;

  const assistedPickerSection = showActionPicker && workflowMode === "assisted" ? (
    <section className="overflow-hidden rounded-[28px] border border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.10),rgba(9,9,11,0.95)_50%)] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.34)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400/70">Assisted mode</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Let ZKML find the best move</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-200/88">
        The AI runs 37 proof families — credit gates, risk models, liquidity analysis — then recommends the optimal route. You review and approve before anything hits the chain.
      </p>

      <div className="mt-5">
        <button
          type="button"
          onClick={() => {
            onIntentSet();
            onGetRecommendation();
          }}
          disabled={loadingRecommendation}
          className="group relative inline-flex items-center gap-3 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-6 py-4 text-left transition-all duration-200 hover:border-cyan-400/50 hover:bg-cyan-500/16 hover:shadow-[0_8px_24px_rgba(8,145,178,0.18)] disabled:opacity-60"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/15 text-lg">⚡</span>
          <div>
            <h3 className="text-base font-semibold text-cyan-50">Run ZKML Analysis</h3>
            <p className="mt-0.5 text-sm text-zinc-400 group-hover:text-zinc-300">
              Analyze portfolio → Recommend action → Gate check → You approve
            </p>
          </div>
          {loadingRecommendation && (
            <Loader2 className="ml-2 h-5 w-5 animate-spin text-cyan-300" />
          )}
        </button>
      </div>

      <div className="mt-5 flex items-center gap-3 text-xs text-zinc-500">
        <span>Want more control?</span>
        <button
          type="button"
          onClick={() => { onIntentSet(); onSetActionType("swap"); setShowEditorModal(true); }}
          className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
        >
          Manual swap
        </button>
        <button
          type="button"
          onClick={() => { onIntentSet(); onSetActionType("rebalance"); setShowEditorModal(true); }}
          className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
        >
          Manual rebalance
        </button>
      </div>
    </section>
  ) : null;

  const automatedDashboardSection = showActionPicker && workflowMode === "automated" ? (
    <section className="overflow-hidden rounded-[28px] border border-violet-500/20 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.12),rgba(9,9,11,0.95)_50%)] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.34)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-violet-400/70">Automated mode</p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">Governed autopilot</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
            AI picks and executes within your policy bounds. Monitor, arm/disarm, or intervene.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleGovernedExecution}
          className={`rounded-full border px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] transition-colors ${
            governedExecutionDisarmed
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
              : "border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20"
          }`}
        >
          {governedExecutionDisarmed ? "Arm autopilot" : "Disarm"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/40 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Status</p>
          <p className="mt-2 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${
              autoProfile.readinessStatus === "ready" && !governedExecutionDisarmed
                ? "bg-emerald-400 animate-pulse"
                : autoProfile.readinessStatus === "ready"
                  ? "bg-amber-400"
                  : "bg-zinc-600"
            }`} />
            <span className="text-sm font-medium text-white">{autoProfile.readinessLabel}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">{autoProfile.readinessDetail}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/40 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Next action</p>
          <p className="mt-2 text-sm font-medium text-white">{autoProfile.nextActionLabel}</p>
          <p className="mt-1 text-xs text-zinc-500">{autoProfile.nextActionDetail}</p>
          {autoProfile.nextActionRouteLabel && (
            <span className="mt-2 inline-block rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-cyan-200">
              {autoProfile.nextActionRouteLabel}
            </span>
          )}
        </div>
        <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/40 p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Risk profile</p>
          <p className="mt-2 text-sm font-medium text-white">{autoProfile.riskProfile}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
            <span>Passport {autoProfile.letterRating}</span>
            <span>·</span>
            <span>{autoProfile.activeSessionCount} key{autoProfile.activeSessionCount === 1 ? "" : "s"}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            onIntentSet();
            onGetRecommendation();
          }}
          disabled={loadingRecommendation || governedExecutionDisarmed}
          className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-200 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
        >
          {loadingRecommendation ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Run governed cycle
        </button>
        <button
          type="button"
          onClick={() => { onIntentSet(); onSetActionType("swap"); setShowEditorModal(true); }}
          className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
        >
          Manual override
        </button>
      </div>
    </section>
  ) : null;

  /* ------------------------------------------------------------------ */
  /*  GATE SECTION — compact hero with action + modal triggers          */
  /* ------------------------------------------------------------------ */
  const gateSection = intentSet ? (
    <section
      className={`overflow-hidden rounded-[28px] border p-5 shadow-[0_28px_80px_rgba(0,0,0,0.34)] transition-[border-color,background] duration-500 ease-out ${
        gateHero.tone === "good"
          ? "border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),rgba(9,9,11,0.92)_45%)]"
          : gateHero.tone === "warning"
            ? "border-amber-500/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),rgba(9,9,11,0.92)_45%)]"
            : "border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),rgba(9,9,11,0.92)_45%)]"
      } ${gateRefreshing ? "border-cyan-400/30 shadow-[0_30px_90px_rgba(8,145,178,0.18)]" : ""}`}
    >
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">Gate</p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">{gateHero.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LlmBadge provider={llmProvider} />
            <StatusPill tone={gateHero.tone}>{gateHero.eyebrow}</StatusPill>
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-200/88">{gateHero.summary}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {failedGateConstraints.length > 0 && (
            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-red-200">
              {failedGateConstraints.length} blocker{failedGateConstraints.length === 1 ? "" : "s"}
            </span>
          )}
          {warningGateConstraints.length > 0 && (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-amber-200">
              {warningGateConstraints.length} warning{warningGateConstraints.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="rounded-full border border-zinc-700/80 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
            {formatUsd(actionValueUsd)} · {gateResult ? formatUsd(gateResult.estimated_cost_usd) : "—"} fee
          </span>
        </div>

        {/* Gate checking indicator */}
        {gateRefreshing && (
          <div className="mt-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3.5 py-3">
            <div className="flex items-center gap-2 text-sm text-cyan-100">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{proposalOutdated ? "Re-evaluating draft…" : "Gate is checking…"}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-950/70">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-400/80" />
            </div>
          </div>
        )}
      </div>

      {/* Primary Action */}
      <div className="mt-4">
        <PrimaryActionTray
          checking={checking}
          executing={executing}
          workflowMode={workflowMode}
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
          executionReceiptCid={executionReceiptCid}
          portableReceiptLink={portableReceiptLink}
          overridePrimaryAction={overridePrimaryAction}
          quoteSecondsLeft={quoteSecondsLeft ?? null}
        />
      </div>

      {/* Quick-action toolbar — modal openers */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowEditorModal(true)}
          className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
        >
          Edit {actionType}
        </button>
        {activeSteps.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTradeTicketModal(true)}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            {activeSteps.length} trade{activeSteps.length === 1 ? "" : "s"} · {routeLabel}
          </button>
        )}
        {gateResult && (
          <button
            type="button"
            onClick={() => setShowSafetyModal(true)}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            {passedGateCount}/{gateResult.constraint_results?.length ?? 0} checks
          </button>
        )}
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
  ) : null;

  /* ------------------------------------------------------------------ */
  /*  DONE STATE — after execution, with reset button                   */
  /* ------------------------------------------------------------------ */
  const doneSection = executionDone ? (
    <section className="overflow-hidden rounded-[28px] border border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),rgba(9,9,11,0.95)_50%)] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.34)]">
      {executionReceipt?.cid ? (
        <ReceiptVaultHero
          receipt={executionReceipt}
          executionTxHash={executionTxHash ?? null}
          workflowMode={workflowMode}
          passedGateCount={passedGateCount}
          totalConstraintCount={gateResult?.constraint_results?.length ?? 0}
        />
      ) : (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400">Done</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Transaction submitted</h2>
          {executionNote && <p className="mt-2 text-sm text-zinc-400">{executionNote}</p>}

          {/* Always surface tx hash, IPFS, and gate results */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {executionTxHash && (
              <a
                href={`https://voyager.online/tx/${executionTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 font-mono text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
                title={executionTxHash}
              >
                <ExternalLink className="h-3 w-3" />
                tx {executionTxHash.slice(0, 8)}…{executionTxHash.slice(-6)}
              </a>
            )}
            {executionReceiptCid && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
                <span className="font-mono text-[11px]" title={executionReceiptCid}>
                  ipfs://{executionReceiptCid.slice(0, 12)}…
                </span>
                <button
                  type="button"
                  title="Copy CID"
                  onClick={() => navigator.clipboard.writeText(executionReceiptCid)}
                  className="text-emerald-400 hover:text-emerald-200"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </span>
            )}
            {portableReceiptLink && (
              <a
                href={portableReceiptLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300 transition-colors hover:border-emerald-400/50 hover:text-emerald-200"
              >
                <ExternalLink className="h-3 w-3" />
                Receipt
              </a>
            )}
          </div>

          {gateResult && (
            <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>
                Gate: {passedGateCount}/{gateResult.constraint_results?.length ?? 0} checks passed
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            onResetIntent();
            setShowEditorModal(false);
            setShowTradeTicketModal(false);
            setShowSafetyModal(false);
          }}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/20"
        >
          <RotateCcw className="h-4 w-4" />
          Start new action
        </button>
        {gateResult && (
          <button
            type="button"
            onClick={() => setShowSafetyModal(true)}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            View safety report
          </button>
        )}
      </div>
    </section>
  ) : null;

  /* ------------------------------------------------------------------ */
  /*  AI RECOMMENDATION CARD — surface the LLM reasoning in ZKML mode   */
  /* ------------------------------------------------------------------ */
  const recommendationCard =
    !showActionPicker &&
    !executionDone &&
    workflowMode !== "manual" &&
    (recommendation || loadingRecommendation) ? (
      <section className="overflow-hidden rounded-[28px] border border-cyan-500/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.08),rgba(9,9,11,0.95)_50%)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-cyan-400" />
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400/70">
                {workflowMode === "assisted" ? "ZKML recommendation" : "Governed strategy"}
              </p>
            </div>
            {loadingRecommendation && !recommendation ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-cyan-100">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Running 37 proof families…</span>
              </div>
            ) : (
              <>
                <h2 className="mt-2 text-lg font-semibold text-white">{proposalHeadline}</h2>
                <p className="mt-1.5 text-sm leading-6 text-zinc-300">{proposalReason}</p>

                {recommendation?.drift_monitor?.explanation && (
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    <span className="font-medium text-zinc-300">Drift: </span>
                    {recommendation.drift_monitor.explanation}
                  </p>
                )}

                {recommendation?.rebalance_summary?.top_changes?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {recommendation.rebalance_summary.top_changes.map((change) => (
                      <span
                        key={change.asset}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                          change.delta_pct > 0
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                            : "border-red-500/25 bg-red-500/10 text-red-300"
                        }`}
                      >
                        {change.asset}
                        <span>{change.delta_pct > 0 ? "+" : ""}{Math.round(change.delta_pct)}%</span>
                      </span>
                    ))}
                    {recommendation?.estimated_swap_count != null && (
                      <span className="inline-flex items-center rounded-full border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-400">
                        {recommendation.estimated_swap_count} trade{recommendation.estimated_swap_count === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                ) : null}

                {recommendationNotice && (
                  <p className="mt-2 text-xs text-amber-200">{recommendationNotice}</p>
                )}
              </>
            )}
          </div>
          {llmProvider && (
            <span className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-cyan-300">
              {llmProvider}
            </span>
          )}
        </div>
      </section>
    ) : null;

  /* ------------------------------------------------------------------ */
  /*  RETURN — clean flow: pick → gate → done                           */
  /* ------------------------------------------------------------------ */
  return (
    <section className="space-y-4">
      {/* ── Privacy toggle ────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-2xl border border-zinc-700/60 bg-zinc-950/80 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-base">{privateMode && !privacyUnavailableReason ? "🛡" : "🔓"}</span>
          <div>
            <p className="text-sm font-medium text-white">
              {privateMode && !privacyUnavailableReason ? "Private mode" : "Standard mode"}
            </p>
            <p className="text-[11px] text-zinc-500">
              {privacyUnavailableReason
                ? privacyUnavailableReason
                : privateMode
                  ? "Swaps routed through MIST Chamber (ZK proof breaks on-chain link)"
                  : "Tap to enable privacy via MIST.cash"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onTogglePrivateMode}
          disabled={!!privacyUnavailableReason}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            privacyUnavailableReason ? "cursor-not-allowed opacity-40 bg-zinc-700" : privateMode ? "cursor-pointer bg-cyan-500" : "cursor-pointer bg-zinc-700"
          }`}
          role="switch"
          aria-checked={privateMode && !privacyUnavailableReason}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              privateMode && !privacyUnavailableReason ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      {privateMode && mistPrivacyStep !== "idle" && mistPrivacyStep !== "complete" && (
        <PrivacyStepIndicator step={mistPrivacyStep} message={mistPrivacyMessage} error={mistPrivacyError} />
      )}

      {/* Key download confirmation gate */}
      {pendingKeyDownload && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm">
          <p className="font-medium text-amber-200">⚠ Save your recovery file before continuing</p>
          <p className="mt-1 text-amber-300/70 text-xs">
            A recovery file was just downloaded. Without it, deposited funds cannot be withdrawn
            if the transaction is interrupted. Confirm you saved it to proceed.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onConfirmKeyDownloaded}
              className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 transition-colors"
            >
              I&apos;ve saved my recovery file — continue
            </button>
            <button
              type="button"
              onClick={onCancelKeyDownload}
              className="rounded-lg bg-zinc-700 px-4 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Recovery panel for stuck deposits */}
      {privateMode && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onToggleRecoveryPanel}
            className="text-[11px] text-zinc-500 hover:text-cyan-400 transition-colors"
          >
            {showRecoveryPanel ? "Hide recovery" : "Recover stuck deposit"}
          </button>
        </div>
      )}
      {showRecoveryPanel && (
        <RecoveryPanel onRecover={onRecoverFromKey} walletAddress={walletAddress} />
      )}

      {/* Phase 1: Mode-specific entry (start state) */}
      {manualPickerSection}
      {assistedPickerSection}
      {automatedDashboardSection}

      {/* Phase 1.5: AI recommendation insight (after ZKML analysis) */}
      {recommendationCard}

      {/* Phase 2: Gate + primary action (active state) */}
      {!executionDone && gateSection}

      {/* Phase 3: Done card with receipt + reset (end state) */}
      {doneSection}

      {/* ── Modals ── */}

      {/* Editor Modal */}
      <SlideUpModal
        open={showEditorModal}
        onClose={() => setShowEditorModal(false)}
        eyebrow={editorEyebrow}
        title={editorHeading}
      >
        <p className="mb-4 text-sm text-zinc-400">{editorIntro}</p>
        <div className="mb-3 flex items-center gap-2">
          {(["rebalance", "swap"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onSetActionType(type)}
              className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${
                actionType === type
                  ? "bg-cyan-500/15 text-cyan-100 border border-cyan-500/30"
                  : "text-zinc-400 border border-zinc-700 hover:text-zinc-100"
              }`}
            >
              {type}
            </button>
          ))}
          <span className="ml-auto rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
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
          recommendedSwapStarter={recommendedSwapStarter}
          recommendedSwapAlternatives={recommendedSwapAlternatives}
          onUseRecommendedSwapStarter={onUseRecommendedSwapStarter}
          onUseRecommendedSwapAlternative={onUseRecommendedSwapAlternative}
        />
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => { setShowEditorModal(false); onRunGateCheck(); }}
            className="rounded-full bg-cyan-500/20 border border-cyan-500/30 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/30"
          >
            Done — run Gate check
          </button>
        </div>
      </SlideUpModal>

      {/* Trade Ticket Modal */}
      <SlideUpModal
        open={showTradeTicketModal}
        onClose={() => setShowTradeTicketModal(false)}
        eyebrow="Trade ticket"
        title={actionType === "swap" ? "Swap ticket" : "Rebalance ticket"}
      >
        <div className="space-y-3">
          {/* Proposal summary */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/55 p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              {workflowMode === "manual" ? "Manual draft" : workflowMode === "automated" ? "Governed strategy" : "System thesis"}
            </p>
            <p className="mt-1 text-base font-medium text-white">{proposalHeadline}</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300 line-clamp-3">{proposalReason}</p>
            {recommendationNotice ? <p className="mt-2 text-sm text-amber-200">{recommendationNotice}</p> : null}
          </div>

          {/* Plan steps */}
          {activeSteps.length ? (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{activeSteps.length} step{activeSteps.length === 1 ? "" : "s"} · {routeLabel}</p>
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
              ) : (
                activeSteps.map((step, index) => (
                  <PlanStep
                    key={`${step.from_asset}-${step.to_asset}-${index}`}
                    index={index + 1}
                    title={`Sell ${step.from_asset}, buy ${step.to_asset}`}
                    meta={`${routeLabel} • expected receive in ${step.to_asset}`}
                    value={formatUsd(step.value_usd)}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 px-5 py-8 text-center">
              <p className="text-sm font-medium text-zinc-200">No plan yet</p>
              <p className="mt-2 text-sm text-zinc-500">Set a target and the exact path will appear.</p>
            </div>
          )}

          {/* Mix bars */}
          {actionType === "rebalance" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <MixBar label="Current mix" allocations={currentAllocations} emphasis="current" />
              <MixBar label="Proposed mix" allocations={userTargetAllocations} emphasis="target" />
            </div>
          )}

          {/* Economics */}
          <div className="grid gap-2 sm:grid-cols-3">
            {impactCards.map((card) => (
              <div key={card.label} className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">{card.label}</p>
                  <span className="text-sm text-zinc-300">{card.value}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </SlideUpModal>

      {/* Safety Report Modal */}
      <SlideUpModal
        open={showSafetyModal}
        onClose={() => setShowSafetyModal(false)}
        eyebrow="Safety report"
        title={`${passedGateCount} of ${gateResult?.constraint_results?.length ?? 0} checks passed`}
      >
        {gateResult ? (
          <SafetyDrawer
            gateResult={gateResult}
            summaryLabel={deskLabel}
            passedGateCount={passedGateCount}
            failedGateConstraints={failedGateConstraints}
            warningGateConstraints={warningGateConstraints}
            showFullGateMatrix={showFullGateMatrix}
            onToggleFullMatrix={onToggleFullMatrix}
          />
        ) : (
          <p className="py-8 text-center text-sm text-zinc-500">Run a Gate check first to see the safety report.</p>
        )}
      </SlideUpModal>

      {/* Execution Status Modal */}
      {executing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-[24px] border border-cyan-500/25 bg-zinc-950 p-8 shadow-2xl text-center max-w-sm w-full mx-4">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-400" />
            <h3 className="mt-4 text-lg font-semibold text-white">Executing transaction</h3>
            <p className="mt-2 text-sm text-zinc-400">
              {executionNote ?? "Waiting for wallet confirmation and chain settlement…"}
            </p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-400/80" />
            </div>
          </div>
        </div>
      ) : null}

      {/* Session Key Manager Modal */}
      {showSessionKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) onDismissSessionKeyModal(); }}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[24px] border border-violet-500/25 bg-zinc-950 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-violet-400/70">Autopilot requirement</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Session key needed</h3>
              </div>
              <button type="button" onClick={onDismissSessionKeyModal} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-sm text-zinc-400">
              Automated mode needs an active session key to execute trades on your behalf. Grant one below.
            </p>
            <SessionKeyManager userAddress={walletAddress} onSessionGranted={onSessionKeyGranted} />
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recovery panel — paste or upload a mist-recovery-*.json to withdraw stuck funds
// ---------------------------------------------------------------------------
function RecoveryPanel({ onRecover, walletAddress }: { onRecover: (json: string) => Promise<void>; walletAddress: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [depositCheck, setDepositCheck] = useState<{
    checking: boolean;
    found: boolean | null;
    legacyFormat?: boolean;
    amount: string;
    token: string;
    tokenSymbol: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Verify a recovery file's deposit on-chain
  const verifyDeposit = useCallback(async (raw: string) => {
    let data: { claimingKey?: string; tokenAddress?: string; amountWei?: string; recipientAddress?: string; depositTxHash?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      setStatus("⚠ Invalid JSON file.");
      return;
    }
    if (!data.claimingKey) {
      setStatus("⚠ File does not contain a claimingKey field.");
      return;
    }
    if (!data.tokenAddress || !data.amountWei || !data.recipientAddress) {
      setStatus("⚠ Incomplete recovery file — missing token, amount, or recipient.");
      return;
    }

    // Derive token symbol from known addresses
    const knownTokens: Record<string, string> = {
      "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": "ETH",
      "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": "STRK",
      "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": "USDC",
    };
    const tokenSymbol = knownTokens[data.tokenAddress] ?? "Token";
    const decimals = tokenSymbol === "USDC" ? 6 : tokenSymbol === "WBTC" ? 8 : 18;
    const humanAmount = (Number(data.amountWei) / 10 ** decimals).toFixed(decimals <= 6 ? decimals : 6).replace(/\.?0+$/, "");

    setDepositCheck({ checking: true, found: null, amount: humanAmount, token: data.tokenAddress, tokenSymbol });
    setStatus(null);

    try {
      // Dynamically load SDK and check deposit on-chain
      const sdk = await import("@mistcash/sdk");
      await sdk.initCore();

      const { RpcProvider } = await import("starknet");
      const readProvider = new RpcProvider({
        nodeUrl: process.env.NEXT_PUBLIC_RPC_URL_MAINNET || process.env.NEXT_PUBLIC_RPC_URL || "/api/v1/zkdefi/starknet-rpc",
      });
      const chamber = sdk.getChamber(readProvider as any);
      const asset = await sdk.fetchTxAssets(chamber, data.claimingKey, data.recipientAddress);
      const assetAmount = typeof asset?.amount === "bigint" ? asset.amount : BigInt(String(asset?.amount ?? 0));

      let found = assetAmount > BigInt(0);
      let legacyFormat = false;

      if (!found) {
        const legacyDepositSecret = sdk.txHash(
          data.claimingKey,
          data.recipientAddress,
          data.tokenAddress,
          data.amountWei,
        );
        const legacyAssetRaw = await (chamber as any).assets_from_secret(legacyDepositSecret);
        const legacyAssetAmount = typeof legacyAssetRaw?.amount === "bigint"
          ? legacyAssetRaw.amount
          : BigInt(String(legacyAssetRaw?.amount ?? 0));
        legacyFormat = legacyAssetAmount > BigInt(0);
      }

      setDepositCheck((prev) => prev ? { ...prev, checking: false, found, legacyFormat } : null);
      if (!found) {
        if (legacyFormat) {
          setStatus(
            "⚠ Deposit found in legacy chamber format caused by an earlier client hashing bug. " +
            "The chamber's public recovery methods reject it, so this deposit cannot be recovered through the public MIST ABI.",
          );
          return;
        }
        if (data.depositTxHash) {
          setStatus(`✗ No deposit found on-chain. Check tx on explorer: ${data.depositTxHash.slice(0, 14)}…`);
        } else {
          setStatus("✗ No deposit found on-chain. The deposit likely failed or was never signed. Your tokens should still be in your wallet.");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDepositCheck((prev) => prev ? { ...prev, checking: false, found: null } : null);
      setStatus(`⚠ Could not verify deposit: ${msg}`);
    }
  }, []);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(null);
    setDepositCheck(null);
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      setText(content);
      void verifyDeposit(content);
    };
    reader.readAsText(file);
  }, [verifyDeposit]);

  const handleRestoreFromServer = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus("Checking server for backed-up recovery keys...");
    setDepositCheck(null);
    try {
      const res = await fetch(`/api/v1/zkdefi/privacy/recovery/fetch/${walletAddress}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      const entries = data.entries ?? [];
      if (entries.length === 0) {
        setStatus("⚠ No backed-up keys found for this wallet.");
        return;
      }
      const latest = entries[entries.length - 1];
      const decoded = atob(latest.encrypted_blob);
      setText(decoded);
      setStatus(`✓ Restored key from server (${entries.length} backup${entries.length > 1 ? "s" : ""} found). Verifying deposit…`);
      void verifyDeposit(decoded);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`✗ Server restore failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [walletAddress, busy, verifyDeposit]);

  const handleRecover = useCallback(async () => {
    if (!text || busy) return;
    setBusy(true);
    setStatus("Generating ZK withdrawal proof — this may take up to 40 seconds...");
    try {
      await onRecover(text);
      setStatus("✓ Recovery withdrawal submitted.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`✗ ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [text, busy, onRecover]);

  const withdrawDisabled = busy || !text || depositCheck?.checking || depositCheck?.found === false || depositCheck?.legacyFormat === true;

  return (
    <div className="rounded-2xl border border-zinc-700/60 bg-zinc-950/80 px-4 py-4 text-sm space-y-3">
      <p className="font-medium text-zinc-300">Recover stuck deposit</p>
      <p className="text-[11px] text-zinc-500">
        Upload the <code className="text-cyan-400">mist-recovery-*.json</code> file that was downloaded
        when you initiated the deposit. We&apos;ll verify the deposit on-chain before attempting withdrawal.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
          disabled={busy}
        >
          Choose file
        </button>
        <button
          type="button"
          onClick={handleRestoreFromServer}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
          disabled={busy}
        >
          Restore from server
        </button>
        <input ref={fileRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
      </div>

      {/* Deposit verification status card */}
      {depositCheck && (
        <div className={`rounded-lg border px-3 py-2.5 ${
          depositCheck.checking
            ? "border-zinc-700 bg-zinc-900"
            : depositCheck.legacyFormat
              ? "border-amber-500/30 bg-amber-500/10"
              : depositCheck.found
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-red-500/30 bg-red-500/10"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {depositCheck.checking ? (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
              ) : depositCheck.legacyFormat ? (
                <span className="text-amber-400 text-xs">!</span>
              ) : depositCheck.found ? (
                <span className="text-emerald-400 text-xs">✓</span>
              ) : (
                <span className="text-red-400 text-xs">✗</span>
              )}
              <span className={`text-xs font-medium ${
                depositCheck.checking
                  ? "text-zinc-300"
                  : depositCheck.legacyFormat
                    ? "text-amber-300"
                    : depositCheck.found
                      ? "text-emerald-300"
                      : "text-red-300"
              }`}>
                {depositCheck.amount} {depositCheck.tokenSymbol}
              </span>
            </div>
            <span className={`text-[10px] ${
              depositCheck.checking
                ? "text-zinc-500"
                : depositCheck.legacyFormat
                  ? "text-amber-400"
                  : depositCheck.found
                    ? "text-emerald-400"
                    : "text-red-400"
            }`}>
              {depositCheck.checking
                ? "Verifying on-chain…"
                : depositCheck.legacyFormat
                  ? "Legacy-format deposit"
                  : depositCheck.found
                    ? "Deposit found"
                    : "Not on-chain"}
            </span>
          </div>
          {!depositCheck.checking && depositCheck.legacyFormat && (
            <p className="mt-1.5 text-[10px] text-amber-200/80">
              This deposit was written under the wrong chamber key by an earlier client bug. It exists on-chain, but both public emergency recovery entrypoints reject it with an invalid Merkle proof, so it is not recoverable through the public MIST ABI.
            </p>
          )}
          {!depositCheck.checking && !depositCheck.found && !depositCheck.legacyFormat && (
            <p className="mt-1.5 text-[10px] text-zinc-500">
              The original deposit transaction likely failed or was never confirmed. Your tokens should still be in your wallet.
              Start a new privacy swap to try again.
            </p>
          )}
        </div>
      )}

      {text && (
        <>
          <details className="group">
            <summary className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-400">
              Show recovery data
            </summary>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setDepositCheck(null); }}
              rows={4}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 font-mono focus:border-cyan-500 focus:outline-none"
              readOnly={busy}
            />
          </details>
          <button
            type="button"
            onClick={handleRecover}
            disabled={!!withdrawDisabled}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              depositCheck?.found ? "bg-emerald-600 hover:bg-emerald-500" : "bg-cyan-600 hover:bg-cyan-500"
            }`}
          >
            {busy
              ? "Generating proof…"
              : depositCheck?.legacyFormat
                ? "Legacy deposit detected"
                : depositCheck?.found === false
                  ? "Deposit not found"
                  : "Withdraw with this key"}
          </button>
        </>
      )}
      {status && (
        <p className={`text-[11px] ${status.startsWith("✗") || status.startsWith("⚠") ? "text-red-400" : status.startsWith("✓") ? "text-green-400" : "text-amber-400"}`}>
          {status}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Privacy flow step indicator (maps mistPrivacyStep → ProofStepper)
// ---------------------------------------------------------------------------

const PRIVACY_STEPS = ["Approve token", "Deposit to Chamber", "Confirm on-chain", "Generate ZK proof", "Relay withdrawal"] as const;

function stepStatus(currentStep: string, idx: number): "pending" | "active" | "done" | "error" {
  const stepMap: Record<string, number> = {
    initializing: -1,
    approving: 0,
    depositing: 1,
    waiting_confirmation: 2,
    generating_proof: 3,
    withdrawing: 4,
    ready_to_swap: 5,
    error: -2,
  };
  const current = stepMap[currentStep] ?? -1;
  if (currentStep === "error") {
    // Mark the last non-pending step as error
    if (idx === Math.max(0, current)) return "error";
    if (idx < current) return "done";
    return "pending";
  }
  if (idx < current) return "done";
  if (idx === current) return "active";
  return "pending";
}

function PrivacyStepIndicator({ step, message, error }: { step: string; message: string; error: string | null }) {
  const steps: ProofStepperProps["steps"] = PRIVACY_STEPS.map((label, idx) => ({
    label,
    status: error && step === "error"
      ? (idx === 0 ? "error" : "pending") // fallback: mark first step as error
      : stepStatus(step, idx),
    detail: stepStatus(step, idx) === "active" ? (message || undefined) : undefined,
  }));

  // For error state, find the furthest step that was active and mark it as error
  if (error) {
    const stepMap: Record<string, number> = { approving: 0, depositing: 1, waiting_confirmation: 2, generating_proof: 3, withdrawing: 4 };
    const errIdx = stepMap[step] ?? 0;
    for (let i = 0; i < steps.length; i++) {
      if (i < errIdx) steps[i].status = "done";
      else if (i === errIdx) { steps[i].status = "error"; steps[i].detail = error; }
      else steps[i].status = "pending";
    }
  }

  return <ProofStepper steps={steps} accent="blue" />;
}
