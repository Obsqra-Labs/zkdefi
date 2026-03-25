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
