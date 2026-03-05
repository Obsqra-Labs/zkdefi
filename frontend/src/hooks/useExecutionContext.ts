"use client";

import { useEffect, useState } from "react";
import { useExecutionInfra } from "@/hooks/useExecutionInfra";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import { getRiskPassport, listSessionKeys } from "@/lib/api/gating";
import { ComplianceProfile } from "@/types/ekubo";

import { API_BASE } from "@/lib/api/client";

interface ExecutionContextState {
  passportScore: number | null;
  passportTier: string;
  activeSessionCount: number;
  dualWalletLinked: boolean;
  dualWalletStatus: string;
  dualWalletChain: string | null;
  dualWalletAddress: string | null;
  complianceProfileCount: number;
  complianceProfiles: ComplianceProfile[];
  relayerDecisionMode: "allow" | "advisory" | "block" | "unknown";
  executionDecisionMode: "allow" | "advisory" | "block" | "unknown";
  lendingDecisionMode: "allow" | "advisory" | "block" | "unknown";
  decisionReasons: string[];
  disclosureDisclaimer: string | null;
  loading: boolean;
}

function normalizeComplianceProfiles(payload: unknown): ComplianceProfile[] {
  if (Array.isArray(payload)) return payload as ComplianceProfile[];
  if (payload && typeof payload === "object") {
    const profiles = (payload as { profiles?: unknown }).profiles;
    if (Array.isArray(profiles)) return profiles as ComplianceProfile[];
  }
  return [];
}

