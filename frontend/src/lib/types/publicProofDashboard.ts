export interface PublicProofDashboardSummary {
  public_entries_total?: number;
  excluded_entries_total?: number;
  notes?: string[];
}

export interface PublicProofDashboardEntry {
  lane?: string;
  title?: string;
  network?: string;
  tx_hash?: string;
  voyager_url?: string;
  starkscan_url?: string;
  verified_on_chain?: boolean;
  mode?: string;
  model?: string;
  verification_backend?: string;
  verification_policy?: string;
  proof_hash?: string | null;
  note?: string;
  [key: string]: unknown;
}

export interface PublicProofDashboardPayload {
  status?: string;
  summary?: PublicProofDashboardSummary;
  entries?: PublicProofDashboardEntry[];
  excluded_lanes?: { lane?: string; reason?: string; detail?: string }[];
  sources?: Record<string, unknown>;
}

export function isPublicProofDashboardPayload(x: unknown): x is PublicProofDashboardPayload {
  return typeof x === "object" && x !== null;
}
