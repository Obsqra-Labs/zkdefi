"use client";

import { type SetStateAction, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PrivacyMethod =
  | "commitment_shield"
  | "nullifier_set"
  | "hashed_proof";

export interface VaultCommitment {
  id: string;
  method: PrivacyMethod;
  asset: "STRK" | "ETH" | "strkBTC" | string;
  amount_wei: string;
  commitment_hash: string;
  // Legacy field (historically used to store nonce in some flows).
  nullifier?: string;
  // Legacy field (historically used to store user secret).
  secret?: string;
  // Canonical fields required for withdraw proof generation.
  user_secret?: string;
  nonce?: string;
  blinding?: string;
  pool_type?: number;
  merkle_index?: number;
  merkle_root?: string;
  path_elements?: string[];
  path_indices?: number[];
  pool_variant?: string;
  deposited_at: string;
  yield_accrued?: string;
  strategy_id?: string;
  allocation_source?: string;
}

export type ProofStep = {
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
};

interface UsePrivacyVaultReturn {
  method: PrivacyMethod;
  setMethod: (m: PrivacyMethod) => void;
  commitments: VaultCommitment[];
  addCommitment: (c: VaultCommitment) => void;
  removeCommitment: (id: string) => void;
  depositSteps: ProofStep[];
  withdrawSteps: ProofStep[];
  setDepositSteps: (value: SetStateAction<ProofStep[]>) => void;
  setWithdrawSteps: (value: SetStateAction<ProofStep[]>) => void;
  migrateOldStorage: () => number;
}

// ---------------------------------------------------------------------------
// Step generators
// ---------------------------------------------------------------------------

export function getDepositStepsForMethod(method: PrivacyMethod): ProofStep[] {
  switch (method) {
    case "commitment_shield":
      return [
        { label: "Generate commitment", status: "pending" },
        { label: "Approve & sign deposit", status: "pending" },
        { label: "Confirm", status: "pending" },
      ];
    case "nullifier_set":
      return [
        { label: "Generate private commitment", status: "pending" },
        { label: "Register in privacy set", status: "pending" },
        { label: "Build Groth16 proof", status: "pending" },
        { label: "Approve & sign deposit", status: "pending" },
      ];
    case "hashed_proof":
      return [
        { label: "Generate private commitment", status: "pending" },
        { label: "Build Groth16 proof", status: "pending" },
        { label: "Register commitment", status: "pending" },
        { label: "Approve & sign", status: "pending" },
      ];
  }
}

export function getWithdrawStepsForMethod(method: PrivacyMethod): ProofStep[] {
  switch (method) {
    case "commitment_shield":
      return [
        { label: "Verify commitment", status: "pending" },
        { label: "Generate withdrawal proof", status: "pending" },
        { label: "Sign transaction", status: "pending" },
      ];
    case "nullifier_set":
      return [
        { label: "Verify commitment", status: "pending" },
        { label: "Generate nullifier", status: "pending" },
        { label: "Build withdraw proof", status: "pending" },
        { label: "Sign transaction", status: "pending" },
      ];
    case "hashed_proof":
      return [
        { label: "Verify commitment", status: "pending" },
        { label: "Build hash proof", status: "pending" },
        { label: "Sign transaction", status: "pending" },
      ];
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers (SSR-safe)
// ---------------------------------------------------------------------------

function storageKey(address: string): string {
  return `zkdefi_vault_${address.toLowerCase()}`;
}

function loadCommitments(address: string): VaultCommitment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(address));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VaultCommitment[]) : [];
  } catch {
    return [];
  }
}

function saveCommitments(address: string, commitments: VaultCommitment[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(address), JSON.stringify(commitments));
}

// ---------------------------------------------------------------------------
// Migration: old keys → unified storage
// ---------------------------------------------------------------------------

const OLD_KEY_METHOD_MAP: ReadonlyArray<{ prefix: string; method: PrivacyMethod }> = [
  { prefix: "zkdefi_commitments_", method: "commitment_shield" },
  { prefix: "zkdefi_shielded_", method: "commitment_shield" },
  { prefix: "zkdefi_fullprivacy_", method: "nullifier_set" },
  { prefix: "zkdefi_poold_", method: "hashed_proof" },
];

