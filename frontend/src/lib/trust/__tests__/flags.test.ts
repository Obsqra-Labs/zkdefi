import { afterEach, describe, expect, it } from "vitest";

import {
  isPortableIdentityV3Enabled,
  isProfileV3Enabled,
  isTrustSurfaceWiringEnabled,
  isZkficoFinisherEnabled,
} from "@/lib/trust/flags";

const envKeys = [
  "NEXT_PUBLIC_PROFILE_V3",
  "NEXT_PUBLIC_PORTABLE_IDENTITY_V3",
  "NEXT_PUBLIC_PORTABLE_IDENTITY_V3_ENABLED",
  "NEXT_PUBLIC_ZKFICO_FINISHER",
  "NEXT_PUBLIC_TRUST_SURFACE_WIRING",
] as const;

afterEach(() => {
  for (const key of envKeys) {
    delete process.env[key];
  }
});

describe("trust flags", () => {
  it("defaults to enabled", () => {
    expect(isProfileV3Enabled()).toBe(true);
    expect(isPortableIdentityV3Enabled()).toBe(true);
    expect(isZkficoFinisherEnabled()).toBe(true);
    expect(isTrustSurfaceWiringEnabled()).toBe(true);
  });

  it("respects explicit false values", () => {
    process.env.NEXT_PUBLIC_PROFILE_V3 = "false";
    process.env.NEXT_PUBLIC_ZKFICO_FINISHER = "0";
    process.env.NEXT_PUBLIC_TRUST_SURFACE_WIRING = "off";

    expect(isProfileV3Enabled()).toBe(false);
    expect(isZkficoFinisherEnabled()).toBe(false);
    expect(isTrustSurfaceWiringEnabled()).toBe(false);
  });

  it("supports portable identity alias env key", () => {
    process.env.NEXT_PUBLIC_PORTABLE_IDENTITY_V3 = "";
    process.env.NEXT_PUBLIC_PORTABLE_IDENTITY_V3_ENABLED = "false";
    expect(isPortableIdentityV3Enabled()).toBe(false);

    process.env.NEXT_PUBLIC_PORTABLE_IDENTITY_V3 = "true";
    expect(isPortableIdentityV3Enabled()).toBe(true);
  });
});

