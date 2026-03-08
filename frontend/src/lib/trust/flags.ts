function envEnabled(value: string | undefined, defaultValue = true): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function firstConfigured(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value == null) continue;
    if (value.trim().length === 0) continue;
    return value;
  }
  return undefined;
}

export const isProfileV3Enabled = (): boolean =>
  envEnabled(process.env.NEXT_PUBLIC_PROFILE_V3, true);

export const isPortableIdentityV3Enabled = (): boolean =>
  envEnabled(
    firstConfigured([
      process.env.NEXT_PUBLIC_PORTABLE_IDENTITY_V3,
      process.env.NEXT_PUBLIC_PORTABLE_IDENTITY_V3_ENABLED,
    ]),
    true
  );

export const isZkficoFinisherEnabled = (): boolean =>
  envEnabled(process.env.NEXT_PUBLIC_ZKFICO_FINISHER, true);

export const isTrustSurfaceWiringEnabled = (): boolean =>
  envEnabled(process.env.NEXT_PUBLIC_TRUST_SURFACE_WIRING, true);
