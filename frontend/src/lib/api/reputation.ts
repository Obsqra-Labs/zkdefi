/**
 * Reputation API client — tiers, staking, upgrades.
 * Talks to /api/v1/zkdefi/reputation/* endpoints.
 */

import { apiFetch } from "@/lib/api/client";

// ── Types ────────────────────────────────────────────────────────────────

export interface ReputationTier {
  tier: number;
  name: string;
  min_score: number;
  benefits: string[];
  [key: string]: unknown;
}

export interface StakeCollateralResponse {
  success: boolean;
  message?: string;
  [key: string]: unknown;
}

export interface UpgradeTierResponse {
  success: boolean;
  new_tier_name?: string;
  message?: string;
  [key: string]: unknown;
}

// ── API calls ────────────────────────────────────────────────────────────

export function getTiers(): Promise<ReputationTier[]> {
  return apiFetch<ReputationTier[]>("/api/v1/zkdefi/reputation/tiers");
}

export function stakeCollateral(
  address: string,
  amountWei: number,
): Promise<StakeCollateralResponse> {
  return apiFetch<StakeCollateralResponse>(
    `/api/v1/zkdefi/reputation/stake-collateral?address=${encodeURIComponent(address)}&amount_wei=${amountWei}`,
    { method: "POST" },
  );
}

export function upgradeTier(
  address: string,
  targetTier: number,
  upgradeProofHash: string = "0x0",
): Promise<UpgradeTierResponse> {
  return apiFetch<UpgradeTierResponse>("/api/v1/zkdefi/reputation/upgrade-tier", {
    method: "POST",
    body: JSON.stringify({
      address,
      target_tier: targetTier,
      upgrade_proof_hash: upgradeProofHash,
    }),
  });
}