export function useExecutionContext(address?: string) {
  const infra = useExecutionInfra();
  const [state, setState] = useState<ExecutionContextState>({
    passportScore: null,
    passportTier: "Unknown",
    activeSessionCount: 0,
    dualWalletLinked: false,
    dualWalletStatus: "missing",
    dualWalletChain: null,
    dualWalletAddress: null,
    complianceProfileCount: 0,
    complianceProfiles: [],
    relayerDecisionMode: "unknown",
    executionDecisionMode: "unknown",
    lendingDecisionMode: "unknown",
    decisionReasons: [],
    disclosureDisclaimer: null,
    loading: false,
  });

  useEffect(() => {
    if (!address) {
      setState((prev) => ({
        ...prev,
        passportScore: null,
        passportTier: "Unknown",
        activeSessionCount: 0,
        dualWalletLinked: false,
        dualWalletStatus: "missing",
        dualWalletChain: null,
        dualWalletAddress: null,
        complianceProfileCount: 0,
        complianceProfiles: [],
        relayerDecisionMode: "unknown",
        executionDecisionMode: "unknown",
        lendingDecisionMode: "unknown",
        decisionReasons: [],
        disclosureDisclaimer: null,
      }));
      return;
    }

    let cancelled = false;
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true }));
      try {
        const [passport, sessions, complianceRes, v2Res, dualSessionRes] = await Promise.all([
          getRiskPassport(address),
          listSessionKeys(address),
          fetch(`${API_BASE}/api/v1/zkdefi/compliance/profiles/${address}`),
          fetch(`${API_BASE}/api/v1/zkdefi/risk_profile/v2/${address}`),
          fetch(`${API_BASE}/api/v1/zkdefi/auth/session/${address}`),
        ]);

        const compliancePayload = complianceRes.ok ? await complianceRes.json() : [];
        const compliance = normalizeComplianceProfiles(compliancePayload);
        const v2 = v2Res.ok ? await v2Res.json() : null;
        const dualSessionPayload = dualSessionRes.ok ? await dualSessionRes.json() : null;

        if (cancelled) return;

        const passportScore =
          typeof v2?.passport?.composite_score === "number"
            ? v2.passport.composite_score
            : typeof passport.composite_score === "number"
              ? passport.composite_score
              : null;
        const passportTier = v2?.reputation?.tier_name || passport.tier_name || "Unknown";
        const activeSessionCount =
          typeof v2?.identity?.session_summary?.active_count === "number"
            ? v2.identity.session_summary.active_count
            : (sessions.sessions || []).filter((row) => row.is_active && !row.is_expired).length;
        const relayerDecisionMode = (v2?.decisions?.relayer?.mode as ExecutionContextState["relayerDecisionMode"]) || "unknown";
        const executionDecisionMode = (v2?.decisions?.execution?.mode as ExecutionContextState["executionDecisionMode"]) || "unknown";
        const lendingDecisionMode = (v2?.decisions?.lending?.mode as ExecutionContextState["lendingDecisionMode"]) || "unknown";
        const decisionReasons = [
          ...(Array.isArray(v2?.decisions?.relayer?.reason_codes) ? v2.decisions.relayer.reason_codes : []),
          ...(Array.isArray(v2?.decisions?.execution?.reason_codes) ? v2.decisions.execution.reason_codes : []),
          ...(Array.isArray(v2?.decisions?.lending?.reason_codes) ? v2.decisions.lending.reason_codes : []),
        ].map((row: unknown) => String(row));
        const dualSessionFromV2 =
          v2?.identity?.dual_wallet_session &&
          typeof v2.identity.dual_wallet_session === "object"
            ? v2.identity.dual_wallet_session
            : null;
        const dualSession =
          dualSessionFromV2 ||
          (dualSessionPayload && typeof dualSessionPayload === "object"
            ? dualSessionPayload
            : null);
        const dualWalletLinked = Boolean(dualSession && (dualSession as { active?: unknown }).active);
        const dualWalletStatus =
          typeof dualSession?.status === "string"
            ? dualSession.status
            : dualWalletLinked
              ? "active"
              : "missing";
        const dualWalletChain =
          typeof dualSession?.chain === "string" ? dualSession.chain : null;
        const dualWalletAddress =
          typeof dualSession?.evm_address === "string"
            ? dualSession.evm_address
            : null;

        setState({
          passportScore,
          passportTier,
          activeSessionCount,
          dualWalletLinked,
          dualWalletStatus,
          dualWalletChain,
          dualWalletAddress,
          complianceProfileCount: compliance.length,
          complianceProfiles: compliance,
          relayerDecisionMode,
          executionDecisionMode,
          lendingDecisionMode,
          decisionReasons,
          disclosureDisclaimer:
            typeof v2?.disclosures?.disclaimer === "string" ? v2.disclosures.disclaimer : null,
          loading: false,
        });
      } catch {
        if (cancelled) return;
        setState((prev) => ({ ...prev, loading: false }));
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [address]);
  useVisibilityPolling(async () => {
    if (!address) return;
    try {
      const [passport, sessions, compliancePayload, v2, dualSessionPayload] = await Promise.all([
        getRiskPassport(address),
        listSessionKeys(address),
        fetch(`${API_BASE}/api/v1/zkdefi/compliance/profiles/${address}`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        fetch(`${API_BASE}/api/v1/zkdefi/risk_profile/v2/${address}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`${API_BASE}/api/v1/zkdefi/auth/session/${address}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      const compliance = normalizeComplianceProfiles(compliancePayload);
      const dualSessionFromV2 =
        v2?.identity?.dual_wallet_session &&
        typeof v2.identity.dual_wallet_session === "object"
          ? v2.identity.dual_wallet_session
          : null;
      const dualSession =
        dualSessionFromV2 ||
        (dualSessionPayload && typeof dualSessionPayload === "object"
          ? dualSessionPayload
          : null);
      const dualWalletLinked = Boolean(dualSession && (dualSession as { active?: unknown }).active);
      const dualWalletStatus =
        typeof dualSession?.status === "string"
          ? dualSession.status
          : dualWalletLinked
            ? "active"
            : "missing";
      const dualWalletChain =
        typeof dualSession?.chain === "string" ? dualSession.chain : null;
      const dualWalletAddress =
        typeof dualSession?.evm_address === "string"
          ? dualSession.evm_address
          : null;
      setState({
        passportScore:
          typeof v2?.passport?.composite_score === "number"
            ? v2.passport.composite_score
            : typeof passport.composite_score === "number"
              ? passport.composite_score
              : null,
        passportTier: v2?.reputation?.tier_name || passport.tier_name || "Unknown",
        activeSessionCount:
          typeof v2?.identity?.session_summary?.active_count === "number"
            ? v2.identity.session_summary.active_count
            : (sessions.sessions || []).filter((row) => row.is_active && !row.is_expired).length,
        dualWalletLinked,
        dualWalletStatus,
        dualWalletChain,
        dualWalletAddress,
        complianceProfileCount: compliance.length,
        complianceProfiles: compliance,
        relayerDecisionMode: (v2?.decisions?.relayer?.mode as ExecutionContextState["relayerDecisionMode"]) || "unknown",
        executionDecisionMode: (v2?.decisions?.execution?.mode as ExecutionContextState["executionDecisionMode"]) || "unknown",
        lendingDecisionMode: (v2?.decisions?.lending?.mode as ExecutionContextState["lendingDecisionMode"]) || "unknown",
        decisionReasons: [
          ...(Array.isArray(v2?.decisions?.relayer?.reason_codes) ? v2.decisions.relayer.reason_codes : []),
          ...(Array.isArray(v2?.decisions?.execution?.reason_codes) ? v2.decisions.execution.reason_codes : []),
          ...(Array.isArray(v2?.decisions?.lending?.reason_codes) ? v2.decisions.lending.reason_codes : []),
        ].map((row: unknown) => String(row)),
        disclosureDisclaimer: typeof v2?.disclosures?.disclaimer === "string" ? v2.disclosures.disclaimer : null,
        loading: false,
      });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, 30_000, [address]);

  return {
    ...state,
    infra,
  };
}
