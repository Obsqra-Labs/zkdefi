import {
  ExecutionCompileResponse,
  PolicyCompilePreviewResponse,
  PrivacyUnifiedActionResponse,
  VaultPolicyProfile,
} from "@/types/ekubo";

import { apiFetch, walletAuthHeaders } from "@/lib/api/client";

export interface PolicyCompileRequest {
  user_address: string;
  action_type?: "deposit" | "withdraw" | "swap" | "lp_add" | "lp_remove" | "deploy" | "rebalance";
  execution_intent?: "manual_wallet" | "orchestrated" | "autonomous" | "session";
  wallet_connected?: boolean;
  shared_pool_id?: string;
  member_address?: string;
  context?: Record<string, unknown>;
}

export function getVaultPolicy(address: string): Promise<VaultPolicyProfile> {
  return apiFetch<VaultPolicyProfile>(`/api/v1/zkdefi/policy/vault/${encodeURIComponent(address)}`);
}

export function putVaultPolicy(address: string, patch: Partial<VaultPolicyProfile>): Promise<VaultPolicyProfile> {
  return apiFetch<VaultPolicyProfile>(`/api/v1/zkdefi/policy/vault/${encodeURIComponent(address)}`, {
    method: "PUT",
    headers: walletAuthHeaders(address),
    body: JSON.stringify({ patch }),
  });
}

export function compilePolicy(request: PolicyCompileRequest): Promise<ExecutionCompileResponse> {
  return apiFetch<ExecutionCompileResponse>("/api/v1/zkdefi/policy/compile", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function previewPolicy(request: PolicyCompileRequest): Promise<PolicyCompilePreviewResponse> {
  return apiFetch<PolicyCompilePreviewResponse>("/api/v1/zkdefi/policy/preview", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export interface PrivacyUnifiedActionRequest {
  user_address: string;
  amount: string;
  token: string;
  shared_pool_id?: string;
  member_address?: string;
  execution_intent?: "manual_wallet" | "orchestrated" | "autonomous" | "session";
  execution_mode?: "wallet" | "orchestrated" | "auto";
  execute_now?: boolean;
  wallet_connected?: boolean;
  venue?: string;
  withdraw_source?: "vault" | "ai_pool";
  extra_context?: Record<string, unknown>;
}

export function privacyDeposit(request: PrivacyUnifiedActionRequest): Promise<PrivacyUnifiedActionResponse> {
  return apiFetch<PrivacyUnifiedActionResponse>("/api/v1/zkdefi/privacy/deposit", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function privacyWithdraw(request: PrivacyUnifiedActionRequest): Promise<PrivacyUnifiedActionResponse> {
  return apiFetch<PrivacyUnifiedActionResponse>("/api/v1/zkdefi/privacy/withdraw", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
