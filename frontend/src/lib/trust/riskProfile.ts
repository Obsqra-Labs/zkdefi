import type { RiskProfileV2 } from "@/hooks/useProfile";

export type CapitalRiskProfile = "conservative" | "balanced" | "aggressive";

const TIER_NAME_TO_LEVEL: Record<string, number> = {
  strict: 0,
  anon: 0,
  standard: 1,
  trusted: 1,
  express: 2,
};

function normalizeTier(profile: RiskProfileV2 | null): number {
  if (!profile) return 1;
  const numericTier = Number(profile.reputation?.tier);
  if (Number.isFinite(numericTier)) return numericTier;
  const tierName = String(profile.reputation?.tier_name ?? "").trim().toLowerCase();
  return TIER_NAME_TO_LEVEL[tierName] ?? 1;
}

/**
 * Maps trust state to strategy risk profile for opportunity APIs.
 * This keeps strategy requests aligned with the user trust posture.
 */
export function getCapitalRiskProfile(profile: RiskProfileV2 | null): CapitalRiskProfile {
  if (!profile) return "balanced";

  const tier = normalizeTier(profile);
  const executionMode = profile.decisions?.execution?.mode ?? "advisory";
  const lendingMode = profile.decisions?.lending?.mode ?? "advisory";

  if (executionMode === "block" || lendingMode === "block" || tier <= 0) {
    return "conservative";
  }

  if (executionMode === "allow" && tier >= 2) {
    return "aggressive";
  }

  return "balanced";
}
