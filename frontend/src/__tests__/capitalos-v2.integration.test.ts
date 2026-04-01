import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Capital OS V2 — Integration Tests
 *
 * Tests the state model, URL resolvers, feature flag, and telemetry
 * wiring without requiring a full React render (those depend on too
 * many mocked providers to be practical here).
 */

// ---------- agentState tests ----------

import {
  isCapitalOSV2Enabled,
  resolveViewParamV2,
  resolveViewOverlayV2,
  buildAgentUrl,
  assertMethodMatchesCommitment,
} from "@/lib/agentState";

describe("agentState — feature flag", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  it("returns true by default (no env var)", () => {
    delete process.env.NEXT_PUBLIC_ENABLE_CAPITAL_OS_V2;
    expect(isCapitalOSV2Enabled()).toBe(true);
  });

  it('returns false when env var is "0"', () => {
    process.env.NEXT_PUBLIC_ENABLE_CAPITAL_OS_V2 = "0";
    expect(isCapitalOSV2Enabled()).toBe(false);
  });

  it('returns true when env var is "1"', () => {
    process.env.NEXT_PUBLIC_ENABLE_CAPITAL_OS_V2 = "1";
    expect(isCapitalOSV2Enabled()).toBe(true);
  });
});

describe("agentState — resolveViewParamV2", () => {
  it("defaults to vault/home when no params", () => {
    const r = resolveViewParamV2(null, null);
    expect(r.mode).toBe("vault");
    expect(r.vaultTab).toBe("home");
  });

  it('resolves "intelligence" mode', () => {
    const r = resolveViewParamV2("intelligence", null);
    expect(r.mode).toBe("intelligence");
    expect(r.vaultTab).toBeFalsy();
  });

  it("resolves vault with pools → portfolio tab (legacy alias)", () => {
    const r = resolveViewParamV2("vault", "pools");
    expect(r.mode).toBe("vault");
    expect(r.vaultTab).toBe("portfolio");
  });

  it("resolves vault with ekubo → portfolio tab (legacy alias)", () => {
    const r = resolveViewParamV2("vault", "ekubo");
    expect(r.mode).toBe("vault");
    expect(r.vaultTab).toBe("portfolio");
  });

  it("resolves vault with lending → portfolio tab", () => {
    const r = resolveViewParamV2("vault", "lending");
    expect(r.mode).toBe("vault");
    expect(r.vaultTab).toBe("portfolio");
  });

  it("resolves vault with activity tab → history", () => {
    const r = resolveViewParamV2("vault", "activity");
    expect(r.mode).toBe("vault");
    expect(r.vaultTab).toBe("history");
  });

  it("defaults unknown v to vault", () => {
    const r = resolveViewParamV2("bogus", null);
    expect(r.mode).toBe("vault");
  });

  it("ignores unknown tab", () => {
    const r = resolveViewParamV2("vault", "bogus");
    expect(r.vaultTab).toBe("home");
  });
});

describe("agentState — resolveViewOverlayV2", () => {
  it("returns empty for null", () => {
    const r = resolveViewOverlayV2(null);
    expect(r.overlay).toBeUndefined();
    expect(r.slideout).toBeUndefined();
  });

  it('resolves "models" as brain overlay', () => {
    const r = resolveViewOverlayV2("models");
    expect(r.overlay).toBe("brain");
  });

  it('resolves "zkml" as brain overlay', () => {
    const r = resolveViewOverlayV2("zkml");
    expect(r.overlay).toBe("brain");
  });

  it("returns empty for legacy overlay params (now handled as vault tabs)", () => {
    expect(resolveViewOverlayV2("oracle")).toEqual({});
    expect(resolveViewOverlayV2("governance")).toEqual({});
    expect(resolveViewOverlayV2("lending")).toEqual({});
    expect(resolveViewOverlayV2("marketplace")).toEqual({});
  });

  it("returns empty for unknown param", () => {
    const r = resolveViewOverlayV2("bogus");
    expect(r.overlay).toBeUndefined();
    expect(r.slideout).toBeUndefined();
  });
});

describe("agentState — buildAgentUrl", () => {
  it("builds URL for vault with default tab", () => {
    expect(buildAgentUrl("vault")).toBe("/agent?v=vault");
  });

  it("builds URL for vault with specific tab", () => {
    expect(buildAgentUrl("vault", "portfolio")).toBe("/agent?v=vault&t=portfolio");
  });

  it("builds URL for intelligence (no tab)", () => {
    expect(buildAgentUrl("intelligence")).toBe("/agent?v=intelligence");
  });
});

describe("agentState — assertMethodMatchesCommitment", () => {
  it("returns ok:true for matching method", () => {
    const result = assertMethodMatchesCommitment("hashed_proof" as any, {
      method: "hashed_proof",
    } as any);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns ok:true for compatible methods (hashed_proof ↔ nullifier_set)", () => {
    const result = assertMethodMatchesCommitment("hashed_proof" as any, {
      method: "nullifier_set",
    } as any);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false for mismatched method", () => {
    const result = assertMethodMatchesCommitment("hashed_proof" as any, {
      method: "fully_private",
    } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Cannot use");
  });

  it("returns ok:true if commitment method matches exactly", () => {
    const result = assertMethodMatchesCommitment("fully_private" as any, {
      method: "fully_private",
    } as any);
    expect(result.ok).toBe(true);
  });
});

// ---------- telemetry tests ----------

import { trackEvent } from "@/lib/telemetry";

describe("telemetry — trackEvent", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    vi.useFakeTimers();
  });

  it("batches events and flushes after delay", async () => {
    trackEvent("test_event", { key: "value" });
    trackEvent("test_event_2");

    // Should not have flushed yet
    expect(fetchMock).not.toHaveBeenCalled();

    // Advance past flush timer (2000ms)
    vi.advanceTimersByTime(2500);

    // Should have flushed
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].event).toBe("test_event");
    expect(body.events[0].properties).toEqual({ key: "value" });
    expect(body.events[1].event).toBe("test_event_2");

    vi.useRealTimers();
  });

  it("sends to the correct endpoint", async () => {
    trackEvent("route_test");
    vi.advanceTimersByTime(2500);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/zkdefi/metrics/event",
      expect.objectContaining({ method: "POST" }),
    );

    vi.useRealTimers();
  });

  it("silently handles fetch errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    trackEvent("error_test");
    vi.advanceTimersByTime(2500);

    // Should not throw
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
