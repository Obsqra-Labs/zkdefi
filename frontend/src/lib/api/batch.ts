/**
 * Batch Verification API client.
 * Talks to /api/v1/zkdefi/batch/* endpoints.
 */

import { apiFetch } from "@/lib/api/client";

// ── Types ────────────────────────────────────────────────────────────────

export interface BatchAction {
  action_hash: string;
  user: string;
  queued_at: string;
  status: "pending" | "submitted" | "challenged";
}

export interface BatchHistoryEntry {
  batch_id: string;
  proof_hash: string;
  action_count: number;
  submitted_at: string;
  tx_hash: string | null;
  status: "submitted" | "verified" | "challenged";
}

export interface BatchPendingResponse {
  pending_count: number;
  actions: BatchAction[];
}

export interface BatchHistoryResponse {
  batches: BatchHistoryEntry[];
  total: number;
}

export interface BatchProcessResponse {
  success: boolean;
  batch_id?: string;
  tx_hash?: string;
  action_count?: number;
  message?: string;
}

// ── API calls ────────────────────────────────────────────────────────────

export function getPendingBatch(): Promise<BatchPendingResponse> {
  return apiFetch<BatchPendingResponse>("/api/v1/zkdefi/batch/pending");
}

export function getBatchHistory(limit = 20): Promise<BatchHistoryResponse> {
  return apiFetch<BatchHistoryResponse>(`/api/v1/zkdefi/batch/history?limit=${limit}`);
}

export function processBatch(): Promise<BatchProcessResponse> {
  return apiFetch<BatchProcessResponse>("/api/v1/zkdefi/batch/process", {
    method: "POST",
  });
}
