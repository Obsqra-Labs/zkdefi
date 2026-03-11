"use client";

import { useState, useEffect, useCallback } from "react";
import { apiUrl } from "@/lib/api/client";

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
      const response = await fetch(apiUrl(`/api/v1/zkdefi/risk_profile/v2/${address}`), { signal });
      if (!response.ok) {
        setError(true);
        setProfile(null);
        return;
      }
      setProfile((await response.json()) as RiskProfileV2);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
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
    const ac = new AbortController();
    refetch(ac.signal);
    return () => ac.abort();
  }, [address, refetch]);

  return { profile, loading, error, refetch };
}
