"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FileText, ExternalLink } from "lucide-react";
import type { LedgerEntry } from "@/contexts/VaultStore";
import type { LedgerAccountResponse, TransferDestinationMode } from "@/lib/api/ledger";
import { toastError, toastSuccess } from "@/lib/toast";
import { ExplorerLink } from "@/components/zkdefi/ExplorerLink";
import { txExplorerLinks } from "@/lib/explorer";

function formatTime(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function weiToShort(wei: string, decimals: number = 18): string {
  try {
    const scale = 10 ** Math.max(0, decimals);
    const n = Number(BigInt(wei)) / scale;
    if (n >= 1) return n.toFixed(2);
    if (n >= 0.01) return n.toFixed(4);
    return n.toFixed(6);
  } catch {
    return wei;
  }
}

function decimalToWei(raw: string, decimals: number): string {
  const cleaned = (raw || "").trim();
  if (!cleaned) throw new Error("Enter an amount.");
  if (!/^\d*\.?\d*$/.test(cleaned)) throw new Error("Amount must be numeric.");
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw.length ? wholeRaw : "0";
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");
  const normalized = `${whole}${frac}`.replace(/^0+/, "") || "0";
  if (normalized === "0") throw new Error("Amount must be greater than zero.");
  return normalized;
}

function assetDecimals(asset: string): number {
  if (asset === "STRK") return 18;
  if (asset === "zkdETH") return 18;
  if (asset === "zkdAI") return 18;
  return 18;
}

function reasonToAction(reason: string | null, direction: string): string {
  if (reason) {
    const r = reason.toLowerCase();
    if (r.includes("deposit") || r === "credit") return "Deposit";
    if (r.includes("withdraw") || r === "debit") return "Withdraw";
    if (r.includes("rebalance")) return "Rebalance";
    if (r.includes("harvest")) return "Harvest";
    if (r.includes("allocation") || r.includes("deploy")) return "Allocation";
    if (r.includes("rotation")) return "Pool rotation";
    return reason.replace(/_/g, " ");
  }
  return direction === "credit" ? "Credit" : "Debit";
}

interface VaultLedgerProps {
  entries: LedgerEntry[];
  account?: LedgerAccountResponse | null;
  loading?: boolean;
  transferOutPending?: boolean;
  transferInPending?: boolean;
  onRequestTransferOut?: (params: {
    amountWei: string;
    asset: string;
    capitalSource?: "wallet_mode" | "private_capital";
    destinationMode: TransferDestinationMode;
    recipient?: string;
  }) => Promise<{ message?: string }>;
  onRequestTransferIn?: (params: {
    txHash: string;
    asset: string;
    capitalSource?: "wallet_mode" | "private_capital";
  }) => Promise<{ message?: string; tx_hash?: string }>;
  onViewProof?: (entry: LedgerEntry) => void;
}

const TRACKED_LEDGER_ASSETS = ["STRK", "zkdETH", "zkdAI"] as const;

export function VaultLedger({
  entries,
  account = null,
  loading = false,
  transferOutPending = false,
  transferInPending = false,
  onRequestTransferOut,
  onRequestTransferIn,
  onViewProof,
}: VaultLedgerProps) {
  const [inTxHash, setInTxHash] = useState("");
  const [inAsset, setInAsset] = useState("STRK");
  const [inCapitalSource, setInCapitalSource] = useState<"wallet_mode" | "private_capital">("wallet_mode");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("STRK");
  const [outCapitalSource, setOutCapitalSource] = useState<"wallet_mode" | "private_capital">("private_capital");
  const [destinationMode, setDestinationMode] = useState<TransferDestinationMode>("shielded");
  const [recipient, setRecipient] = useState("");

  const accountAssets = useMemo(
    () => (account?.assets && Array.isArray(account.assets) ? account.assets : []),
    [account?.assets],
  );

  const derivedAssets = useMemo(() => {
    const balances = new Map<string, bigint>();
    for (const entry of entries) {
      const symbol = String(entry.asset || "STRK");
      const raw = String(entry.amount_wei || "0");
      const parsed = raw.startsWith("0x") ? BigInt(raw) : BigInt(raw || "0");
      const signed = entry.direction === "debit" ? -parsed : parsed;
      balances.set(symbol, (balances.get(symbol) ?? BigInt(0)) + signed);
    }
    return Array.from(balances.entries())
      .map(([symbol, value]) => ({
        asset: symbol,
        available_wei: value < BigInt(0) ? "0" : value.toString(),
        pending_out_wei: "0",
        deployed_wei: "0",
      }))
      .sort((a, b) => a.asset.localeCompare(b.asset));
  }, [entries]);

  const displayAssets = useMemo(() => {
    if (accountAssets.length > 0) return accountAssets;
    if (derivedAssets.length > 0) return derivedAssets;
    return TRACKED_LEDGER_ASSETS.map((symbol) => ({
      asset: symbol,
      available_wei: "0",
      pending_out_wei: "0",
      deployed_wei: "0",
    }));
  }, [accountAssets, derivedAssets]);

  const showingDerivedBalances = accountAssets.length === 0 && derivedAssets.length > 0;
  const showingZeroBaseline = accountAssets.length === 0 && derivedAssets.length === 0;

  const canSubmitTransferOut = Boolean(onRequestTransferOut) && !transferOutPending;
  const canSubmitTransferIn = Boolean(onRequestTransferIn) && !transferInPending;

  useEffect(() => {
    if (asset !== "STRK" && destinationMode === "shielded") {
      setDestinationMode("wallet");
    }
  }, [asset, destinationMode]);

  const handleTransferIn = async () => {
    if (!onRequestTransferIn) return;
    try {
      if (!inTxHash.trim()) throw new Error("Enter a transfer tx hash.");
      const response = await onRequestTransferIn({
        txHash: inTxHash.trim(),
        asset: inAsset,
        capitalSource: inCapitalSource,
      });
      const txHash = typeof response?.tx_hash === "string" ? response.tx_hash.trim() : "";
      if (txHash) {
        const explorer = txExplorerLinks(txHash)[0];
        toastSuccess(response?.message || "Transfer in credited.", {
          action: explorer
            ? {
                label: "View on explorer",
                onClick: () => window.open(explorer.url, "_blank", "noopener,noreferrer"),
              }
            : undefined,
        });
      } else {
        toastSuccess(response?.message || "Transfer in credited.");
      }
      setInTxHash("");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Transfer in failed.");
    }
  };

  const handleTransferOut = async () => {
    if (!onRequestTransferOut) return;
    try {
      const wei = decimalToWei(amount, assetDecimals(asset));
      const recipientValue = destinationMode === "wallet" ? recipient.trim() : undefined;
      const response = await onRequestTransferOut({
        amountWei: wei,
        asset,
        capitalSource: outCapitalSource,
        destinationMode,
        recipient: recipientValue || undefined,
      });
      toastSuccess(response?.message || "Transfer out queued.");
      setAmount("");
      if (destinationMode === "wallet") setRecipient("");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Transfer out failed.");
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h3 className="font-semibold text-zinc-200 flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-emerald-400" />
          Ledger
        </h3>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h3 className="font-semibold text-zinc-200 flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-emerald-400" />
        Ledger
      </h3>
      <p className="text-xs text-zinc-500 mb-4">Every action shows what happened and why. Proof status when available.</p>
      <p className="text-[11px] text-zinc-500 mb-3">
        Internal ledger balances are tracked inside zkde.fi and are separate from direct wallet balances.
        {showingDerivedBalances ? " Showing estimated balances from recent ledger activity while account snapshot sync catches up." : ""}
        {showingZeroBaseline ? " No prior ledger activity found yet, so all tracked assets start at 0." : ""}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {displayAssets.map((item) => (
          <div key={item.asset} className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3">
            <p className="text-xs text-zinc-500">{item.asset}</p>
            <p className="text-base font-semibold text-zinc-100">{weiToShort(item.available_wei)} {item.asset}</p>
            <p className="text-[11px] text-zinc-500">Pending out: {weiToShort(item.pending_out_wei)} {item.asset}</p>
          </div>
        ))}
      </div>

      {(onRequestTransferIn || onRequestTransferOut) && (
        <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3 mb-4 space-y-3">
          {onRequestTransferIn && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-200">Transfer In</p>
                <span className="text-[11px] text-zinc-500">wallet -&gt; vault -&gt; ledger</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input
                  value={inTxHash}
                  onChange={(e) => setInTxHash(e.target.value)}
                  placeholder="Transfer tx hash"
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                />
                <select
                  value={inAsset}
                  onChange={(e) => setInAsset(e.target.value)}
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="STRK">STRK</option>
                  <option value="zkdETH">zkdETH</option>
                  <option value="zkdAI">zkdAI</option>
                </select>
                <select
                  value={inCapitalSource}
                  onChange={(e) => setInCapitalSource(e.target.value as "wallet_mode" | "private_capital")}
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="wallet_mode">Wallet mode</option>
                  <option value="private_capital">Private capital</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleTransferIn()}
                  disabled={!canSubmitTransferIn}
                  className="rounded border border-cyan-600/40 bg-cyan-600/15 px-3 py-2 text-sm text-cyan-300 hover:bg-cyan-600/25 disabled:opacity-50"
                >
                  {transferInPending ? "Verifying..." : "Verify & Credit"}
                </button>
              </div>
            </div>
          )}

          {onRequestTransferOut && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-200">Transfer Out</p>
                <span className="text-[11px] text-zinc-500">Default rail: shielded (wallet optional)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount"
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                />
                <select
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="STRK">STRK</option>
                  <option value="zkdETH">zkdETH</option>
                  <option value="zkdAI">zkdAI</option>
                </select>
                <select
                  value={outCapitalSource}
                  onChange={(e) => setOutCapitalSource(e.target.value as "wallet_mode" | "private_capital")}
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="private_capital">Private capital</option>
                  <option value="wallet_mode">Wallet mode</option>
                </select>
                <select
                  value={destinationMode}
                  onChange={(e) => setDestinationMode(e.target.value as TransferDestinationMode)}
                  className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="shielded" disabled={asset !== "STRK"}>Shielded</option>
                  <option value="wallet">Wallet</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleTransferOut()}
                  disabled={!canSubmitTransferOut}
                  className="rounded border border-emerald-600/40 bg-emerald-600/15 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-600/25 disabled:opacity-50"
                >
                  {transferOutPending ? "Queueing..." : "Queue Transfer"}
                </button>
              </div>
              {destinationMode === "wallet" && (
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Recipient wallet (optional)"
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                />
              )}
              <p className="text-[11px] text-zinc-500">
                Shielded is currently available for STRK. Non-STRK assets auto-route to wallet mode.
              </p>
            </div>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 text-sm">
          No ledger entries yet. Deposit to the vault or run an allocation to see activity.
        </div>
      ) : (
        <ul className="space-y-2 max-h-[400px] overflow-y-auto">
          {entries.map((entry) => {
            const isCredit = entry.direction === "credit";
            const action = reasonToAction(entry.reason, entry.direction);
            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 rounded-lg bg-zinc-800/40 border border-zinc-700/50 text-sm"
              >
                <span className="text-zinc-500 shrink-0 w-16">{formatTime(entry.created_at)}</span>
                <span className="font-medium text-zinc-200 shrink-0 capitalize">{action}</span>
                <span className={isCredit ? "text-emerald-400" : "text-amber-400"}>
                  {isCredit ? "+" : "−"}{weiToShort(entry.amount_wei, assetDecimals(entry.asset || "STRK"))} {entry.asset || "STRK"}
                </span>
                {entry.reason && (
                  <span className="text-zinc-500 truncate max-w-[180px]" title={entry.reason}>
                    {entry.reason.replace(/_/g, " ")}
                  </span>
                )}
                {typeof entry.capital_source === "string" && entry.capital_source.trim() && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300">
                    {entry.capital_source.replace(/_/g, " ")}
                  </span>
                )}
                {entry.tx_hash ? (
                  <ExplorerLink
                    type="tx"
                    txHash={entry.tx_hash}
                    className="text-zinc-300 font-mono text-xs truncate max-w-[160px]"
                  >
                    {entry.tx_hash.slice(0, 8)}…{entry.tx_hash.slice(-4)}
                  </ExplorerLink>
                ) : entry.proof_status === "verified" ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Proof verified
                  </span>
                ) : entry.proof_status === "pending" ? (
                  <span className="inline-flex items-center gap-1 text-amber-400 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    Proof pending
                  </span>
                ) : entry.proof_hash ? (
                  <span className="text-zinc-400 text-xs font-mono truncate max-w-[120px]" title={entry.proof_hash}>
                    {entry.proof_hash.slice(0, 10)}…
                  </span>
                ) : (
                  <span className="text-zinc-600 text-xs shrink-0">No proof</span>
                )}
                {onViewProof && (
                  <button
                    type="button"
                    onClick={() => onViewProof(entry)}
                    className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    View proof <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
