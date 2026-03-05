/**
 * ERC-8004 Identity Adapter
 *
 * Maps zkde.fi's internal reputation/passport/session-key model into
 * ERC-8004 portable agent identity structures. This adapter is consumed
 * by both the Identity surface (for displaying portable identity cards)
 * and the Brain surface (for advertising agent capabilities to external
 * callers/registries).
 *
 * ERC-8004 defines:
 *   - Agent Identity Card (NFT metadata + .well-known/agent-card.json)
 *   - Reputation Registry (bounded scores + attestations)
 *   - Validation Registry (third-party verification status)
 *
 * This file adapts internal types into the ERC-8004 schema so the
 * frontend can render them and the backend can project them to
 * on-chain registries when ready.
 *
 * Reference: https://eips.ethereum.org/EIPS/eip-8004 (Jan 2026)
 *
 * When the Profile page has a Risk Profile bundle, use derivePortableIdentityFromBundle
 * so the Identity tab is a view over the same data (no double-fetch).
 */

import { apiFetch } from "@/lib/api/client";
import type { RiskProfileBundle } from "@/hooks/useProfile";

// ---------------------------------------------------------------------------
// ERC-8004 Portable Identity Types
// ---------------------------------------------------------------------------

/** Agent identity card — maps to .well-known/agent-card.json schema. */
export interface AgentIdentityCard {
  /** Agent address (owner or controller). */
  agent_address: string;
  /** Human-readable name for the agent. */
  name: string;
  /** Short description of capabilities. */
  description: string;
  /** Supported capabilities / skills (e.g., "swap", "rebalance", "lp"). */
  capabilities: string[];
  /** Version of the agent logic (semantic). */
  version: string;
  /** URI to a logo/avatar. */
  avatar_uri?: string;
  /** Link to the auditor/attestor if verified. */
  verification_uri?: string;
  /** Creation timestamp ISO-8601. */
  created_at: string;
}

/** Reputation attestation — a single scored observation in the registry. */
export interface ReputationAttestation {
  /** Attestor address (validator, DAO, protocol). */
  attestor: string;
  /** Score category (e.g., "execution_reliability", "capital_efficiency"). */
  category: string;
  /** Bounded score 0-1000. */
  score: number;
  /** Evidence/proof hash (fact_hash or snapshot_hash). */
  evidence_hash?: string;
  /** Timestamp of the attestation. */
  attested_at: string;
  /** Expiry (optional). */
  expires_at?: string;
}

/** Aggregate reputation projection from internal passport/tier. */
export interface PortableReputationProfile {
  /** Overall reputation score (0-1000, bounded). */
  overall_score: number;
  /** Privacy tier label (Strict, Standard, Express). */
  privacy_tier: string;
  /** Number of verified proof receipts. */
  verified_receipt_count: number;
  /** Attestations list. */
  attestations: ReputationAttestation[];
  /** Last updated timestamp. */
  updated_at: string;
}

/** Validation status from a third-party or protocol registry. */
export interface ValidationStatus {
  /** Validator address or name. */
  validator: string;
  /** Whether this agent is currently validated. */
  valid: boolean;
  /** Reason / label for validation result. */
  reason?: string;
  /** Validation timestamp. */
  validated_at: string;
}

/** Full ERC-8004 portable identity bundle. */
export interface ERC8004PortableIdentity {
  identity_card: AgentIdentityCard;
  reputation: PortableReputationProfile;
  validations: ValidationStatus[];
  /** Session key summary: active keys count and earliest expiry. */
  session_summary: {
    active_count: number;
    earliest_expiry?: string;
  };
  /** Selective disclosure summary: how many attributes are shared externally. */
  disclosure_summary: {
    shared_attribute_count: number;
    last_disclosure_at?: string;
  };
}

// ---------------------------------------------------------------------------
// Adapter: Internal → ERC-8004
// ---------------------------------------------------------------------------

/**
 * Derive ERC-8004 portable identity from an existing Risk Profile bundle.
 * Use this on the Profile page so the Identity tab is a view over the same
 * data — no separate fetches for passport/reputation/sessions/compliance.
 */
