/**
 * Vault API client — deposit verification, status, and history.
 */

import { API_BASE, apiFetch } from "@/lib/api/client";

/** Shorthand: call apiFetch with /api/v1/zkdefi/vault prefix. */
function vaultFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(`/api/v1/zkdefi/vault${path}`, init);
}

// ── Types ────────────────────────────────────────────────────────────────

export interface VaultDepositRequest {
  user_address: string;
  tx_hash: string;
}

export interface VaultDepositResponse {
  deposit_id: number | null;
  user_address: string;
  amount_wei: string;
  tx_hash: string;
  balance_wei: string;
  duplicate: boolean;
  message: string;
}

export interface VaultAllocation {
  venue: string;
  pair: string | null;
  amount_wei: string;
  position_id: string | null;
  status: string;
}

export interface VaultStatusResponse {
  user_address: string;
  balance_wei: string;
  total_deposited_wei: string;
  total_withdrawn_wei: string;
  deployed_wei: string;
  liquid_wei: string;
  total_yield_wei: string;
  apy_estimate: number;
  allocations: VaultAllocation[];
}

export interface VaultDepositRecord {
  id: number;
  amount_wei: string;
  tx_hash: string;
  status: string;
  created_at: number;
}

export interface OperatorAddress {
  operator_address: string;
}

// ── API calls ────────────────────────────────────────────────────────────

export function submitVaultDeposit(req: VaultDepositRequest): Promise<VaultDepositResponse> {
  return vaultFetch<VaultDepositResponse>("/deposit", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function getVaultStatus(userAddress: string): Promise<VaultStatusResponse> {
  return vaultFetch<VaultStatusResponse>(`/status?user_address=${encodeURIComponent(userAddress)}`);
}

export function getVaultDeposits(userAddress: string): Promise<VaultDepositRecord[]> {
  return vaultFetch<VaultDepositRecord[]>(`/deposits?user_address=${encodeURIComponent(userAddress)}`);
}

export function getOperatorAddress(): Promise<OperatorAddress> {
  return vaultFetch<OperatorAddress>("/operator-address");
}

// ── Position (including protocol-gated) ──────────────────────────────────

export interface PositionResponse {
  position: string;
  [key: string]: unknown;
}

/**
 * Fetch user position. Uses the zkdefi position endpoint,
 * not the vault sub-path, so we call API_BASE directly.
 */
export async function getPosition(
  address: string,
  protocolId: number = 0,
  signal?: AbortSignal,
): Promise<PositionResponse> {
  const res = await fetch(
    `${API_BASE}/api/v1/zkdefi/position/${encodeURIComponent(address)}?protocol_id=${protocolId}`,
    { signal, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PositionResponse;
}
