"use client";

import { useState, useEffect, useCallback } from "react";
import { ApiError, apiUrl } from "@/lib/api/client";
import { fetchCanonicalRiskProfileV2 } from "@/lib/trust/canonicalProfile";

const RISK_PROFILE_V2_MISSING_SESSION_KEY = "zkdefi:risk_profile_v2_missing";
const RISK_PROFILE_V2_MISSING_TTL_MS = 60_000;

export interface RiskProfileBundle {
  address: string;
  reputation: {
    tier: number;
    tier_name: string;
    tenure_days: number;
    successful_txns: number;
    collateral_eth: number;
    total_volume_eth?: number;
    transaction_count?: number;
    upgrade_eligible?: boolean;
    upgrade_requirements?: Record<string, unknown>;
  } | null;
  risk_passport: {
    composite_score: number;
    letter_rating: string;
    tier: number;
    tier_name: string;
    credit_tier: string | null;
    credit_score: number | null;
    proof_receipts?: Array<Record<string, unknown>>;
    aggregation_sources?: Array<{
      id?: string;
      description?: string;
      chain?: string;
      contract_hint?: string | null;
    }>;
    chain_id?: string;
  } | null;
  onboarding: {
    has_agent: boolean;
    fact_hash?: string | null;
    identity_commitment?: string | null;
    timestamp?: number;
    on_chain_status?: Record<string, unknown>;
    message?: string;
  } | null;
  linked_addresses: Record<string, string>;
  compliance_summary: { count: number; profiles: Array<Record<string, unknown>> };
  session_summary: { count: number; active_count: number; sessions: Array<Record<string, unknown>> };
  governance?: {
    user_address?: string;
    voting_power?: number;
    lp_usd?: number;
    lending_usd?: number;
    staking_usd?: number;
    tier?: number;
    tier_name?: string;
    tier_multiplier?: number;
    base_capital_usd?: number;
    formula_version?: string;
    basis?: string;
  } | null;
  dual_wallet_session?: {
    active: boolean;
    status: string;
    chain?: string | null;
    evm_address?: string | null;
    expires_at?: number | null;
    verified_at?: string | null;
    session_id?: string | null;
  };
}

export interface RiskDecisionGate {
  mode: "allow" | "advisory" | "block";
  reason_codes: string[];
  reason_hints?: string[];
  limits?: Record<string, unknown>;
}

export interface RiskProfileV2 {
  profile_version: string;
  version_matrix?: {
    builder_v2?: string;
    profile_v2?: string;
    portable_v3?: string;
    zkfico_pack_v1?: string;
  };
  address: string;
  identity: {
    has_agent: boolean;
    identity_commitment?: string | null;
    subject_id?: string;
    linked_addresses: Array<{
      chain: string;
      address: string;
      verified: boolean;
      verified_at?: string | null;
    }>;
    session_summary: { count: number; active_count: number };
    dual_wallet_session?: {
      active: boolean;
      status: string;
      chain?: string | null;
      evm_address?: string | null;
      expires_at?: number | null;
      verified_at?: string | null;
    };
  };
  attribution_summary?: {
    event_count: number;
    chains: string[];
  };
  credential_summary?: {
    issued_count: number;
    active_count: number;
    revoked_count: number;
    latest_issued_at?: string | null;
  };
  reputation: {
    tier: number;
    tier_name: string;
    tenure_days: number;
    transaction_count: number;
    successful_txns: number;
    collateral_eth: number;
    total_volume_eth: number;
  };
  passport: {
    composite_score: number;
    letter_rating: string;
    tier: number;
    tier_name: string;
    credit_tier?: string | null;
    credit_score?: number | null;
    receipt_summary: { count: number; by_type: Record<string, number> };
  };
  governance?: {
    voting_power: number;
    lp_usd: number;
    lending_usd: number;
    staking_usd: number;
    tier_multiplier: number;
    formula_version: string;
    basis?: string;
  };
  portfolio?: {
    total_value_usd: number;
    protocol_count: number;
    position_count: number;
    protocols_found: string[];
    snapshot_hash?: string | null;
    scanned_at?: string | null;
  };
  trust_tuple?: {
    reputation?: Record<string, unknown>;
    credit?: Record<string, unknown>;
    governance?: Record<string, unknown>;
    execution?: Record<string, unknown>;
    identity?: Record<string, unknown>;
  };
  decisions: {
    relayer: RiskDecisionGate;
    execution: RiskDecisionGate;
    lending: RiskDecisionGate;
  };
  disclosures?: {
    risk_notice_id?: string;
    legal_mode?: string;
    disclaimer?: string;
  };
  predictive_credit?: {
    grade: string;
    grade_confidence: number;
    max_ltv: number;
    rate_bps: number;
    credit_line_eth: number;
    collaborative_multiplier: number;
    model_name: string;
    model_hash?: string | null;
    proof_hash?: string | null;
    proof_hex?: string | null;
  } | null;
  feature_flags?: Record<string, unknown>;
  generated_at?: string;
}

