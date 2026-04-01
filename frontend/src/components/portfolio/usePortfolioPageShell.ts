"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "@starknet-react/core";
import { useRouter } from "next/navigation";
import type { Call } from "starknet";
import { RpcProvider } from "starknet";

import {
  buildPolicyDraft,
  buildPortfolioIntent,
  checkPortfolioIntent,
  confirmPortfolioExecution,
  executePortfolioIntent,
  fetchPortfolioPageData,
  fetchPortfolioReceipts,
  fetchPortfolioRecommendation,
  savePortfolioPolicy,
  setPortfolioGovernedExecutionState,
  togglePortfolioEmergencyStop,
} from "./api";
import {
  ASSET_DECIMALS,
  MAINNET_TOKEN_BY_SYMBOL,
  buildWalletCallsFromExecution,
  extractExecutionError,
  fromWei,
  minSwapAmountForAsset,
  optimizeWalletCallsForExecution,
} from "./execution";
import { formatAssetAmount, formatEditableAmount, formatUsd } from "./formatters";

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

import {
  aggregateAssets,
  chainBadgeLabel,
  isMainnetChain,
  normalizeAllocationMap,
  normalizeReceiptStatus,
  proposalKeyForIntent,
  receiptEventGroup,
  receiptEventSummary,
  receiptEventTitle,
} from "./helpers";
import type {
  ActionType,
  ExecutorReadiness,
  GateResult,
  GovernedExecution,
  PolicyDraft,
  PolicySnapshot,
  PortableReceiptData,
  PortfolioSnapshot,
  PreparedCall,
  Receipt,
  Recommendation,
  RecommendationRouteOption,
  SupportedAsset,
  WorkflowMode,
} from "./types";
import { useRiskProfileV2 } from "@/hooks/useProfile";
import { useMistPrivacy } from "@/hooks/useMistPrivacy";
import { getApiErrorMessage } from "@/lib/api/client";
import { voyagerTxUrl } from "@/lib/explorer";
import { getTxStatus, type TxSettlementStatus } from "@/lib/pendingTx";

const SUPPORTED_ASSETS: SupportedAsset[] = ["ETH", "STRK", "USDC", "WBTC"];
const MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL_MAINNET ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  "";
const PREPARED_WALLET_CALL_TTL_MS = 20_000;

