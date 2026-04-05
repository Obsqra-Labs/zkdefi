"use client";

import { apiFetch, apiFetchAuth } from "@/lib/api/client";
import { buildPortfolioSessionHeaders, normalizePortfolioAddress } from "@/lib/portfolioSession";

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
  WorkflowMode,
} from "./types";

export const PORTFOLIO_NETWORK_ID = "starknet_mainnet";

export type PortfolioAuthTelemetrySummary = {
  window_sec: number;
  window_start: number;
  window_end: number;
  totals: {
    events: number;
    successes: number;
    failures: number;
    success_rate_pct: number | null;
  };
  latency_ms: {
    total: { samples: number; p50: number | null; p95: number | null };
    start: { samples: number; p50: number | null; p95: number | null };
    sign: { samples: number; p50: number | null; p95: number | null };
    complete: { samples: number; p50: number | null; p95: number | null };
  };
  failures: {
    by_stage: Record<string, number>;
    by_status: Record<string, number>;
  };
  alerts: Array<{
    id: string;
    severity: string;
    message: string;
    count: number;
    window_event_count: number;
    ratio: number;
    window_sec: number;
    emit_log_warning?: boolean;
  }>;
};

export type PortfolioIntentDraft = {
  actionType: ActionType;
  swapAssetIn: SupportedAsset;
  swapAssetOut: SupportedAsset;
  swapAmount: string;
  slippageBps: string;
  targetWeights: Record<SupportedAsset, string>;
  adapterTarget?: "best" | "ekubo" | "avnu";
};

export function buildPortfolioIntent(draft: PortfolioIntentDraft): Record<string, unknown> {
  const nonce = Math.floor(Date.now() / 1000);
  const common = {
    deadline: nonce + 1800,
    nonce,
    block_number: 0,
    max_slippage_bps: Number.parseInt(draft.slippageBps, 10) || 50,
    adapter_target: draft.adapterTarget ?? "best",
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
      WBTC: Number.parseFloat(draft.targetWeights.WBTC) || 0,
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
    apiFetch<PortfolioSnapshot>(`/api/v1/portfolio/${walletAddress}`, { timeoutMs: 25_000 }),
    apiFetchAuth<PolicySnapshot>(`/api/v1/execution_gate/policy/${walletAddress}`, walletAddress, {
      timeoutMs: 15_000,
      headers: buildPortfolioSessionHeaders(walletAddress),
    }),
    apiFetch<ExecutorReadiness>(`/api/v1/execution_gate/readiness/${PORTFOLIO_NETWORK_ID}`, { timeoutMs: 15_000 }),
    apiFetchAuth<Receipt[]>(`/api/v1/execution_gate/receipts/${walletAddress}`, walletAddress, {
      timeoutMs: 20_000,
      headers: buildPortfolioSessionHeaders(walletAddress),
    }),
  ]);
  return { portfolio, policy, readiness, receipts };
}

export async function fetchPortfolioReceipts(walletAddress: string): Promise<Receipt[]> {
  return apiFetchAuth<Receipt[]>(`/api/v1/execution_gate/receipts/${walletAddress}`, walletAddress, {
    timeoutMs: 20_000,
    headers: buildPortfolioSessionHeaders(walletAddress),
  });
}

export async function fetchPortfolioAuthTelemetrySummary(
  windowSec = 24 * 60 * 60,
): Promise<PortfolioAuthTelemetrySummary> {
  return apiFetch<PortfolioAuthTelemetrySummary>(
    `/api/v1/portfolio/auth/telemetry/summary?window_sec=${Math.max(60, Math.floor(windowSec))}`,
    { timeoutMs: 10_000 },
  );
}

export async function checkPortfolioIntent(
  ownerAddress: string,
  intent: Record<string, unknown>,
): Promise<GateResult> {
  const intentType = String(intent?.type ?? "swap").toLowerCase();
  const timeoutMs = intentType === "rebalance" ? 120_000 : 75_000;
  return apiFetchAuth<GateResult>("/api/v1/execution_gate/check", ownerAddress, {
    method: "POST",
    timeoutMs,
    headers: buildPortfolioSessionHeaders(ownerAddress),
    body: JSON.stringify({
      owner_address: ownerAddress,
      intent,
      prepare_preview: true,
    }),
  });
}

