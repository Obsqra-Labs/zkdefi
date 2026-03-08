"use client";

import { useEffect, useState } from "react";

import { apiUrl } from "@/lib/api/client";

export interface AggregatedReceipt {
  proof_type?: string;
  action?: string;
  result?: string;
  timestamp: string;
  onChainHash?: string;
}

interface ReceiptAggregatorState {
  receipts: AggregatedReceipt[];
  loading: boolean;
}

export function useReceiptAggregator(address?: string, refreshKey = 0): ReceiptAggregatorState {
  const [receipts, setReceipts] = useState<AggregatedReceipt[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setReceipts([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          apiUrl(`/api/v1/zkdefi/risk_passport/user/${address}`),
          { signal: AbortSignal.timeout(8000) },
        );

        if (!response.ok) {
          throw new Error(`receipt request failed (${response.status})`);
        }

        const payload = await response.json();
        const proofReceipts = Array.isArray(payload?.proof_receipts)
          ? payload.proof_receipts
          : [];

        const normalized = proofReceipts
          .filter((item: unknown) => item && typeof item === "object")
          .map((item: Record<string, unknown>) => ({
            proof_type: typeof item.proof_type === "string" ? item.proof_type : undefined,
            action: typeof item.action_type === "string" ? item.action_type : undefined,
            result: typeof item.result === "string" ? item.result : undefined,
            timestamp:
              typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
            onChainHash: typeof item.tx_hash === "string" ? item.tx_hash : undefined,
          }));

        if (!cancelled) {
          setReceipts(normalized);
        }
      } catch {
        if (!cancelled) {
          setReceipts([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

  return { receipts, loading };
}
