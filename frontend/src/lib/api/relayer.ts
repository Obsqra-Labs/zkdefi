/**
 * Relayer API client — private withdrawal relay, stats, pending.
 * Talks to /api/v1/zkdefi/relayer/* endpoints.
 */

import { apiFetch } from "@/lib/api/client";

// ── Types ────────────────────────────────────────────────────────────────

export interface RelayRequest {
  request_id: string;
  amount_wei: string;
  destination: string;
  status: string;
  created_at: number;
}

export interface RelayerStats {
  deposit_pending: number;
  claim_pending: number;
  relayer_address: string;
}

export interface RelayResponse {
  request_id?: string;
  error?: string;
  [key: string]: unknown;
}

// ── API calls ────────────────────────────────────────────────────────────

export function getPending(address: string): Promise<RelayRequest[]> {
  return apiFetch<RelayRequest[]>(
    `/api/v1/zkdefi/relayer/pending/${encodeURIComponent(address)}`,
  );
}

export function getStats(): Promise<RelayerStats> {
  return apiFetch<RelayerStats>("/api/v1/zkdefi/relayer/stats");
}

export function requestRelay(
  userAddress: string,
  amountWei: string,
  destination: string,
): Promise<RelayResponse> {
  return apiFetch<RelayResponse>("/api/v1/zkdefi/relayer/request", {
    method: "POST",
    body: JSON.stringify({
      user_address: userAddress,
      amount_wei: amountWei,
      destination,
    }),
  });
}