export async function fetchPortfolioRecommendation(ownerAddress: string): Promise<Recommendation> {
  return apiFetchAuth<Recommendation>(`/api/v1/execution_gate/recommendation/${ownerAddress}`, ownerAddress, {
    timeoutMs: 90_000,
    headers: buildPortfolioSessionHeaders(ownerAddress),
  });
}

export async function executePortfolioIntent(
  ownerAddress: string,
  intent: Record<string, unknown>,
  actionType: ActionType,
  options?: {
    allowAdvisoryOverride?: boolean;
    allowManualOverride?: boolean;
    workflowMode?: WorkflowMode;
    sessionKeyId?: string | null;
  },
): Promise<ExecutionResponse> {
  return apiFetchAuth<ExecutionResponse>("/api/v1/execution_gate/execute", ownerAddress, {
    method: "POST",
    timeoutMs: actionType === "rebalance" ? 240_000 : 120_000,
    headers: buildPortfolioSessionHeaders(ownerAddress),
    body: JSON.stringify({
      owner_address: ownerAddress,
      intent: {
        ...intent,
        execute_live: false,
        allow_advisory_override: Boolean(options?.allowAdvisoryOverride),
        allow_manual_override: Boolean(options?.allowManualOverride),
        workflow_mode: options?.workflowMode,
        session_key_id: options?.sessionKeyId ?? undefined,
      },
    }),
  });
}

