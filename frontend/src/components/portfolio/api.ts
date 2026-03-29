"use client";

import { apiFetch } from "@/lib/api/client";

import { minSwapAmountForAsset, toWei } from "./execution";
import type {
  ActionType,
  ExecutionResponse,
  ExecutorReadiness,
  GateResult,
  PolicyDraft,
  PolicySnapshot,
  PortfolioSnapshot,
  Receipt,
  Recommendation,
  SupportedAsset,
} from "./types";

export const PORTFOLIO_NETWORK_ID = "starknet_mainnet";

export type PortfolioIntentDraft = {
  actionType: ActionType;
  swapAssetIn: SupportedAsset;
  swapAssetOut: SupportedAsset;
  swapAmount: string;
  slippageBps: string;
  targetWeights: Record<SupportedAsset, string>;
};

export function buildPortfolioIntent(draft: PortfolioIntentDraft): Record<string, unknown> {
  const nonce = Math.floor(Date.now() / 1000);
  const common = {
    deadline: nonce + 1800,
    nonce,
    block_number: 0,
    max_slippage_bps: Number.parseInt(draft.slippageBps, 10) || 50,
    adapter_target: "best",
    network_id: PORTFOLIO_NETWORK_ID,
  };

  if (draft.actionType === "swap") {
    return {
      ...common,
      type: "swap",
      token_in: draft.swapAssetIn,
      token_out: draft.swapAssetOut,
      amount_wei: toWei(draft.swapAmount, draft.swapAssetIn),
    };
  }

  return {
    ...common,
    type: "rebalance",
    target_allocations: {
      ETH: Number.parseFloat(draft.targetWeights.ETH) || 0,
      STRK: Number.parseFloat(draft.targetWeights.STRK) || 0,
      USDC: Number.parseFloat(draft.targetWeights.USDC) || 0,
    },
  };
}

export async function fetchPortfolioPageData(walletAddress: string): Promise<{
  portfolio: PortfolioSnapshot;
  policy: PolicySnapshot;
  readiness: ExecutorReadiness;
  receipts: Receipt[];
}> {
  const [portfolio, policy, readiness, receipts] = await Promise.all([
    apiFetch<PortfolioSnapshot>(`/api/v1/portfolio/${walletAddress}`),
    apiFetch<PolicySnapshot>(`/api/v1/execution_gate/policy/${walletAddress}`),
    apiFetch<ExecutorReadiness>(`/api/v1/execution_gate/readiness/${PORTFOLIO_NETWORK_ID}`),
    apiFetch<Receipt[]>(`/api/v1/execution_gate/receipts/${walletAddress}`),
  ]);
  return { portfolio, policy, readiness, receipts };
}

export async function fetchPortfolioReceipts(walletAddress: string): Promise<Receipt[]> {
  return apiFetch<Receipt[]>(`/api/v1/execution_gate/receipts/${walletAddress}`);
}

export async function checkPortfolioIntent(
  ownerAddress: string,
  intent: Record<string, unknown>,
): Promise<GateResult> {
  return apiFetch<GateResult>("/api/v1/execution_gate/check", {
    method: "POST",
    body: JSON.stringify({
      owner_address: ownerAddress,
      intent,
      prepare_preview: true,
    }),
  });
}

export async function fetchPortfolioRecommendation(ownerAddress: string): Promise<Recommendation> {
  return apiFetch<Recommendation>(`/api/v1/execution_gate/recommendation/${ownerAddress}`);
}

export async function executePortfolioIntent(
  ownerAddress: string,
  intent: Record<string, unknown>,
  actionType: ActionType,
  options?: {
    allowAdvisoryOverride?: boolean;
  },
): Promise<ExecutionResponse> {
  return apiFetch<ExecutionResponse>("/api/v1/execution_gate/execute", {
    method: "POST",
    timeoutMs: actionType === "rebalance" ? 240_000 : 120_000,
    body: JSON.stringify({
      owner_address: ownerAddress,
      intent: {
        ...intent,
        execute_live: false,
        allow_advisory_override: Boolean(options?.allowAdvisoryOverride),
      },
    }),
  });
}

export async function confirmPortfolioExecution(
  ownerAddress: string,
  receiptId: string,
  txHash: string,
): Promise<void> {
  await apiFetch("/api/v1/execution_gate/confirm", {
    method: "POST",
    body: JSON.stringify({
      owner_address: ownerAddress,
      receipt_id: receiptId,
      tx_hash: txHash,
    }),
  });
}

export function buildPolicyDraft(snapshot: PolicySnapshot): PolicyDraft {
  return {
    paused: snapshot.paused,
    maxValueUsd: String(snapshot.max_value_per_action_usd ?? ""),
    maxSlippageBps: String(snapshot.max_slippage_bps ?? ""),
    cooldownSeconds: String(snapshot.cooldown_seconds ?? ""),
    maxSwaps: String(snapshot.max_swaps_per_rebalance ?? ""),
    minAmounts: {
      ETH: String(snapshot.min_amounts?.ETH ?? minSwapAmountForAsset("ETH")),
      STRK: String(snapshot.min_amounts?.STRK ?? minSwapAmountForAsset("STRK")),
      USDC: String(snapshot.min_amounts?.USDC ?? minSwapAmountForAsset("USDC")),
    },
  };
}

export function buildPolicyPayload(draft: PolicyDraft): Record<string, unknown> {
  return {
    paused: draft.paused,
    max_value_per_action_usd: Number(draft.maxValueUsd) || 0,
    max_slippage_bps: Number(draft.maxSlippageBps) || 0,
    cooldown_seconds: Number(draft.cooldownSeconds) || 0,
    max_swaps_per_rebalance: Number(draft.maxSwaps) || 1,
    min_amounts: {
      ETH: Number(draft.minAmounts.ETH) || minSwapAmountForAsset("ETH"),
      STRK: Number(draft.minAmounts.STRK) || minSwapAmountForAsset("STRK"),
      USDC: Number(draft.minAmounts.USDC) || minSwapAmountForAsset("USDC"),
    },
  };
}

export async function savePortfolioPolicy(
  ownerAddress: string,
  draft: PolicyDraft,
): Promise<PolicySnapshot> {
  const payload = await apiFetch<{ snapshot: PolicySnapshot }>(`/api/v1/execution_gate/policy/${ownerAddress}`, {
    method: "PUT",
    body: JSON.stringify(buildPolicyPayload(draft)),
  });
  return payload.snapshot;
}

export async function togglePortfolioEmergencyStop(
  ownerAddress: string,
  snapshot: PolicySnapshot,
): Promise<PolicySnapshot> {
  const payload = await apiFetch<{ snapshot: PolicySnapshot }>(`/api/v1/execution_gate/policy/${ownerAddress}`, {
    method: "PUT",
    body: JSON.stringify({
      ...buildPolicyPayload(buildPolicyDraft(snapshot)),
      paused: !snapshot.paused,
    }),
  });
  return payload.snapshot;
}
