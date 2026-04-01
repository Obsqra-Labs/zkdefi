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
  portable_receipt?: {
    registry_receipt_id?: string;
    cid?: string;
    gateway_url?: string | null;
    ipfs_gateway_url?: string | null;
    ipfs_uri?: string | null;
    archive_tx_hash?: string | null;
  } | null;
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

/** A single normalized activity entry from the vault activity feed */
export interface ActivityEntry {
  type: string;        // ledger | receipt | rebalance | yield
  description: string;
  method: string;
  timestamp: string;
  asset: string;
  amount: string;
  hashes: {
    tx: string;
    commitment: string;
    nullifier: string;
    proof: string;
  };
}

/* ── Builder Activity (on-chain, receipt-backed) ─────────────────── */

/** A single receipt from the ReceiptOS timeline. */
export interface ReceiptEntry {
  receiptId: string;
  timestamp: string;
  type: string;           // gate | execute | deposit | warning
  intentSummary: string;
  gateStatus: string;     // pass | pending | failed
  hashes: {
    intent: string;
    policy: string;
    execution: string;
    receipt: string;
  };
  source: string;         // receipt_service | orchestration | decision_event
}

/** On-chain activity backed by ReceiptOS attestations. */
export interface BuilderActivity {
  receipts: ReceiptEntry[];
  totalReceipts: number;
}
