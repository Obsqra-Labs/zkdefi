"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { Shield, Eye, Lock, ArrowRight, ExternalLink, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/lib/AppContext";
import { ActivityEvent, PoolSource } from "@/lib/AppContext";
import { useHistoryTimeline } from "@/hooks/useHistoryTimeline";
import { sepoliaTxExplorerLinks } from "@/lib/explorer";
import { TransactionDebugDrawer } from "@/components/zkdefi/TransactionDebugDrawer";

interface ActivityLogProps {
  title?: string;
  /** Lock to a single pool -- hides pool filter row */
  poolFilter?: PoolSource;
  /** Limit displayed events (useful for compact embeds) */
  maxItems?: number;
  /** Hide filter bars and use tighter spacing */
  compact?: boolean;
  /** Callback when user clicks "View all" in compact mode */
  onViewAll?: () => void;
}

type ActionFilter = "all" | "deposits" | "withdrawals" | "proofs";
type PoolFilter = "all" | PoolSource;

const POOL_LABELS: Record<PoolSource, string> = {
  full_privacy: "Vault (Full privacy)",
  shielded: "Vault (Shielded)",
  pool_c: "Vault (Full privacy)",
  pool_d: "Vault (Hashed claims)",
  stealth: "Stealth",
  compliance: "Compliance",
  system: "Shared pool",
  ekubo: "Ekubo",
  dark_ledger: "Dark Ledger",
};

const POOL_COLORS: Record<PoolSource, string> = {
  full_privacy: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  shielded: "bg-violet-500/15 text-violet-400 border-violet-500/25",
  pool_c: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  pool_d: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/25",
  stealth: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
  compliance: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  system: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
  ekubo: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  dark_ledger: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
};

