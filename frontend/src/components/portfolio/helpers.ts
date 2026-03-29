import type { TxSettlementStatus } from "@/lib/pendingTx";

import type {
  PortfolioPosition,
  Receipt,
  RecommendationDriftMonitor,
  SupportedAsset,
} from "./types";

export function prettyBucketLabel(value: string): string {
  return value.replaceAll("_", " ").replaceAll(":", " ").trim();
}

export function humanizeReasonCode(value?: string | null): string {
  const code = String(value ?? "").trim();
  if (!code) return "No issue recorded.";
  if (code.startsWith("fee_inefficient")) return "Trade size is inefficient relative to estimated network cost.";
  if (code.startsWith("cooldown_active")) return "Cooldown is still active from a recent action.";
  if (code.startsWith("min_amount_too_small")) return "Amount is too small for a reliable route.";
  if (code.startsWith("slippage_exceeds_limit")) return "Requested slippage is above the current guardrail.";
  if (code.startsWith("action_value_exceeds_limit")) return "Action size is above the current policy cap.";
  if (code.startsWith("rebalance_bundle_too_large")) return "The rebalance needs too many swaps for the current policy.";
  if (code.startsWith("zkml_non_compliant")) return "One of the advisory zkML checks came back non-compliant.";
  if (code.startsWith("zkml_proof_failed")) return "One of the advisory zkML proofs could not be generated.";
  if (code.startsWith("execution_error")) return "Execution prep failed before the wallet request was built.";
  return prettyBucketLabel(code);
}

export function normalizeReceiptStatus(receipt: Receipt, txStatus?: TxSettlementStatus): string {
  const stage = receipt.metadata?.stage ?? "check";
  const rawStatus = receipt.metadata?.status ?? (receipt.metadata?.allowed ? "allowed" : "recorded");

  if (stage === "policy") return "policy updated";
  if (stage === "monitor") {
    if (rawStatus === "rebalance") return "rebalance watch";
    if (rawStatus === "watch") return "drift watch";
    return "monitored";
  }

  if (stage === "execute" && receipt.tx_hash) {
    if (txStatus === "confirmed") return "confirmed";
    if (txStatus === "accepted") return "accepted";
    if (txStatus === "rejected") return "failed";
    if (rawStatus === "blocked") return "blocked";
    if (rawStatus === "failed") return "failed";
    return "submitted";
  }

  if (rawStatus === "blocked") return "blocked";
  if (rawStatus === "error" || rawStatus === "failed") return "failed";
  if (rawStatus === "prepared" || rawStatus === "ready_to_sign") return "ready to sign";
  if (rawStatus === "submitted") return "submitted";
  if (rawStatus === "accepted") return "accepted";
  if (rawStatus === "confirmed") return "confirmed";
  return "checked";
}

export function receiptEventGroup(receipt: Receipt): "system" | "gate" | "user" {
  const stage = receipt.metadata?.stage ?? "check";
  if (stage === "monitor") return "system";
  if (stage === "policy" || stage === "execute") return "user";
  return "gate";
}

export function receiptEventTitle(receipt: Receipt): string {
  const stage = receipt.metadata?.stage ?? "check";
  const action = String(receipt.action_type ?? "portfolio").replaceAll("_", " ");
  const status = normalizeReceiptStatus(receipt);
  if (stage === "policy") return "Guardrails updated";
  if (stage === "monitor") return "Agent drift review";
  if (stage === "execute") {
    if (status === "ready to sign") return `${action} ready to sign`;
    if (status === "submitted" || status === "accepted") return `${action} sent`;
    if (status === "confirmed") return `${action} confirmed`;
    if (status === "failed") return `${action} failed`;
    if (status === "blocked") return `${action} stopped`;
    return `${action} execution`;
  }
  if (stage === "check") return `${action} safety review`;
  return `${action} activity`;
}

export function receiptEventSummary(receipt: Receipt, status: string): string {
  const stage = receipt.metadata?.stage ?? "check";
  const action = String(receipt.action_type ?? "portfolio").replaceAll("_", " ");
  const reasonCodes = receipt.metadata?.reason_codes ?? [];
  const venue = receipt.metadata?.execution?.execution_adapter;
  const txHash = receipt.tx_hash;
  if (stage === "policy") {
    const changed = receipt.metadata?.policy?.changed_fields ?? [];
    return changed.length ? `${changed.length} guardrail${changed.length === 1 ? "" : "s"} changed.` : "Policy settings changed.";
  }
  if (stage === "monitor") {
    return receipt.metadata?.monitor?.explanation ?? "Agent reviewed drift against the target mix.";
  }
  if (stage === "check") {
    if (status === "checked") return `${action} cleared the current safety review.`;
    if (status === "blocked" || status === "failed") return humanizeReasonCode(reasonCodes[0]);
    return `${action} was reviewed against wallet and policy constraints.`;
  }
  if (stage === "execute") {
    if (status === "ready to sign") return `${venue ? String(venue).toUpperCase() : "Wallet"} calls are prepared and waiting for signature.`;
    if (status === "submitted" || status === "accepted") {
      return `${venue ? String(venue).toUpperCase() : "Wallet"} submission is in flight${txHash ? "." : " and awaiting chain status."}`;
    }
    if (status === "confirmed") return "Confirmed on Starknet mainnet.";
    if (status === "failed" || status === "blocked") {
      return humanizeReasonCode(reasonCodes[0] ?? receipt.metadata?.execution?.tx_status ?? receipt.metadata?.execution?.warning ?? null);
    }
    return `${action} execution event recorded.`;
  }
  return "Recent portfolio activity.";
}

