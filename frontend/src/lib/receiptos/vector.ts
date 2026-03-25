/**
 * Reputation vector builder for the passport.
 *
 * Calls the existing zkdefi backend reputation scan endpoint and normalizes
 * the response into the six ReceiptOS signals:
 *   wallet_age_days, account_type, transaction_count,
 *   protocol_categories, liquidation_count, bridge_inflow
 */

import { apiFetch } from "@/lib/api/client";
import type { ReputationVector, SignalEntry } from "./types";

export async function fetchVector(walletAddress: string): Promise<ReputationVector> {
  const raw = await apiFetch<Record<string, unknown>>(
    `/api/v1/zkdefi/reputation/scan/${walletAddress}`,
    { method: "POST", timeoutMs: 30_000 }
  );
  return normalize(walletAddress, raw);
}

function normalize(
  walletAddress: string,
  raw: Record<string, unknown>
): ReputationVector {
  const nonce = Number(raw.nonce ?? 0);
  const accountType = String(raw.account_type ?? "");
  const signals = Array.isArray(raw.signals) ? raw.signals : [];

  const entries: SignalEntry[] = [
    {
      key: "wallet_age_days",
      label: "Wallet Age",
      value: findSignalValue(signals, "wallet_age_days"),
      unit: "days",
    },
    {
      key: "account_type",
      label: "Account Type",
      value: accountType ? 1 : null,
      unit: accountType || "unknown",
    },
    {
      key: "transaction_count",
      label: "Transactions",
      value: nonce > 0 ? nonce : null,
      unit: "txns",
    },
    {
      key: "protocol_categories",
      label: "Protocols Used",
      value: raw.protocol_count != null ? Number(raw.protocol_count) : null,
      unit: "protocols",
    },
    {
      key: "liquidation_count",
      label: "Liquidations",
      value: findSignalValue(signals, "liquidation_count"),
      unit: "events",
    },
    {
      key: "bridge_inflow",
      label: "Bridge Inflow",
      value: findSignalValue(signals, "bridge_inflow"),
      unit: "ETH",
    },
  ];

  return {
    wallet_address: walletAddress,
    scanned_at: new Date().toISOString(),
    signals: entries,
  };
}

function findSignalValue(
  signals: Array<Record<string, unknown>>,
  key: string
): number | null {
  const match = signals.find(
    (s) => s.signal === key || s.label === key || s.category === key
  );
  if (!match) return null;
  const v = Number(match.value);
  return Number.isFinite(v) ? v : null;
}
