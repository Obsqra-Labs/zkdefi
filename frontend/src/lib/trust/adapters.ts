import type { RiskDecisionGate, RiskProfileV2 } from "@/hooks/useProfile";

export type DisclosureClaimKey =
  | "identity_binding"
  | "reputation_tier"
  | "credit_line"
  | "governance_power"
  | "execution_gate";

export interface TrustGateView {
  mode: "allow" | "advisory" | "block";
  reasons: string[];
  limits: Record<string, unknown>;
}

export interface GovernancePowerView {
  votingPower: number;
  lpUsd: number;
  lendingUsd: number;
  stakingUsd: number;
  tierMultiplier: number;
  formulaVersion: string;
  basis?: string;
}

export interface IdentityBindingView {
  hasAgent: boolean;
  linkedVerifiedCount: number;
  dualWalletActive: boolean;
  dualWalletStatus: string;
  activeSessionCount: number;
  identityCommitment?: string | null;
}

export interface DisclosureClaim {
  key: DisclosureClaimKey;
  label: string;
  value: unknown;
}

const EMPTY_GATE: TrustGateView = {
  mode: "advisory",
  reasons: ["profile_unavailable"],
  limits: {},
};

function normalizeGate(gate: RiskDecisionGate | undefined): TrustGateView {
  if (!gate || typeof gate !== "object") {
    return EMPTY_GATE;
  }
  return {
    mode: gate.mode ?? "advisory",
    reasons: Array.isArray(gate.reason_codes) ? gate.reason_codes : [],
    limits: gate.limits ?? {},
  };
}

export function getExecutionGate(profile: RiskProfileV2 | null | undefined): TrustGateView {
  return normalizeGate(profile?.decisions?.execution);
}

export function getLendingGate(profile: RiskProfileV2 | null | undefined): TrustGateView {
  return normalizeGate(profile?.decisions?.lending);
}

export function getGovernancePower(profile: RiskProfileV2 | null | undefined): GovernancePowerView {
  const governance = (profile?.governance ?? {}) as Partial<NonNullable<RiskProfileV2["governance"]>>;
  return {
    votingPower: Number(governance.voting_power ?? 0),
    lpUsd: Number(governance.lp_usd ?? 0),
    lendingUsd: Number(governance.lending_usd ?? 0),
    stakingUsd: Number(governance.staking_usd ?? 0),
    tierMultiplier: Number(governance.tier_multiplier ?? 1),
    formulaVersion: governance.formula_version ?? "vp_v2_sqrt_capital_tier_multiplier",
    basis: governance.basis,
  };
}

export function getIdentityBindingStatus(profile: RiskProfileV2 | null | undefined): IdentityBindingView {
  const identity = profile?.identity;
  const linked = Array.isArray(identity?.linked_addresses) ? identity.linked_addresses : [];
  const dual = identity?.dual_wallet_session;
  const sessionSummary = identity?.session_summary;

  return {
    hasAgent: Boolean(identity?.has_agent),
    linkedVerifiedCount: linked.filter((item) => Boolean(item?.verified)).length,
    dualWalletActive: Boolean(dual?.active),
    dualWalletStatus: dual?.status ?? "missing",
    activeSessionCount: Number(sessionSummary?.active_count ?? 0),
    identityCommitment: identity?.identity_commitment,
  };
}

export function getDisclosureClaims(
  profile: RiskProfileV2 | null | undefined,
  include: DisclosureClaimKey[] = [
    "identity_binding",
    "reputation_tier",
    "credit_line",
    "governance_power",
    "execution_gate",
  ]
): DisclosureClaim[] {
  if (!profile) {
    return [];
  }

  const includeSet = new Set(include);
  const identity = getIdentityBindingStatus(profile);
  const execution = getExecutionGate(profile);
  const lending = getLendingGate(profile);
  const governance = getGovernancePower(profile);

  const claims: DisclosureClaim[] = [];

  if (includeSet.has("identity_binding")) {
    claims.push({
      key: "identity_binding",
      label: "Identity Binding",
      value: {
        linked_verified_count: identity.linkedVerifiedCount,
        dual_wallet_active: identity.dualWalletActive,
        active_sessions: identity.activeSessionCount,
      },
    });
  }

  if (includeSet.has("reputation_tier")) {
    claims.push({
      key: "reputation_tier",
      label: "Reputation Tier",
      value: {
        tier: profile.reputation.tier,
        tier_name: profile.reputation.tier_name,
        letter_rating: profile.passport.letter_rating,
      },
    });
  }

  if (includeSet.has("credit_line")) {
    claims.push({
      key: "credit_line",
      label: "Credit Terms",
      value: {
        grade: profile.predictive_credit?.grade ?? null,
        credit_line_eth: profile.predictive_credit?.credit_line_eth ?? null,
        rate_bps: profile.predictive_credit?.rate_bps ?? null,
        lending_mode: lending.mode,
      },
    });
  }

  if (includeSet.has("governance_power")) {
    claims.push({
      key: "governance_power",
      label: "Governance Power",
      value: {
        voting_power: governance.votingPower,
        tier_multiplier: governance.tierMultiplier,
        basis: governance.basis ?? null,
      },
    });
  }

  if (includeSet.has("execution_gate")) {
    claims.push({
      key: "execution_gate",
      label: "Execution Gate",
      value: {
        mode: execution.mode,
        reason_codes: execution.reasons,
      },
    });
  }

  return claims;
}
