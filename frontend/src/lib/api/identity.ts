/**
 * Identity API client — onboarding status, commitment lookup, compliance profiles.
 * Talks to /api/v1/zkdefi/onboarding/*, /api/v1/identity/*, /api/v1/zkdefi/compliance/* endpoints.
 */

import { apiFetch } from "@/lib/api/client";

// ── Types ────────────────────────────────────────────────────────────────

export interface OnboardingStatus {
  onboarded: boolean;
  identity_commitment?: string;
  risk_profile?: string;
  [key: string]: unknown;
}

export interface CommitmentLookup {
  found: boolean;
  commitment?: string;
  tier?: string;
  score?: number;
  [key: string]: unknown;
}

export interface ComplianceProfile {
  profile_type: string;
  verified: boolean;
  created_at: number;
  [key: string]: unknown;
}

// ── API calls ────────────────────────────────────────────────────────────

export function getOnboardingStatus(
  address: string,
): Promise<OnboardingStatus | null> {
  return apiFetch<OnboardingStatus>(
    `/api/v1/zkdefi/onboarding/status/${encodeURIComponent(address)}`,
  ).catch(() => null);
}

export function getCommitmentLookup(
  commitment: string,
): Promise<CommitmentLookup> {
  return apiFetch<CommitmentLookup>(
    `/api/v1/identity/commitment/${encodeURIComponent(commitment)}`,
  );
}

/**
 * Resolve the credit tier for a user by checking onboarding → identity commitment.
 * Returns null if the user has no commitment or lookup fails.
 */
export async function resolveCreditTier(
  address: string,
): Promise<CommitmentLookup | null> {
  try {
    const onb = await getOnboardingStatus(address);
    const commitment = onb?.identity_commitment;
    if (!commitment) return null;
    const data = await getCommitmentLookup(commitment);
    return data?.found ? data : null;
  } catch {
    return null;
  }
}

export function getComplianceProfiles(
  address: string,
): Promise<ComplianceProfile[]> {
  return apiFetch<ComplianceProfile[]>(
    `/api/v1/zkdefi/compliance/profiles/${encodeURIComponent(address)}`,
  ).catch(() => []);
}
