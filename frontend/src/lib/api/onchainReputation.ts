/**
 * On-chain reputation API client.
 * Talks to /api/v1/zkdefi/reputation/user/{address}/on-chain endpoint.
 */

import { apiFetch } from "@/lib/api/client";

// ── Types ────────────────────────────────────────────────────────────────

export interface OnChainReputation {
  address: string;
  tier: number;
  tier_name: string;
  reputation_score: number;
  collateral_wei: string;
  collateral_eth: number;
  successful_txns: number;
  failed_txns: number;
  total_volume_wei: string;
  total_volume_eth: number;
  can_use_relayer: boolean;
  relayer_delay_seconds: number;
  collaborative_score: number;
  source: "on-chain" | "fallback";
  contract: string;
  chain: string;
}

// ── API call ─────────────────────────────────────────────────────────────

export function getOnChainReputation(address: string): Promise<OnChainReputation> {
  return apiFetch<OnChainReputation>(
    `/api/v1/zkdefi/reputation/user/${encodeURIComponent(address)}/on-chain`,
  );
}
