/**
 * Reputation vector builder for the passport.
 *
 * Calls the zkdefi backend reputation user endpoint and normalizes
 * the response into the six ReceiptOS signals:
 *   wallet_age_days, account_type, transaction_count,
 *   protocol_categories, liquidation_count, bridge_inflow
 */

import { apiFetch } from "@/lib/api/client";
import type { ReputationVector, ReputationProfile, SignalEntry, UpgradeRequirements, ActivityEntry } from "./types";

interface ReputationUser {
  address: string;
  tier: number;
  tier_name: string;
  transaction_count: number;
  total_volume_eth: number;
  tenure_days: number;
  successful_txns: number;
  failed_txns: number;
  collateral_eth: number;
  reputation_score: number;
  upgrade_eligible: boolean;
  upgrade_requirements: UpgradeRequirements | null;
  gates: Record<string, boolean>;
}

export async function fetchVector(walletAddress: string): Promise<ReputationVector> {
  const raw = await apiFetch<ReputationUser>(
    `/api/v1/zkdefi/reputation/user/${walletAddress}`,
    { timeoutMs: 30_000 }
  );
  return normalize(walletAddress, raw);
}

export async function fetchProfile(walletAddress: string): Promise<ReputationProfile> {
  const raw = await apiFetch<ReputationUser>(
    `/api/v1/zkdefi/reputation/user/${walletAddress}`,
    { timeoutMs: 30_000 }
  );
  const base = normalize(walletAddress, raw);
  return {
    ...base,
    reputation_score: raw.reputation_score ?? 0,
    tier: raw.tier ?? 0,
    tier_name: raw.tier_name ?? "Strict",
    gates: raw.gates ?? {},
    upgrade_eligible: raw.upgrade_eligible ?? false,
    upgrade_requirements: raw.upgrade_requirements ?? null,
    transaction_count: raw.transaction_count ?? 0,
    successful_txns: raw.successful_txns ?? 0,
    failed_txns: raw.failed_txns ?? 0,
    total_volume_eth: raw.total_volume_eth ?? 0,
    tenure_days: raw.tenure_days ?? 0,
    collateral_eth: raw.collateral_eth ?? 0,
  };
}

function normalize(
  walletAddress: string,
  raw: ReputationUser
): ReputationVector {
  // Count how many protocol gates are enabled
  const protocolCount = raw.gates
    ? Object.values(raw.gates).filter(Boolean).length
    : null;

  const entries: SignalEntry[] = [
    {
      key: "wallet_age_days",
      label: "Wallet Age",
      value: raw.tenure_days > 0 ? raw.tenure_days : null,
      unit: "days",
    },
    {
      key: "account_type",
      label: "Account Type",
      value: raw.tier_name ? 1 : null,
      unit: raw.tier_name || "unknown",
    },
    {
      key: "transaction_count",
      label: "Transactions",
      value: raw.transaction_count > 0 ? raw.transaction_count : null,
      unit: "txns",
    },
    {
      key: "protocol_categories",
      label: "Protocols Used",
      value: protocolCount,
      unit: "protocols",
    },
    {
      key: "liquidation_count",
      label: "Liquidations",
      value: raw.failed_txns > 0 ? raw.failed_txns : 0,
      unit: "events",
    },
    {
      key: "bridge_inflow",
      label: "Collateral",
      value: raw.collateral_eth > 0 ? raw.collateral_eth : null,
      unit: "ETH",
    },
  ];

  return {
    wallet_address: walletAddress,
    scanned_at: new Date().toISOString(),
    signals: entries,
  };
}

/** Fetch recent activity from the vault activity aggregator. */
export async function fetchActivity(walletAddress: string): Promise<ActivityEntry[]> {
  try {
    const data = await apiFetch<{ activity: ActivityEntry[] }>(
      `/api/v1/zkdefi/vault/activity/${walletAddress}`,
      { timeoutMs: 10_000 }
    );
    return data.activity ?? [];
  } catch {
    return [];
  }
}