export function proposalKeyForIntent(intent: Record<string, unknown>): string {
  const type = String(intent.type ?? "swap");
  if (type === "swap") {
    return JSON.stringify({
      type,
      network_id: intent.network_id ?? "starknet_mainnet",
      adapter_target: intent.adapter_target ?? "best",
      token_in: intent.token_in ?? null,
      token_out: intent.token_out ?? null,
      amount_wei: intent.amount_wei ?? 0,
      max_slippage_bps: intent.max_slippage_bps ?? 50,
    });
  }
  const target = (intent.target_allocations ?? {}) as Record<string, unknown>;
  return JSON.stringify({
    type,
    network_id: intent.network_id ?? "starknet_mainnet",
    adapter_target: intent.adapter_target ?? "best",
    target_allocations: {
      ETH: target.ETH ?? 0,
      STRK: target.STRK ?? 0,
      USDC: target.USDC ?? 0,
    },
    max_slippage_bps: intent.max_slippage_bps ?? 50,
  });
}

export function aggregateAssets(
  positions: PortfolioPosition[],
): Record<SupportedAsset, { amount: number; valueUsd: number }> {
  return positions.reduce(
    (acc, position) => {
      const asset = position.asset_symbol?.toUpperCase() as SupportedAsset;
      if (!(asset in acc)) return acc;
      acc[asset].amount += Number(position.amount || 0);
      acc[asset].valueUsd += Number(position.value_usd || 0);
      return acc;
    },
    {
      ETH: { amount: 0, valueUsd: 0 },
      STRK: { amount: 0, valueUsd: 0 },
      USDC: { amount: 0, valueUsd: 0 },
    },
  );
}

export function normalizeAllocationMap(
  allocations: Partial<Record<SupportedAsset, number>>,
): Record<SupportedAsset, number> {
  const cleaned = {
    ETH: Math.max(0, Number(allocations.ETH ?? 0)),
    STRK: Math.max(0, Number(allocations.STRK ?? 0)),
    USDC: Math.max(0, Number(allocations.USDC ?? 0)),
  };
  const total = cleaned.ETH + cleaned.STRK + cleaned.USDC;
  if (total <= 0) {
    return { ETH: 40, STRK: 25, USDC: 35 };
  }
  const normalized = {
    ETH: Number(((cleaned.ETH / total) * 100).toFixed(1)),
    STRK: Number(((cleaned.STRK / total) * 100).toFixed(1)),
    USDC: Number(((cleaned.USDC / total) * 100).toFixed(1)),
  };
  const residual = Number((100 - (normalized.ETH + normalized.STRK + normalized.USDC)).toFixed(1));
  normalized.USDC = Number((normalized.USDC + residual).toFixed(1));
  return normalized;
}

export function normalizeChainId(chainId: string | bigint | undefined): string {
  if (typeof chainId === "bigint") return `0x${chainId.toString(16)}`.toLowerCase();
  return String(chainId ?? "").toLowerCase();
}

export function isMainnetChain(chainId: string | bigint | undefined): boolean {
  const value = normalizeChainId(chainId);
  return value.includes("main") || value === "0x534e5f4d41494e";
}

export function chainBadgeLabel(chainId: string | bigint | undefined): string {
  if (isMainnetChain(chainId)) return "Mainnet";
  const value = normalizeChainId(chainId);
  if (value.includes("sep") || value === "0x534e5f5345504f4c4941") return "Sepolia";
  return "Unknown";
}

export function residualGap(
  target: Partial<Record<SupportedAsset, number>> | undefined,
  actual: Partial<Record<SupportedAsset, number>> | undefined,
  assets: SupportedAsset[],
): { asset: SupportedAsset; gap: number } | null {
  if (!target || !actual) return null;
  let best: { asset: SupportedAsset; gap: number } | null = null;
  for (const asset of assets) {
    const gap = Math.abs((actual[asset] ?? 0) - (target[asset] ?? 0));
    if (!best || gap > best.gap) best = { asset, gap };
  }
  return best;
}

export function driftLabelForStatus(status: RecommendationDriftMonitor["status"]): string {
  if (status === "rebalance") return "Rebalance suggested";
  if (status === "watch") return "Drifted";
  return "On target";
}
