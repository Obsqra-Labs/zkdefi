"use client";

import React, { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { Shield, Eye, Lock, ArrowRight, ExternalLink, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/lib/AppContext";
import { ActivityEvent, PoolSource } from "@/lib/AppContext";
import { sepoliaStarkscanTxUrl } from "@/lib/explorer";

interface ActivityLogProps {
  title?: string;
  /** Lock to a single pool -- hides pool filter row */
  poolFilter?: PoolSource;
}

type ActionFilter = "all" | "deposits" | "withdrawals" | "proofs";
type PoolFilter = "all" | PoolSource;

const POOL_LABELS: Record<PoolSource, string> = {
  full_privacy: "Pool B",
  shielded: "Shielded",
  pool_c: "Pool C",
  pool_d: "Pool D",
  stealth: "Stealth",
  compliance: "Compliance",
  system: "System",
};

const POOL_COLORS: Record<PoolSource, string> = {
  full_privacy: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  shielded: "bg-violet-500/15 text-violet-400 border-violet-500/25",
  pool_c: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  pool_d: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/25",
  stealth: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
  compliance: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  system: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
};

export function ActivityLog({ title = "Activity Feed", poolFilter: lockedPool }: ActivityLogProps = {}) {
  const { address, isConnected } = useAccount();
  const { activityFeed, syncActivityForAddress } = useApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [poolFilterState, setPoolFilterState] = useState<PoolFilter>("all");

  // If parent locked the pool, use that
  const activePool = lockedPool || poolFilterState;

  // Sync persisted activity when wallet address changes
  useEffect(() => {
    syncActivityForAddress(isConnected ? address : undefined);
  }, [isConnected, address, syncActivityForAddress]);

  // Derive which pools have events (for showing pool filter tabs)
  const activePools = Array.from(new Set(activityFeed.map((e) => e.pool).filter(Boolean))) as PoolSource[];

  const filteredFeed = activityFeed.filter((e) => {
    // Pool filter
    if (activePool !== "all" && e.pool !== activePool) return false;
    // Action filter
    if (actionFilter === "all") return true;
    if (actionFilter === "deposits") return e.type === "deposit";
    if (actionFilter === "withdrawals") return e.type === "withdraw";
    if (actionFilter === "proofs") return e.type === "proof" || e.type === "disclosure" || e.type === "private";
    return true;
  });

  const getEventIcon = (type: ActivityEvent["type"]) => {
    switch (type) {
      case "deposit":
        return <ArrowDownToLine className="w-4 h-4 text-proof-valid" />;
      case "withdraw":
        return <ArrowUpFromLine className="w-4 h-4 text-amber-400" />;
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
        {activityFeed.length > 0 && (
          <span className="text-xs text-zinc-500">{activityFeed.length} events</span>
        )}
      </div>

      {/* Pool filter row (only if multiple pools have events and not locked) */}
      {!lockedPool && activePools.length > 1 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <button
            onClick={() => setPoolFilterState("all")}
            className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
              poolFilterState === "all"
                ? "bg-zinc-700 text-white border-zinc-600"
                : "bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 border-zinc-700"
            }`}
          >
            All Pools
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
      {activityFeed.length > 0 && (
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
                {activityFeed.length === 0 ? "No activity yet" : "No matching activity"}
              </p>
              <p className="text-sm text-zinc-500">
                {activityFeed.length === 0
                  ? "Your deposits, withdrawals, and proofs will appear here"
                  : "Try a different filter"}
              </p>
            </motion.div>
          ) : (
            filteredFeed.map((event: ActivityEvent) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="glass rounded-lg border border-zinc-700 p-4 hover:border-zinc-600 transition-colors cursor-pointer"
                onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg border ${getEventColor(event.type)}`}>
                    {getEventIcon(event.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-medium text-zinc-200 truncate">{event.text}</p>
                        {event.pool && (
                          <span className={`px-1.5 py-0.5 text-[10px] rounded border shrink-0 ${POOL_COLORS[event.pool]}`}>
                            {POOL_LABELS[event.pool]}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-zinc-500 shrink-0">
                        {formatTimeAgo(event.time)}
                      </span>
                    </div>
                    {expandedId === event.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 pt-3 border-t border-zinc-700 space-y-2"
                      >
                        {event.details && (
                          <p className="text-xs text-zinc-400">{event.details}</p>
                        )}
                        {event.txHash && (
                          <a
                            href={sepoliaStarkscanTxUrl(event.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View transaction
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
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