async function fetchLegacyBundle(address: string): Promise<RiskProfileBundle> {
  const [
    repRes,
    passportRes,
    onbRes,
    linkedRes,
    complianceRes,
    sessionsRes,
    dualSessionRes,
    governanceRes,
  ] =
    await Promise.all([
      fetch(apiUrl(`/api/v1/zkdefi/reputation/user/${address}`)),
      fetch(apiUrl(`/api/v1/zkdefi/risk_passport/user/${address}`)),
      fetch(apiUrl(`/api/v1/zkdefi/onboarding/status/${address}`)),
      fetch(apiUrl(`/api/v1/zkdefi/linked_addresses/${address}`)),
      fetch(apiUrl(`/api/v1/zkdefi/compliance/profiles/${address}`)),
      fetch(apiUrl(`/api/v1/zkdefi/session_keys/list/${address}`)),
      fetch(apiUrl(`/api/v1/zkdefi/auth/session/${address}`)),
      fetch(apiUrl(`/api/v1/dao/voting_power/${address}`)),
    ]);

  const reputation = repRes.ok ? await repRes.json() : null;
  const risk_passport = passportRes.ok ? await passportRes.json() : null;
  const onboarding = onbRes.ok ? await onbRes.json() : null;
  let linked_addresses: Record<string, string> = {};
  if (linkedRes.ok) {
    const data = await linkedRes.json();
    if (data && typeof data === "object") linked_addresses = data;
  }
  let complianceProfiles: Array<Record<string, unknown>> = [];
  if (complianceRes.ok) {
    const data = await complianceRes.json();
    if (Array.isArray(data)) complianceProfiles = data;
  }
  let session_summary = {
    count: 0,
    active_count: 0,
    sessions: [] as Array<Record<string, unknown>>,
  };
  if (sessionsRes.ok) {
    const data = await sessionsRes.json();
    if (data && typeof data === "object") {
      session_summary = {
        count: data.count ?? 0,
        active_count: data.active_count ?? 0,
        sessions: Array.isArray(data.sessions) ? data.sessions : [],
      };
    }
  }
  let dual_wallet_session: RiskProfileBundle["dual_wallet_session"] = undefined;
  if (dualSessionRes.ok) {
    const data = await dualSessionRes.json();
    if (data && typeof data === "object") {
      dual_wallet_session = {
        active: Boolean(data.active),
        status: typeof data.status === "string" ? data.status : "missing",
        chain: typeof data.chain === "string" ? data.chain : null,
        evm_address: typeof data.evm_address === "string" ? data.evm_address : null,
        expires_at: typeof data.expires_at === "number" ? data.expires_at : null,
        verified_at: typeof data.verified_at === "string" ? data.verified_at : null,
        session_id: typeof data.session_id === "string" ? data.session_id : null,
      };
    }
  }
  let governance: RiskProfileBundle["governance"] = null;
  if (governanceRes.ok) {
    const data = await governanceRes.json();
    if (data && typeof data === "object") {
      governance = data as RiskProfileBundle["governance"];
    }
  }

  return {
    address,
    reputation,
    risk_passport,
    onboarding,
    linked_addresses,
    compliance_summary: { count: complianceProfiles.length, profiles: complianceProfiles },
    session_summary,
    governance,
    dual_wallet_session,
  };
}

