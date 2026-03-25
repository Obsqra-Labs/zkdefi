import { describe, expect, it } from "vitest";
import { computePolicyHash, type VectorForPolicyHash } from "../src/policy-hash";
import { AttesterSigner, verifyWithPublicKey } from "../src/signer";

const SAMPLE_VECTOR: VectorForPolicyHash = {
  wallet: "0x10eb4fb373daf7fc8985aa3185d9b1aebb4b2025111895d12668e5ca0447d76",
  timestamp: 1774445608,
  signals: {
    wallet_age_days: 27,
    account_type: "argent",
    transaction_count: 202542,
    protocol_category_count: 0,
    liquidation_count: null,
    bridge_inflow: null,
  },
};

const FIXTURE_PRIVATE_KEY = "0x12345";
const FIXTURE_POLICY_HASH = "0x12f6c11739eb6a8992e87dfe47d97453d4e0d2845140e3d566154e9e82114f6";
const FIXTURE_PUBLIC_KEY_X = "0x2f8ffcb446d2a062ef18561eb507b08ea01d52d4c594e90cfca47f075cb952";
const FIXTURE_SIG_R = "0x66693e63a92f664a568afab13c7e0899dd26e2a12c9302af145a32097174387";
const FIXTURE_SIG_S = "0x513136e43c19d9d02a2d9280dfabe8cef2c47acce35c020d92b867ef0e35f66";

describe("computePolicyHash", () => {
  it("is deterministic for the same vector", () => {
    expect(computePolicyHash(SAMPLE_VECTOR)).toBe(computePolicyHash(SAMPLE_VECTOR));
  });

  it("changes when the vector changes", () => {
    const variant: VectorForPolicyHash = {
      ...SAMPLE_VECTOR,
      signals: { ...SAMPLE_VECTOR.signals, transaction_count: SAMPLE_VECTOR.signals.transaction_count + 1 },
    };
    expect(computePolicyHash(SAMPLE_VECTOR)).not.toBe(computePolicyHash(variant));
  });

  it("treats null account type as unknown", () => {
    const withNull: VectorForPolicyHash = {
      ...SAMPLE_VECTOR,
      signals: { ...SAMPLE_VECTOR.signals, account_type: null },
    };
    const withUnknown: VectorForPolicyHash = {
      ...SAMPLE_VECTOR,
      signals: { ...SAMPLE_VECTOR.signals, account_type: "unknown" },
    };
    expect(computePolicyHash(withNull)).toBe(computePolicyHash(withUnknown));
  });
});

describe("AttesterSigner", () => {
  it("signs and verifies locally with the same Stark key", () => {
    const signer = new AttesterSigner(FIXTURE_PRIVATE_KEY);
    const policyHash = computePolicyHash(SAMPLE_VECTOR);
    const signature = signer.sign(policyHash);

    expect(signer.verify(policyHash, signature)).toBe(true);
    expect(verifyWithPublicKey(policyHash, signature, signer.fullPublicKey)).toBe(true);
  });

  it("rejects a signature for a different policy hash", () => {
    const signer = new AttesterSigner(FIXTURE_PRIVATE_KEY);
    const policyHash = computePolicyHash(SAMPLE_VECTOR);
    const otherPolicyHash = computePolicyHash({
      ...SAMPLE_VECTOR,
      timestamp: SAMPLE_VECTOR.timestamp + 1,
    });
    const signature = signer.sign(policyHash);

    expect(signer.verify(otherPolicyHash, signature)).toBe(false);
  });

  it("matches the documented cross-language fixture constants", () => {
    const signer = new AttesterSigner(FIXTURE_PRIVATE_KEY);
    const signature = signer.sign(FIXTURE_POLICY_HASH);

    expect(signer.publicKey).toBe(FIXTURE_PUBLIC_KEY_X);
    expect(signature.r).toBe(FIXTURE_SIG_R);
    expect(signature.s).toBe(FIXTURE_SIG_S);
    expect(signer.verify(FIXTURE_POLICY_HASH, signature)).toBe(true);
  });
});