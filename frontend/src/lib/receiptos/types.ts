/** ReceiptOS types for the passport integration */

export interface ReputationVector {
  wallet_address: string;
  scanned_at: string;
  signals: SignalEntry[];
}

export interface SignalEntry {
  key: string;
  label: string;
  value: number | null;
  unit: string;
}

export interface OnchainReceipt {
  receipt_id: number;
  verified: boolean;
  policy_hash: string;
  weight: number;
}

export interface ClaimResponse {
  receipt_id: number;
  tx_hash: string;
}

/** Full reputation profile surfaced by the backend */
export interface ReputationProfile {
  wallet_address: string;
  scanned_at: string;
  signals: SignalEntry[];
  reputation_score: number;
  tier: number;
  tier_name: string;
  gates: Record<string, boolean>;
  upgrade_eligible: boolean;
  upgrade_requirements: UpgradeRequirements | null;
  transaction_count: number;
  successful_txns: number;
  failed_txns: number;
  total_volume_eth: number;
  tenure_days: number;
  collateral_eth: number;
}

export interface UpgradeRequirements {
  target_tier: number;
  needs_tenure_days?: number;
  needs_successful_txns?: number;
  needs_collateral_eth?: number;
}
