import type { RiskProfileV2 } from "@/hooks/useProfile";

export interface TrustFlowState {
  rootIdentityConnected: boolean;
  walletsLinked: boolean;
  walletsVerified: boolean;
  attributionsSynced: boolean;
  claimsDerived: boolean;
  disclosurePackIssued: boolean;
  scopedSessionBound: boolean;
}

export interface TrustFlowStepMeta {
  key: keyof TrustFlowState;
  label: string;
  hint: string;
}

export const TRUST_FLOW_STEPS: TrustFlowStepMeta[] = [
  {
    key: "rootIdentityConnected",
    label: "Connect root identity",
    hint: "Anchor the subject to Starknet identity.",
  },
  {
    key: "walletsLinked",
    label: "Link wallets",
    hint: "Attach EVM and Starknet accounts to one subject.",
  },
  {
    key: "walletsVerified",
    label: "Verify ownership",
    hint: "Only verified links influence trust decisions.",
  },
  {
    key: "attributionsSynced",
    label: "Sync attributions",
    hint: "Import cross-chain behavioral events into the ledger.",
  },
  {
    key: "claimsDerived",
    label: "Derive claims",
    hint: "Compute portable trust claims from verified activity.",
  },
  {
    key: "disclosurePackIssued",
    label: "Issue disclosure pack",
    hint: "Create selective disclosure credentials for downstream use.",
  },
  {
    key: "scopedSessionBound",
    label: "Bind scoped session",
    hint: "Grant execution rights with explicit limits.",
  },
];

export interface TrustFlowProgress {
  complete: number;
  total: number;
  ratio: number;
  nextStep: keyof TrustFlowState | null;
}

const AGENT_REQUIRED_STEPS: Array<keyof TrustFlowState> = [
  "rootIdentityConnected",
  "walletsLinked",
  "walletsVerified",
  "claimsDerived",
  "scopedSessionBound",
];

export function deriveTrustFlowState(
  profile: RiskProfileV2 | null | undefined,
  address?: string | null
): TrustFlowState {
  const identity = profile?.identity;
  const linked = Array.isArray(identity?.linked_addresses) ? identity.linked_addresses : [];
  const verifiedLinkedCount = linked.filter((item) => Boolean(item?.verified)).length;

  return {
    rootIdentityConnected: Boolean(address && (identity?.identity_commitment || identity?.has_agent)),
    walletsLinked: linked.length > 0,
    walletsVerified: verifiedLinkedCount > 0,
    attributionsSynced: Number(profile?.attribution_summary?.event_count ?? 0) > 0,
    claimsDerived: Number(profile?.passport?.composite_score ?? 0) > 0,
    disclosurePackIssued: Number(profile?.credential_summary?.active_count ?? 0) > 0,
    scopedSessionBound:
      Number(identity?.session_summary?.active_count ?? 0) > 0 || Boolean(identity?.dual_wallet_session?.active),
  };
}

export function getTrustFlowProgress(state: TrustFlowState): TrustFlowProgress {
  const total = TRUST_FLOW_STEPS.length;
  const complete = TRUST_FLOW_STEPS.filter((step) => Boolean(state[step.key])).length;
  const ratio = total > 0 ? complete / total : 0;
  const firstIncomplete = TRUST_FLOW_STEPS.find((step) => !state[step.key]);

  return {
    complete,
    total,
    ratio,
    nextStep: firstIncomplete ? firstIncomplete.key : null,
  };
}

export function isTrustFlowComplete(state: TrustFlowState): boolean {
  return TRUST_FLOW_STEPS.every((step) => Boolean(state[step.key]));
}

export function isTrustFlowReadyForAgent(state: TrustFlowState): boolean {
  return AGENT_REQUIRED_STEPS.every((stepKey) => Boolean(state[stepKey]));
}
