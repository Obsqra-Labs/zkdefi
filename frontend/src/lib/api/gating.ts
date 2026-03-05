import {
  AdvisoryCheckRequest,
  AdvisoryCheckResponse,
  PolicyCompilePreviewResponse,
  RebalanceCheckResponse,
  RebalancePrepareResponse,
  RebalanceProposalResponse,
  RiskPassportUser,
  SessionKeyListResponse,
} from "@/types/ekubo";

import { apiFetch } from "@/lib/api/client";

export async function getRiskPassport(address: string): Promise<RiskPassportUser> {
  try {
    return await apiFetch<RiskPassportUser>(`/api/v1/zkdefi/risk_passport/user/${address}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : "";
    const missingPassportRoute = msg.includes("404") || msg.includes("not found");
    if (!missingPassportRoute) throw error;

    // Fallback 1: use risk_profile bundle if the dedicated passport route is offline.
    try {
      const bundle = await apiFetch<{ risk_passport?: RiskPassportUser | null }>(
        `/api/v1/zkdefi/risk_profile/${address}`,
      );
      if (bundle?.risk_passport) return bundle.risk_passport;
    } catch {
      // Continue to v2 fallback.
    }

    // Fallback 2: map risk_profile/v2 passport shape into RiskPassportUser.
    const v2 = await apiFetch<{ passport?: Partial<RiskPassportUser> }>(
      `/api/v1/zkdefi/risk_profile/v2/${address}`,
    );
    const passport = v2?.passport ?? {};
    return {
      composite_score: typeof passport.composite_score === "number" ? passport.composite_score : 0,
      letter_rating: typeof passport.letter_rating === "string" ? passport.letter_rating : "D",
      tier: typeof passport.tier === "number" ? passport.tier : 0,
      tier_name: typeof passport.tier_name === "string" ? passport.tier_name : "Strict",
      credit_tier: typeof passport.credit_tier === "string" ? passport.credit_tier : null,
      credit_score: typeof passport.credit_score === "number" ? passport.credit_score : null,
      proof_receipts: [],
    };
  }
}

export function listSessionKeys(address: string): Promise<SessionKeyListResponse> {
  return apiFetch<SessionKeyListResponse>(`/api/v1/zkdefi/session_keys/list/${address}`);
}

export interface GateActionInput {
  userAddress: string;
  amount: number;
  reason: string;
  poolId: string;
  portfolioFeatures: number[];
  fromProtocol: number;
  toProtocol: number;
  sessionId?: string;
}

export interface GateActionResult {
  ok: boolean;
  proposalId?: string;
  snapshotHash?: string;
  commitmentHash?: string;
  executionProofHash?: string;
  reason?: string;
}

export function advisoryActionCheck(input: AdvisoryCheckRequest): Promise<AdvisoryCheckResponse> {
  return apiFetch<AdvisoryCheckResponse>("/api/v1/zkdefi/rebalancer/advisory-check", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface CompilePreviewInput {
  user_address: string;
  action_type: "deposit" | "withdraw" | "swap" | "lp_add" | "lp_remove" | "deploy" | "rebalance";
  execution_intent: "manual_wallet" | "orchestrated" | "autonomous" | "session";
  wallet_connected?: boolean;
  shared_pool_id?: string;
  member_address?: string;
  context?: Record<string, unknown>;
}

export function compilePreview(input: CompilePreviewInput): Promise<PolicyCompilePreviewResponse> {
  return apiFetch<PolicyCompilePreviewResponse>("/api/v1/zkdefi/policy/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function postWithRetry<T>(
  path: string,
  body: Record<string, unknown>,
  retries = 2,
  retryDelayMs = 2000,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await apiFetch<T>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const shouldRetry =
        attempt < retries &&
        (message.includes("retry") ||
          message.includes("in progress") ||
          message.includes("proof in progress") ||
          message.includes("temporarily") ||
          message.includes("503") ||
          message.includes("timeout"));
      if (!shouldRetry) throw error;
      const delay = Math.floor(retryDelayMs * Math.pow(1.5, attempt));
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
  }
  throw new Error("Unexpected retry failure");
}

function normalizeFeatures(features: number[]): number[] {
  const base = Array.from({ length: 8 }, (_, i) => Number(features[i] ?? 0));
  return base.map((value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  });
}

export async function runActionGate(input: GateActionInput): Promise<GateActionResult> {
  const features = normalizeFeatures(input.portfolioFeatures);

  try {
    const proposal = await postWithRetry<RebalanceProposalResponse>(
      "/api/v1/zkdefi/rebalancer/propose",
      {
        user_address: input.userAddress,
        from_protocol: input.fromProtocol,
        to_protocol: input.toProtocol,
        amount: Math.max(1, Math.floor(input.amount)),
        reason: input.reason,
      },
      0,
    );

    const check = await postWithRetry<RebalanceCheckResponse>(
      "/api/v1/zkdefi/rebalancer/check",
      {
        proposal_id: proposal.proposal_id,
        portfolio_features: features,
        pool_id: input.poolId,
      },
      4,
    );

    if (!check.can_proceed) {
      return {
        ok: false,
        proposalId: proposal.proposal_id,
        snapshotHash: check.snapshot_hash,
        commitmentHash: check.commitment_hash,
        reason: "zkML gate blocked this action",
      };
    }

    let executionProofHash: string | undefined;
    if (input.sessionId) {
      const prepared = await postWithRetry<RebalancePrepareResponse>(
        "/api/v1/zkdefi/rebalancer/prepare",
        {
          proposal_id: proposal.proposal_id,
          session_id: input.sessionId,
        },
        3,
      );
      if (!prepared.ready_to_execute) {
        return {
          ok: false,
          proposalId: proposal.proposal_id,
          snapshotHash: check.snapshot_hash,
          commitmentHash: check.commitment_hash,
          reason: "Session preparation failed for this action",
        };
      }
      executionProofHash = prepared.execution_proof_hash;
    }

    return {
      ok: true,
      proposalId: proposal.proposal_id,
      snapshotHash: check.snapshot_hash,
      commitmentHash: check.commitment_hash,
      executionProofHash,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gate check failed";
    const normalized =
      message.toLowerCase().includes("in progress")
        ? "Proof still generating. Retry in a few seconds."
        : message;
    return {
      ok: false,
      reason: normalized,
    };
  }
}
