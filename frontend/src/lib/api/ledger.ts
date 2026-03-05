import { apiFetch } from "@/lib/api/client";

export type LedgerAssetSymbol = "STRK" | "zkdETH" | "zkdAI" | string;
export type TransferDestinationMode = "shielded" | "wallet";

export interface LedgerTransferEntry {
  id: number;
  address: string;
  asset: LedgerAssetSymbol;
  amount_wei: string;
  direction: string;
  request_id: number | null;
  reason: string | null;
  tx_hash?: string | null;
  capital_source?: "wallet_mode" | "private_capital" | string | null;
  created_at: number;
  // Proof enrichment fields
  proof_hash?: string | null;
  proof_status?: "verified" | "pending" | "mock" | null;
  receipt_id?: string | null;
}

export interface LedgerTransfersResponse {
  transfers: LedgerTransferEntry[];
  limit: number;
  offset: number;
}

export interface LedgerAssetAccount {
  asset: LedgerAssetSymbol;
  available_wei: string;
  pending_out_wei: string;
  deployed_wei: string;
}

export interface LedgerAccountResponse {
  address: string;
  default_destination_mode: TransferDestinationMode;
  wallet_opt_out_enabled: boolean;
  total_earned_wei: string;
  assets: LedgerAssetAccount[];
}

export interface TransferOutRequest {
  user_address: string;
  amount_wei: string;
  asset: LedgerAssetSymbol;
  capital_source?: "wallet_mode" | "private_capital";
  destination_mode: TransferDestinationMode;
  recipient?: string;
}

export interface TransferOutResponse {
  status: "queued";
  destination_mode: TransferDestinationMode;
  request_id: number;
  asset: LedgerAssetSymbol;
  capital_source: "wallet_mode" | "private_capital" | string;
  amount_wei: string;
  recipient: string;
  ledger_balance_wei: string;
  receipt_id: string;
  message: string;
}

export interface TransferInRequest {
  user_address: string;
  tx_hash: string;
  asset: LedgerAssetSymbol;
  capital_source?: "wallet_mode" | "private_capital";
}

export interface TransferInResponse {
  status: "credited";
  asset: LedgerAssetSymbol;
  capital_source: "wallet_mode" | "private_capital" | string;
  tx_hash: string;
  amount_wei: string;
  balance_wei: string;
  receipt_id: string;
  message: string;
}

export function getLedgerTransfers(
  userAddress: string,
  limit: number = 50,
  offset: number = 0,
  asset?: LedgerAssetSymbol,
): Promise<LedgerTransfersResponse> {
  const query = new URLSearchParams({
    user_address: userAddress,
    limit: String(limit),
    offset: String(offset),
  });
  if (asset) query.set("asset", String(asset));
  return apiFetch<LedgerTransfersResponse>(`/api/v1/zkdefi/ledger/transfers?${query.toString()}`);
}

export function getLedgerAccount(userAddress: string): Promise<LedgerAccountResponse> {
  return apiFetch<LedgerAccountResponse>(
    `/api/v1/zkdefi/ledger/account/${encodeURIComponent(userAddress)}`,
  );
}

export function requestLedgerTransferOut(req: TransferOutRequest): Promise<TransferOutResponse> {
  return apiFetch<TransferOutResponse>("/api/v1/zkdefi/ledger/transfer_out/request", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function requestLedgerTransferIn(req: TransferInRequest): Promise<TransferInResponse> {
  return apiFetch<TransferInResponse>("/api/v1/zkdefi/ledger/transfer_in/request", {
    method: "POST",
    body: JSON.stringify(req),
  });
}
