"use client";

import { useState, useEffect, useCallback } from "react";

import { API_BASE } from "@/lib/api/client";

/** Risk Profile bundle shape returned by GET /api/v1/zkdefi/risk_profile/{address} */
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
    aggregation_sources?: Array<{ id?: string; description?: string; chain?: string; contract_hint?: string | null }>;
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
  address: string;
  identity: {
    has_agent: boolean;
    identity_commitment?: string | null;
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
  } | null;
  feature_flags?: Record<string, unknown>;
  generated_at?: string;
}

/** When risk_profile endpoint returns 404 (e.g. backend not yet deployed), fetch legacy endpoints and build a synthetic bundle. */
async function fetchLegacyBundle(
  base: string,
  address: string
): Promise<RiskProfileBundle> {
  const [repRes, passportRes, onbRes, linkedRes, complianceRes, sessionsRes, dualSessionRes] = await Promise.all([
    fetch(`${base}/api/v1/zkdefi/reputation/user/${address}`),
    fetch(`${base}/api/v1/zkdefi/risk_passport/user/${address}`),
    fetch(`${base}/api/v1/zkdefi/onboarding/status/${address}`),
    fetch(`${base}/api/v1/zkdefi/linked_addresses/${address}`),
    fetch(`${base}/api/v1/zkdefi/compliance/profiles/${address}`),
    fetch(`${base}/api/v1/zkdefi/session_keys/list/${address}`),
    fetch(`${base}/api/v1/zkdefi/auth/session/${address}`),
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
  let session_summary = { count: 0, active_count: 0, sessions: [] as Array<Record<string, unknown>> };
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

  return {
    address,
    reputation,
    risk_passport,
    onboarding,
    linked_addresses,
    compliance_summary: { count: complianceProfiles.length, profiles: complianceProfiles },
    session_summary,
    dual_wallet_session,
  };
}

export function useRiskProfile(address: string | undefined) {
  const [profile, setProfile] = useState<RiskProfileBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refetch = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(false);
    const base = API_BASE;
    try {
      const r = await fetch(`${base}/api/v1/zkdefi/risk_profile/${address}`);
      if (r.ok) {
        const data = await r.json();
        setProfile(data);
        return;
      }
      if (r.status === 404) {
        const bundle = await fetchLegacyBundle(base, address);
        setProfile(bundle);
        return;
      }
      setError(true);
      setProfile(null);
    } catch {
      try {
        const bundle = await fetchLegacyBundle(base, address);
        setProfile(bundle);
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
  const sessionSummary = profile?.session_summary ?? { count: 0, active_count: 0, sessions: [] };
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

  const refetch = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(false);
    try {
      const r = await fetch(`${API_BASE}/api/v1/zkdefi/risk_profile/v2/${address}`);
      if (!r.ok) {
        setError(true);
        setProfile(null);
        return;
      }
      const data = (await r.json()) as RiskProfileV2;
      setProfile(data);
    } catch {
      setError(true);
      setProfile(null);
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

  return { profile, loading, error, refetch };
}
