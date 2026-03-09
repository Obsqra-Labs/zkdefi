import { apiFetch } from "@/lib/api/client";

export interface IdentityGraphLink {
  link_id?: string;
  subject?: string;
  chain?: string;
  address?: string;
  verified?: boolean;
  verified_at?: string | null;
  verification_method?: string;
  confidence?: number;
}

export interface IdentityGraphResponse {
  subject?: string;
  identity_commitment?: string | null;
  links?: IdentityGraphLink[];
  sessions?: Array<Record<string, unknown>>;
  updated_at?: string;
  version_matrix?: Record<string, string>;
}

export interface AttributionQueryResponse {
  subject?: string;
  summary?: {
    total_events?: number;
    coverage_score?: number;
    verified_chain_count?: number;
  };
  attributions?: Array<Record<string, unknown>>;
  version_matrix?: Record<string, string>;
}

export interface ClaimsDeriveResponse {
  subject?: string;
  window_days?: number;
  min_confidence?: number;
  summary?: {
    attribution_count?: number;
    coverage_score?: number;
    verified_chain_count?: number;
  };
  claims?: Record<string, unknown>;
  version_matrix?: Record<string, string>;
}

export interface CredentialIssueResponse {
  status?: string;
  credential?: {
    credential_id?: string;
    subject?: string;
    template?: string;
    audience?: string;
    claims?: Record<string, unknown>;
    issued_at?: string;
    expires_at?: string;
    signature?: string;
    revocation_id?: string;
    revoked?: boolean;
  };
}

export interface CredentialVerifyResponse {
  valid?: boolean;
  reason?: string;
  credential?: {
    credential_id?: string;
    subject?: string;
    revocation_id?: string;
    revoked?: boolean;
  };
}

export interface CredentialRevokeResponse {
  revoked?: boolean;
  credential_id?: string;
  revocation_id?: string;
  reason?: string;
}

export interface RevocationStatusResponse {
  revocation_id?: string;
  revoked?: boolean;
  reason?: string | null;
  revoked_at?: string | null;
}

export function normalizeSubject(addressOrSubject: string): string {
  return addressOrSubject.trim().toLowerCase();
}

export async function fetchIdentityGraph(subject: string): Promise<IdentityGraphResponse> {
  return apiFetch<IdentityGraphResponse>(
    `/api/v1/zkdefi/identity/graph/${normalizeSubject(subject)}`
  );
}

export async function syncAttributions(
  subject: string,
  windowDays = 90,
  includeEvidence = false
): Promise<AttributionQueryResponse> {
  return apiFetch<AttributionQueryResponse>("/api/v1/zkdefi/attributions/query", {
    method: "POST",
    body: JSON.stringify({
      subject: normalizeSubject(subject),
      window_days: windowDays,
      include_evidence: includeEvidence,
    }),
  });
}

export async function deriveClaims(
  subject: string,
  windowDays = 90,
  minConfidence = 0.0
): Promise<ClaimsDeriveResponse> {
  return apiFetch<ClaimsDeriveResponse>("/api/v1/zkdefi/claims/derive", {
    method: "POST",
    body: JSON.stringify({
      subject: normalizeSubject(subject),
      window_days: windowDays,
      min_confidence: minConfidence,
    }),
  });
}

export async function issueCredential(
  subject: string,
  opts?: {
    template?: string;
    audience?: string;
    claimKeys?: string[];
    ttlHours?: number;
  }
): Promise<CredentialIssueResponse> {
  return apiFetch<CredentialIssueResponse>("/api/v1/zkdefi/credentials/issue", {
    method: "POST",
    body: JSON.stringify({
      subject: normalizeSubject(subject),
      template: opts?.template ?? "portable_identity_v3",
      audience: opts?.audience ?? "self",
      claim_keys: opts?.claimKeys,
      ttl_hours: opts?.ttlHours ?? 24,
    }),
  });
}

export async function verifyCredential(
  credentialId: string,
  signature?: string
): Promise<CredentialVerifyResponse> {
  return apiFetch<CredentialVerifyResponse>("/api/v1/zkdefi/credentials/verify", {
    method: "POST",
    body: JSON.stringify({
      credential_id: credentialId.trim(),
      signature: signature?.trim() || undefined,
    }),
  });
}

export async function revokeCredential(
  credentialId: string,
  reason = "user_requested"
): Promise<CredentialRevokeResponse> {
  return apiFetch<CredentialRevokeResponse>("/api/v1/zkdefi/credentials/revoke", {
    method: "POST",
    body: JSON.stringify({
      credential_id: credentialId.trim(),
      reason,
    }),
  });
}

export async function getRevocationStatus(
  revocationId: string
): Promise<RevocationStatusResponse> {
  return apiFetch<RevocationStatusResponse>(
    `/api/v1/zkdefi/credentials/revocation/${revocationId.trim()}`
  );
}
