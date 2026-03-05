"use client";

import { useCallback, useEffect, useState } from "react";
import { getVaultPolicy, putVaultPolicy } from "@/lib/api/policy";
import { migrateLocalCommitments } from "@/lib/api/state";
import { VaultPolicyProfile } from "@/types/ekubo";

export function useVaultPolicy(address?: string) {
  const [policy, setPolicy] = useState<VaultPolicyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migratedAddress, setMigratedAddress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setPolicy(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await getVaultPolicy(address);
      setPolicy(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load vault policy";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [address]);

  const savePatch = useCallback(
    async (patch: Partial<VaultPolicyProfile>) => {
      if (!address) throw new Error("Wallet not connected");
      setSaving(true);
      setError(null);
      try {
        const next = await putVaultPolicy(address, patch);
        setPolicy(next);
        return next;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save vault policy";
        setError(msg);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [address],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!address || !policy || migratedAddress === address) return;
    if (typeof window === "undefined") return;

    const addr = address.toLowerCase();
    const migrationPayload: Record<string, Array<Record<string, unknown>>> = {};
    const keyMap = [
      `zkdefi_poold_${addr}`,
      `zkdefi_fullprivacy_${addr}`,
      `zkdefi_poolc_${addr}`,
      `zkdefi_shielded_${addr}`,
      `zkdefi_commitments_${addr}`,
    ];
    for (const key of keyMap) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          migrationPayload[key] = parsed.filter((row) => typeof row === "object" && row !== null);
        }
      } catch {
        // Best-effort migration only.
      }
    }

    if (Object.keys(migrationPayload).length === 0) {
      setMigratedAddress(address);
      return;
    }

    void migrateLocalCommitments({
      user_address: address,
      commitments: migrationPayload,
      apply_policy_preset: true,
    })
      .then(async (result) => {
        const inferred = result.inferred_preset;
        if (inferred && inferred !== policy.privacy_policy?.preset) {
          const next = await putVaultPolicy(address, {
            privacy_policy: {
              ...policy.privacy_policy,
              preset: inferred,
            },
          });
          setPolicy(next);
        }
      })
      .catch(() => {
        // non-fatal migration
      })
      .finally(() => {
        setMigratedAddress(address);
      });
  }, [address, migratedAddress, policy]);

  return {
    policy,
    loading,
    saving,
    error,
    refresh,
    savePatch,
  };
}