export function derivePortableIdentityFromBundle(
  bundle: RiskProfileBundle,
): ERC8004PortableIdentity {
  const rep = bundle.reputation ?? null;
  const passport = bundle.risk_passport ?? null;
  const sessions = bundle.session_summary ?? { count: 0, active_count: 0, sessions: [] };
  const compliance = bundle.compliance_summary ?? { count: 0, profiles: [] };
  const tier = rep?.tier ?? 0;
  const tierName = rep?.tier_name ?? (tier === 0 ? "Strict" : tier === 1 ? "Standard" : "Express");

  const receipts = (passport?.proof_receipts ?? []) as InternalProofReceipt[];
  const attestations: ReputationAttestation[] = receipts.map((r) => ({
    attestor: "zkde.fi-protocol",
    category: (r.proof_type as string) ?? "execution",
    score: r.result === "pass" ? 800 : r.result === "advisory" ? 500 : 200,
    evidence_hash: r.fact_hash ?? r.snapshot_hash,
    attested_at: (r.timestamp as string) ?? new Date().toISOString(),
  }));

  const sessionList = sessions.sessions ?? [];
  const expiries = sessionList
    .map((s) => (s as { expires_at?: string }).expires_at)
    .filter(Boolean) as string[];
  expiries.sort();
  const profilesList = compliance.profiles ?? [];
  const lastDisclosure = profilesList
    .map((p) => (p as { created_at?: number; shared_at?: string }).created_at ?? (p as { shared_at?: string }).shared_at)
    .filter(Boolean)
    .sort()
    .reverse()[0];
  const lastDisclosureStr =
    typeof lastDisclosure === "number"
      ? new Date(lastDisclosure * 1000).toISOString()
      : typeof lastDisclosure === "string"
        ? lastDisclosure
        : undefined;

  // --- Derive self-validations from bundle data ---
  const validations: ValidationStatus[] = [];
  const now = new Date().toISOString();

  // Passport score validation
  if (passport && (passport.composite_score ?? 0) > 0) {
    validations.push({
      validator: "zkde.fi-risk-engine",
      valid: (passport.composite_score ?? 0) >= 40,
      reason: `Passport composite score: ${passport.composite_score}`,
      validated_at: now,
    });
  }

  // Session key validation
  if (sessions.active_count > 0) {
    validations.push({
      validator: "zkde.fi-session-registry",
      valid: true,
      reason: `${sessions.active_count} active session key(s)`,
      validated_at: now,
    });
  }

  // Proof receipt validation
  if (receipts.length > 0) {
    const passCount = receipts.filter((r) => r.result === "pass").length;
    validations.push({
      validator: "zkde.fi-proof-verifier",
      valid: passCount > 0,
      reason: `${passCount}/${receipts.length} proof(s) passed`,
      validated_at: now,
    });
  }

  return {
    identity_card: {
      agent_address: bundle.address,
      name: `zkde.fi Agent ${bundle.address.slice(0, 8)}`,
      description: "Privacy-first autonomous DeFi agent on Starknet",
      capabilities: ["swap", "lp", "rebalance", "privacy_deposit", "privacy_withdraw"],
      version: "0.1.0",
      created_at: new Date().toISOString(),
    },
    reputation: {
      overall_score: mapTierToScore(tier),
      privacy_tier: tierName,
      verified_receipt_count: receipts.length,
      attestations,
      updated_at: new Date().toISOString(),
    },
    validations,
    session_summary: {
      active_count: sessions.active_count ?? 0,
      earliest_expiry: expiries[0],
    },
    disclosure_summary: {
      shared_attribute_count: compliance.count ?? profilesList.length,
      last_disclosure_at: lastDisclosureStr,
    },
  };
}

// ---------------------------------------------------------------------------
// Fetch-based adapter (use when bundle not available)
// ---------------------------------------------------------------------------

/**
 * Fetch the internal risk passport and reputation data, then project
 * into ERC-8004 structures. This is the single adapter boundary.
 *
 * Consumers should call this and render the result — they should NOT
 * reach into internal reputation/passport endpoints directly for
 * portable-identity views.
 */
