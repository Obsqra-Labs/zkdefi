"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getOrCreateVault,
  getVaultBalance,
  getVaultNotes,
  getVaultReceipts,
  createDepositIntent,
  confirmDeposit,
  requestWithdrawal,
  sweepToLedger,
  sweepToVault,
  type VaultAccount,
  type VaultBalance,
  type Note,
  type LedgerEntry,
} from "@/lib/api/vault-v2";
import { creditLineService, type CreditLineResponse } from "@/services/CreditLineService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenBalance {
  token: string;
  available: number;
  pending: number;
  deployed: number;
  total: number;
}

export interface UseVaultV2Return {
  // Account
  vaultId: string | null;
  account: VaultAccount | null;
  // Balances
  balances: TokenBalance[];
  totalAvailableUsd: number;
  // Notes (privacy notes from on-chain deposits)
  notes: Note[];
  // Receipts (double-entry ledger entries)
  receipts: LedgerEntry[];
  // Credit
  creditLines: CreditLineResponse[];
  creditAvailableUsd: number;
  creditUsedUsd: number;
  // State
  loading: boolean;
  error: string | null;
  // Actions
  refresh: () => Promise<void>;
  recordDeposit: (amountWei: string, token: string, rail: string, txHash: string, commitmentHash: string) => Promise<void>;
  recordWithdrawal: (amountWei: string, token: string, destination: string, route: string) => Promise<void>;
  doSweepToLedger: (noteId: string, amountWei: string, token: string) => Promise<void>;
  doSweepToVault: (amountWei: string, token: string, targetRail: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVaultV2(address: string | undefined): UseVaultV2Return {
  const [account, setAccount] = useState<VaultAccount | null>(null);
  const [balance, setBalance] = useState<VaultBalance | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [receipts, setReceipts] = useState<LedgerEntry[]>([]);
  const [creditLines, setCreditLines] = useState<CreditLineResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const vaultId = account?.vault_id ?? null;

  // -----------------------------------------------------------------------
  // Derived balances
  // -----------------------------------------------------------------------
  const balances: TokenBalance[] = balance?.by_token
    ? Object.entries(balance.by_token).map(([token, v]) => ({
        token,
        available: Number(v.available ?? 0) / 1e18,
        pending: Number(v.pending ?? 0) / 1e18,
        deployed: Number(v.deployed ?? 0) / 1e18,
        total: (Number(v.available ?? 0) + Number(v.pending ?? 0) + Number(v.deployed ?? 0)) / 1e18,
      }))
    : [];

  const totalAvailableUsd = 0; // price conversion done at consumer level

  const creditAvailableUsd = creditLines.reduce((s, l) => s + (l.credit_available_usd ?? 0), 0);
  const creditUsedUsd = creditLines.reduce((s, l) => s + (l.credit_used_usd ?? 0), 0);

  // -----------------------------------------------------------------------
  // Load
  // -----------------------------------------------------------------------
  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setError(null);

      // 1. Get or create vault account
      const acct = await getOrCreateVault(address).catch(() => null);
      if (!acct?.vault_id) {
        setLoading(false);
        return;
      }
      setAccount(acct);

      // 2. Parallel fetch balance, notes, receipts, credit
      const [bal, nts, rcpts, cred] = await Promise.all([
        getVaultBalance(acct.vault_id).catch(() => null),
        getVaultNotes(acct.vault_id).catch(() => []),
        getVaultReceipts(acct.vault_id).catch(() => []),
        creditLineService.getCreditLines(address).catch(() => null),
      ]);

      if (bal) setBalance(bal);
      if (Array.isArray(nts)) setNotes(nts);
      if (Array.isArray(rcpts)) setReceipts(rcpts);
      if (cred?.lines) setCreditLines(cred.lines.filter((l) => l.status === "active"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30_000);
    return () => clearInterval(iv);
  }, [refresh]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  /** Record a deposit in the Privacy Pool (V2 intent→confirm) */
  const recordDeposit = useCallback(
    async (amountWei: string, token: string, rail: string, txHash: string, commitmentHash: string) => {
      if (!vaultId) return;
      try {
        const intent = await createDepositIntent(vaultId, amountWei, token, rail);
        await confirmDeposit(intent.intent_id, txHash, commitmentHash);
        await refresh();
      } catch {
        // best-effort — on-chain deposit already succeeded
        console.warn("[PrivacyPool] Failed to record deposit in V2 ledger");
      }
    },
    [vaultId, refresh],
  );

  /** Record a withdrawal in the Privacy Pool */
  const recordWithdrawal = useCallback(
    async (amountWei: string, token: string, destination: string, route: string) => {
      if (!vaultId) return;
      try {
        await requestWithdrawal(vaultId, amountWei, token, destination, route);
        await refresh();
      } catch {
        console.warn("[PrivacyPool] Failed to record withdrawal in V2 ledger");
      }
    },
    [vaultId, refresh],
  );

  /** Sweep a privacy note back to ledger balance */
  const doSweepToLedger = useCallback(
    async (noteId: string, amountWei: string, token: string) => {
      if (!vaultId) throw new Error("No vault");
      await sweepToLedger(vaultId, noteId, amountWei, token);
      await refresh();
    },
    [vaultId, refresh],
  );

  /** Sweep ledger balance out to a privacy pool */
  const doSweepToVault = useCallback(
    async (amountWei: string, token: string, targetRail: string) => {
      if (!vaultId) throw new Error("No vault");
      await sweepToVault(vaultId, amountWei, token, targetRail);
      await refresh();
    },
    [vaultId, refresh],
  );

  return {
    vaultId,
    account,
    balances,
    totalAvailableUsd,
    notes,
    receipts,
    creditLines,
    creditAvailableUsd,
    creditUsedUsd,
    loading,
    error,
    refresh,
    recordDeposit,
    recordWithdrawal,
    doSweepToLedger,
    doSweepToVault,
  };
}
