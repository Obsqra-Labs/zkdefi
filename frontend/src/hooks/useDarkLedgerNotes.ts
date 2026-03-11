"use client";

/**
 * useDarkLedgerNotes — shared hook for dark ledger note data.
 *
 * Resolution: prefers useVaultV2 notes, falls back to /ledger/notes/{address}.
 */

import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api/client";
import type { UseVaultV2Return } from "@/hooks/useVaultV2";

export interface DarkNote {
  note_hash: string;
  amount_wei: string;
  token: string;
  rail_type: string;
}

export interface DarkLedgerState {
  note_count: number;
  sweep_available_usd: number;
  l3_block: number;
  notes: DarkNote[];
  loading: boolean;
}

export function useDarkLedgerNotes(
  address: string | undefined,
  v2?: UseVaultV2Return,
): DarkLedgerState {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<Omit<DarkLedgerState, "loading">>({
    note_count: 0,
    sweep_available_usd: 0,
    l3_block: 0,
    notes: [],
  });

  // Prefer V2 hook data if available
  const fromV2 = useMemo(() => {
    if (!v2 || v2.loading) return null;
    if (v2.notes.length === 0) return null;
    return {
      note_count: v2.notes.length,
      sweep_available_usd: 0,
      l3_block: 0,
      notes: v2.notes.map((n: any) => ({
        note_hash: n.note_id || n.note_hash || "",
        amount_wei: n.amount_wei || "0",
        token: n.token || "STRK",
        rail_type: n.rail_type || "unknown",
      })),
    };
  }, [v2]);

  useEffect(() => {
    if (fromV2) {
      setState(fromV2);
      setLoading(false);
      return;
    }
    if (!address) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<any>(`/api/v1/zkdefi/ledger/notes/${address}`)
      .then((res) => {
        if (cancelled) return;
        const notes = (res?.notes ?? []).map((n: any) => ({
          note_hash: n.note_hash || "",
          amount_wei: n.amount_wei || "0",
          token: n.token || "STRK",
          rail_type: n.rail_type || "unknown",
        }));
        setState({
          note_count: res?.note_count ?? notes.length,
          sweep_available_usd: res?.sweep_available_usd ?? 0,
          l3_block: res?.l3_block ?? 0,
          notes,
        });
      })
      .catch(() => {
        /* keep defaults */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, fromV2]);

  return useMemo(
    () => ({ ...state, loading }),
    [state, loading],
  );
}