export function ActivityLog({ title = "Activity Feed", poolFilter: lockedPool, maxItems, compact, onViewAll }: ActivityLogProps = {}) {
  const { address, isConnected } = useAccount();
  const { activityFeed, syncActivityForAddress, invalidateKey } = useApp();
  const timeline = useHistoryTimeline(isConnected ? address : undefined, invalidateKey);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [debugExpandedId, setDebugExpandedId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [poolFilterState, setPoolFilterState] = useState<PoolFilter>("all");

  // If parent locked the pool, use that
  const activePool = lockedPool || poolFilterState;

  // Sync persisted activity when wallet address changes
  useEffect(() => {
    syncActivityForAddress(isConnected ? address : undefined);
  }, [isConnected, address, syncActivityForAddress]);

  const backendFeed = useMemo<ActivityEvent[]>(() => {
    return (timeline.events || []).map((row) => {
      const ts = row.timestamp ? new Date(row.timestamp) : new Date();
      const type: ActivityEvent["type"] =
        row.type === "shared_pool_execution" || row.type === "shared_pool_proposal"
          ? "rebalance"
          : row.type.includes("policy")
            ? "proof"
            : row.type.includes("privacy")
              ? "private"
              : row.type.includes("swap") || row.type === "trade"
                ? "trade"
                : row.type.includes("lp")
                  ? "lp"
                  : row.type.includes("deposit")
                    ? "deposit"
                    : row.type.includes("withdraw")
                      ? "withdraw"
                      : "proof";

      return {
        id: row.id,
        type,
        pool: row.venue?.toLowerCase().includes("ekubo") ? "ekubo" : "system",
        text: row.title,
        txHash: row.tx_hash ?? undefined,
        status: row.status === "info" ? "pending" : row.status,
        details: row.details ?? undefined,
        time: Number.isFinite(ts.getTime()) ? ts : new Date(),
      };
    });
  }, [timeline.events]);

  const mergedFeed = useMemo(() => {
    const backendById = new Set<string>();
    const backendByTx = new Set<string>();
    for (const row of backendFeed) {
      backendById.add(row.id);
      if (row.txHash) backendByTx.add(row.txHash.toLowerCase());
    }

    const optimistic = activityFeed.filter((row) => {
      if (backendById.has(row.id)) return false;
      if (row.txHash && backendByTx.has(row.txHash.toLowerCase())) return false;
      return true;
    });

    return [...optimistic, ...backendFeed].sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [activityFeed, backendFeed]);

  // Derive which pools have events (for showing pool filter tabs)
  const activePools = Array.from(new Set(mergedFeed.map((e) => e.pool).filter(Boolean))) as PoolSource[];

  const filteredFeed = mergedFeed.filter((e) => {
    // Pool filter
    if (activePool !== "all" && e.pool !== activePool) return false;
    // Action filter
    if (actionFilter === "all") return true;
    if (actionFilter === "deposits") return e.type === "deposit";
    if (actionFilter === "withdrawals") return e.type === "withdraw";
    if (actionFilter === "proofs") return e.type === "proof" || e.type === "disclosure" || e.type === "private";
    return true;
  });

  const getActionLabel = (type: ActivityEvent["type"]): string => {
    switch (type) {
      case "deposit": return "Deposit";
      case "withdraw": return "Withdraw";
      case "trade": return "Swap";
      case "lp": return "LP";
      case "rebalance": return "Allocation";
      case "proof": return "Proof";
      case "private": return "Private";
      case "disclosure": return "Disclosure";
      default: return "Event";
    }
  };

  const getEventIcon = (type: ActivityEvent["type"]) => {
    switch (type) {
      case "deposit":
        return <ArrowDownToLine className="w-4 h-4 text-proof-valid" />;
      case "withdraw":
        return <ArrowUpFromLine className="w-4 h-4 text-amber-400" />;
      case "trade":
        return <ArrowRight className="w-4 h-4 text-emerald-400" />;
      case "lp":
        return <Shield className="w-4 h-4 text-emerald-300" />;
      case "proof":
        return <Shield className="w-4 h-4 text-proof-generating" />;
      case "private":
        return <Lock className="w-4 h-4 text-privacy-shielded" />;
      case "disclosure":
        return <Eye className="w-4 h-4 text-cyan-400" />;
      default:
        return <ArrowRight className="w-4 h-4 text-zinc-400" />;
    }
  };

  const getEventColor = (type: ActivityEvent["type"]) => {
    switch (type) {
      case "deposit":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "withdraw":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "trade":
        return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
      case "lp":
        return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
      case "proof":
        return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
      case "private":
        return "bg-violet-500/10 text-violet-400 border-violet-500/20";
      case "disclosure":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      default:
        return "bg-zinc-700 text-zinc-400 border-zinc-600";
    }
  };

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (!isConnected) {
    return (
      <div className="glass rounded-2xl border border-zinc-800 p-8">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>
        <div className="text-center py-12">
          <p className="text-zinc-400 mb-2">Connect wallet to see your activity</p>
          <p className="text-sm text-zinc-500">
            Deposits, proofs, and private transfers will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        {mergedFeed.length > 0 && (
          <span className="text-xs text-zinc-500">{mergedFeed.length} events</span>
        )}
      </div>
      {timeline.error && (
        <div className="mb-3 rounded-lg border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          History sync warning: {timeline.error}
        </div>
      )}

      {/* Pool filter row (only if multiple pools have events and not locked) */}
      {!compact && !lockedPool && activePools.length > 1 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <button
            onClick={() => setPoolFilterState("all")}
            className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
              poolFilterState === "all"
                ? "bg-zinc-700 text-white border-zinc-600"
                : "bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 border-zinc-700"
            }`}
          >
            All
          </button>
          {activePools.map((p) => (
            <button
              key={p}
              onClick={() => setPoolFilterState(p)}
              className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                poolFilterState === p
                  ? POOL_COLORS[p]
                  : "bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 border-zinc-700"
              }`}
            >
              {POOL_LABELS[p]}
            </button>
          ))}
        </div>
      )}

      {/* Action filter row */}
      {!compact && mergedFeed.length > 0 && (
        <div className="flex gap-2 mb-4">
          {(["all", "deposits", "withdrawals", "proofs"] as ActionFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setActionFilter(f)}
              className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                actionFilter === f
                  ? "bg-zinc-700 text-white border-zinc-600"
                  : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border-zinc-700"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <AnimatePresence>
          {filteredFeed.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <p className="text-zinc-400 mb-2">
                {mergedFeed.length === 0 ? "No activity yet" : "No matching activity"}
              </p>
              <p className="text-sm text-zinc-500">
                {mergedFeed.length === 0
                  ? "Your deposits, withdrawals, and proofs will appear here"
                  : "Try a different filter"}
              </p>
            </motion.div>
          ) : (
            filteredFeed.slice(0, maxItems ?? Infinity).map((event: ActivityEvent) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="glass rounded-lg border border-zinc-700 p-4 hover:border-zinc-600 transition-colors cursor-pointer"
                onClick={() => {
                  const nextExpanded = expandedId === event.id ? null : event.id;
                  setExpandedId(nextExpanded);
                  if (nextExpanded !== event.id) setDebugExpandedId(null);
                }}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg border ${getEventColor(event.type)}`}>
                    {getEventIcon(event.type)}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* Row 1: title + time */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className={`px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide rounded border shrink-0 ${getEventColor(event.type)}`}>
                          {getActionLabel(event.type)}
                        </span>
                        <p className="text-sm text-zinc-200 truncate">{event.text}</p>
                      </div>
                      <span className="text-xs text-zinc-500 shrink-0">
                        {formatTimeAgo(event.time)}
                      </span>
                    </div>
                    {/* Row 2: pool · receipt ID · status */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {event.pool && (
                        <span className={`px-1.5 py-0.5 text-[10px] rounded border ${POOL_COLORS[event.pool]}`}>
                          {POOL_LABELS[event.pool]}
                        </span>
                      )}
                      {event.txHash && (
                        <span className="text-[10px] text-zinc-500 font-mono">
                          #{event.txHash.slice(2, 10)}
                        </span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        event.status === "confirmed"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : event.status === "pending"
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                      }`}>
                        {event.status === "confirmed" ? "Finalized" : event.status === "pending" ? "Pending" : String(event.status)}
                      </span>
                    </div>
                    {expandedId === event.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 pt-3 border-t border-zinc-700 space-y-2"
                      >
                        {event.txHash && (
                          <div className="text-[11px] space-y-1.5 bg-zinc-900/60 rounded-lg p-3 border border-zinc-700/50">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-zinc-500 shrink-0">Receipt</span>
                              <span className="font-mono text-zinc-300 break-all text-right">{event.txHash}</span>
                            </div>
                          </div>
                        )}
                        {event.details && (() => {
                          const str = String(event.details);
                          const proofMatch = str.match(/proof[\s_-]?hash[:\s]+([0-9a-fx]+)/i);
                          const gateMatch = str.match(/gate[\s_-]?proof[\s_-]?id[:\s]+([^\s,;]+)/i);
                          const policyMatch = str.match(/policy[\s_-]?version[:\s]+([^\s,;]+)/i);
                          const structured: [string, string][] = [];
                          if (proofMatch) structured.push(["Proof Hash", proofMatch[1]]);
                          if (gateMatch) structured.push(["Gate Proof ID", gateMatch[1]]);
                          if (policyMatch) structured.push(["Policy Version", policyMatch[1]]);
                          if (structured.length > 0) return (
                            <div className="text-[11px] space-y-1.5 bg-zinc-900/60 rounded-lg p-3 border border-zinc-700/50">
                              {structured.map(([k, v]) => (
                                <div key={k} className="flex items-start justify-between gap-2">
                                  <span className="text-zinc-500 shrink-0">{k}</span>
                                  <span className="font-mono text-zinc-300 break-all text-right">{v}</span>
                                </div>
                              ))}
                            </div>
                          );
                          return <p className="text-xs text-zinc-400 whitespace-pre-wrap break-words">{str}</p>;
                        })()}
                        <div className="flex flex-wrap items-center gap-2">
                          {event.txHash &&
                            sepoliaTxExplorerLinks(event.txHash).map((link) => (
                              <a
                                key={`${event.id}-${link.label}`}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
                                onClick={(e) => e.stopPropagation()}
                              >
                                View on {link.label}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ))}
                          {(event.details || event.txHash) && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 text-xs text-zinc-300 hover:text-zinc-100 border border-zinc-700 rounded px-2 py-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDebugExpandedId((prev) => (prev === event.id ? null : event.id));
                              }}
                            >
                              {debugExpandedId === event.id ? "Hide debug" : "Debug details"}
                            </button>
                          )}
                        </div>
                        {debugExpandedId === event.id && <TransactionDebugDrawer event={event} />}
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Compact footer */}
      {compact && maxItems && filteredFeed.length > maxItems && (
        <button
          type="button"
          onClick={() => onViewAll?.()}
          className="mt-3 w-full text-center text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          View all activity →
        </button>
      )}
    </div>
  );
}

// Helper function to add activity events (can be called from other components)
export function addActivityEvent(
  setActivityFeed: React.Dispatch<React.SetStateAction<ActivityEvent[]>>,
  event: Omit<ActivityEvent, "id" | "time">
) {
  setActivityFeed((prev: ActivityEvent[]) => [
    {
      ...event,
      id: Math.random().toString(36).substring(2, 9),
      time: new Date(),
    },
    ...prev,
  ].slice(0, 100)); // Keep last 100 events
}