export async function confirmPortfolioExecution(
  ownerAddress: string,
  receiptId: string,
  txHash: string,
  privacyMeta?: {
    deposit_tx_hash: string;
    chamber?: string;
    token?: string;
    execution_mode?: string;
    recipient?: string;
    withdraw_tx_hash?: string;
    execution_account?: string;
    execution_wallet_strategy?: string;
  },
): Promise<{
  portable_receipt?: {
    registry_receipt_id?: string;
    cid?: string;
    gateway_url?: string | null;
    ipfs_uri?: string | null;
  };
  portable_receipt_error?: string;
}> {
  const canonicalHex = (
    value: string,
    field: string,
    options?: { minNibbles?: number; nonZero?: boolean },
  ): string => {
    const raw = String(value ?? "").trim();
    if (!raw) throw new Error(`${field} is required.`);
    if (!raw.startsWith("0x")) throw new Error(`${field} must be 0x-prefixed hex.`);
    const digits = raw.slice(2);
    if (!/^[0-9a-fA-F]+$/.test(digits)) throw new Error(`${field} must contain only hex characters.`);
    const canonical = digits.toLowerCase().replace(/^0+/, "") || "0";
    if (options?.nonZero && canonical === "0") throw new Error(`${field} must be non-zero.`);
    if ((options?.minNibbles ?? 1) > canonical.length) throw new Error(`${field} is too short.`);
    return `0x${canonical}`;
  };

  const sameCanonicalAddress = (lhs: string, rhs: string): boolean => {
    try {
      return (
        canonicalHex(lhs, "address", { nonZero: true })
        === canonicalHex(rhs, "address", { nonZero: true })
      );
    } catch {
      return normalizePortfolioAddress(lhs) === normalizePortfolioAddress(rhs);
    }
  };

  const sanitizePrivacyMeta = (
    owner: string,
    meta: typeof privacyMeta | undefined,
  ): {
    deposit_tx_hash: string;
    withdraw_tx_hash: string;
    execution_mode: string;
    recipient?: string;
    execution_account?: string;
    execution_wallet_strategy?: string;
    chamber?: string;
    token?: string;
  } | undefined => {
    if (!meta) return undefined;
    const mode = String(meta.execution_mode ?? "relayer").trim().toLowerCase();
    if (!["relayer", "fresh_address", "private_account"].includes(mode)) {
      throw new Error("privacy_wrap.execution_mode must be relayer, fresh_address, or private_account.");
    }
    const depositTxHash = canonicalHex(meta.deposit_tx_hash, "privacy_wrap.deposit_tx_hash", { minNibbles: 8, nonZero: true });
    const withdrawTxHash = canonicalHex(meta.withdraw_tx_hash ?? "", "privacy_wrap.withdraw_tx_hash", { minNibbles: 8, nonZero: true });
    const ownerCanonical = canonicalHex(owner, "owner_address", { nonZero: true });
    const recipient = meta.recipient
      ? canonicalHex(meta.recipient, "privacy_wrap.recipient", { nonZero: true })
      : undefined;
    const executionAccount = meta.execution_account
      ? canonicalHex(meta.execution_account, "privacy_wrap.execution_account", { nonZero: true })
      : undefined;

    if (mode === "fresh_address") {
      if (!recipient) throw new Error("privacy_wrap.fresh_address requires recipient.");
      if (sameCanonicalAddress(recipient, ownerCanonical)) {
        throw new Error("privacy_wrap.fresh_address recipient must differ from owner_address.");
      }
    }
    if (mode === "private_account") {
      if (!recipient || !executionAccount) {
        throw new Error("privacy_wrap.private_account requires recipient and execution_account.");
      }
      if (sameCanonicalAddress(recipient, ownerCanonical)) {
        throw new Error("privacy_wrap.private_account recipient must differ from owner_address.");
      }
    }

    return {
      deposit_tx_hash: depositTxHash,
      withdraw_tx_hash: withdrawTxHash,
      execution_mode: mode,
      ...(recipient ? { recipient } : {}),
      ...(executionAccount ? { execution_account: executionAccount } : {}),
      ...(meta.execution_wallet_strategy
        ? { execution_wallet_strategy: String(meta.execution_wallet_strategy).trim().toLowerCase() }
        : {}),
      ...(meta.chamber ? { chamber: canonicalHex(meta.chamber, "privacy_wrap.chamber", { nonZero: true }) } : {}),
      ...(meta.token ? { token: canonicalHex(meta.token, "privacy_wrap.token", { nonZero: true }) } : {}),
    };
  };

  const sanitizedPrivacyMeta = sanitizePrivacyMeta(ownerAddress, privacyMeta);

  return apiFetchAuth("/api/v1/execution_gate/confirm", ownerAddress, {
    method: "POST",
    headers: buildPortfolioSessionHeaders(ownerAddress),
    body: JSON.stringify({
      owner_address: ownerAddress,
      receipt_id: receiptId,
      tx_hash: txHash,
      ...(sanitizedPrivacyMeta ? { privacy_wrap: sanitizedPrivacyMeta } : {}),
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
    maxFeeSharePct: String(snapshot.max_fee_share_pct ?? "85"),
    minAmounts: {
      ETH: String(snapshot.min_amounts?.ETH ?? minSwapAmountForAsset("ETH")),
      STRK: String(snapshot.min_amounts?.STRK ?? minSwapAmountForAsset("STRK")),
      USDC: String(snapshot.min_amounts?.USDC ?? minSwapAmountForAsset("USDC")),
      WBTC: String(snapshot.min_amounts?.WBTC ?? minSwapAmountForAsset("WBTC")),
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
    max_fee_share_pct: Math.max(1, Math.min(100, Number(draft.maxFeeSharePct) || 85)),
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
  const payload = await apiFetchAuth<{ snapshot: PolicySnapshot }>(`/api/v1/execution_gate/policy/${ownerAddress}`, ownerAddress, {
    method: "PUT",
    headers: buildPortfolioSessionHeaders(ownerAddress),
    body: JSON.stringify(buildPolicyPayload(draft)),
  });
  return payload.snapshot;
}

export async function togglePortfolioEmergencyStop(
  ownerAddress: string,
  snapshot: PolicySnapshot,
): Promise<PolicySnapshot> {
  const payload = await apiFetchAuth<{ snapshot: PolicySnapshot }>(`/api/v1/execution_gate/policy/${ownerAddress}`, ownerAddress, {
    method: "PUT",
    headers: buildPortfolioSessionHeaders(ownerAddress),
    body: JSON.stringify({
      ...buildPolicyPayload(buildPolicyDraft(snapshot)),
      paused: !snapshot.paused,
    }),
  });
  return payload.snapshot;
}

export async function setPortfolioGovernedExecutionState(
  ownerAddress: string,
  state: "armed" | "disarmed",
): Promise<PolicySnapshot> {
  const payload = await apiFetchAuth<{ snapshot: PolicySnapshot }>(`/api/v1/execution_gate/policy/${ownerAddress}`, ownerAddress, {
    method: "PUT",
    headers: buildPortfolioSessionHeaders(ownerAddress),
    body: JSON.stringify({
      governed_execution_state: state,
    }),
  });
  return payload.snapshot;
}
