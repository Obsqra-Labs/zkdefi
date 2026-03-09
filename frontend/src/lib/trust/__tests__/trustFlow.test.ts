import { describe, expect, it } from "vitest";

import type { RiskProfileV2 } from "@/hooks/useProfile";
import {
  deriveTrustFlowState,
  getTrustFlowProgress,
  isTrustFlowComplete,
  isTrustFlowReadyForAgent,
} from "@/lib/trust/trustFlow";

const baseProfile: RiskProfileV2 = {
  profile_version: "2.0",
  address: "0xabc",
  identity: {
    has_agent: true,
    identity_commitment: "0xcommit",
    subject_id: "subject_1",
    linked_addresses: [
      { chain: "ethereum", address: "0x1", verified: true },
      { chain: "base", address: "0x2", verified: false },
    ],
    session_summary: { count: 1, active_count: 1 },
    dual_wallet_session: {
      active: true,
      status: "active",
      chain: "ethereum",
      evm_address: "0x1",
      expires_at: 123,
      verified_at: "2026-03-08T00:00:00Z",
    },
  },
  attribution_summary: {
    event_count: 10,
    chains: ["starknet", "ethereum"],
  },
  credential_summary: {
    issued_count: 3,
    active_count: 2,
    revoked_count: 1,
  },
  reputation: {
    tier: 2,
    tier_name: "Express",
    tenure_days: 120,
    transaction_count: 10,
    successful_txns: 10,
    collateral_eth: 1,
    total_volume_eth: 5,
  },
  passport: {
    composite_score: 85,
    letter_rating: "A",
    tier: 2,
    tier_name: "Express",
    credit_tier: "A",
    credit_score: 760,
    receipt_summary: { count: 2, by_type: {} },
  },
  decisions: {
    relayer: { mode: "allow", reason_codes: [], limits: {} },
    execution: { mode: "allow", reason_codes: [], limits: {} },
    lending: { mode: "allow", reason_codes: [], limits: {} },
  },
};

describe("trust flow", () => {
  it("derives full flow from populated profile", () => {
    const state = deriveTrustFlowState(baseProfile, "0xabc");
    expect(state.rootIdentityConnected).toBe(true);
    expect(state.walletsLinked).toBe(true);
    expect(state.walletsVerified).toBe(true);
    expect(state.attributionsSynced).toBe(true);
    expect(state.claimsDerived).toBe(true);
    expect(state.disclosurePackIssued).toBe(true);
    expect(state.scopedSessionBound).toBe(true);

    expect(isTrustFlowReadyForAgent(state)).toBe(true);
    expect(isTrustFlowComplete(state)).toBe(true);

    const progress = getTrustFlowProgress(state);
    expect(progress.complete).toBe(progress.total);
    expect(progress.nextStep).toBeNull();
  });

  it("handles sparse profile safely", () => {
    const sparse: RiskProfileV2 = {
      ...baseProfile,
      identity: {
        ...baseProfile.identity,
        has_agent: false,
        identity_commitment: null,
        linked_addresses: [],
        session_summary: { count: 0, active_count: 0 },
        dual_wallet_session: { ...baseProfile.identity.dual_wallet_session!, active: false, status: "missing" },
      },
      attribution_summary: { event_count: 0, chains: [] },
      credential_summary: { issued_count: 0, active_count: 0, revoked_count: 0 },
      passport: { ...baseProfile.passport, composite_score: 0 },
    };

    const state = deriveTrustFlowState(sparse, "0xabc");
    expect(state.rootIdentityConnected).toBe(false);
    expect(state.walletsLinked).toBe(false);
    expect(state.walletsVerified).toBe(false);
    expect(state.attributionsSynced).toBe(false);
    expect(state.claimsDerived).toBe(false);
    expect(state.disclosurePackIssued).toBe(false);
    expect(state.scopedSessionBound).toBe(false);

    expect(isTrustFlowReadyForAgent(state)).toBe(false);
    expect(isTrustFlowComplete(state)).toBe(false);

    const progress = getTrustFlowProgress(state);
    expect(progress.complete).toBe(0);
    expect(progress.nextStep).toBe("rootIdentityConnected");
  });
});
