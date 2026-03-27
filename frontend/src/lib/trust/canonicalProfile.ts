import { apiFetch } from "@/lib/api/client";
import type { RiskProfileV2 } from "@/hooks/useProfile";
import type { ReputationData } from "@/components/marketing/ReputationProfile";

/** Canonical trust profile fetcher used across surfaces. */
export async function fetchCanonicalRiskProfileV2(
  address: string,
  signal?: AbortSignal,
): Promise<RiskProfileV2> {
  const normalized = String(address || "").trim();
  if (!normalized) {
    throw new Error("Missing address");
  }

  return apiFetch<RiskProfileV2>(`/api/v1/zkdefi/risk_profile/v2/${normalized}`, {
    signal,
    timeoutMs: 12_000,
  });
}

/**
 * Map canonical v2 trust payload to the landing IdentityCard shape.
 * This keeps landing visuals stable while using canonical trust data.
 */
export function toLandingReputationData(profile: RiskProfileV2): ReputationData {
  const rep = profile.reputation;
  const passport = profile.passport;
  const predictive = profile.predictive_credit;
  const nowIso = new Date().toISOString();

  const confidence = Number(predictive?.grade_confidence ?? 0);
  const tier = Math.max(1, Math.min(5, Number(rep?.tier ?? 1) + 1));
  const txCount = Number(rep?.transaction_count ?? 0);
  const totalVolumeEth = Number(rep?.total_volume_eth ?? 0);
  const totalCapitalUsd = Math.max(0, totalVolumeEth * 2500);

  const ficoScore = Number(passport?.credit_score ?? 0);
  const ficoTier = mapFicoTier(ficoScore);

  const letter = String(passport?.letter_rating ?? predictive?.grade ?? "C");
  const creditClass = /^[A-D]/i.test(letter) ? letter.toUpperCase() : "C";

  const profileHash = stableProfileHash(profile.address, profile.generated_at || nowIso, passport?.composite_score ?? 0);

  return {
    wallet_address: profile.address,
    scanned_at: profile.generated_at || nowIso,
    account_type: "risk_profile_v2",
    nonce: txCount,
    account_exists: true,
    is_contract_deployer: false,
    total_capital_usd: round2(totalCapitalUsd),
    capital_by_protocol: {},
    protocol_count: 0,
    position_count: txCount,
    signals: [],
    defi_veteran_score: Number(passport?.composite_score ?? 0),
    conviction_score: clamp01(confidence || 0.6),
    activity_score: clamp01(txCount / 100),
    diversity_score: clamp01((profile.identity?.linked_addresses?.length ?? 0) / 4),
    capital_score: clamp01(totalVolumeEth / 50),
    resilience_score: clamp01(1 - Number(profile.decisions?.execution?.mode === "block" ? 0.5 : 0.2)),
    recommended_tier: tier,
    tier_reasoning: `Canonical trust profile ${profile.profile_version}`,
    profile_hash: profileHash,
    scan_duration_ms: 0,
    errors: [],
    fico_score: ficoScore || undefined,
    fico_tier: ficoTier || undefined,
    credit_class: creditClass,
    credit_class_index: undefined,
    credit_confidence: clamp01(confidence),
    credit_features: undefined,
    credit_feature_hash: undefined,
    credit_model_hash: undefined,
    credit_circuit_version: predictive?.model_name,
    ezkl_ready: true,
  };
}

function stableProfileHash(address: string, generatedAt: string, compositeScore: number): string {
  const input = `${address.toLowerCase()}|${generatedAt}|${compositeScore}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return `0x${hash.toString(16).padStart(8, "0")}`;
}

function mapFicoTier(score: number): string {
  if (!Number.isFinite(score) || score <= 0) return "";
  if (score >= 800) return "Excellent";
  if (score >= 740) return "Very Good";
  if (score >= 670) return "Good";
  if (score >= 580) return "Fair";
  return "Poor";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
