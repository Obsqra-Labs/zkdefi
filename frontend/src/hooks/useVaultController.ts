"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api/client";

export type VaultStateEnum =
  | "ACTIVE"
  | "COOLDOWN"
  | "PENDING_REBALANCE"
  | "PAUSED"
  | "EMERGENCY";

export type ProofsState = "OK" | "WARNING" | "FAIL";

interface VaultStatsResponse {
  cooldown_remaining_seconds?: number;
  pending_proposal?: boolean;
  circuit_breaker_active?: boolean;
  last_rebalance_ts?: string | null;
  risk_score_valid?: boolean;
}

interface SessionKeyListResponse {
  sessions?: Array<{ status?: string; is_active?: boolean }>;
}

export interface VaultControllerState {
  vaultState: VaultStateEnum;
  cooldownRemaining: number;
  pendingProposal: boolean;
  lastRebalanceTs: string | null;
  proofsState: {
    policyEnforced: ProofsState;
    riskWithinBound: ProofsState;
    mevProtection: ProofsState;
    overall: ProofsState;
  };
  loading: boolean;
}

export function useVaultController(address: string | undefined): VaultControllerState {
  const [state, setState] = useState<VaultControllerState>({
    vaultState: "ACTIVE",
    cooldownRemaining: 0,
    pendingProposal: false,
    lastRebalanceTs: null,
    proofsState: {
      policyEnforced: "OK",
      riskWithinBound: "OK",
      mevProtection: "OK",
      overall: "OK",
    },
    loading: true,
  });

  const fetchState = useCallback(async () => {
    if (!address) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    try {
      const [statsRes, keysRes] = await Promise.allSettled([
        apiFetch<VaultStatsResponse>(`/api/v1/zkdefi/private-yield/vault/stats`),
        apiFetch<SessionKeyListResponse>(`/api/v1/zkdefi/session_keys/list/${address}`),
      ]);

      const stats = statsRes.status === "fulfilled" ? statsRes.value : null;
      const keysData = keysRes.status === "fulfilled" ? keysRes.value : null;

      // Derive vault state from available data
      let vaultState: VaultStateEnum = "ACTIVE";
      let cooldownRemaining = 0;
      let pendingProposal = false;

      if (stats?.cooldown_remaining_seconds) {
        cooldownRemaining = stats.cooldown_remaining_seconds;
        if (cooldownRemaining > 0) vaultState = "COOLDOWN";
      }
      if (stats?.pending_proposal) {
        pendingProposal = true;
        vaultState = "PENDING_REBALANCE";
      }
      if (stats?.circuit_breaker_active) {
        vaultState = "EMERGENCY";
      }

      // Proofs state -- derived from session key validity and vault health
      const sessions = keysData?.sessions ?? [];
      const hasActiveKey = sessions.some((k) => k.status === "active" || k.is_active);
      const policyEnforced: ProofsState = hasActiveKey ? "OK" : "WARNING";
      const riskWithinBound: ProofsState = stats?.risk_score_valid !== false ? "OK" : "FAIL";
      const mevProtection: ProofsState = "OK";
      const overall: ProofsState =
        riskWithinBound === "FAIL"
          ? "FAIL"
          : policyEnforced === "WARNING"
            ? "WARNING"
            : "OK";

      setState({
        vaultState,
        cooldownRemaining,
        pendingProposal,
        lastRebalanceTs: stats?.last_rebalance_ts ?? null,
        proofsState: { policyEnforced, riskWithinBound, mevProtection, overall },
        loading: false,
      });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [address]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 30_000);
    return () => clearInterval(interval);
  }, [fetchState]);

  return state;
}
