"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getUserSessions, type Session } from "@/lib/sessionKeys";
import { API_BASE } from "@/lib/api/client";
import { getVaultStatus, type VaultStatusResponse } from "@/lib/api/vault";
import {
  getLedgerAccount,
  getLedgerTransfers,
  requestLedgerTransferIn,
  requestLedgerTransferOut,
  type LedgerAccountResponse,
  type LedgerTransferEntry,
  type TransferDestinationMode,
  type TransferInResponse,
  type TransferOutResponse,
} from "@/lib/api/ledger";

/** Single ledger transfer entry (from GET /api/v1/zkdefi/ledger/transfers) */
export type LedgerEntry = LedgerTransferEntry;

/** Allocation breakdown: LP / Limit / Private / Staking / Idle (percent 0-100) */
export interface AllocationBreakdown {
  lp: number;
  limit: number;
  private: number;
  staking: number;
  idle: number;
}

/** Privacy tier derived from reputation endpoint */
export interface UserPrivacyTier {
  tier: number;
  tier_name: string;
  proof_requirement: string;
  max_deposits_per_day: number;
}

/** Active session key summary for header/chip display */
export interface ActiveSessionSummary {
  sessionId: string | null;
  expiresAt: string | null;
  isActive: boolean;
}

export interface VaultStoreState {
  effectiveAddress: string | undefined;
  walletBalanceWei: string | null;
  vaultBalanceWei: string | null;
  vaultStatus: VaultStatusResponse | null;
  allocationBreakdown: AllocationBreakdown;
  sessionKeyState: Session[];
  activeSession: ActiveSessionSummary;
  ledgerEntries: LedgerEntry[];
  ledgerAccount: LedgerAccountResponse | null;
  transferOutPending: boolean;
  transferInPending: boolean;
  riskLimits: { maxPositionUsd?: number; sessionDurationHours?: number } | null;
  privacyTier: UserPrivacyTier | null;
  demoMode: boolean;
  loading: boolean;
  error: string | null;
  invalidate: () => void;
  setEffectiveAddress: (address: string | undefined) => void;
  requestTransferOut: (params: {
    amountWei: string;
    asset: string;
    capitalSource?: "wallet_mode" | "private_capital";
    destinationMode: TransferDestinationMode;
    recipient?: string;
  }) => Promise<TransferOutResponse>;
  requestTransferIn: (params: {
    txHash: string;
    asset: string;
    capitalSource?: "wallet_mode" | "private_capital";
  }) => Promise<TransferInResponse>;
}

const defaultAllocation: AllocationBreakdown = {
  lp: 0,
  limit: 0,
  private: 0,
  staking: 0,
  idle: 100,
};

const defaultActiveSession: ActiveSessionSummary = {
  sessionId: null,
  expiresAt: null,
  isActive: false,
};

const VaultStoreContext = createContext<VaultStoreState | undefined>(undefined);