function toRiskProfileV2FromLegacy(bundle: RiskProfileBundle): RiskProfileV2 {
  const reputation = bundle.reputation ?? {
    tier: 0,
    tier_name: "Strict",
    tenure_days: 0,
    successful_txns: 0,
    collateral_eth: 0,
    total_volume_eth: 0,
    transaction_count: 0,
  };
  const passport = bundle.risk_passport ?? {
    composite_score: 0,
    letter_rating: "D",
    tier: 0,
    tier_name: "Strict",
    credit_tier: null,
    credit_score: null,
    proof_receipts: [],
  };
  const linked = bundle.linked_addresses ?? {};
  const verification =
    linked && typeof linked === "object" && "verification" in linked
      ? ((linked as unknown as { verification?: Record<string, { verified?: boolean; verified_at?: string | null }> })
          .verification ?? {})
      : {};

  const linkedEntries = ([
    ["eth", "ethereum"],
    ["arb", "arbitrum"],
    ["base", "base"],
    ["opt", "optimism"],
  ] as const)
    .map(([key, chain]) => {
      const value = linked[key];
      if (!value) return null;
      return {
        chain,
        address: value,
        verified: Boolean(verification?.[key]?.verified),
        verified_at: verification?.[key]?.verified_at ?? null,
      };
    })
    .filter(Boolean) as RiskProfileV2["identity"]["linked_addresses"];

  const proofReceipts = Array.isArray(passport.proof_receipts) ? passport.proof_receipts : [];
  const byType = proofReceipts.reduce<Record<string, number>>((acc, row) => {
    const proofType =
      row && typeof row === "object" && typeof row.proof_type === "string"
        ? row.proof_type
        : "unknown";
    acc[proofType] = (acc[proofType] ?? 0) + 1;
    return acc;
  }, {});

  const repGates =
    bundle.reputation && typeof (bundle.reputation as Record<string, unknown>).gates === "object"
      ? ((bundle.reputation as Record<string, unknown>).gates as Record<string, unknown>)
      : {};

  const executionAllowed = Boolean(repGates.canSwap);
  const lendingAllowed = Boolean(repGates.canLend) || Boolean(repGates.canBorrow);

  return {
    profile_version: "2.0-fallback",
    address: bundle.address,
    identity: {
      has_agent: Boolean(bundle.onboarding?.has_agent),
      identity_commitment: bundle.onboarding?.identity_commitment ?? null,
      linked_addresses: linkedEntries,
      session_summary: {
        count: bundle.session_summary?.count ?? 0,
        active_count: bundle.session_summary?.active_count ?? 0,
      },
      dual_wallet_session: bundle.dual_wallet_session ?? {
        active: false,
        status: "missing",
      },
    },
    reputation: {
      tier: reputation.tier ?? 0,
      tier_name: reputation.tier_name ?? "Strict",
      tenure_days: reputation.tenure_days ?? 0,
      transaction_count: reputation.transaction_count ?? reputation.successful_txns ?? 0,
      successful_txns: reputation.successful_txns ?? 0,
      collateral_eth: reputation.collateral_eth ?? 0,
      total_volume_eth: reputation.total_volume_eth ?? 0,
    },
    passport: {
      composite_score: passport.composite_score ?? 0,
      letter_rating: passport.letter_rating ?? "D",
      tier: passport.tier ?? 0,
      tier_name: passport.tier_name ?? "Strict",
      credit_tier: passport.credit_tier ?? null,
      credit_score: passport.credit_score ?? null,
      receipt_summary: {
        count: proofReceipts.length,
        by_type: byType,
      },
    },
    governance: bundle.governance
      ? {
          voting_power: bundle.governance.voting_power ?? 0,
          lp_usd: bundle.governance.lp_usd ?? 0,
          lending_usd: bundle.governance.lending_usd ?? 0,
          staking_usd: bundle.governance.staking_usd ?? 0,
          tier_multiplier: bundle.governance.tier_multiplier ?? 1,
          formula_version: bundle.governance.formula_version ?? "legacy",
          basis: bundle.governance.basis,
        }
      : undefined,
    decisions: {
      execution: {
        mode: executionAllowed ? "allow" : "advisory",
        reason_codes: executionAllowed ? ["legacy_gate_allow_swap"] : ["legacy_gate_no_swap_allowance"],
        reason_hints: executionAllowed
          ? ["Legacy reputation gate allows spot execution."]
          : ["Legacy reputation gate does not currently allow spot execution."],
      },
      relayer: {
        mode: executionAllowed ? "allow" : "advisory",
        reason_codes: executionAllowed ? ["legacy_gate_allow_relayer"] : ["legacy_gate_review_relayer"],
        reason_hints: executionAllowed
          ? ["Legacy profile is sufficient for relayer review."]
          : ["Relayer posture is being inferred from the legacy profile surface."],
      },
      lending: {
        mode: lendingAllowed ? "allow" : "advisory",
        reason_codes: lendingAllowed ? ["legacy_gate_allow_lending"] : ["legacy_gate_no_lending_allowance"],
        reason_hints: lendingAllowed
          ? ["Legacy reputation gate allows lending review."]
          : ["Legacy reputation gate does not currently allow lending."],
      },
    },
    predictive_credit: passport.letter_rating
      ? {
          grade: passport.letter_rating,
          grade_confidence: 0,
          max_ltv: 0,
          rate_bps: 0,
          credit_line_eth: 0,
          collaborative_multiplier: 1,
          model_name: "legacy risk passport",
        }
      : null,
    generated_at: new Date().toISOString(),
  };
}

