"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "@starknet-react/core";
import type { Call } from "starknet";

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
  togglePortfolioEmergencyStop,
} from "./api";
import {
  buildWalletCallsFromExecution,
  extractExecutionError,
  fromWei,
  minSwapAmountForAsset,
  optimizeWalletCallsForExecution,
} from "./execution";
import { formatAssetAmount, formatEditableAmount } from "./formatters";
import {
  aggregateAssets,
  chainBadgeLabel,
  isMainnetChain,
  normalizeAllocationMap,
  normalizeReceiptStatus,
  proposalKeyForIntent,
  receiptEventSummary,
  receiptEventTitle,
} from "./helpers";
import type {
  ActionType,
  ExecutorReadiness,
  GateResult,
  PolicyDraft,
  PolicySnapshot,
  PortfolioSnapshot,
  PreparedCall,
  Receipt,
  Recommendation,
  SupportedAsset,
} from "./types";
import { useRiskProfileV2 } from "@/hooks/useProfile";
import { getApiErrorMessage } from "@/lib/api/client";
import { voyagerTxUrl } from "@/lib/explorer";
import { getTxStatus, type TxSettlementStatus } from "@/lib/pendingTx";

const SUPPORTED_ASSETS: SupportedAsset[] = ["ETH", "STRK", "USDC"];
const MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL_MAINNET ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  "";
const PREPARED_WALLET_CALL_TTL_MS = 20_000;