export function usePortfolioPageShell() {
  const { address, account, isConnected, chainId } = useAccount();
  const { profile } = useRiskProfileV2(address);
  const router = useRouter();

  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [policy, setPolicy] = useState<PolicySnapshot | null>(null);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [readiness, setReadiness] = useState<ExecutorReadiness | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendationNotice, setRecommendationNotice] = useState<string | null>(null);
  const [aiProposalApplied, setAiProposalApplied] = useState(false);
  const [gateResult, setGateResult] = useState<GateResult | null>(null);
  const [lastCheckedProposalKey, setLastCheckedProposalKey] = useState<string | null>(null);
  const [lastPreparedAdapter, setLastPreparedAdapter] = useState<string | null>(null);
  const [executionNote, setExecutionNote] = useState<string | null>(null);
  const [executionTxHash, setExecutionTxHash] = useState<string | null>(null);
  const [executionReceiptCid, setExecutionReceiptCid] = useState<string | null>(null);
  const [executionReceipt, setExecutionReceipt] = useState<PortableReceiptData | null>(null);
  const [pendingPreparedCalls, setPendingPreparedCalls] = useState<PreparedCall[] | null>(null);
  const [pendingWalletCalls, setPendingWalletCalls] = useState<Call[] | null>(null);
  const [pendingReceiptId, setPendingReceiptId] = useState<string | null>(null);
  const [pendingRouteLabel, setPendingRouteLabel] = useState<string | null>(null);
  const [pendingPreparedAt, setPendingPreparedAt] = useState<number | null>(null);
  const [txStatusMap, setTxStatusMap] = useState<Record<string, TxSettlementStatus>>({});
  const [showFullGateMatrix, setShowFullGateMatrix] = useState(false);
  const [showSafetyDetails, setShowSafetyDetails] = useState(false);
  const [showPolicyEditor, setShowPolicyEditor] = useState(false);
  const [showSessionKeyModal, setShowSessionKeyModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [loadingRecommendation, setLoadingRecommendation] = useState(false);
  const [intentSet, setIntentSet] = useState(false);
  const recommendationJustAppliedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [privateMode, setPrivateMode] = useState(false);

  // MIST.cash privacy layer (deposit → ZK withdraw → break on-chain link)
  const mistPrivacy = useMistPrivacy();
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("manual");

  const [actionType, setActionType] = useState<ActionType>("rebalance");
  const [swapAssetIn, setSwapAssetIn] = useState<SupportedAsset>("ETH");
  const [swapAssetOut, setSwapAssetOut] = useState<SupportedAsset>("USDC");
  const [swapAmount, setSwapAmount] = useState("0.10");
  const [slippageBps, setSlippageBps] = useState("50");
  const [targetWeights, setTargetWeights] = useState<Record<SupportedAsset, string>>({
    ETH: "40",
    STRK: "20",
    USDC: "30",
    WBTC: "10",
  });

  const portableReceiptHref = useMemo(() => {
    const registryReceiptId = receipts.find((receipt) => receipt.metadata?.portable_receipt?.registry_receipt_id)
      ?.metadata?.portable_receipt?.registry_receipt_id;
    return registryReceiptId ? `/archive?receipt=${registryReceiptId}` : null;
  }, [receipts]);

  const assetSummary = useMemo(() => aggregateAssets(portfolio?.positions ?? []), [portfolio]);
  const totalTrackedValue = useMemo(
    () => Object.values(assetSummary).reduce((sum, asset) => sum + asset.valueUsd, 0),
    [assetSummary],
  );
  const unsupportedAssets = useMemo(() => {
    const walletAssets = portfolio?.wallet_assets_found ?? [];
    return walletAssets.filter((asset, index) => {
      if (SUPPORTED_ASSETS.includes(asset as SupportedAsset)) return false;
      return walletAssets.indexOf(asset) === index;
    });
  }, [portfolio]);
  const hasSupportedCapital = totalTrackedValue > 0.01;
  const currentAllocations = useMemo(
    () =>
      SUPPORTED_ASSETS.reduce(
        (acc, asset) => {
          acc[asset] = totalTrackedValue > 0 ? (assetSummary[asset].valueUsd / totalTrackedValue) * 100 : 0;
          return acc;
        },
        { ETH: 0, STRK: 0, USDC: 0, WBTC: 0 } as Record<SupportedAsset, number>,
      ),
    [assetSummary, totalTrackedValue],
  );
  const swapAvailableAmount = assetSummary[swapAssetIn].amount;
  const swapAvailableUsd = assetSummary[swapAssetIn].valueUsd;
  const swapAmountValue = Number.parseFloat(swapAmount) || 0;
  const swapAmountPercent = swapAvailableAmount > 0 ? Math.min(100, (swapAmountValue / swapAvailableAmount) * 100) : 0;
  const minSwapAmount = minSwapAmountForAsset(swapAssetIn);
  const isBelowMinSwap = swapAmountValue > 0 && swapAmountValue < minSwapAmount;
  const targetWeightSum = useMemo(
    () => SUPPORTED_ASSETS.reduce((sum, asset) => sum + (Number.parseFloat(targetWeights[asset]) || 0), 0),
    [targetWeights],
  );
  const currentIntent = useMemo(
    () =>
      buildPortfolioIntent({
        actionType,
        swapAssetIn,
        swapAssetOut,
        swapAmount,
        slippageBps,
        targetWeights,
      }),
    [actionType, swapAssetIn, swapAssetOut, swapAmount, slippageBps, targetWeights],
  );
  const currentProposalKey = useMemo(() => proposalKeyForIntent(currentIntent), [currentIntent]);
  const hasFreshGateCheck = Boolean(gateResult && lastCheckedProposalKey === currentProposalKey);
  const userTargetAllocations = useMemo(
    () => ({
      ETH: Number.parseFloat(targetWeights.ETH) || 0,
      STRK: Number.parseFloat(targetWeights.STRK) || 0,
      USDC: Number.parseFloat(targetWeights.USDC) || 0,
      WBTC: Number.parseFloat(targetWeights.WBTC) || 0,
    }),
    [targetWeights],
  );
  const aiTargetAllocations = useMemo(
    () =>
      recommendation
        ? {
            ETH: recommendation.target_allocations.ETH ?? 0,
            STRK: recommendation.target_allocations.STRK ?? 0,
            USDC: recommendation.target_allocations.USDC ?? 0,
            WBTC: recommendation.target_allocations.WBTC ?? 0,
          }
        : null,
    [recommendation],
  );
  const aiExecutionPreview = useMemo(() => {
    const steps = recommendation?.derived_swap_steps ?? [];
    if (!steps.length) return null;
    const total = steps.reduce((sum, step) => sum + (Number(step.value_usd) || 0), 0);
    return { steps, total };
  }, [recommendation]);
  const recommendedSwapOptions = useMemo(
    () =>
      recommendation?.recommendation_mode === "best_next_move"
        ? recommendation?.recommended_alternatives ?? []
        : [],
    [recommendation],
  );
  const selectedRecommendedSwapOption = useMemo(
    () => recommendedSwapOptions.find((option) => option.selected) ?? null,
    [recommendedSwapOptions],
  );
  const warningGateConstraints = useMemo(
    () =>
      (gateResult?.constraint_results ?? []).filter((item) => {
        if (item.warning && item.passed) return true;
        if (gateResult?.proof_mode !== "groth16" && item.kind === "zkml" && !item.passed) return true;
        return false;
      }),
    [gateResult],
  );
  const failedGateConstraints = useMemo(
    () =>
      (gateResult?.constraint_results ?? []).filter((item) => {
        if (gateResult?.proof_mode !== "groth16" && item.kind === "zkml" && !item.passed) return false;
        return !item.passed;
      }),
    [gateResult],
  );
  const passedGateCount = useMemo(
    () => (gateResult?.constraint_results ?? []).filter((item) => item.passed).length,
    [gateResult],
  );
  const rebalancePresets = useMemo(() => {
    const current = normalizeAllocationMap(currentAllocations);
    const conservative = normalizeAllocationMap({
      ETH: Math.max(22, current.ETH - 10),
      STRK: Math.max(6, current.STRK - 12),
      USDC: current.USDC + 22,
    });
    const marketNeutral = normalizeAllocationMap({
      ETH: Math.max(28, current.ETH - 4),
      STRK: Math.max(18, current.STRK - 2),
      USDC: Math.max(25, current.USDC + 6),
    });
    const aggressive = normalizeAllocationMap({
      ETH: Math.max(18, current.ETH - 6),
      STRK: Math.min(62, current.STRK + 20),
      USDC: Math.max(10, current.USDC - 12),
    });
    return [
      { id: "conservative", label: "Conservative", description: "Hold a larger reserve and keep volatility lower.", allocations: conservative },
      { id: "market-neutral", label: "Market Neutral", description: "Balance ETH, STRK, and cash more evenly.", allocations: marketNeutral },
      { id: "aggressive", label: "Aggressive", description: "Lean into STRK risk and reduce idle cash.", allocations: aggressive },
    ];
  }, [currentAllocations]);
  const aiProposalKey = useMemo(
    () => (recommendation?.intent ? proposalKeyForIntent(recommendation.intent) : null),
    [recommendation],
  );
  const proposalSourceLabel = useMemo(() => {
    if (actionType === "swap") {
      const matchingOption = recommendedSwapOptions.find(
        (option) =>
          currentIntent.type === "swap" &&
          currentIntent.token_in === option.from_asset &&
          currentIntent.token_out === option.to_asset &&
          String(currentIntent.amount_wei ?? "") === String(option.amount_wei),
      );
      if (matchingOption?.selected) return workflowMode === "automated" ? "Governed route" : workflowMode === "assisted" ? "Guided route" : "Best live route";
      if (matchingOption) return "Route option";
      return "Manual swap";
    }
    if (workflowMode === "automated") return "Governed draft";
    if (workflowMode === "assisted") return recommendation?.recommendation_mode === "best_next_move" ? "Guided route" : "Guided draft";
    if (recommendation?.recommendation_mode === "best_next_move") return "Best next move";
    if (aiProposalApplied || (aiProposalKey && currentProposalKey === aiProposalKey)) return "Suggested target";
    return "Manual target";
  }, [actionType, workflowMode, aiProposalApplied, aiProposalKey, currentIntent, currentProposalKey, recommendation, recommendedSwapOptions]);
  const proposalOutdated = Boolean(gateResult) && lastCheckedProposalKey !== currentProposalKey;
  const suggestedSwapFallback = useMemo(() => {
    if (actionType !== "rebalance") return null;
    const step = gateResult?.swap_steps?.[0];
    if (!step || (gateResult?.swap_steps?.length ?? 0) !== 1) return null;
    const totalValue = portfolio?.total_value_usd ?? totalTrackedValue;
    if (totalValue > 25 && gateResult?.allowed) return null;
    return {
      label: `${step.from_asset} → ${step.to_asset} may clear more cleanly`,
      detail: `Instead of shopping percentage targets, switch this draft to one direct ${formatAssetAmount(step.amount, step.from_asset)} ${step.from_asset} swap.`,
    };
  }, [actionType, gateResult, portfolio?.total_value_usd, totalTrackedValue]);
  const hasPreparedRebalance = actionType === "rebalance" && Boolean(pendingWalletCalls?.length);
  const canSignPreparedRebalance = hasPreparedRebalance && Boolean(account && address);
  const canManualOverride = useMemo(() => {
    if (pendingWalletCalls?.length) return false;
    if (workflowMode !== "manual") return false;
    if (!hasFreshGateCheck || gateResult?.allowed) return false;
    return Boolean(gateResult?.swap_steps?.length);
  }, [workflowMode, hasFreshGateCheck, gateResult, pendingWalletCalls]);
  const canAdvisoryOverride = useMemo(() => {
    if (pendingWalletCalls?.length) return false;
    if (workflowMode === "manual") return false;
    if (!hasFreshGateCheck || gateResult?.allowed) return false;
    if (!gateResult?.swap_steps?.length) return false;
    const failedNames = failedGateConstraints.map((item) => item.name);
    return failedNames.length === 1 && failedNames[0] === "FeeEfficiencyGuard";
  }, [workflowMode, hasFreshGateCheck, gateResult, failedGateConstraints, pendingWalletCalls]);

  const safetySummaryLine = useMemo(() => {
    if (!gateResult) return "No fresh safety result yet.";
    if (failedGateConstraints.length) return `${failedGateConstraints.length} check${failedGateConstraints.length === 1 ? "" : "s"} need attention.`;
    if (warningGateConstraints.length) return `${warningGateConstraints.length} warning${warningGateConstraints.length === 1 ? "" : "s"} to review.`;
    return `${passedGateCount} checks passed.`;
  }, [gateResult, failedGateConstraints.length, warningGateConstraints.length, passedGateCount]);
  const feeGuardResult = useMemo(
    () => gateResult?.constraint_results.find((item) => item.name === "FeeEfficiencyGuard") ?? null,
    [gateResult],
  );
  const gasReserveResult = useMemo(
    () => gateResult?.constraint_results.find((item) => item.name === "GasReserveGuard") ?? null,
    [gateResult],
  );
  const proposalTurnoverPct = useMemo(() => {
    if (!gateResult?.swap_steps?.length || totalTrackedValue <= 0) return null;
    const movedUsd = gateResult.swap_steps.reduce((sum, step) => sum + (Number(step.value_usd) || 0), 0);
    return (movedUsd / totalTrackedValue) * 100;
  }, [gateResult, totalTrackedValue]);
  const driftLabel = useMemo(() => {
    const status = recommendation?.drift_monitor?.status;
    if (status === "rebalance") return "Rebalance suggested";
    if (status === "watch") return "Drifted";
    return "On target";
  }, [recommendation]);
  const safetyLabel = gateResult
    ? canManualOverride
      ? "Manual route available"
      : canAdvisoryOverride
      ? "Permitted with fee warning"
      : gateResult.allowed
        ? "Safe to sign"
        : "Needs adjustment"
    : "Drafting";
  const totalPortfolioValue = portfolio?.total_value_usd ?? totalTrackedValue;
  const headerBreakdown = useMemo(() => {
    const active = SUPPORTED_ASSETS.filter((asset) => assetSummary[asset].valueUsd > 0.01);
    return active.length ? active.join(" • ") : "ETH • STRK • USDC";
  }, [assetSummary]);
  const automatedGovernedState = useMemo<{
    hasOnboarding: boolean;
    hasAgent: boolean;
    activeSessionCount: number;
    activeSessionKeyIds: string[];
    governedState: NonNullable<GovernedExecution["state"]>;
    controlState: NonNullable<GovernedExecution["control_state"]>;
    executionMode: GovernedExecution["mode"];
    primaryHint: string;
    passportScore: number;
    letterRating: string;
    profileSource: GovernedExecution["source"];
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
  }>(() => {
    const backendState = recommendation?.governed_execution;
    if (backendState) {
      return {
        hasOnboarding: Boolean(backendState.has_onboarding),
        hasAgent: Boolean(backendState.has_agent),
        activeSessionCount: Number(backendState.active_session_count ?? 0),
        activeSessionKeyIds: backendState.active_session_key_ids ?? [],
        governedState: backendState.state ?? "session_unavailable",
        controlState: backendState.control_state ?? "disarmed",
        executionMode: backendState.mode,
        primaryHint:
          backendState.primary_hint ||
          backendState.reason_hints?.[0] ||
          "Governed execution is using the current onboarding and session-key posture for this wallet.",
        passportScore: Number(backendState.passport_score ?? profile?.passport?.composite_score ?? 0),
        letterRating: String(backendState.passport_letter ?? profile?.passport?.letter_rating ?? "D"),
        profileSource: backendState.source,
        riskProfile: String(backendState.risk_profile ?? "balanced"),
        riskTolerance: Number(backendState.risk_tolerance ?? 50),
        policyExecutionMode: String(backendState.policy_execution_mode ?? "assist"),
        readinessStatus:
          backendState.readiness?.status ??
          (backendState.mode === "allow"
            ? "ready"
            : backendState.has_onboarding
              ? "needs_session_key"
              : "needs_onboarding"),
        readinessLabel:
          backendState.readiness?.label ??
          (backendState.mode === "allow"
            ? "Ready to govern"
            : backendState.has_onboarding
              ? "Session key needed"
              : "Onboarding needed"),
        readinessDetail:
          backendState.readiness?.detail ||
          backendState.primary_hint ||
          "Governed execution is using the current onboarding and session-key posture for this wallet.",
        nextActionType: backendState.next_action?.type ?? "wait",
        nextActionLabel: backendState.next_action?.label ?? "No governed move ready yet",
        nextActionDetail:
          backendState.next_action?.detail ||
          backendState.primary_hint ||
          "The governed lane does not have an executable next move yet.",
        nextActionRouteLabel: backendState.next_action?.route_label ?? null,
        nextActionRouteDetail: backendState.next_action?.route_detail ?? null,
        nextActionTradeCount: Number(backendState.next_action?.trade_count ?? 0),
        nextActionValueUsd: Number(backendState.next_action?.value_moved_usd ?? 0),
      };
    }

    const executionDecision = profile?.decisions?.execution;
    const executionMode: GovernedExecution["mode"] = executionDecision?.mode ?? "advisory";
    const sessionInfo = profile?.identity?.session_summary;
    const activeSessionCount = Number(sessionInfo?.active_count ?? 0);
    const hasAgent = Boolean(profile?.identity?.has_agent);
    const passportScore = Number(profile?.passport?.composite_score ?? 0);
    const letterRating = String(profile?.passport?.letter_rating ?? "D");
    const primaryHint =
      executionDecision?.reason_hints?.[0] ??
      (hasAgent
        ? activeSessionCount > 0
          ? "Governed execution can use the current execution profile."
          : "Create or renew a session key before relying on governed execution."
        : "Complete onboarding before relying on governed execution.");

    return {
      hasOnboarding: hasAgent,
      hasAgent,
      activeSessionCount,
      activeSessionKeyIds: [],
      governedState: hasAgent ? (activeSessionCount > 0 ? "policy_fallback" : "session_unavailable") : "session_unavailable",
      controlState: "disarmed",
      executionMode,
      primaryHint,
      passportScore,
      letterRating,
      profileSource: hasAgent ? "onboarding_constraints" : "portfolio_policy",
      riskProfile: recommendation?.risk_profile ?? "balanced",
      riskTolerance: Number(recommendation?.risk_tolerance ?? 50),
      policyExecutionMode: "assist",
      readinessStatus: hasAgent ? (activeSessionCount > 0 ? "policy_fallback" : "needs_session_key") : "needs_onboarding",
      readinessLabel: hasAgent ? (activeSessionCount > 0 ? "Policy fallback" : "Session key needed") : "Onboarding needed",
      readinessDetail: primaryHint,
      nextActionType: "wait",
      nextActionLabel: "No governed move ready yet",
      nextActionDetail: "The governed lane is waiting for a portfolio recommendation before it can summarize the next move.",
      nextActionRouteLabel: null,
      nextActionRouteDetail: null,
      nextActionTradeCount: 0,
      nextActionValueUsd: 0,
    };
  }, [profile, recommendation]);
  const automatedSessionKeyId = useMemo(
    () => automatedGovernedState.activeSessionKeyIds[0] ?? null,
    [automatedGovernedState.activeSessionKeyIds],
  );
  const governedExecutionControlState = policy?.governed_execution_state ?? automatedGovernedState.controlState ?? "disarmed";
  const governedExecutionDisarmed = governedExecutionControlState !== "armed";
  const primaryActionLabel = useMemo(() => {
    if (hasPreparedRebalance) {
      if (workflowMode === "manual") return "Sign manual route";
      if (workflowMode === "automated") return "Authorize governed route";
      return "Sign guided route";
    }
    if (workflowMode === "automated" && automatedGovernedState.governedState === "executing") return "Governed move executing";
    if (workflowMode === "automated" && !automatedGovernedState.hasOnboarding) return "Complete onboarding";
    if (workflowMode === "automated" && automatedGovernedState.activeSessionCount <= 0) return "Add session key";
    if (workflowMode === "automated" && governedExecutionDisarmed) return "Arm governed execution";
    if (executing) return workflowMode === "automated" ? "Arming governed move" : "Preparing";
    if (loadingRecommendation && !hasFreshGateCheck) return workflowMode === "automated" ? "Loading governed route" : "Loading recommendation";
    if (workflowMode === "manual") {
      if (hasFreshGateCheck && !gateResult?.allowed && !gateResult?.swap_steps?.length) {
        return actionType === "rebalance" ? "No route available" : "Needs route";
      }
      if (actionType === "rebalance") return canManualOverride ? "Prepare route anyway" : "Prepare manual route";
      return canManualOverride ? "Sign anyway" : "Sign manual swap";
    }
    if (checking && !hasFreshGateCheck) return workflowMode === "automated" ? "Evaluating governed move" : "Checking Safety";
    if (canAdvisoryOverride) return workflowMode === "automated" ? "Authorize with fee warning" : "Continue with fee warning";
    if (hasFreshGateCheck && !gateResult?.allowed) return workflowMode === "automated" ? "Governed move blocked" : "Needs adjustment";
    if (!hasFreshGateCheck) {
      if (workflowMode === "automated") return "Evaluate governed move";
      return actionType === "rebalance" ? "Review guided move" : "Review guided swap";
    }
    if (actionType === "rebalance") return workflowMode === "automated" ? "Arm governed execution" : "Review guided move";
    return workflowMode === "automated" ? "Arm governed swap" : "Sign guided swap";
  }, [actionType, hasPreparedRebalance, workflowMode, automatedGovernedState, governedExecutionDisarmed, executing, checking, loadingRecommendation, hasFreshGateCheck, gateResult, canAdvisoryOverride, canManualOverride]);
  const primaryActionDisabled = useMemo(() => {
    if (executing) return true;
    if (hasPreparedRebalance) return !canSignPreparedRebalance;
    if (workflowMode === "automated" && automatedGovernedState.governedState === "executing") return true;
    if (workflowMode === "automated" && !automatedGovernedState.hasOnboarding) return false;
    if (workflowMode === "automated" && automatedGovernedState.activeSessionCount <= 0) return false;
    if (workflowMode === "automated" && governedExecutionDisarmed) return false;
    if (workflowMode === "manual") {
      if (hasFreshGateCheck && !gateResult?.allowed && !gateResult?.swap_steps?.length) return true;
      return checking;
    }
    // Assisted/Automated: if gate already allowed, don't disable even during background re-check
    if (hasFreshGateCheck && gateResult?.allowed) return false;
    if (canAdvisoryOverride) return checking;
    if (hasFreshGateCheck && !gateResult?.allowed) return true;
    if (!hasFreshGateCheck) return true;
    return checking;
  }, [executing, hasPreparedRebalance, canSignPreparedRebalance, workflowMode, automatedGovernedState, governedExecutionDisarmed, hasFreshGateCheck, gateResult, checking, canAdvisoryOverride]);
  const deskState = useMemo(() => {
    if (workflowMode === "automated" && !automatedGovernedState.hasOnboarding) {
      return {
        label: "Onboarding needed",
        tone: "warning" as const,
        headline: "Automated mode needs onboarding before it can govern this wallet.",
        detail: "Complete onboarding first. Governed execution falls back to your onboarding profile and session posture.",
      };
    }
    if (workflowMode === "automated" && automatedGovernedState.activeSessionCount <= 0) {
      return {
        label: "Session key needed",
        tone: "warning" as const,
        headline: "Automated mode needs an active session key.",
        detail: "Add or renew a governed session key before relying on automated execution in this lane.",
      };
    }
    if (workflowMode === "automated" && automatedGovernedState.governedState === "executing") {
      return {
        label: "Governed move submitted",
        tone: "good" as const,
        headline: "A governed move is already in flight.",
        detail: "Wait for the current governed execution to settle before arming another move in this lane.",
      };
    }
    if (workflowMode === "automated" && governedExecutionDisarmed) {
      return {
        label: "Governed execution paused",
        tone: "warning" as const,
        headline: "Governed execution is disarmed for this wallet.",
        detail: "Primary action will arm governed execution again. Until then, automated mode will not authorize moves.",
      };
    }
    if (executionTxHash) {
      return {
        label: workflowMode === "automated" ? "Governed move submitted" : "Submitted",
        tone: "good" as const,
        headline: workflowMode === "automated" ? "The governed move is out." : "Wallet submission is out.",
        detail: "Track confirmation in the activity rail while the agent keeps watching drift.",
      };
    }
    if (actionType === "rebalance" && pendingWalletCalls?.length) {
      return {
        label: workflowMode === "manual" ? "Route ready" : workflowMode === "automated" ? "Governed route ready" : "Ready to sign",
        tone: "good" as const,
        headline:
          workflowMode === "manual"
            ? "The manual route is ready in your wallet."
            : workflowMode === "automated"
              ? "The governed route is ready to authorize."
              : "The rebalance is ready in your wallet.",
        detail:
          workflowMode === "manual"
            ? "The Gate output is recorded below, but manual mode lets you inspect and sign the prepared route yourself."
            : workflowMode === "automated"
              ? "Primary action now authorizes the governed route with the current onboarding profile and session-key posture."
            : "Review the exact sells and buys below, then sign once.",
      };
    }
    if (hasFreshGateCheck) {
      if (workflowMode === "manual" && !gateResult?.allowed && gateResult?.swap_steps?.length) {
        return {
          label: "Manual route available",
          tone: "warning" as const,
          headline: "Manual mode can still prepare this route.",
          detail: "The Gate remains visible as advisory output, but a real wallet route exists and you can inspect it yourself.",
        };
      }
      if (!gateResult?.allowed && failedGateConstraints.length === 1 && failedGateConstraints[0]?.name === "FeeEfficiencyGuard") {
        return {
          label: "Permitted with fee warning",
          tone: "warning" as const,
          headline:
            workflowMode === "automated"
              ? "The governed route exists, but the fee is heavy for the size."
              : "The route exists, but the fee is heavy for the size.",
          detail:
            workflowMode === "automated"
              ? "You can still authorize the governed route and inspect the exact cost yourself, or switch modes and edit the move manually."
              : "You can still prepare the wallet path and inspect the exact cost yourself, or edit the target to improve the economics.",
        };
      }
      return {
        label:
          workflowMode === "automated"
            ? gateResult?.allowed
              ? "Governed route ready"
              : "Governed move blocked"
            : gateResult?.allowed
              ? "Safe to sign"
              : "Needs adjustment",
        tone: gateResult?.allowed ? ("good" as const) : ("warning" as const),
        headline:
          workflowMode === "automated"
            ? gateResult?.allowed
              ? "The governed lane cleared this move."
              : "The governed lane is blocking this move."
            : gateResult?.allowed
              ? "The current proposal cleared safety checks."
              : "The current proposal needs changes before signing.",
        detail:
          workflowMode === "automated"
            ? gateResult?.allowed
              ? "Primary action now arms the governed move with the current policy and session-key posture."
              : "Automated mode will not arm this move until the governed draft clears again."
            : gateResult?.allowed
              ? "You can move straight to review and wallet signing."
              : "Adjust the target mix or amount and the desk will re-check automatically.",
      };
    }
    if (checking) {
      return {
        label: workflowMode === "automated" ? "Evaluating governed move" : "Checking",
        tone: "neutral" as const,
        headline:
          workflowMode === "automated"
            ? "Re-evaluating the governed move."
            : "Running the safety check in the background.",
        detail:
          workflowMode === "automated"
            ? "The governed lane is refreshing policy, drift, and route economics now."
            : "Keep editing if needed. The desk updates when the fresh result lands.",
      };
    }
    return {
      label: workflowMode === "automated" ? "Governed draft" : "Drafting",
      tone: "neutral" as const,
      headline:
        workflowMode === "manual"
          ? "Shape a route or target first."
          : workflowMode === "automated"
            ? "Automated mode is shaping the next governed move."
            : "Shape the target mix first.",
      detail:
        workflowMode === "manual"
          ? "Manual mode still runs the Gate and records the result, but a real route can go to wallet even when the Gate does not clear it."
          : workflowMode === "automated"
            ? "Automated mode evaluates policy, drift, and route quality before it arms a governed action."
          : "The desk will run the safety check automatically as you update the proposal.",
    };
  }, [actionType, pendingWalletCalls, workflowMode, automatedGovernedState, governedExecutionDisarmed, hasFreshGateCheck, gateResult, checking, executionTxHash, failedGateConstraints]);
  const proposalHeadline = useMemo(() => {
    if (workflowMode === "manual") {
      if (actionType === "swap") return `Swap ${swapAssetIn} into ${swapAssetOut}`;
      const leadStep = gateResult?.swap_steps?.[0];
      return leadStep ? `Rebalance via ${leadStep.from_asset} → ${leadStep.to_asset}` : "Rebalance toward your target mix";
    }
    if (workflowMode === "automated") {
      if (recommendation) {
        return recommendation.rebalance_summary?.headline ?? "Strategy and policy are shaping the next governed move.";
      }
      return automatedGovernedState.nextActionLabel || automatedGovernedState.readinessLabel;
    }
    return recommendation?.rebalance_summary?.headline ?? "Set a target mix and let the Gate decide if it is safe to sign.";
  }, [workflowMode, actionType, swapAssetIn, swapAssetOut, gateResult, recommendation, automatedGovernedState]);
  const proposalReason = useMemo(() => {
    if (workflowMode === "manual") {
      return actionType === "swap"
        ? "Manual mode starts from the trade you set. The Gate still scores route quality, policy, and cost, but the wallet path stays in your hands."
        : "Manual mode starts from your target mix. The Gate translates it into an executable path and records the checks, but the route can still continue to wallet.";
    }
    if (workflowMode === "automated") {
      if (!recommendation) {
        return automatedGovernedState.nextActionDetail || automatedGovernedState.readinessDetail;
      }
      return (
        recommendation?.recommendation_note ??
        recommendation?.rebalance_summary?.why ??
        "Experimental governed mode lets strategy and policy shape the draft while the Gate remains in charge of execution."
      );
    }
    return (
      recommendation?.recommendation_note ??
      recommendation?.rebalance_summary?.why ??
      "The suggested target stays separate from your target. Use it as a suggestion, not an automatic override."
    );
  }, [workflowMode, actionType, recommendation, automatedGovernedState]);
  const proposalRouteLabel = useMemo(() => {
    if (workflowMode === "manual") {
      const leadStep = gateResult?.swap_steps?.[0];
      return leadStep ? `${leadStep.from_asset} → ${leadStep.to_asset}` : null;
    }
    return recommendation?.recommended_route_label ?? null;
  }, [workflowMode, gateResult, recommendation]);
  const proposalRouteDetail = useMemo(() => {
    if (workflowMode === "manual") {
      const leadStep = gateResult?.swap_steps?.[0];
      return leadStep ? `${formatUsd(leadStep.value_usd)} from the current manual draft` : null;
    }
    return recommendation?.recommended_route_detail ?? null;
  }, [workflowMode, gateResult, recommendation]);
  const recommendedSwapStarter = useMemo(() => {
    const option = selectedRecommendedSwapOption;
    const step =
      option ??
      (recommendation?.recommendation_mode === "best_next_move" ? recommendation?.derived_swap_steps?.[0] : null);
    if (!step) return null;
    const routeLabel = option?.route_label ?? recommendation?.recommended_route_label ?? `${step.from_asset} → ${step.to_asset}`;
    return {
      label: `Start from ${routeLabel}`,
      detail:
        option?.detail ??
        `${formatUsd(step.value_usd)} direct swap${recommendation?.recommended_route_detail ? ` • ${recommendation.recommended_route_detail}` : ""}`,
    };
  }, [recommendation, selectedRecommendedSwapOption]);
  const recommendedSwapAlternatives = useMemo(
    () => recommendedSwapOptions.filter((option) => !option.selected),
    [recommendedSwapOptions],
  );
  const recentActivityItems = useMemo(
    () =>
      receipts.slice(0, 15).map((receipt) => {
        const txStatus = receipt.tx_hash ? txStatusMap[receipt.tx_hash] : undefined;
        const status = normalizeReceiptStatus(receipt, txStatus);
        const registryId = receipt.metadata?.portable_receipt?.registry_receipt_id;
        const cid = receipt.metadata?.portable_receipt?.cid;
        const anchorTier = receipt.metadata?.portable_receipt?.anchor_tier
          ?? (receipt.metadata as Record<string, unknown> | undefined)?.anchor_tier as string | undefined
          ?? null;
        return {
          id: receipt.receipt_id,
          title: receiptEventTitle(receipt),
          summary: receiptEventSummary(receipt, status),
          status,
          timestamp: relativeTime(receipt.timestamp),
          txHref: receipt.tx_hash ? voyagerTxUrl(receipt.tx_hash) : null,
          receiptHref: registryId ? `/archive?receipt=${registryId}` : null,
          verifyHref: cid ? `/verify?cid=${cid}` : null,
          group: receiptEventGroup(receipt),
          cid: cid ?? null,
          anchorTier: anchorTier ?? null,
        };
      }),
    [receipts, txStatusMap],
  );

  const applyRecommendationDraft = useCallback((payload: Recommendation, mode: WorkflowMode) => {
    const selectedOption =
      payload.recommendation_mode === "best_next_move"
        ? payload.recommended_alternatives?.find((option) => option.selected) ?? null
        : null;
    const bestStep =
      selectedOption ??
      (payload.recommendation_mode === "best_next_move" ? payload.derived_swap_steps?.[0] : null);

    if (bestStep) {
      setActionType("swap");
      setSwapAssetIn(bestStep.from_asset);
      setSwapAssetOut(bestStep.to_asset);
      setSwapAmount(formatEditableAmount(bestStep.amount, bestStep.from_asset));
      setAiProposalApplied(false);
      setExecutionNote(
        mode === "automated"
          ? `Loaded the governed live route: ${bestStep.from_asset} → ${bestStep.to_asset} for about ${formatUsd(bestStep.value_usd)}.`
          : `Loaded the guided live route: ${bestStep.from_asset} → ${bestStep.to_asset} for about ${formatUsd(bestStep.value_usd)}.`,
      );
      return;
    }

    if (payload.target_allocations) {
      const normalizedTarget = normalizeAllocationMap({
        ETH: payload.target_allocations.ETH ?? 0,
        STRK: payload.target_allocations.STRK ?? 0,
        USDC: payload.target_allocations.USDC ?? 0,
        WBTC: payload.target_allocations.WBTC ?? 0,
      });
      setActionType("rebalance");
      setTargetWeights({
        ETH: String(normalizedTarget.ETH),
        STRK: String(normalizedTarget.STRK),
        USDC: String(normalizedTarget.USDC),
        WBTC: String(normalizedTarget.WBTC),
      });
      setAiProposalApplied(true);
      setExecutionNote(
        mode === "automated"
          ? "Loaded the governed target draft into the desk."
          : "Loaded the guided target draft into the desk.",
      );
      return;
    }

    setActionType("rebalance");
    setAiProposalApplied(false);
  }, []);

  const refreshData = async (walletAddress: string) => {
    setLoading(true);
    setError(null);
    try {
      const { portfolio: portfolioPayload, policy: policyPayload, readiness: readinessPayload, receipts: receiptPayload } =
        await fetchPortfolioPageData(walletAddress);
      setPortfolio(portfolioPayload);
      setPolicy(policyPayload);
      setReadiness(readinessPayload);
      setReceipts(receiptPayload);
    } catch (err) {
      const message = getApiErrorMessage(err);
      setError(
        message
          ? `Unable to refresh the portfolio desk right now. ${message}`
          : "Unable to refresh the portfolio desk right now. Try again in a moment.",
      );
    } finally {
      setLoading(false);
    }
  };

  const setSwapAmountByPercent = (percent: number) => {
    if (!swapAvailableAmount) {
      setSwapAmount("");
      return;
    }
    const nextAmount = (swapAvailableAmount * percent) / 100;
    setSwapAmount(formatEditableAmount(nextAmount, swapAssetIn));
  };

  const updateTargetWeight = (asset: SupportedAsset, rawValue: string) => {
    const nextValue = rawValue === "" ? "" : String(Math.max(0, Math.min(100, Number.parseFloat(rawValue) || 0)));
    setTargetWeights((current) => ({ ...current, [asset]: nextValue }));
  };

  const applyTargetAllocationMap = (allocations: Record<SupportedAsset, number>) => {
    setActionType("rebalance");
    setTargetWeights({
      ETH: String(allocations.ETH),
      STRK: String(allocations.STRK),
      USDC: String(allocations.USDC),
      WBTC: String(allocations.WBTC),
    });
    if (aiTargetAllocations) {
      const aiNormalized = normalizeAllocationMap(aiTargetAllocations);
      const isAiMatch = SUPPORTED_ASSETS.every(
        (asset) => Math.abs((allocations[asset] ?? 0) - (aiNormalized[asset] ?? 0)) < 0.2,
      );
      setAiProposalApplied(isAiMatch);
    } else {
      setAiProposalApplied(false);
    }
  };

  const runGateCheck = async (intentOverride?: Record<string, unknown>) => {
    if (!address) return;
    setChecking(true);
    setError(null);
    setLastPreparedAdapter(null);
    setPendingPreparedCalls(null);
    setPendingWalletCalls(null);
    setPendingReceiptId(null);
    setPendingRouteLabel(null);
    setPendingPreparedAt(null);
    try {
      const intent = intentOverride ?? currentIntent;
      const payload = await checkPortfolioIntent(address, intent);
      setGateResult(payload);
      setLastCheckedProposalKey(proposalKeyForIntent(intent));
      setLastPreparedAdapter(payload.execution_preview?.execution_adapter ?? null);
      setReceipts(await fetchPortfolioReceipts(address));
    } catch (err) {
      const message = getApiErrorMessage(err);
      setError(
        message
          ? `Gate unavailable right now. ${message}`
          : "Gate unavailable right now. Try the safety check again in a moment.",
      );
    } finally {
      setChecking(false);
    }
  };

  const getRecommendation = useCallback(async () => {
    if (!address) return;
    setLoadingRecommendation(true);
    setError(null);
    setRecommendationNotice(null);
    setLastPreparedAdapter(null);
    setPendingPreparedCalls(null);
    setPendingWalletCalls(null);
    setPendingReceiptId(null);
    setPendingRouteLabel(null);
    setPendingPreparedAt(null);
    try {
      const payload = await fetchPortfolioRecommendation(address);
      setRecommendation(payload);
      setAiProposalApplied(false);
      if (workflowMode === "manual") {
        setExecutionNote("Loaded a fresh system recommendation. Switch to Assisted or Automated to load it into the draft.");
      }
    } catch (err) {
      setRecommendationNotice("The suggested target is unavailable right now. You can still edit your own target and run the safety check.");
    } finally {
      setLoadingRecommendation(false);
    }
  }, [address, workflowMode]);

  const applyAiTargets = () => {
    if (!aiTargetAllocations) return;
    applyTargetAllocationMap(normalizeAllocationMap(aiTargetAllocations));
  };

  const applySuggestedSwapFallback = () => {
    const step = gateResult?.swap_steps?.[0];
    if (!step) return;
    setActionType("swap");
    setSwapAssetIn(step.from_asset);
    setSwapAssetOut(step.to_asset);
    setSwapAmount(formatEditableAmount(step.amount, step.from_asset));
    setAiProposalApplied(false);
    setExecutionNote(
      `Switched to the simpler ${step.from_asset} → ${step.to_asset} swap so the desk can check one direct path instead of a full rebalance.`,
    );
  };

  const applyRecommendedSwapStarter = () => {
    const step =
      selectedRecommendedSwapOption ??
      (recommendation?.recommendation_mode === "best_next_move" ? recommendation?.derived_swap_steps?.[0] : null);
    if (!step) return;
    setActionType("swap");
    setSwapAssetIn(step.from_asset);
    setSwapAssetOut(step.to_asset);
    setSwapAmount(formatEditableAmount(step.amount, step.from_asset));
    setAiProposalApplied(false);
    setExecutionNote(
      `Started from the best live route: ${step.from_asset} → ${step.to_asset} for about ${formatUsd(step.value_usd)}.`,
    );
  };

  const applyRecommendedSwapOption = (option: RecommendationRouteOption) => {
    setActionType("swap");
    setSwapAssetIn(option.from_asset);
    setSwapAssetOut(option.to_asset);
    setSwapAmount(formatEditableAmount(option.amount, option.from_asset));
    setAiProposalApplied(false);
    setExecutionNote(
      `Loaded an alternate live route: ${option.route_label} for about ${formatUsd(option.value_usd)}.`,
    );
  };

  const signPreparedRebalance = async () => {
    if (!pendingWalletCalls?.length) {
      setExecutionNote("Review rebalance again before signing.");
      return;
    }
    if (!account || !address) {
      setExecutionNote("Reconnect the wallet before signing this rebalance.");
      return;
    }
    if (pendingPreparedAt && Date.now() - pendingPreparedAt > PREPARED_WALLET_CALL_TTL_MS) {
      setPendingWalletCalls(null);
      setPendingPreparedCalls(null);
      setPendingReceiptId(null);
      setPendingRouteLabel(null);
      setPendingPreparedAt(null);
      setExecutionNote("Quote expired. Review rebalance again before signing.");
      return;
    }
    setExecuting(true);
    setError(null);
    setExecutionNote("Signing rebalance with wallet...");
    try {
      const optimized = await optimizeWalletCallsForExecution(
        pendingWalletCalls,
        address,
        readiness?.rpc_url || MAINNET_RPC_URL || undefined,
      );
      const result = await account.execute(optimized.calls);
      setExecutionTxHash(result.transaction_hash);
      setPendingWalletCalls(null);
      setPendingPreparedCalls(null);
      setPendingReceiptId(null);
      setPendingRouteLabel(null);
      setPendingPreparedAt(null);
      setExecutionReceiptCid(null);
      setExecutionReceipt(null);
      if (pendingReceiptId) {
        try {
          const confirmPayload = await confirmPortfolioExecution(address, pendingReceiptId, result.transaction_hash);
          if (confirmPayload?.portable_receipt?.cid) {
            setExecutionReceiptCid(confirmPayload.portable_receipt.cid);
            setExecutionReceipt(confirmPayload.portable_receipt);
            setExecutionNote(`Receipt saved to IPFS and anchored on Starknet.`);
          } else {
            setExecutionNote(`Submitted via wallet. Tx ${result.transaction_hash.slice(0, 12)}...`);
          }
        } catch (confirmErr) {
          console.error("portfolio confirm failed after wallet submission", confirmErr);
          setExecutionNote(
            `Submitted via wallet. Tx ${result.transaction_hash.slice(0, 12)}... Receipt sync delayed.`,
          );
        }
      } else {
        setExecutionNote(
          `Submitted via wallet. Tx ${result.transaction_hash.slice(0, 12)}...`,
        );
      }
      await refreshData(address);
    } catch (err) {
      const message = getApiErrorMessage(err);
      if (message.includes("Insufficient tokens received")) {
        setPendingWalletCalls(null);
        setPendingPreparedCalls(null);
        setPendingReceiptId(null);
        setPendingRouteLabel(null);
        setPendingPreparedAt(null);
        setExecutionNote("Quote expired during wallet signing. Review rebalance again for a fresh route.");
      } else {
        setError(message);
      }
    } finally {
      setExecuting(false);
    }
  };

  const executeIntent = async (options?: {
    allowAdvisoryOverride?: boolean;
    allowManualOverride?: boolean;
    workflowMode?: WorkflowMode;
    sessionKeyId?: string | null;
  }) => {
    if (!address) return;
    if (!hasFreshGateCheck && !options?.allowManualOverride) {
      setExecutionNote("Run Gate Check on the current proposal before executing.");
      return;
    }
    setExecuting(true);
    setError(null);
    setLastPreparedAdapter(null);
    setPendingPreparedCalls(null);
    setPendingWalletCalls(null);
    setPendingReceiptId(null);
    setPendingRouteLabel(null);
    setPendingPreparedAt(null);
    setExecutionNote(
      options?.allowManualOverride
        ? actionType === "rebalance"
          ? "Preparing the manual route and recording the Gate result..."
          : "Preparing the manual swap and recording the Gate result..."
        : actionType === "rebalance"
          ? "Re-running the gate and preparing rebalance legs for wallet signing..."
          : "Re-running the gate and preparing a wallet request...",
    );
    setExecutionTxHash(null);
    setExecutionReceiptCid(null);
    try {
      if (account && !isMainnetChain(chainId)) {
        setExecutionNote("Wallet is connected on Sepolia. Switch Argent to Starknet mainnet first.");
        return;
      }
      const payload = await executePortfolioIntent(address, currentIntent, actionType, options);
      setGateResult(payload.gate);
      setLastPreparedAdapter(payload.execution_adapter ?? null);
      setPendingRouteLabel(payload.execution_adapter ?? null);

      if (payload.tx_hash) {
        setExecutionTxHash(payload.tx_hash);
        setExecutionReceiptCid(null);
        setExecutionReceipt(null);
        setExecutionNote(`Submitted. Tx ${payload.tx_hash.slice(0, 12)}...`);
        if (payload.receipt_id) {
          try {
            const confirmPayload = await confirmPortfolioExecution(address, payload.receipt_id, payload.tx_hash);
            if (confirmPayload?.portable_receipt?.cid) {
              setExecutionReceiptCid(confirmPayload.portable_receipt.cid);
              setExecutionReceipt(confirmPayload.portable_receipt);
              setExecutionNote(`Receipt saved to IPFS and anchored on Starknet.`);
            }
          } catch (confirmErr) {
            console.error("portfolio confirm failed after server-side submission", confirmErr);
          }
        }
        await refreshData(address);
        return;
      }

      const executionError = extractExecutionError(payload);
      if (payload.status === "error" || executionError) {
        if (actionType === "swap" && isBelowMinSwap && executionError) {
          setExecutionNote(
            `Amount looks too small for routing. Try at least ${formatAssetAmount(minSwapAmount, swapAssetIn)}.`,
          );
        } else {
          setExecutionNote(executionError ?? "Execution preparation failed before the wallet could sign.");
        }
        await refreshData(address);
        return;
      }

      if (account) {
        const walletExecution = buildWalletCallsFromExecution(payload);
        if (walletExecution.calls.length) {
          const adapterLabel = payload.execution_adapter ? payload.execution_adapter.toUpperCase() : "wallet route";
          if (actionType === "rebalance") {
            const optimized = await optimizeWalletCallsForExecution(
              walletExecution.calls,
              address,
              readiness?.rpc_url || MAINNET_RPC_URL || undefined,
            );
            setPendingPreparedCalls(payload.prepared_calls ?? []);
            setPendingWalletCalls(optimized.calls);
            setPendingReceiptId(payload.receipt_id ?? null);
            setPendingRouteLabel(payload.execution_adapter ?? null);
            setPendingPreparedAt(Date.now());
            setExecutionNote(
              options?.allowManualOverride
                ? "Prepared in manual mode. The Gate result is recorded below, but you can inspect and sign the route yourself."
                : options?.allowAdvisoryOverride
                ? "Prepared despite the fee warning. Review the exact cost and route below, then sign only if you still want it."
                : optimized.skippedApprovals
                  ? `Prepared rebalance steps. Skipped ${optimized.skippedApprovals} existing approval${optimized.skippedApprovals === 1 ? "" : "s"}. Review below, then click Sign Rebalance.`
                  : "Prepared rebalance steps. Review below, then click Sign Rebalance.",
            );
            return;
          }
          const optimized = await optimizeWalletCallsForExecution(
            walletExecution.calls,
            address,
            readiness?.rpc_url || MAINNET_RPC_URL || undefined,
          );
          setExecutionNote(
            optimized.skippedApprovals
              ? `Prepared via ${adapterLabel}. Skipped ${optimized.skippedApprovals} existing approval${optimized.skippedApprovals === 1 ? "" : "s"}. Awaiting wallet signature in Argent...`
              : `Prepared via ${adapterLabel}. Awaiting wallet signature in Argent...`,
          );

          // ── MIST.cash privacy wrap ──────────────────────────────────
          // When privateMode is on and this is a swap (not rebalance),
          // route the input token through the MIST Chamber first:
          //   1. deposit input amount into Chamber  (approve + deposit tx)
          //   2. wait for Merkle tree update
          //   3. generate ZK proof + withdraw       (handle_zkp tx)
          //   4. then execute the original swap
          // This breaks the on-chain link between the user's source
          // funds and the swap transaction.
          if (privateMode && actionType === "swap" && swapAssetIn !== "WBTC") {
            const tokenAddr = MAINNET_TOKEN_BY_SYMBOL[swapAssetIn];
            const decimals = ASSET_DECIMALS[swapAssetIn];
            const amountWei = Math.round(Number.parseFloat(swapAmount || "0") * 10 ** decimals).toString();
            if (Number(amountWei) > 0) {
              try {
                await mistPrivacy.initialize();
                setExecutionNote("🛡 Private mode: depositing into MIST Chamber...");
                const { txHash: depTxHash, claimingKey: key } = await mistPrivacy.executeDeposit(
                  account,
                  tokenAddr,
                  amountWei,
                  address,
                );
                setExecutionNote(`🛡 Deposit confirmed (${depTxHash.slice(0, 12)}...). Generating ZK withdrawal proof...`);
                const rpcUrl = readiness?.rpc_url || MAINNET_RPC_URL;
                const provider = new RpcProvider({ nodeUrl: rpcUrl });
                const withdrawCalls = await mistPrivacy.buildWithdrawCalls(
                  provider,
                  address,
                  tokenAddr,
                  amountWei,
                  key,
                );
                setExecutionNote("🛡 Proof generated. Sign the private withdrawal + swap in your wallet...");
                // Combine: withdraw from Chamber + original swap in one multicall
                const combinedCalls = [...withdrawCalls, ...optimized.calls];
                const result = await account.execute(combinedCalls);
                setExecutionTxHash(result.transaction_hash);
                const confirmPayload = await confirmPortfolioExecution(address, payload.receipt_id, result.transaction_hash);
                if (confirmPayload?.portable_receipt?.cid) {
                  setExecutionReceiptCid(confirmPayload.portable_receipt.cid);
                  setExecutionReceipt(confirmPayload.portable_receipt);
                  setExecutionNote(`🛡 Private swap complete. Receipt saved to IPFS.`);
                } else {
                  setExecutionNote(`🛡 Private swap submitted. Tx ${result.transaction_hash.slice(0, 12)}...`);
                }
                await refreshData(address);
                return;
              } catch (privErr) {
                const privMsg = privErr instanceof Error ? privErr.message : String(privErr);
                setExecutionNote(`Privacy wrap failed: ${privMsg}. Falling back to normal execution...`);
                // Fall through to normal execution below
              }
            }
          }

          const result = await account.execute(optimized.calls);
          setExecutionTxHash(result.transaction_hash);
          const confirmPayload = await confirmPortfolioExecution(address, payload.receipt_id, result.transaction_hash);
          if (confirmPayload?.portable_receipt?.cid) {
            setExecutionReceiptCid(confirmPayload.portable_receipt.cid);
            setExecutionReceipt(confirmPayload.portable_receipt);
            setExecutionNote(`Receipt saved to IPFS and anchored on Starknet.`);
          } else {
            setExecutionNote(`Submitted via wallet. Tx ${result.transaction_hash.slice(0, 12)}...`);
          }
          await refreshData(address);
          return;
        }
        if (walletExecution.error) {
          if (actionType === "swap" && isBelowMinSwap) {
            setExecutionNote(
              `Amount looks too small for routing. Try at least ${formatAssetAmount(minSwapAmount, swapAssetIn)}.`,
            );
          } else {
            setExecutionNote(walletExecution.error);
          }
        }
      }

      const benignPreviewWarning =
        account &&
        typeof payload.warning === "string" &&
        payload.warning.includes("Mainnet live submission is disabled");

      setExecutionNote(
        (!benignPreviewWarning ? payload.warning : null) ||
          (options?.allowManualOverride
            ? "Manual mode prepared the route, but wallet signing still needs an active mainnet account."
            : "Execution was prepared but not submitted. Connect an active wallet account to sign this on mainnet."),
      );
      await refreshData(address);
    } catch (err) {
      const message = getApiErrorMessage(err);
      if (message.includes("Insufficient tokens received")) {
        setExecutionNote("Quote expired during wallet signing. Review the proposal again for a fresh route.");
      } else {
        setError(message || "Unable to prepare the action right now. Try again in a moment.");
      }
    } finally {
      setExecuting(false);
    }
  };

  const resetIntent = () => {
    setIntentSet(false);
    setGateResult(null);
    setLastCheckedProposalKey(null);
    setRecommendation(null);
    setRecommendationNotice(null);
    setExecutionNote(null);
    setExecutionTxHash(null);
    setExecutionReceiptCid(null);
    setExecutionReceipt(null);
    setPendingPreparedCalls(null);
    setPendingWalletCalls(null);
    setPendingReceiptId(null);
    setPendingRouteLabel(null);
    setPendingPreparedAt(null);
    setError(null);
    recommendationJustAppliedRef.current = false;
  };

  const runAiGateCheck = async () => {
    if (!recommendation?.intent) return;
    await runGateCheck(recommendation.intent);
  };

  const savePolicy = async () => {
    if (!address || !policyDraft) return;
    setChecking(true);
    setError(null);
    try {
      setPolicy(await savePortfolioPolicy(address, policyDraft));
      setPolicyDirty(false);
    } catch (err) {
      const message = getApiErrorMessage(err);
      setError(
        message
          ? `Unable to update guardrails right now. ${message}`
          : "Unable to update guardrails right now. Try again in a moment.",
      );
    } finally {
      setChecking(false);
    }
  };

  const toggleEmergencyStop = async () => {
    if (!address || !policy) return;
    setChecking(true);
    setError(null);
    try {
      const snapshot = await togglePortfolioEmergencyStop(address, policy);
      setPolicy(snapshot);
      setPolicyDraft(buildPolicyDraft(snapshot));
      setPolicyDirty(false);
      await refreshData(address);
    } catch (err) {
      const message = getApiErrorMessage(err);
      setError(
        message
          ? `Unable to update the pause state right now. ${message}`
          : "Unable to update the pause state right now. Try again in a moment.",
      );
    } finally {
      setChecking(false);
    }
  };

  const setGovernedExecutionControl = async (state: "armed" | "disarmed") => {
    if (!address) return;
    setChecking(true);
    setError(null);
    try {
      const snapshot = await setPortfolioGovernedExecutionState(address, state);
      setPolicy(snapshot);
      setPolicyDraft(buildPolicyDraft(snapshot));
      setPolicyDirty(false);
      await refreshData(address);
    } catch (err) {
      const message = getApiErrorMessage(err);
      setError(
        message
          ? `Unable to update governed execution right now. ${message}`
          : "Unable to update governed execution right now. Try again in a moment.",
      );
    } finally {
      setChecking(false);
    }
  };

  const handlePrimaryAction = async () => {
    if (workflowMode === "automated" && !automatedGovernedState.hasOnboarding) {
      setExecutionNote("Automated mode needs onboarding first. Opening the passport flow.");
      router.push("/passport");
      return;
    }
    if (workflowMode === "automated" && automatedGovernedState.activeSessionCount <= 0) {
      setExecutionNote("Automated mode needs a session key first.");
      setShowSessionKeyModal(true);
      return;
    }
    if (workflowMode === "automated" && governedExecutionDisarmed) {
      setExecutionNote("Arming governed execution for this wallet.");
      await setGovernedExecutionControl("armed");
      return;
    }
    if (hasPreparedRebalance) {
      await signPreparedRebalance();
      return;
    }
    if (workflowMode === "manual") {
      await executeIntent({ allowManualOverride: true, workflowMode });
      return;
    }
    if (canAdvisoryOverride) {
      await executeIntent({
        allowAdvisoryOverride: true,
        workflowMode,
        sessionKeyId: workflowMode === "automated" ? automatedSessionKeyId : null,
      });
      return;
    }
    if (hasFreshGateCheck && !gateResult?.allowed) {
      setExecutionNote("Adjust the target first. The current draft is blocked by the latest safety check.");
      return;
    }
    if (!hasFreshGateCheck) {
      await runGateCheck();
      return;
    }
    await executeIntent({ workflowMode, sessionKeyId: workflowMode === "automated" ? automatedSessionKeyId : null });
  };

  useEffect(() => {
    setPendingPreparedCalls(null);
    setPendingWalletCalls(null);
    setPendingReceiptId(null);
    setPendingRouteLabel(null);
    setPendingPreparedAt(null);
  }, [currentProposalKey, actionType]);

  useEffect(() => {
    if (workflowMode === "manual" || !recommendation) return;
    recommendationJustAppliedRef.current = true;
    applyRecommendationDraft(recommendation, workflowMode);
  }, [workflowMode, recommendation, applyRecommendationDraft]);

  useEffect(() => {
    if (!address || workflowMode === "manual" || recommendation) return;
    void getRecommendation();
  }, [address, workflowMode, recommendation, getRecommendation]);

  useEffect(() => {
    setShowFullGateMatrix(false);
  }, [gateResult?.receipt_id, gateResult?.intent_hash, gateResult?.route_hash]);

  useEffect(() => {
    if (!address || executing || checking) return;
    // Don't auto-gate-check until the user has set an intent
    // (except automated mode which runs off policy).
    if (!intentSet && workflowMode !== "automated") return;
    if (actionType === "rebalance" && pendingWalletCalls?.length) return;
    if (lastCheckedProposalKey === currentProposalKey) return;
    if (executionTxHash) return;
    // After a recommendation is applied, run the gate check immediately instead of
    // waiting 700ms so the user doesn't stare at a disabled button.
    const delay = recommendationJustAppliedRef.current ? 100 : 700;
    const timeoutId = window.setTimeout(() => {
      recommendationJustAppliedRef.current = false;
      void runGateCheck();
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [address, actionType, currentProposalKey, lastCheckedProposalKey, checking, executing, pendingWalletCalls, executionTxHash, intentSet, workflowMode]);

  useEffect(() => {
    const hashes = Array.from(
      new Set(
        receipts
          .map((receipt) => receipt.tx_hash)
          .filter((hash): hash is string => typeof hash === "string" && hash.startsWith("0x")),
      ),
    );
    if (!hashes.length) return;
    const rpcUrl = readiness?.rpc_url || MAINNET_RPC_URL || undefined;
    let dead = false;

    const poll = async () => {
      const entries = await Promise.all(hashes.map(async (hash) => ({ hash, status: await getTxStatus(hash, rpcUrl) })));
      if (dead) return;
      setTxStatusMap((prev) => {
        const next = { ...prev };
        for (const entry of entries) next[entry.hash] = entry.status;
        return next;
      });
    };

    void poll();
    const id = setInterval(poll, 10_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [receipts, readiness]);

  useEffect(() => {
    if (!address || !isConnected) {
      setPortfolio(null);
      setPolicy(null);
      setPolicyDraft(null);
      setPolicyDirty(false);
      setReadiness(null);
      setReceipts([]);
      setGateResult(null);
      setLastCheckedProposalKey(null);
      setRecommendation(null);
      setRecommendationNotice(null);
      setLastPreparedAdapter(null);
      setExecutionNote(null);
      setExecutionTxHash(null);
      setExecutionReceiptCid(null);
      setExecutionReceipt(null);
      setPendingPreparedCalls(null);
      setPendingWalletCalls(null);
      setPendingReceiptId(null);
      setPendingRouteLabel(null);
      setTxStatusMap({});
      setError(null);
      return;
    }
    void refreshData(address);
  }, [address, isConnected]);

  useEffect(() => {
    if (!policy || policyDirty) return;
    setPolicyDraft(buildPolicyDraft(policy));
  }, [policy, policyDirty]);

  const headerProps = {
    address: address ?? "",
    loading,
    totalPortfolioValue,
    headerBreakdown,
    driftLabel,
    driftHint: recommendation?.drift_monitor?.explanation ?? "Agent is watching the current mix.",
    safetyLabel,
    safetyHint: deskState.detail,
    trustGrade: profile?.passport?.letter_rating ?? "D",
    trustTier: profile?.passport?.tier ?? 0,
    isMainnet: isMainnetChain(chainId),
    checking,
    onRefresh: () => {
      if (address) void refreshData(address);
    },
    onEmergencyStop: () => {
      void toggleEmergencyStop();
    },
    paused: Boolean(policy?.paused),
    workflowMode,
    onWorkflowModeChange: setWorkflowMode,
  };

  const mainDeskProps = {
    checking,
    executing,
    workflowMode,
    onWorkflowModeChange: setWorkflowMode,
    actionType,
    showRecommendationCard: hasSupportedCapital,
    recommendation,
    recommendationNotice,
    proposalHeadline,
    proposalReason,
    walletAddress: address ?? "",
    proposalRouteLabel,
    proposalRouteDetail,
    aiExecutionPreview,
    onSetActionType: setActionType,
    onGetRecommendation: () => {
      void getRecommendation();
    },
    onApplyAiTargets: applyAiTargets,
    onRunAiGateCheck: () => {
      void runAiGateCheck();
    },
    proposalSourceLabel,
    swapAssetIn,
    swapAssetOut,
    onSwapAssetInChange: setSwapAssetIn,
    onSwapAssetOutChange: setSwapAssetOut,
    swapAmount,
    onSwapAmountChange: setSwapAmount,
    onSwapAmountPercent: setSwapAmountByPercent,
    swapAmountPercent,
    swapAvailableAmount,
    swapAvailableUsd,
    minSwapAmount,
    isBelowMinSwap,
    slippageBps,
    onSlippageChange: setSlippageBps,
    assetSummary,
    currentAllocations,
    userTargetAllocations,
    aiTargetAllocations,
    rebalancePresets,
    onApplyPreset: applyTargetAllocationMap,
    targetWeights,
    onTargetChange: updateTargetWeight,
    targetWeightSum,
    gateResult,
    safetySummaryLine,
    deskTone: deskState.tone,
    deskLabel: deskState.label,
    deskHeadline: deskState.headline,
    deskDetail: deskState.detail,
    feeGuardResult,
    gasReserveResult,
    showSafetyDetails,
    onToggleSafetyDetails: () => setShowSafetyDetails((current) => !current),
    onRunGateCheck: () => {
      void runGateCheck();
    },
    onPrimaryAction: () => {
      void handlePrimaryAction();
    },
    primaryActionDisabled,
    primaryActionLabel,
    hasFreshGateCheck,
    pendingWalletCalls,
    walletMismatch: Boolean(account && !isMainnetChain(chainId)),
    walletLabel: chainBadgeLabel(chainId),
    proposalOutdated,
    executionNote,
    executionReceiptCid,
    executionReceipt,
    executionTxHash,
    executionLink: executionTxHash ? voyagerTxUrl(executionTxHash) : null,
    portableReceiptLink: executionTxHash ? portableReceiptHref : null,
    passedGateCount,
    failedGateConstraints,
    warningGateConstraints,
    showFullGateMatrix,
    onToggleFullMatrix: () => setShowFullGateMatrix((current) => !current),
    pendingPreparedCalls,
    pendingRouteLabel,
    lastPreparedAdapter,
    fromWei,
    suggestedSwapFallback,
    recommendedSwapStarter,
    recommendedSwapAlternatives,
    overridePrimaryAction: canManualOverride || canAdvisoryOverride,
    loadingRecommendation,
    intentSet,
    onIntentSet: () => setIntentSet(true),
    onResetIntent: resetIntent,
    llmProvider: (recommendation as Record<string, unknown>)?.provenance
      ? String(((recommendation as Record<string, unknown>).provenance as Record<string, unknown>)?.llm_provider ?? "")
      : null,
    automatedProfileFallback: automatedGovernedState,
    governedExecutionDisarmed,
    onToggleGovernedExecution: () => {
      setExecutionNote(
        governedExecutionDisarmed
          ? "Arming governed execution for this wallet."
          : "Disarming governed execution for this wallet.",
      );
      void setGovernedExecutionControl(governedExecutionDisarmed ? "armed" : "disarmed");
    },
    onUseSuggestedSwap: applySuggestedSwapFallback,
    onUseRecommendedSwapStarter: applyRecommendedSwapStarter,
    onUseRecommendedSwapAlternative: applyRecommendedSwapOption,
    privateMode,
    onTogglePrivateMode: () => setPrivateMode((v) => !v),
    mistPrivacyStep: mistPrivacy.step,
    mistPrivacyMessage: mistPrivacy.message,
    mistPrivacyBusy: mistPrivacy.busy,
    mistPrivacyError: mistPrivacy.error,
    showSessionKeyModal,
    onDismissSessionKeyModal: () => setShowSessionKeyModal(false),
    onSessionKeyGranted: (sessionId: string) => {
      setShowSessionKeyModal(false);
      setExecutionNote(`Session key granted (${sessionId.slice(0, 10)}…). You can now arm autopilot.`);
      if (address) void refreshData(address);
    },
  };

  const rightRailProps = {
    totalTrackedValue,
    currentAllocations,
    unsupportedAssets,
    proposalTurnoverPct,
    feeGuardResult,
    gasReserveResult,
    recentActivity: recentActivityItems,
    policy,
    policyDraft,
    showPolicyEditor,
    policyDirty,
    checking,
    onTogglePolicyEditor: () => setShowPolicyEditor((current) => !current),
    onPolicyFieldChange: (
      field: "maxValueUsd" | "maxSlippageBps" | "cooldownSeconds" | "maxSwaps" | "maxFeeSharePct",
      value: string,
    ) => {
      setPolicyDraft((current) => (current ? { ...current, [field]: value } : current));
      setPolicyDirty(true);
    },
    onPolicyMinAmountChange: (asset: SupportedAsset, value: string) => {
      setPolicyDraft((current) =>
        current ? { ...current, minAmounts: { ...current.minAmounts, [asset]: value } } : current,
      );
      setPolicyDirty(true);
    },
    onSavePolicy: () => {
      void savePolicy();
    },
    workflowMode,
    automatedProfileFallback: automatedGovernedState,
    governedExecutionDisarmed,
    onToggleGovernedExecution: () => {
      setExecutionNote(
        governedExecutionDisarmed
          ? "Arming governed execution for this wallet."
          : "Disarming governed execution for this wallet.",
      );
      void setGovernedExecutionControl(governedExecutionDisarmed ? "armed" : "disarmed");
    },
  };

  return {
    address,
    isConnected,
    error,
    supportedAssets: SUPPORTED_ASSETS,
    assetSummary,
    currentAllocations,
    hasSupportedCapital,
    unsupportedAssets,
    headerProps,
    mainDeskProps,
    rightRailProps,
  };
}
