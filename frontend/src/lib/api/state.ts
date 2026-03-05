import {
  CommitmentLedgerResponse,
  ExecutionPreflightRequest,
  ExecutionPreflightResponse,
  HistoryTimelineResponse,
  WithdrawReadyResponse,
  WalletStateResponse,
} from "@/types/ekubo";

import { apiFetch } from "@/lib/api/client";

export function getHistoryTimeline(address: string): Promise<HistoryTimelineResponse> {
  return apiFetch<HistoryTimelineResponse>(`/api/v1/zkdefi/history/timeline/${encodeURIComponent(address)}`);
}

export function getWalletState(address: string, tokens?: string[]): Promise<WalletStateResponse> {
  const params = new URLSearchParams();
  for (const token of tokens ?? []) {
    if (token) params.append("token", token);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<WalletStateResponse>(`/api/v1/zkdefi/wallet/state/${encodeURIComponent(address)}${suffix}`);
}

export function getWithdrawReady(address: string): Promise<WithdrawReadyResponse> {
  return apiFetch<WithdrawReadyResponse>(`/api/v1/zkdefi/state/withdraw-ready/${encodeURIComponent(address)}`);
}

export function getCommitmentLedger(address: string): Promise<CommitmentLedgerResponse> {
  return apiFetch<CommitmentLedgerResponse>(`/api/v1/zkdefi/state/commitment-ledger/${encodeURIComponent(address)}`);
}

export function executionPreflight(
  request: ExecutionPreflightRequest,
): Promise<ExecutionPreflightResponse> {
  return apiFetch<ExecutionPreflightResponse>("/api/v1/zkdefi/execution/preflight", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export interface LocalCommitmentsMigrationResponse {
  user_address: string;
  imported_count: number;
  inferred_preset?: "unlinkable_basic" | "hidden_flow" | "hashed_claims" | null;
  policy_updated: boolean;
  migrated_at: string;
  note: string;
}

export interface ManualWalletEventResponse {
  user_address: string;
  receipt_id: string;
  tx_hash: string;
  status: string;
}

export function migrateLocalCommitments(payload: {
  user_address: string;
  commitments: Record<string, Array<Record<string, unknown>>>;
  apply_policy_preset?: boolean;
}): Promise<LocalCommitmentsMigrationResponse> {
  return apiFetch<LocalCommitmentsMigrationResponse>("/api/v1/zkdefi/state/migrate/local-commitments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function recordManualWalletEvent(payload: {
  user_address: string;
  action_type: "deposit" | "withdraw" | "swap" | "lp_add" | "lp_remove" | "deploy";
  venue: string;
  execution_path?: string;
  tx_hash: string;
  amount_wei?: string;
  asset?: string;
  capital_source?: "wallet_mode" | "private_capital";
  title?: string;
  details?: string;
  status?: "pending" | "confirmed" | "failed" | "info";
}): Promise<ManualWalletEventResponse> {
  return apiFetch<ManualWalletEventResponse>("/api/v1/zkdefi/state/manual-wallet-event", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
