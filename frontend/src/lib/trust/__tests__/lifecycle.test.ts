import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deriveClaims,
  fetchIdentityGraph,
  issueCredential,
  normalizeSubject,
  revokeCredential,
  syncAttributions,
  verifyCredential,
} from "@/lib/trust/lifecycle";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe("trust lifecycle client", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("normalizes subject casing", () => {
    expect(normalizeSubject(" 0xAbC ")).toBe("0xabc");
  });

  it("calls identity graph endpoint", async () => {
    apiFetchMock.mockResolvedValueOnce({ subject: "0xabc" });
    await fetchIdentityGraph("0xAbC");
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/zkdefi/identity/graph/0xabc");
  });

  it("syncs attributions with defaults", async () => {
    apiFetchMock.mockResolvedValueOnce({ summary: { total_events: 2 } });
    await syncAttributions("0xAbC");
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/zkdefi/attributions/query",
      expect.objectContaining({
        method: "POST",
      })
    );
    const payload = JSON.parse(apiFetchMock.mock.calls[0][1].body as string);
    expect(payload).toMatchObject({
      subject: "0xabc",
      window_days: 90,
      include_evidence: false,
    });
  });

  it("derives claims with explicit confidence", async () => {
    apiFetchMock.mockResolvedValueOnce({ claims: { reputation_score_0_100: 88 } });
    await deriveClaims("0xAbC", 120, 0.75);
    const payload = JSON.parse(apiFetchMock.mock.calls[0][1].body as string);
    expect(payload).toMatchObject({
      subject: "0xabc",
      window_days: 120,
      min_confidence: 0.75,
    });
  });

  it("issues, verifies, and revokes credentials", async () => {
    apiFetchMock.mockResolvedValueOnce({ status: "ok", credential: { credential_id: "cred_1" } });
    await issueCredential("0xAbC", { ttlHours: 6 });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/zkdefi/credentials/issue",
      expect.objectContaining({ method: "POST" })
    );

    apiFetchMock.mockResolvedValueOnce({ valid: true });
    await verifyCredential("cred_1");
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/zkdefi/credentials/verify",
      expect.objectContaining({ method: "POST" })
    );

    apiFetchMock.mockResolvedValueOnce({ revoked: true, credential_id: "cred_1" });
    await revokeCredential("cred_1");
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/zkdefi/credentials/revoke",
      expect.objectContaining({ method: "POST" })
    );
  });
});