export function usePortfolioPageShell() {
  const { address, account, isConnected, chainId } = useAccount();
  const { profile } = useRiskProfileV2(address);

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
  const [pendingPreparedCalls, setPendingPreparedCalls] = useState<PreparedCall[] | null>(null);
  const [pendingWalletCalls, setPendingWalletCalls] = useState<Call[] | null>(null);
  const [pendingReceiptId, setPendingReceiptId] = useState<string | null>(null);
  const [pendingRouteLabel, setPendingRouteLabel] = useState<string | null>(null);
  const [pendingPreparedAt, setPendingPreparedAt] = useState<number | null>(null);
  const [txStatusMap, setTxStatusMap] = useState<Record<string, TxSettlementStatus>>({});
  const [showFullGateMatrix, setShowFullGateMatrix] = useState(false);
  const [showSafetyDetails, setShowSafetyDetails] = useState(false);
  const [showPolicyEditor, setShowPolicyEditor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [actionType, setActionType] = useState<ActionType>("rebalance");
  const [swapAssetIn, setSwapAssetIn] = useState<SupportedAsset>("ETH");
  const [swapAssetOut, setSwapAssetOut] = useState<SupportedAsset>("USDC");
  const [swapAmount, setSwapAmount] = useState("0.10");
  const [slippageBps, setSlippageBps] = useState("50");
  const [targetWeights, setTargetWeights] = useState<Record<SupportedAsset, string>>({
    ETH: "40",
    STRK: "25",
    USDC: "35",
  });

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
        { ETH: 0, STRK: 0, USDC: 0 } as Record<SupportedAsset, number>,
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
    if (actionType === "swap") return "Manual swap";
    if (recommendation?.recommendation_mode === "best_next_move") return "Best next move";
    if (aiProposalApplied || (aiProposalKey && currentProposalKey === aiProposalKey)) return "Suggested target";
    return "Manual target";
  }, [actionType, aiProposalApplied, aiProposalKey, currentProposalKey, recommendation?.recommendation_mode]);
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
  const deskState = useMemo(() => {
    if (executionTxHash) {
      return {
        label: "Submitted",
        tone: "good" as const,
        headline: "Wallet submission is out.",
        detail: "Track confirmation in the activity rail while the agent keeps watching drift.",
      };
    }
    if (actionType === "rebalance" && pendingWalletCalls?.length) {
      return {
        label: "Ready to sign",
        tone: "good" as const,
        headline: "The rebalance is ready in your wallet.",
        detail: "Review the exact sells and buys below, then sign once.",
      };
    }
    if (hasFreshGateCheck) {
      if (!gateResult?.allowed && failedGateConstraints.length === 1 && failedGateConstraints[0]?.name === "FeeEfficiencyGuard") {
        return {
          label: "Permitted with fee warning",
          tone: "warning" as const,
          headline: "The route exists, but the fee is heavy for the size.",
          detail: "You can still prepare the wallet path and inspect the exact cost yourself, or edit the target to improve the economics.",
        };
      }
      return {
        label: gateResult?.allowed ? "Safe to sign" : "Needs adjustment",
        tone: gateResult?.allowed ? ("good" as const) : ("warning" as const),
        headline: gateResult?.allowed ? "The current proposal cleared safety checks." : "The current proposal needs changes before signing.",
        detail: gateResult?.allowed
          ? "You can move straight to review and wallet signing."
          : "Adjust the target mix or amount and the desk will re-check automatically.",
      };
    }
    if (checking) {
      return {
        label: "Checking",
        tone: "neutral" as const,
        headline: "Running the safety check in the background.",
        detail: "Keep editing if needed. The desk updates when the fresh result lands.",
      };
    }
    return {
      label: "Drafting",
      tone: "neutral" as const,
      headline: "Shape the target mix first.",
      detail: "The desk will run the safety check automatically as you update the proposal.",
    };
  }, [actionType, pendingWalletCalls, hasFreshGateCheck, gateResult, checking, executionTxHash, failedGateConstraints]);
  const hasPreparedRebalance = actionType === "rebalance" && Boolean(pendingWalletCalls?.length);
  const canSignPreparedRebalance = hasPreparedRebalance && Boolean(account && address);
  const canAdvisoryOverride = useMemo(() => {
    if (pendingWalletCalls?.length) return false;
    if (!hasFreshGateCheck || gateResult?.allowed) return false;
    if (!gateResult?.swap_steps?.length) return false;
    const failedNames = failedGateConstraints.map((item) => item.name);
    return failedNames.length === 1 && failedNames[0] === "FeeEfficiencyGuard";
  }, [hasFreshGateCheck, gateResult, failedGateConstraints, pendingWalletCalls]);

  const primaryActionLabel = useMemo(() => {
    if (hasPreparedRebalance) return "Sign rebalance";
    if (executing) return "Preparing";
    if (checking && !hasFreshGateCheck) return "Checking Safety";
    if (canAdvisoryOverride) return "Continue with fee warning";
    if (hasFreshGateCheck && !gateResult?.allowed) return "Needs adjustment";
    if (!hasFreshGateCheck) return actionType === "rebalance" ? "Review rebalance" : "Review swap";
    if (actionType === "rebalance") return "Review Rebalance";
    return "Sign swap";
  }, [actionType, hasPreparedRebalance, executing, checking, hasFreshGateCheck, gateResult, canAdvisoryOverride]);
  const primaryActionDisabled = useMemo(() => {
    if (executing) return true;
    if (hasPreparedRebalance) return !canSignPreparedRebalance;
    if (canAdvisoryOverride) return checking;
    if (hasFreshGateCheck && !gateResult?.allowed) return true;
    if (!hasFreshGateCheck) return true;
    return checking;
  }, [executing, hasPreparedRebalance, canSignPreparedRebalance, hasFreshGateCheck, gateResult, checking, canAdvisoryOverride]);
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
    ? canAdvisoryOverride
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
  const proposalHeadline =
    recommendation?.rebalance_summary?.headline ?? "Set a target mix and let the gate decide if it is safe to sign.";
  const proposalReason =
    recommendation?.recommendation_note ??
    recommendation?.rebalance_summary?.why ??
    "The suggested target stays separate from your target. Use it as a suggestion, not an automatic override.";
  const recentActivityItems = useMemo(
    () =>
      receipts.slice(0, 4).map((receipt) => {
        const txStatus = receipt.tx_hash ? txStatusMap[receipt.tx_hash] : undefined;
        const status = normalizeReceiptStatus(receipt, txStatus);
        return {
          id: receipt.receipt_id,
          title: receiptEventTitle(receipt),
          summary: receiptEventSummary(receipt, status),
          status,
          timestamp: new Date(receipt.timestamp).toLocaleString(),
          txHref: receipt.tx_hash ? voyagerTxUrl(receipt.tx_hash) : null,
        };
      }),
    [receipts, txStatusMap],
  );

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
    setExecutionNote(null);
    setExecutionTxHash(null);
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

  const getRecommendation = async () => {
    if (!address) return;
    setChecking(true);
    setError(null);
    setRecommendationNotice(null);
    setLastPreparedAdapter(null);
    setPendingPreparedCalls(null);
    setPendingWalletCalls(null);
    setPendingReceiptId(null);
    setPendingRouteLabel(null);
    setPendingPreparedAt(null);
    setExecutionNote(null);
    setExecutionTxHash(null);
    try {
      const payload = await fetchPortfolioRecommendation(address);
      setRecommendation(payload);
      setActionType("rebalance");
      setAiProposalApplied(false);
    } catch (err) {
      setRecommendationNotice("The suggested target is unavailable right now. You can still edit your own target and run the safety check.");
    } finally {
      setChecking(false);
    }
  };

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
      if (pendingReceiptId) {
        try {
          await confirmPortfolioExecution(address, pendingReceiptId, result.transaction_hash);
          setExecutionNote(
            optimized.skippedApprovals
              ? `Submitted via wallet after skipping ${optimized.skippedApprovals} existing approval${optimized.skippedApprovals === 1 ? "" : "s"}. Tx ${result.transaction_hash.slice(0, 12)}...`
              : `Submitted via wallet. Tx ${result.transaction_hash.slice(0, 12)}...`,
          );
        } catch (confirmErr) {
          console.error("portfolio confirm failed after wallet submission", confirmErr);
          setExecutionNote(
            `Submitted via wallet. Tx ${result.transaction_hash.slice(0, 12)}... Receipt sync is delayed, but the transaction was sent.`,
          );
        }
      } else {
        setExecutionNote(
          `Submitted via wallet. Tx ${result.transaction_hash.slice(0, 12)}... Receipt sync is unavailable, but the transaction was sent.`,
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

  const executeIntent = async (options?: { allowAdvisoryOverride?: boolean }) => {
    if (!address) return;
    if (!hasFreshGateCheck) {
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
      actionType === "rebalance"
        ? "Re-running the gate and preparing rebalance legs for wallet signing..."
        : "Re-running the gate and preparing a wallet request...",
    );
    setExecutionTxHash(null);
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
        setExecutionNote(`Submitted on ${payload.status}. Tx ${payload.tx_hash.slice(0, 12)}...`);
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
              options?.allowAdvisoryOverride
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
          const result = await account.execute(optimized.calls);
          setExecutionTxHash(result.transaction_hash);
          await confirmPortfolioExecution(address, payload.receipt_id, result.transaction_hash);
          setExecutionNote(
            options?.allowAdvisoryOverride
              ? `Submitted via wallet after fee-warning override. Tx ${result.transaction_hash.slice(0, 12)}...`
              : `Submitted via wallet. Tx ${result.transaction_hash.slice(0, 12)}...`,
          );
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
          "Execution was prepared but not submitted. Connect an active wallet account to sign this on mainnet.",
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

  const handlePrimaryAction = async () => {
    if (hasPreparedRebalance) {
      await signPreparedRebalance();
      return;
    }
    if (canAdvisoryOverride) {
      await executeIntent({ allowAdvisoryOverride: true });
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
    await executeIntent();
  };

  useEffect(() => {
    setPendingPreparedCalls(null);
    setPendingWalletCalls(null);
    setPendingReceiptId(null);
    setPendingRouteLabel(null);
    setPendingPreparedAt(null);
  }, [currentProposalKey, actionType]);

  useEffect(() => {
    setShowFullGateMatrix(false);
  }, [gateResult?.receipt_id, gateResult?.intent_hash, gateResult?.route_hash]);

  useEffect(() => {
    if (!address || executing || checking) return;
    if (actionType === "rebalance" && pendingWalletCalls?.length) return;
    if (lastCheckedProposalKey === currentProposalKey) return;
    const timeoutId = window.setTimeout(() => {
      void runGateCheck();
    }, 700);
    return () => window.clearTimeout(timeoutId);
  }, [address, actionType, currentProposalKey, lastCheckedProposalKey, checking, executing, pendingWalletCalls]);

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
  };

  const mainDeskProps = {
    checking,
    executing,
    actionType,
    showRecommendationCard: hasSupportedCapital,
    recommendation,
    recommendationNotice,
    proposalHeadline,
    proposalReason,
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
    executionLink: executionTxHash ? voyagerTxUrl(executionTxHash) : null,
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
    overridePrimaryAction: canAdvisoryOverride,
    onUseSuggestedSwap: applySuggestedSwapFallback,
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
      field: "maxValueUsd" | "maxSlippageBps" | "cooldownSeconds" | "maxSwaps",
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
