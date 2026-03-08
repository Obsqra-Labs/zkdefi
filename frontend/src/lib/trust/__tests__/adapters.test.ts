import { describe, expect, it } from "vitest";

import {
  getDisclosureClaims,
  getExecutionGate,
  getGovernancePower,
  getIdentityBindingStatus,
  getLendingGate,
} from "@/lib/trust/adapters";
import type { RiskProfileV2 } from "@/hooks/useProfile";

const profile: RiskProfileV2 = {
  profile_version: "2.0",
  address: "0xabc",
  identity: {
    has_agent: true,
    identity_commitment: "0xcommit",
    linked_addresses: [
      { chain: "ethereum", address: "0x1", verified: true },
      { chain: "base", address: "0x2", verified: false },
    ],
    session_summary: { count: 2, active_count: 1 },
    dual_wallet_session: {
      active: true,
      status: "active",
      chain: "ethereum",
      evm_address: "0x1",
      expires_at: 111,
      verified_at: "now",
    },
  },
  reputation: {
    tier: 2,
    tier_name: "Express",
    tenure_days: 120,
    transaction_count: 14,
    successful_txns: 12,
    collateral_eth: 2,
    total_volume_eth: 10,
  },
  passport: {
    composite_score: 81,
    letter_rating: "A",
    tier: 2,
    tier_name: "Express",
    credit_tier: "A",
    credit_score: 760,
    receipt_summary: { count: 2, by_type: { risk_passport: 1 } },
  },
  governance: {
    voting_power: 123.45,
    lp_usd: 600,
    lending_usd: 220,
    staking_usd: 300,
    tier_multiplier: 1.4,
    formula_version: "vp_v2",
    basis: "sqrt_capital",
  },
  decisions: {
    relayer: { mode: "allow", reason_codes: [], limits: {} },
    execution: { mode: "advisory", reason_codes: ["no_active_session"], limits: {} },
    lending: { mode: "block", reason_codes: ["no_credit_line"], limits: {} },
  },
  disclosures: {
    risk_notice_id: "notice-v1",
    legal_mode: "strong",
    disclaimer: "test",
  },
  predictive_credit: {
    grade: "A",
    grade_confidence: 0.92,
    max_ltv: 0.7,
    rate_bps: 450,
    credit_line_eth: 12,
    collaborative_multiplier: 1.2,
    model_name: "creditworthiness_xgboost",
  },
};

describe("trust adapters", () => {
  it("maps execution and lending gates", () => {
    expect(getExecutionGate(profile).mode).toBe("advisory");
    expect(getLendingGate(profile).mode).toBe("block");
  });

  it("maps governance power safely", () => {
    const governance = getGovernancePower(profile);
    expect(governance.votingPower).toBeCloseTo(123.45);
    expect(governance.tierMultiplier).toBeCloseTo(1.4);
    expect(governance.formulaVersion).toBe("vp_v2");
  });

  it("maps identity binding status", () => {
    const identity = getIdentityBindingStatus(profile);
    expect(identity.hasAgent).toBe(true);
    expect(identity.linkedVerifiedCount).toBe(1);
    expect(identity.dualWalletActive).toBe(true);
    expect(identity.activeSessionCount).toBe(1);
  });

  it("builds selective disclosure claims", () => {
    const claims = getDisclosureClaims(profile, [
      "identity_binding",
      "reputation_tier",
      "governance_power",
    ]);
    expect(claims).toHaveLength(3);
    expect(claims.map((c) => c.key)).toEqual([
      "identity_binding",
      "reputation_tier",
      "governance_power",
    ]);
  });

  it("returns defaults for missing profile", () => {
    expect(getExecutionGate(null).mode).toBe("advisory");
    expect(getDisclosureClaims(undefined)).toEqual([]);
  });
});
