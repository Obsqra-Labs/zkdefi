/** ReceiptOS Passport — shared types */

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

/** On-chain receipt state returned by the ReceiptRegistry contract */
export interface OnchainReceipt {
  receipt_id: number;
  verified: boolean;
  policy_hash: string;
  weight: number;
  consumed: boolean;
}

/** Claim request body (POST /api/claim) */
export interface ClaimRequest {
  wallet_address: string;
}

/** Claim response */
export interface ClaimResponse {
  receipt_id: number;
  tx_hash: string;
}
