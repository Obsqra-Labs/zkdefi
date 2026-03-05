"use client";

/**
 * useReceiptAggregator — dual-source receipt timeline with reconciliation.
 *
 * Merges on-chain receipt signals (session key events, selective disclosure
 * attestations, constraint receipt hashes) with backend-sourced timeline
 * entries. Each receipt gets a reconciliation status:
 *
 *   confirmed  — seen on both chain and backend
 *   pending    — backend only (chain confirmation not yet indexed)
 *   on-chain   — chain only (backend not yet aware)
 *   diverged   — both exist but data doesn't match
 *
 * This is the canonical receipt source for Vault ledger, ProofTimeline,
 * and Identity proof views after the refactor.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getHistoryTimeline } from "@/lib/api/state";
import { type HistoryTimelineEvent, type HistoryTimelineResponse } from "@/types/ekubo";
import { apiFetch } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReceiptReconciliationStatus =
  | "confirmed"    // on-chain + backend agree
  | "pending"      // backend only — waiting for chain confirmation
  | "on-chain"     // chain only — backend not yet indexed
  | "diverged";    // both exist but data differs

export interface AggregatedReceipt {
  /** Stable identifier (tx_hash or backend event id). */
  id: string;
  /** Proof / receipt type label. */
  proof_type: string;
  /** Action that produced this receipt. */
  action: string;
  /** ISO timestamp of first observation. */
  timestamp: string;
  /** Reconciliation status. */
  status: ReceiptReconciliationStatus;
  /** Backend timeline entry (if present). */
  backendEntry?: HistoryTimelineEvent;
  /** On-chain receipt hash or tx hash (if present). */
  onChainHash?: string;
  /** Chain id used for explorer routing (if present). */
  chainId?: string;
  /** On-chain fact hash for verifier (if present). */
  factHash?: string;
  /** Human-friendly result summary. */
  result?: string;
  /** Extra metadata from either source. */
  meta?: Record<string, unknown>;
}

function normalizeStatus(raw: string | undefined): "pending" | "confirmed" | "failed" | "info" | "" {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  if (["confirmed", "executed", "pass", "success", "ok", "on-chain"].includes(value)) return "confirmed";
  if (["pending", "queued", "proposed"].includes(value)) return "pending";
  if (["blocked", "failed", "error", "reject", "rejected"].includes(value)) return "failed";
  return "info";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReceiptAggregator(
  address: string | undefined,
  invalidateKey?: number,
) {
  const [backendEvents, setBackendEvents] = useState<HistoryTimelineEvent[]>([]);
  const [onChainReceipts, setOnChainReceipts] = useState<OnChainReceiptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Fetch backend timeline ----
  const fetchBackend = useCallback(async () => {
    if (!address) return;
    try {
      const resp = await getHistoryTimeline(address);
      setBackendEvents(resp?.events ?? []);
    } catch {
      // Non-fatal: on-chain source may still work.
    }
  }, [address]);

  // ---- Fetch on-chain receipts from indexer (endpoint may not exist yet) ----
  const fetchOnChain = useCallback(async () => {
    if (!address) return;
    try {
      const data = await apiFetch<{ receipts?: OnChainReceiptEntry[] }>(
        `/api/v1/zkdefi/receipts/on-chain/${address}`,
        undefined,
        { timeoutMs: 5_000, retries: 0 }, // short timeout, no retry — endpoint may be absent
      );
      setOnChainReceipts(data.receipts ?? []);
    } catch {
      // Non-fatal: on-chain indexer may not be deployed yet.
      setOnChainReceipts([]);
    }
  }, [address]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchBackend(), fetchOnChain()]);
    } catch (e) {
      setError("Failed to load receipt timeline.");
    } finally {
      setLoading(false);
    }
  }, [fetchBackend, fetchOnChain]);

  useEffect(() => {
    void refresh();
  }, [refresh, invalidateKey]);

  // ---- Reconciliation ----
  const receipts = useMemo<AggregatedReceipt[]>(() => {
    const byHash = new Map<string, { backend?: HistoryTimelineEvent; chain?: OnChainReceiptEntry }>();
    const visibleBackendEvents = backendEvents.filter((event) => event.type !== "local_commitment_migration");

    // Index backend events by tx_hash
    for (const ev of visibleBackendEvents) {
      const key = ev.tx_hash ?? ev.id ?? `be-${ev.timestamp}`;
      const existing = byHash.get(key) ?? {};
      existing.backend = ev;
      byHash.set(key, existing);
    }

    // Index on-chain receipts
    for (const r of onChainReceipts) {
      const key = r.tx_hash ?? `oc-${r.timestamp}`;
      const existing = byHash.get(key) ?? {};
      existing.chain = r;
      byHash.set(key, existing);
    }

    // Merge
    const merged: AggregatedReceipt[] = [];
    for (const [key, { backend, chain }] of byHash.entries()) {
      let status: ReceiptReconciliationStatus;
      if (backend && chain) {
        // Both exist — treat semantically equivalent terminal states as confirmed.
        const backendStatus = normalizeStatus(backend.status);
        const chainStatus = normalizeStatus(chain.result);
        const statusMatch =
          !backendStatus ||
          !chainStatus ||
          backendStatus === chainStatus ||
          (backendStatus === "info" && chainStatus === "confirmed");
        status = statusMatch ? "confirmed" : "diverged";
      } else if (backend && !chain) {
        // Backend-only receipts are not always pending; many are terminal bookkeeping events.
        const backendStatus = normalizeStatus(backend.status);
        status = backendStatus === "pending" ? "pending" : "confirmed";
      } else {
        status = "on-chain";
      }

      merged.push({
        id: key,
        proof_type: chain?.proof_type ?? backend?.type ?? "unknown",
        action: chain?.action ?? backend?.title ?? "unknown",
        timestamp: chain?.timestamp ?? backend?.timestamp ?? new Date().toISOString(),
        status,
        backendEntry: backend,
        onChainHash:
          chain?.tx_hash ??
          backend?.tx_hash ??
          (typeof backend?.meta?.tx_hash === "string" ? backend.meta.tx_hash : undefined),
        chainId:
          chain?.chain_id ??
          (typeof chain?.meta?.chain_id === "string" ? chain.meta.chain_id : undefined) ??
          (typeof backend?.meta?.chain_id === "string" ? backend.meta.chain_id : undefined),
        factHash: chain?.fact_hash,
        result: chain?.result ?? backend?.status,
        meta: {
          ...((backend?.meta as Record<string, unknown> | undefined) ?? {}),
          ...((chain?.meta as Record<string, unknown> | undefined) ?? {}),
        },
      });
    }

    // Sort newest-first
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return merged;
  }, [backendEvents, onChainReceipts]);

  return { receipts, loading, error, refresh };
}

// ---------------------------------------------------------------------------
// Internal types for on-chain receipt indexer response
// ---------------------------------------------------------------------------

interface OnChainReceiptEntry {
  tx_hash?: string;
  fact_hash?: string;
  proof_type?: string;
  action?: string;
  result?: string;
  timestamp?: string;
  chain_id?: string;
  meta?: Record<string, unknown>;
}