export async function getPortableIdentity(
  agentAddress: string,
): Promise<ERC8004PortableIdentity> {
  // Fetch internal passport + reputation in parallel
  const [passport, reputation, sessions, compliance] = await Promise.all([
    fetchRiskPassport(agentAddress),
    fetchReputation(agentAddress),
    fetchSessionSummary(agentAddress),
    fetchComplianceSummary(agentAddress),
  ]);

  // Map internal tier → ERC-8004 bounded score (backend returns tier, not current_tier)
  const tierScore = mapTierToScore(reputation?.tier ?? reputation?.current_tier ?? 0);

  // Build attestations from proof receipts
  const attestations: ReputationAttestation[] = (
    passport?.proof_receipts ?? []
  ).map((r: InternalProofReceipt) => ({
    attestor: "zkde.fi-protocol",
    category: r.proof_type ?? "execution",
    score: r.result === "pass" ? 800 : r.result === "advisory" ? 500 : 200,
    evidence_hash: r.fact_hash ?? r.snapshot_hash,
    attested_at: r.timestamp ?? new Date().toISOString(),
  }));

  return {
    identity_card: {
      agent_address: agentAddress,
      name: `zkde.fi Agent ${agentAddress.slice(0, 8)}`,
      description: "Privacy-first autonomous DeFi agent on Starknet",
      capabilities: ["swap", "lp", "rebalance", "privacy_deposit", "privacy_withdraw"],
      version: "0.1.0",
      created_at: reputation?.created_at ?? new Date().toISOString(),
    },
    reputation: {
      overall_score: tierScore,
      privacy_tier:
        reputation?.tier === 0 || reputation?.current_tier === 0
          ? "Strict"
          : reputation?.tier === 1 || reputation?.current_tier === 1
            ? "Standard"
            : "Express",
      verified_receipt_count: passport?.proof_receipts?.length ?? 0,
      attestations,
      updated_at: new Date().toISOString(),
    },
    validations: deriveValidations(passport, reputation, sessions),
    session_summary: {
      active_count: sessions?.active_count ?? 0,
      earliest_expiry: sessions?.earliest_expiry,
    },
    disclosure_summary: {
      shared_attribute_count: compliance?.shared_attribute_count ?? 0,
      last_disclosure_at: compliance?.last_disclosure_at,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal fetch helpers (wrap raw endpoints that don't yet have domain clients)
// ---------------------------------------------------------------------------

interface InternalProofReceipt {
  proof_type?: string;
  result?: string;
  fact_hash?: string;
  snapshot_hash?: string;
  timestamp?: string;
}

async function fetchRiskPassport(address: string) {
  try {
    return await apiFetch<{
      proof_receipts?: InternalProofReceipt[];
      overall_score?: number;
    }>(`/api/v1/zkdefi/risk_passport/user/${encodeURIComponent(address)}`);
  } catch {
    return null;
  }
}

async function fetchReputation(address: string) {
  try {
    return await apiFetch<{
      tier?: number;
      current_tier?: number;
      created_at?: string;
    }>(`/api/v1/zkdefi/reputation/user/${encodeURIComponent(address)}`);
  } catch {
    return null;
  }
}

async function fetchSessionSummary(address: string) {
  try {
    const data = await apiFetch<{ sessions?: Array<{ expires_at?: string; is_active?: boolean; active?: boolean }> }>(
      `/api/v1/zkdefi/session_keys/list/${encodeURIComponent(address)}`,
    );
    const active = (data.sessions ?? []).filter((s) => s.is_active ?? s.active);
    const expiries = active.map((s) => s.expires_at).filter(Boolean).sort();
    return {
      active_count: active.length,
      earliest_expiry: expiries[0] ?? undefined,
    };
  } catch {
    return { active_count: 0 };
  }
}

async function fetchComplianceSummary(address: string) {
  try {
    const data = await apiFetch<unknown>(
      `/api/v1/zkdefi/compliance/profiles/${encodeURIComponent(address)}`,
    );
    // Backend returns array directly; some clients may wrap in { profiles: [] }
    const profiles = Array.isArray(data)
      ? data
      : (data as { profiles?: Array<{ shared_at?: string; created_at?: number }> })?.profiles ?? [];
    return {
      shared_attribute_count: profiles.length,
      last_disclosure_at: profiles
        .map((p) => p.shared_at ?? (p.created_at != null ? new Date(p.created_at * 1000).toISOString() : undefined))
        .filter(Boolean)
        .sort()
        .reverse()[0] as string | undefined,
    };
  } catch {
    return { shared_attribute_count: 0 };
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Derive self-validations from internal data for the fetch-based path.
 */
function deriveValidations(
  passport: { proof_receipts?: InternalProofReceipt[]; overall_score?: number } | null,
  reputation: { tier?: number; current_tier?: number; created_at?: string } | null,
  sessions: { active_count?: number; earliest_expiry?: string } | null,
): ValidationStatus[] {
  const validations: ValidationStatus[] = [];
  const now = new Date().toISOString();

  if (passport && (passport.overall_score ?? 0) > 0) {
    validations.push({
      validator: "zkde.fi-risk-engine",
      valid: (passport.overall_score ?? 0) >= 40,
      reason: `Passport composite score: ${passport.overall_score}`,
      validated_at: now,
    });
  }

  if ((sessions?.active_count ?? 0) > 0) {
    validations.push({
      validator: "zkde.fi-session-registry",
      valid: true,
      reason: `${sessions!.active_count} active session key(s)`,
      validated_at: now,
    });
  }

  const receipts = passport?.proof_receipts ?? [];
  if (receipts.length > 0) {
    const passCount = receipts.filter((r) => r.result === "pass").length;
    validations.push({
      validator: "zkde.fi-proof-verifier",
      valid: passCount > 0,
      reason: `${passCount}/${receipts.length} proof(s) passed`,
      validated_at: now,
    });
  }

  return validations;
}

function mapTierToScore(tier: number): number {
  // Strict = highest trust, Express = lowest
  // Bounded 0-1000 per ERC-8004 spec
  switch (tier) {
    case 0: return 900; // Strict — full proof, highest trust
    case 1: return 600; // Standard — constraint proof
    case 2: return 400; // Express — batched proof
    default: return 300;
  }
}