export function VaultStoreProvider({
  children,
  demoMode = false,
  walletBalanceWei = null,
}: {
  children: ReactNode;
  demoMode?: boolean;
  walletBalanceWei?: string | null;
}) {
  const [effectiveAddress, setEffectiveAddressState] = useState<string | undefined>(undefined);
  const [vaultBalanceWei, setVaultBalanceWei] = useState<string | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatusResponse | null>(null);
  const [allocationBreakdown, setAllocationBreakdown] = useState<AllocationBreakdown>(defaultAllocation);
  const [sessionKeyState, setSessionKeyState] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSessionSummary>(defaultActiveSession);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerAccount, setLedgerAccount] = useState<LedgerAccountResponse | null>(null);
  const [transferOutPending, setTransferOutPending] = useState(false);
  const [transferInPending, setTransferInPending] = useState(false);
  const [riskLimits, setRiskLimits] = useState<VaultStoreState["riskLimits"]>(null);
  const [privacyTier, setPrivacyTier] = useState<UserPrivacyTier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidateKey, setInvalidateKey] = useState(0);

  const setEffectiveAddress = useCallback((address: string | undefined) => {
    setEffectiveAddressState(address);
  }, []);

  // --- Fetch vault balance & status via domain client ---
  const fetchVaultStatus = useCallback(async (address: string) => {
    try {
      const status = await getVaultStatus(address);
      setVaultStatus(status);
      setVaultBalanceWei(status.balance_wei ?? null);

      // Derive allocation breakdown from vault allocations
      if (status.allocations && status.allocations.length > 0) {
        const total = BigInt(status.balance_wei || "0") + BigInt(status.deployed_wei || "0");
        if (total > BigInt(0)) {
          let lpWei = BigInt(0);
          let privateWei = BigInt(0);
          let stakingWei = BigInt(0);
          for (const alloc of status.allocations) {
            const amt = BigInt(alloc.amount_wei || "0");
            if (alloc.venue?.includes("staking") || alloc.venue?.includes("delegation")) {
              stakingWei += amt;
            } else if (alloc.venue?.includes("privacy") || alloc.venue?.includes("shielded")) {
              privateWei += amt;
            } else {
              lpWei += amt;
            }
          }
          const lpPct = Number((lpWei * BigInt(100)) / total);
          const privatePct = Number((privateWei * BigInt(100)) / total);
          const stakingPct = Number((stakingWei * BigInt(100)) / total);
          const idlePct = Math.max(0, 100 - lpPct - privatePct - stakingPct);
          setAllocationBreakdown({ lp: lpPct, limit: 0, private: privatePct, staking: stakingPct, idle: idlePct });
        }
      }
    } catch {
      // Non-fatal: other sources may still populate
    }
  }, []);

  const fetchLedger = useCallback(async (address: string) => {
    try {
      const data = await getLedgerTransfers(address, 50, 0);
      setLedgerEntries(data.transfers ?? []);
    } catch {
      setLedgerEntries([]);
    }
  }, []);

  const fetchLedgerAccount = useCallback(async (address: string) => {
    try {
      const data = await getLedgerAccount(address);
      setLedgerAccount(data);
    } catch {
      setLedgerAccount(null);
    }
  }, []);

  const fetchSessions = useCallback(async (address: string) => {
    try {
      const sessions = await getUserSessions(address);
      setSessionKeyState(sessions);
      // Derive active session summary
      const active = sessions.find((s) => s.isActive && !s.isExpired);
      setActiveSession({
        sessionId: active?.sessionId ?? null,
        expiresAt: active?.expiresAt ?? null,
        isActive: !!active,
      });
    } catch {
      setSessionKeyState([]);
      setActiveSession(defaultActiveSession);
    }
  }, []);

  // --- Fetch privacy tier from reputation endpoint ---
  const fetchPrivacyTier = useCallback(async (address: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/reputation/user/${address}`);
      if (!res.ok) return;
      const data = await res.json();
      const rawTier = data.tier ?? data.current_tier;
      if (rawTier !== undefined && rawTier !== null) {
        const tier = Number(rawTier);
        if (!Number.isFinite(tier)) return;
        const tierName =
          typeof data.tier_name === "string" && data.tier_name.trim().length > 0
            ? data.tier_name
            : tier === 0
              ? "Strict"
              : tier === 1
                ? "Standard"
                : "Express";
        setPrivacyTier({
          tier,
          tier_name: tierName,
          proof_requirement: tier === 0 ? "Full proof" : tier === 1 ? "Constraint proof" : "Batched",
          max_deposits_per_day: tier === 0 ? 2 : tier === 1 ? 10 : 50,
        });
      }
    } catch {
      // Non-fatal
    }
  }, []);

  // --- Fetch risk limits from vault policy ---
  const fetchRiskLimits = useCallback(async (address: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/policy/vault/${encodeURIComponent(address)}`);
      if (!res.ok) return;
      const data = await res.json();
      setRiskLimits({
        maxPositionUsd: data.execution_policy?.session_max_notional_usd ?? undefined,
        sessionDurationHours: data.execution_policy?.session_duration_hours ?? undefined,
      });
    } catch {
      // Non-fatal
    }
  }, []);

  const invalidate = useCallback(() => {
    setInvalidateKey((k) => k + 1);
  }, []);

  const requestTransferOutAction = useCallback(
    async ({
      amountWei,
      asset,
      capitalSource,
      destinationMode,
      recipient,
    }: {
      amountWei: string;
      asset: string;
      capitalSource?: "wallet_mode" | "private_capital";
      destinationMode: TransferDestinationMode;
      recipient?: string;
    }): Promise<TransferOutResponse> => {
      if (!effectiveAddress) {
        throw new Error("Connect wallet before requesting transfer out.");
      }
      setTransferOutPending(true);
      try {
        const response = await requestLedgerTransferOut({
          user_address: effectiveAddress,
          amount_wei: amountWei,
          asset,
          capital_source: capitalSource,
          destination_mode: destinationMode,
          recipient,
        });
        invalidate();
        return response;
      } finally {
        setTransferOutPending(false);
      }
    },
    [effectiveAddress, invalidate],
  );

  const requestTransferInAction = useCallback(
    async ({
      txHash,
      asset,
      capitalSource,
    }: {
      txHash: string;
      asset: string;
      capitalSource?: "wallet_mode" | "private_capital";
    }): Promise<TransferInResponse> => {
      if (!effectiveAddress) {
        throw new Error("Connect wallet before requesting transfer in.");
      }
      setTransferInPending(true);
      try {
        const response = await requestLedgerTransferIn({
          user_address: effectiveAddress,
          tx_hash: txHash,
          asset,
          capital_source: capitalSource,
        });
        invalidate();
        return response;
      } finally {
        setTransferInPending(false);
      }
    },
    [effectiveAddress, invalidate],
  );

  useEffect(() => {
    if (!effectiveAddress) {
      setLedgerEntries([]);
      setLedgerAccount(null);
      setSessionKeyState([]);
      setActiveSession(defaultActiveSession);
      setVaultBalanceWei(null);
      setVaultStatus(null);
      setPrivacyTier(null);
      setRiskLimits(null);
      setAllocationBreakdown(defaultAllocation);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let cancelled = false;
    Promise.all([
      fetchVaultStatus(effectiveAddress),
      fetchLedger(effectiveAddress),
      fetchLedgerAccount(effectiveAddress),
      fetchSessions(effectiveAddress),
      fetchPrivacyTier(effectiveAddress),
      fetchRiskLimits(effectiveAddress),
    ])
      .then(() => { if (!cancelled) setLoading(false); })
      .catch(() => { if (!cancelled) { setError("Failed to load vault"); setLoading(false); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveAddress, invalidateKey, fetchVaultStatus, fetchLedger, fetchLedgerAccount, fetchSessions, fetchPrivacyTier, fetchRiskLimits]);

  const value = useMemo<VaultStoreState>(
    () => ({
      effectiveAddress,
      walletBalanceWei,
      vaultBalanceWei,
      vaultStatus,
      allocationBreakdown,
      sessionKeyState,
      activeSession,
      ledgerEntries,
      ledgerAccount,
      transferOutPending,
      transferInPending,
      riskLimits,
      privacyTier,
      demoMode,
      loading,
      error,
      invalidate,
      setEffectiveAddress,
      requestTransferOut: requestTransferOutAction,
      requestTransferIn: requestTransferInAction,
    }),
    [
      effectiveAddress,
      walletBalanceWei,
      vaultBalanceWei,
      vaultStatus,
      allocationBreakdown,
      sessionKeyState,
      activeSession,
      ledgerEntries,
      ledgerAccount,
      transferOutPending,
      transferInPending,
      riskLimits,
      privacyTier,
      demoMode,
      loading,
      error,
      invalidate,
      setEffectiveAddress,
      requestTransferOutAction,
      requestTransferInAction,
    ]
  );

  return <VaultStoreContext.Provider value={value}>{children}</VaultStoreContext.Provider>;
}

export function useVaultStore() {
  const ctx = useContext(VaultStoreContext);
  if (ctx === undefined) {
    throw new Error("useVaultStore must be used within VaultStoreProvider");
  }
  return ctx;
}
