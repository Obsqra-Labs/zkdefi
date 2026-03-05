/**
 * Orchestration API client — full orchestration deploy.
 * Talks to /api/v1/zkdefi/orchestration/* endpoints.
 */

import { apiFetch } from "@/lib/api/client";

// ── Types ────────────────────────────────────────────────────────────────

export interface OrchestrationDeployRequest {
  user_address: string;
  deployable_amount: number;
  risk_profile: string;
}

export interface OrchestrationPosition {
  strategy: string;
  amount: number;
  status: string;
  [key: string]: unknown;
}

export interface OrchestrationDeployResponse {
  positions: OrchestrationPosition[];
  [key: string]: unknown;
}

// ── API calls ────────────────────────────────────────────────────────────

export function deploy(
  request: OrchestrationDeployRequest,
  demoMode?: boolean,
): Promise<OrchestrationDeployResponse> {
  return apiFetch<OrchestrationDeployResponse>(
    "/api/v1/zkdefi/orchestration/deploy",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    demoMode ? { demoMode: true } : undefined,
  );
}
