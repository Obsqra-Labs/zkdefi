"use client";

import { useState, useEffect } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Coins,
  Shield,
  ExternalLink,
} from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { useReceiptAggregator, type AggregatedReceipt } from "@/hooks/useReceiptAggregator";

interface ActivityEntry {
  type: string;
  description: string;
  message?: string;
  detail?: string;
  method?: string;
  timestamp: string;
  hashes?: { tx?: string; commitment?: string; nullifier?: string; proof?: string };
  asset?: string;
  amount?: string;
}

interface ActivityResponse {
  activity: ActivityEntry[];
}

type FilterType = "all" | "deposits" | "withdrawals" | "yields" | "rebalances" | "proofs";

const PROOF_KEYWORDS = ["proof", "groth16", "receipt", "attestation", "zkml"];

function inferCategory(entry: ActivityEntry): FilterType | null {
  const desc = (entry.description || "").toLowerCase();
  const t = (entry.type || "").toLowerCase();
  if (PROOF_KEYWORDS.some((kw) => t.includes(kw) || desc.includes(kw))) return "proofs";
  if (t === "rebalance" || t === "rebalance_committed" || t === "rebalance_executed") return "rebalances";
  if (t === "yield") return "yields";
  if (desc.includes("deposit")) return "deposits";
  if (desc.includes("withdraw") || t === "emergency_withdraw") return "withdrawals";
  return null;
}

function formatDate(timestamp: string): string {
  if (!timestamp) return "Unknown";
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return timestamp;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function formatTime(timestamp: string): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getEntryIcon(entry: ActivityEntry) {
  const cat = inferCategory(entry);
  switch (cat) {
    case "deposits":
      return <ArrowDownToLine className="w-4 h-4 text-emerald-400" />;
    case "withdrawals":
      return <ArrowUpFromLine className="w-4 h-4 text-amber-400" />;
    case "yields":
      return <Coins className="w-4 h-4 text-cyan-400" />;
    case "proofs":
      return <Shield className="w-4 h-4 text-indigo-400" />;
    case "rebalances":
      return <Shield className="w-4 h-4 text-violet-400" />;
    default:
      return <Coins className="w-4 h-4 text-zinc-400" />;
  }
}

function getSpecialEventStyles(entry: ActivityEntry): { borderColor: string; message: string; badges?: React.ReactNode; detail?: string } | null {
  switch (entry.type) {
    case "rebalance_committed":
      return {
        borderColor: "border-l-blue-500",
        message: entry.message || "Rebalance pending... protected from front-running",
        badges: (
          <span className="rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
            MEV Protected
          </span>
        ),
      };
    case "rebalance_executed":
      return {
        borderColor: "border-l-emerald-500",
        message: entry.message || "Rebalance executed. No trade intent was exposed.",
        detail: entry.detail,
        badges: (
          <div className="flex flex-wrap gap-1.5 mt-1.5 w-full">
            <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              Policy enforced
            </span>
            <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              Risk verified
            </span>
            <span className="rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
              MEV protected
            </span>
          </div>
        ),
      };
    case "emergency_withdraw":
      return {
        borderColor: "border-l-red-500",
        message: "Emergency: capital returning to vault",
      };
    default:
      return null;
  }
}

export function ActivityTab({ address }: { address?: string }) {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = () => setRefreshKey((k) => k + 1);

  const { receipts: aggregatedReceipts, loading: receiptsLoading } = useReceiptAggregator(address, refreshKey);

  useEffect(() => {
    if (!address) {
      setActivity([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/zkdefi/vault/activity/${address}?limit=100`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body?.detail === "string" ? body.detail : `Request failed (${res.status})`,
          );
        }
        const data: ActivityResponse = await res.json();
        if (!cancelled) setActivity(Array.isArray(data.activity) ? data.activity : []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load activity");
          setActivity([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [address, refreshKey]);

  const receiptEntries: ActivityEntry[] = aggregatedReceipts.map((r) => ({
    type: r.proof_type || "proof",
    description: r.action || r.proof_type || "Proof receipt",
    message: r.result ?? undefined,
    timestamp: r.timestamp,
    hashes: r.onChainHash ? { tx: r.onChainHash } : undefined,
    asset: undefined,
    amount: undefined,
  }));

  const merged = [...activity];
  for (const re of receiptEntries) {
    const txHash = re.hashes?.tx;
    if (txHash && merged.some((e) => e.hashes?.tx === txHash)) continue;
    merged.push(re);
  }
  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const filtered = merged.filter((entry) => {
    if (filter === "all") return true;
    const cat = inferCategory(entry);
    return cat === filter;
  });

  const byDate = filtered.reduce<Record<string, ActivityEntry[]>>((acc, entry) => {
    const key = formatDate(entry.timestamp);
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});

  const dateGroups = Object.entries(byDate);

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "deposits", label: "Deposits" },
    { key: "withdrawals", label: "Withdrawals" },
    { key: "yields", label: "Yields" },
    { key: "rebalances", label: "Rebalances" },
    { key: "proofs", label: "Proofs" },
  ];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 dark:bg-zinc-900/50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-zinc-200">Activity</h3>
        <button
          type="button"
          onClick={reload}
          disabled={loading || !address}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {filters.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              filter === key
                ? "bg-zinc-700 text-white border-zinc-600"
                : "bg-zinc-800/50 text-zinc-400 border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {error}
        </div>
      )}

      {(loading || receiptsLoading) && activity.length === 0 && aggregatedReceipts.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-500">
          Loading activity...
        </div>
      ) : !address ? (
        <div className="py-12 text-center text-sm text-zinc-500">
          Connect wallet or enter address to view activity
        </div>
      ) : dateGroups.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-zinc-400">
            {filter !== "all" && activity.length > 0
              ? `No ${filters.find((f) => f.key === filter)?.label?.toLowerCase() ?? "matching"} activity`
              : "No activity yet"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {filter !== "all" && activity.length > 0
              ? "Try a different filter or check back later."
              : "Actions you take will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {dateGroups.map(([dateLabel, entries]) => (
            <div key={dateLabel}>
              <div className="mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                {dateLabel}
              </div>
              <div className="space-y-2">
                {entries.map((entry, idx) => {
                  const special = getSpecialEventStyles(entry);
                  const borderClass = special ? `border-l-4 ${special.borderColor}` : "";
                  const displayMessage = special ? special.message : (entry.description || entry.type);
                  return (
                    <div
                      key={`${entry.timestamp}-${idx}-${entry.description}`}
                      className={`flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-800/30 p-3 hover:border-zinc-700 transition-colors ${borderClass}`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800">
                        {getEntryIcon(entry)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-zinc-200">
                            {displayMessage}
                          </span>
                          {!special && entry.method && (
                            <span className="rounded border border-zinc-600 bg-zinc-700/50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
                              {entry.method}
                            </span>
                          )}
                          {special?.badges && special.badges}
                        </div>
                        {special?.detail && (
                          <div className="mt-1 text-xs text-zinc-400">{special.detail}</div>
                        )}
                        <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                          <span>{formatTime(entry.timestamp)}</span>
                          {entry.amount && (
                            <span className="text-zinc-400">
                              {entry.amount} {entry.asset || "STRK"}
                            </span>
                          )}
                          {entry.hashes?.tx && (
                            <a
                              href={sepoliaVoyagerTxUrl(entry.hashes.tx)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                            >
                              View on Explorer
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