export function useProfileReputation(address: string | undefined) {
  const [userRep, setUserRep] = useState<any>(null);
  const [error, setError] = useState(false);

  const refetch = useCallback(() => {
    if (!address) return;
    setError(false);
    fetch(apiUrl(`/api/v1/zkdefi/reputation/user/${address}`))
      .then((r) => {
        if (!r.ok) {
          setError(true);
          return null;
        }
        return r.json();
      })
      .then((data) => setUserRep(data ?? null))
      .catch(() => {
        setError(true);
        setUserRep(null);
      });
  }, [address]);

  useEffect(() => {
    if (!address) {
      setUserRep(null);
      setError(false);
      return;
    }
    refetch();
  }, [address, refetch]);

  return { userRep, error, refetch };
}

export function useOnboardingStatus(address: string | undefined) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(() => {
    if (!address) return;
    setLoading(true);
    fetch(apiUrl(`/api/v1/zkdefi/onboarding/status/${address}`))
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    if (!address) {
      setStatus(null);
      return;
    }
    refetch();
  }, [address, refetch]);

  return { status, loading, refetch };
}

export function useRiskPassport(address: string | undefined) {
  const [passport, setPassport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refetch = useCallback(() => {
    if (!address) return;
    setLoading(true);
    setError(false);
    fetch(apiUrl(`/api/v1/zkdefi/risk_passport/user/${address}`))
      .then((r) => {
        if (!r.ok) {
          setError(true);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        setPassport(data ?? null);
      })
      .catch(() => {
        setError(true);
        setPassport(null);
      })
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    if (!address) {
      setPassport(null);
      setError(false);
      setLoading(false);
      return;
    }
    refetch();
  }, [address, refetch]);

  return { passport, loading, error, refetch };
}

export type LinkedAddresses = { eth?: string; arb?: string; base?: string; opt?: string };
export type LinkedDraft = { eth: string; arb: string; base: string; opt: string };

export function useLinkedAddresses(address: string | undefined) {
  const [linked, setLinked] = useState<LinkedAddresses>({});
  const [draft, setDraft] = useState<LinkedDraft>({ eth: "", arb: "", base: "", opt: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(() => {
    if (!address) return;
    setLoading(true);
    fetch(apiUrl(`/api/v1/zkdefi/linked_addresses/${address}`))
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, string>) => {
        setLinked(data);
        setDraft({
          eth: data.eth ?? "",
          arb: data.arb ?? "",
          base: data.base ?? "",
          opt: data.opt ?? "",
        });
      })
      .catch(() => {
        setLinked({});
        setDraft({ eth: "", arb: "", base: "", opt: "" });
      })
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    if (!address) {
      setLinked({});
      setDraft({ eth: "", arb: "", base: "", opt: "" });
      return;
    }
    refetch();
  }, [address, refetch]);

  const save = useCallback(async () => {
    if (!address) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl("/api/v1/zkdefi/linked_addresses"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starknet_address: address,
          eth: draft.eth || undefined,
          arb: draft.arb || undefined,
          base: draft.base || undefined,
          opt: draft.opt || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setLinked(data);
        setDraft({
          eth: (data as Record<string, string>).eth ?? "",
          arb: (data as Record<string, string>).arb ?? "",
          base: (data as Record<string, string>).base ?? "",
          opt: (data as Record<string, string>).opt ?? "",
        });
        return true;
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [address, draft]);

  return { linked, draft, setDraft, save, loading, saving, refetch };
}

export function useRiskProfile(address: string | undefined) {
  const [profile, setProfile] = useState<RiskProfileBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refetch = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(apiUrl(`/api/v1/zkdefi/risk_profile/${address}`));
      if (response.ok) {
        setProfile((await response.json()) as RiskProfileBundle);
        return;
      }
      if (response.status === 404) {
        setProfile(await fetchLegacyBundle(address));
        return;
      }
      setError(true);
      setProfile(null);
    } catch {
      try {
        setProfile(await fetchLegacyBundle(address));
      } catch {
        setError(true);
        setProfile(null);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (!address) {
      setProfile(null);
      setError(false);
      setLoading(false);
      return;
    }
    refetch();
  }, [address, refetch]);

  const reputation = profile?.reputation ?? null;
  const riskPassport = profile?.risk_passport ?? null;
  const onboarding = profile?.onboarding ?? null;
  const linkedAddresses = profile?.linked_addresses ?? {};
  const complianceSummary = profile?.compliance_summary ?? { count: 0, profiles: [] };
  const sessionSummary = profile?.session_summary ?? {
    count: 0,
    active_count: 0,
    sessions: [],
  };
  const dualWalletSession = profile?.dual_wallet_session ?? null;

  return {
    profile,
    reputation,
    riskPassport,
    onboarding,
    linkedAddresses,
    complianceSummary,
    sessionSummary,
    dualWalletSession,
    loading,
    error,
    refetch,
  };
}

export function useRiskProfileV2(address: string | undefined) {
  const [profile, setProfile] = useState<RiskProfileV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refetch = useCallback(async (signal?: AbortSignal) => {
    if (!address) return;
    setLoading(true);
    setError(false);
    try {
      const skipCanonical =
        typeof window !== "undefined" &&
        (() => {
          const raw = window.sessionStorage.getItem(RISK_PROFILE_V2_MISSING_SESSION_KEY);
          if (!raw) return false;
          const seenAt = Number.parseInt(raw, 10);
          if (!Number.isFinite(seenAt)) return false;
          return Date.now() - seenAt < RISK_PROFILE_V2_MISSING_TTL_MS;
        })();
      if (skipCanonical) {
        const legacy = await fetchLegacyBundle(address);
        setProfile(toRiskProfileV2FromLegacy(legacy));
        setError(false);
        return;
      }
      const payload = await fetchCanonicalRiskProfileV2(address, signal);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(RISK_PROFILE_V2_MISSING_SESSION_KEY);
      }
      setProfile(payload);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      try {
        if (err instanceof ApiError && err.status === 404 && typeof window !== "undefined") {
          window.sessionStorage.setItem(RISK_PROFILE_V2_MISSING_SESSION_KEY, String(Date.now()));
        }
        if (err instanceof ApiError && err.status !== 404) {
          throw err;
        }
        const legacy = await fetchLegacyBundle(address);
        setProfile(toRiskProfileV2FromLegacy(legacy));
        setError(false);
      } catch {
        setError(true);
        setProfile(null);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (!address) {
      setProfile(null);
      setError(false);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    refetch(ac.signal);
    return () => ac.abort();
  }, [address, refetch]);

  return { profile, loading, error, refetch };
}
