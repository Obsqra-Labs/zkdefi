import { SharedPoolRecord, SharedPoolMemberPolicy } from "@/types/ekubo";

import { apiFetch } from "@/lib/api/client";

export interface CreateSharedPoolRequest {
  manager_address: string;
  shared_pool_id?: string;
  envelope?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface JoinSharedPoolRequest {
  member_address: string;
  member_override?: Record<string, unknown>;
  autopilot_opt_in?: boolean;
  session_scope?: Record<string, unknown>;
}

export interface CreateProposalRequest {
  manager_address: string;
  payload: Record<string, unknown>;
}

export interface ExecuteProposalRequest {
  proposal_id: string;
  member_address: string;
  execution_intent?: "manual_wallet" | "orchestrated" | "autonomous" | "session";
  wallet_connected?: boolean;
}

export function createSharedPool(request: CreateSharedPoolRequest): Promise<SharedPoolRecord> {
  return apiFetch<SharedPoolRecord>("/api/v1/zkdefi/shared_pools", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function getSharedPool(sharedPoolId: string): Promise<SharedPoolRecord> {
  return apiFetch<SharedPoolRecord>(`/api/v1/zkdefi/shared_pools/${encodeURIComponent(sharedPoolId)}`);
}

export function updateSharedPoolEnvelope(sharedPoolId: string, envelope: Record<string, unknown>): Promise<SharedPoolRecord> {
  return apiFetch<SharedPoolRecord>(`/api/v1/zkdefi/shared_pools/${encodeURIComponent(sharedPoolId)}/envelope`, {
    method: "PUT",
    body: JSON.stringify({ envelope }),
  });
}

export function joinSharedPool(sharedPoolId: string, request: JoinSharedPoolRequest): Promise<SharedPoolMemberPolicy> {
  return apiFetch<SharedPoolMemberPolicy>(`/api/v1/zkdefi/shared_pools/${encodeURIComponent(sharedPoolId)}/join`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function updateSharedPoolMember(
  sharedPoolId: string,
  memberAddress: string,
  patch: {
    member_override?: Record<string, unknown>;
    autopilot_opt_in?: boolean;
    session_scope?: Record<string, unknown>;
  },
): Promise<SharedPoolMemberPolicy> {
  return apiFetch<SharedPoolMemberPolicy>(
    `/api/v1/zkdefi/shared_pools/${encodeURIComponent(sharedPoolId)}/member/${encodeURIComponent(memberAddress)}`,
    {
      method: "PUT",
      body: JSON.stringify(patch),
    },
  );
}

export function createSharedPoolProposal(sharedPoolId: string, request: CreateProposalRequest): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(
    `/api/v1/zkdefi/shared_pools/${encodeURIComponent(sharedPoolId)}/proposals`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function executeSharedPoolProposal(sharedPoolId: string, request: ExecuteProposalRequest): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(
    `/api/v1/zkdefi/shared_pools/${encodeURIComponent(sharedPoolId)}/execute`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}
