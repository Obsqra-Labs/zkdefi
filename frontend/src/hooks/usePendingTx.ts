"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Types ──────────────────────────────────────────────────────────── */

export type TxStatus = "pending" | "confirmed" | "failed";

export interface PendingTxEntry {
  hash: string;
  label: string;
  status: TxStatus;
  submittedAt: number;
  resolvedAt?: number;
}

/* ── Module-level store ─────────────────────────────────────────────── */

const POLL_MS = 8_000;
const TX_EVENT = "zkdefi:pending-tx";
const store = new Map<string, PendingTxEntry>();

function emit() {
  window.dispatchEvent(new CustomEvent(TX_EVENT));
}

/**
 * Register a transaction hash as pending.
 * Can be called from any code path (doesn't need to be inside a React component).
 */
export function trackTx(hash: string, label = "Transaction"): void {
  store.set(hash.toLowerCase(), {
    hash,
    label,
    status: "pending",
    submittedAt: Date.now(),
  });
  emit();
}

/* ── Polling helper (Starknet receipt check) ────────────────────────── */

async function checkReceipt(hash: string): Promise<TxStatus> {
  try {
    const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia";
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_getTransactionReceipt",
        params: [hash],
      }),
    });
    if (!res.ok) return "pending";
    const json = await res.json();
    const status = json?.result?.execution_status ?? json?.result?.finality_status;
    if (status === "SUCCEEDED" || status === "ACCEPTED_ON_L2" || status === "ACCEPTED_ON_L1") return "confirmed";
    if (status === "REVERTED" || status === "REJECTED") return "failed";
    return "pending";
  } catch {
    return "pending";
  }
}

/* ── React hook ─────────────────────────────────────────────────────── */

/**
 * Hook that returns the current list of tracked transactions and a `track` helper.
 * Automatically polls pending transactions via Starknet RPC for receipt status.
 */
export function usePendingTx() {
  const [entries, setEntries] = useState<PendingTxEntry[]>(() => Array.from(store.values()));
  const polling = useRef(false);

  // Sync from module store whenever a custom event fires.
  useEffect(() => {
    const sync = () => setEntries(Array.from(store.values()));
    window.addEventListener(TX_EVENT, sync);
    return () => window.removeEventListener(TX_EVENT, sync);
  }, []);

  // Poll pending hashes for confirmation.
  useEffect(() => {
    if (polling.current) return;
    polling.current = true;

    const tick = async () => {
      let changed = false;
      for (const [key, entry] of store) {
        if (entry.status !== "pending") continue;
        const status = await checkReceipt(entry.hash);
        if (status !== "pending") {
          store.set(key, { ...entry, status, resolvedAt: Date.now() });
          changed = true;
        }
      }
      if (changed) emit();
    };

    const iv = setInterval(() => void tick(), POLL_MS);
    void tick(); // run immediately
    return () => {
      clearInterval(iv);
      polling.current = false;
    };
  }, []);

  const track = useCallback((hash: string, label?: string) => trackTx(hash, label), []);

  const pending = entries.filter((e) => e.status === "pending");

  return { entries, pending, track };
}