function migrateOldKeys(address: string, existing: VaultCommitment[]): { merged: VaultCommitment[]; count: number } {
  if (typeof window === "undefined") return { merged: existing, count: 0 };

  const addr = address.toLowerCase();
  const knownHashes = new Set(existing.map((c) => c.commitment_hash));
  const newEntries: VaultCommitment[] = [];

  for (const { prefix, method } of OLD_KEY_METHOD_MAP) {
    // Try both raw address and lowercased (old panels didn't normalise case)
    const candidates = [addr, address];
    const seen = new Set<string>();
    for (const a of candidates) {
      const key = `${prefix}${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;

        let migratedFromThisKey = 0;
        for (const item of parsed) {
          if (typeof item !== "object" || item === null) continue;
          const rec = item as Record<string, unknown>;
          // Old panels stored "commitment", not "commitment_hash"
          const hash = String(rec.commitment_hash ?? rec.commitment ?? rec.hash ?? "");
          if (!hash || knownHashes.has(hash)) continue;
          knownHashes.add(hash);

          // Old ShieldedPool stored "balance" (wei string), FullPrivacy stored "amount" (int)
          const rawAmount = rec.amount_wei ?? rec.balance ?? rec.amount ?? "0";
          const amountStr = String(rawAmount);

          // Resolve deposited_at from various legacy fields
          let depositedAt: string;
          if (typeof rec.deposited_at === "string") {
            depositedAt = rec.deposited_at;
          } else if (typeof rec.timestamp === "number") {
            depositedAt = new Date(rec.timestamp).toISOString();
          } else {
            depositedAt = new Date().toISOString();
          }

          newEntries.push({
            id: crypto.randomUUID(),
            method,
            asset: (rec.asset as "STRK" | "ETH") ?? "STRK",
            amount_wei: amountStr,
            commitment_hash: hash,
            nullifier: rec.nullifier != null ? String(rec.nullifier) : undefined,
            secret: rec.secret != null ? String(rec.secret) : undefined,
            user_secret: rec.user_secret != null ? String(rec.user_secret) : undefined,
            nonce: rec.nonce != null ? String(rec.nonce) : undefined,
            blinding: rec.blinding != null ? String(rec.blinding) : undefined,
            pool_type: typeof rec.pool_type === "number" ? rec.pool_type : undefined,
            merkle_index: typeof rec.merkle_index === "number" ? rec.merkle_index : undefined,
            merkle_root: rec.merkle_root != null ? String(rec.merkle_root) : undefined,
            path_elements: Array.isArray(rec.path_elements)
              ? rec.path_elements.map((p) => String(p))
              : undefined,
            path_indices: Array.isArray(rec.path_indices)
              ? rec.path_indices.map((p) => Number(p)).filter((p) => Number.isFinite(p))
              : undefined,
            pool_variant: rec.pool_variant != null ? String(rec.pool_variant) : undefined,
            deposited_at: depositedAt,
            yield_accrued: rec.yield_accrued != null ? String(rec.yield_accrued) : undefined,
          });
          migratedFromThisKey++;
        }

        // Only remove the old key if we actually migrated records from it
        if (migratedFromThisKey > 0) {
          window.localStorage.removeItem(key);
        }
      } catch {
        // best-effort
      }
    }
  }

  if (newEntries.length === 0) return { merged: existing, count: 0 };
  const merged = [...existing, ...newEntries];
  return { merged, count: newEntries.length };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePrivacyVault(address?: string): UsePrivacyVaultReturn {
  // Default to hashed_proof — maximum privacy (hash-committed deposits + withdrawals).
  // Users never choose a privacy method; they always get the strongest one.
  const [method, setMethodRaw] = useState<PrivacyMethod>("hashed_proof");
  const [commitments, setCommitments] = useState<VaultCommitment[]>([]);
  const [depositSteps, setDepositSteps] = useState<ProofStep[]>(() =>
    getDepositStepsForMethod("hashed_proof"),
  );
  const [withdrawSteps, setWithdrawSteps] = useState<ProofStep[]>(() =>
    getWithdrawStepsForMethod("hashed_proof"),
  );

  useEffect(() => {
    if (!address) {
      setCommitments([]);
      return;
    }
    setCommitments(loadCommitments(address));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let dead = false;

    (async () => {
      try {
        const data = await apiFetch<{ notes?: Record<string, unknown>[] }>(`/api/v1/zkdefi/ledger/notes/${address}`, {
          method: "GET",
        });
        if (dead) return;
        const notes: Record<string, unknown>[] = Array.isArray(data?.notes) ? data.notes : [];
        if (notes.length === 0) return;

        setCommitments((prev) => {
          const known = new Set(prev.map((c) => c.commitment_hash));
          const imported: VaultCommitment[] = [];
          for (const note of notes) {
            const rail = String(note?.rail_type ?? "").toLowerCase();
            if (!rail || rail === "dark_ledger") continue;

            const commitment = String(note?.commitment ?? "");
            if (!commitment || known.has(commitment)) continue;
            known.add(commitment);

            const amountWei = String(note?.amount_wei ?? "0");
            const createdAt = Number(note?.created_at ?? Date.now() / 1000);
            imported.push({
              id: crypto.randomUUID(),
              method: "hashed_proof",
              asset: String(note?.token ?? "STRK"),
              amount_wei: amountWei,
              commitment_hash: commitment,
              deposited_at: new Date(createdAt * 1000).toISOString(),
            });
          }
          if (imported.length === 0) return prev;
          const next = [...prev, ...imported];
          saveCommitments(address, next);
          return next;
        });
      } catch {
        // best-effort reconciliation
      }
    })();

    return () => {
      dead = true;
    };
  }, [address]);

  useEffect(() => {
    if (!address || commitments.length === 0) return;
    let dead = false;

    (async () => {
      try {
        const data = await apiFetch<{ positions?: Record<string, unknown>[] }>(
          `/api/v1/zkdefi/private-yield/positions/${address}`,
          { method: "GET" },
        );
        if (dead) return;
        const positions: Record<string, unknown>[] = Array.isArray(data.positions) ? data.positions : [];
        if (positions.length === 0) return;

        const yieldMap = new Map<string, string>();
        for (const pos of positions) {
          const hash = String(pos.commitment ?? pos.commitment_hash ?? "");
          const accrued = pos.yield_accrued ?? pos.yield ?? pos.earned ?? null;
          if (hash && accrued != null) yieldMap.set(hash, String(accrued));
        }

        if (yieldMap.size === 0 || dead) return;

        setCommitments((prev) => {
          let changed = false;
          const next = prev.map((c) => {
            const y = yieldMap.get(c.commitment_hash);
            if (y && y !== c.yield_accrued) {
              changed = true;
              return { ...c, yield_accrued: y };
            }
            return c;
          });
          if (changed) saveCommitments(address, next);
          return changed ? next : prev;
        });
      } catch { /* best-effort background sync */ }
    })();

    return () => { dead = true; };
  }, [address, commitments.length]);

  const setMethod = useCallback((m: PrivacyMethod) => {
    setMethodRaw(m);
    setDepositSteps(getDepositStepsForMethod(m));
    setWithdrawSteps(getWithdrawStepsForMethod(m));
  }, []);

  const addCommitment = useCallback(
    (c: VaultCommitment) => {
      if (!address) return;
      setCommitments((prev) => {
        const next = [...prev, c];
        saveCommitments(address, next);
        return next;
      });
    },
    [address],
  );

  const removeCommitment = useCallback(
    (id: string) => {
      if (!address) return;
      setCommitments((prev) => {
        const next = prev.filter((c) => c.id !== id);
        saveCommitments(address, next);
        return next;
      });
    },
    [address],
  );

  const migrateOldStorage = useCallback((): number => {
    if (!address) return 0;
    const current = loadCommitments(address);
    const { merged, count } = migrateOldKeys(address, current);
    if (count > 0) {
      saveCommitments(address, merged);
      setCommitments(merged);
    }
    return count;
  }, [address]);

  return {
    method,
    setMethod,
    commitments,
    addCommitment,
    removeCommitment,
    depositSteps,
    withdrawSteps,
    setDepositSteps,
    setWithdrawSteps,
    migrateOldStorage,
  };
}
