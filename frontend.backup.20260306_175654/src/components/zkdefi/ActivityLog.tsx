"use client";

import React, { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { Shield, Eye, Lock, ArrowRight, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/lib/AppContext";

import { ActivityEvent } from "@/lib/AppContext";

export function ActivityLog() {
  const { address, isConnected } = useAccount();
  const { activityFeed, setActivityFeed } = useApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setActivityFeed([]);
      return;
    }

    // Poll for activity updates every 5 seconds
    const interval = setInterval(() => {
      // In a real implementation, this would fetch from backend
      // For now, we'll track events from localStorage or context
    }, 5000);

    return () => clearInterval(interval);
  }, [isConnected, address, setActivityFeed]);

  const getEventIcon = (type: ActivityEvent["type"]) => {
    switch (type) {
      case "deposit":
        return <Shield className="w-4 h-4 text-proof-valid" />;
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
        <h2 className="text-xl font-semibold mb-4">Activity Feed</h2>
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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Activity Feed</h2>
        {activityFeed.length > 0 && (
          <div className="flex gap-2">
            <button className="px-3 py-1 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700">
              All
            </button>
            <button className="px-3 py-1 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700">
              Deposits
            </button>
            <button className="px-3 py-1 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700">
              Proofs
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <AnimatePresence>
          {activityFeed.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <p className="text-zinc-400 mb-2">No activity yet</p>
              <p className="text-sm text-zinc-500">
                Your deposits, proofs, and private transfers will appear here
              </p>
            </motion.div>
          ) : (
            activityFeed.map((event: ActivityEvent) => (
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
                      <p className="text-sm font-medium text-zinc-200">{event.text}</p>
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
                            href={`https://sepolia.starkscan.co/tx/${event.txHash}`}
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
  ].slice(0, 50)); // Keep last 50 events
}
