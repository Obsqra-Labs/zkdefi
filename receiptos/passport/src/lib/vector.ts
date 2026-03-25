/**
 * Reputation vector builder — isolated from the main indexer.
 *
 * The passport app calls the existing zkdefi backend API to get the raw
 * reputation data, then normalizes it into the six ReceiptOS signals.
 *
 * Signals (from spec v0.1):
 *   wallet_age_days, account_type, transaction_count,
 *   protocol_categories, liquidation_count, bridge_inflow
 */

import type { ReputationVector, SignalEntry } from "./types";

const ZKDEFI_API =
  process.env.NEXT_PUBLIC_ZKDEFI_API_URL ?? "http://localhost:8003";

export async function fetchVector(walletAddress: string): Promise<ReputationVector> {
  const url = `${ZKDEFI_API}/api/v1/zkdefi/reputation/scan/${walletAddress}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Reputation scan failed: ${res.status}`);
  }

  const data = await res.json();
  return normalize(walletAddress, data);
}

function normalize(walletAddress: string, raw: Record<string, unknown>): ReputationVector {
  const nonce = Number(raw.nonce ?? 0);
  const accountType = String(raw.account_type ?? "");
  const signals = Array.isArray(raw.signals) ? raw.signals : [];

  const walletAgeDays = findSignalValue(signals, "wallet_age_days");
  const transactionCount = nonce > 0 ? nonce : null;
  const protocolCount = raw.protocol_count != null ? Number(raw.protocol_count) : null;
  const liquidationCount = findSignalValue(signals, "liquidation_count");
  const bridgeInflow = findSignalValue(signals, "bridge_inflow");

  const entries: SignalEntry[] = [
    {
      key: "wallet_age_days",
      label: "Wallet Age",
      value: walletAgeDays,
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
      value: transactionCount,
      unit: "txns",
    },
    {
      key: "protocol_categories",
      label: "Protocols Used",
      value: protocolCount,
      unit: "protocols",
    },
    {
      key: "liquidation_count",
      label: "Liquidations",
      value: liquidationCount,
      unit: "events",
    },
    {
      key: "bridge_inflow",
      label: "Bridge Inflow",
      value: bridgeInflow,
      unit: "ETH",
    },
  ];

  return {
    wallet_address: walletAddress,
    scanned_at: new Date().toISOString(),
    signals: entries,
  };
}

function findSignalValue(signals: Array<Record<string, unknown>>, key: string): number | null {
  const match = signals.find(
    (s) => s.signal === key || s.label === key || s.category === key
  );
  if (!match) return null;
  const v = Number(match.value);
  return Number.isFinite(v) ? v : null;
}
