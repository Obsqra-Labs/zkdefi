"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileCheck,
  Brain,
  TrendingUp,
  ShieldAlert,
  Lock,
  Vote,
  Server,
  Landmark,
  Coins,
  Shuffle,
  ChevronDown,
  ChevronUp,
  Copy,
} from "lucide-react";

export interface StreamItem {
  id: string;
  type: string;
  timestamp: string;
  title: string;
  subtitle: string;
  status: string;
  trust_delta?: number;
  hashes?: Record<string, string>;
  source?: string;
  actions: string[];
  venue?: string;
  apy_bps?: number;
  risk_level?: string;
  composite_score?: number;
}

interface StreamCardProps {
  item: StreamItem;
  onAction?: (action: string, itemId: string) => void;
}

const TYPE_CONFIG: Record<
  string,
  { icon: React.ElementType; bg: string; text: string; border?: string }
> = {
  receipt: { icon: FileCheck, bg: "bg-emerald-500/20", text: "text-emerald-400" },
  decision: { icon: Brain, bg: "bg-amber-500/20", text: "text-amber-400" },
  opportunity: { icon: TrendingUp, bg: "bg-cyan-500/20", text: "text-cyan-400" },
  policy: { icon: ShieldAlert, bg: "bg-red-500/20", text: "text-red-400" },
  privacy: { icon: Lock, bg: "bg-violet-500/20", text: "text-violet-400", border: "border-l-violet-500" },
  governance: { icon: Vote, bg: "bg-blue-500/20", text: "text-blue-400", border: "border-l-blue-500" },
  system: { icon: Server, bg: "bg-zinc-500/20", text: "text-zinc-400" },
  lending: { icon: Landmark, bg: "bg-green-500/20", text: "text-green-400" },
  staking: { icon: Coins, bg: "bg-orange-500/20", text: "text-orange-400" },
  rebalance: { icon: Shuffle, bg: "bg-indigo-500/20", text: "text-indigo-400", border: "border-l-indigo-500" },
  brain_check: { icon: Brain, bg: "bg-purple-500/20", text: "text-purple-400" },
};

function formatRelativeTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    if (diff < 172800_000) return "yesterday";
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export function StreamCard({ item, onAction }: StreamCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.system;
  const Icon = config.icon;

  const hasHashes = item.hashes && Object.values(item.hashes).some(Boolean);
  const hasDetail = hasHashes || item.venue || item.apy_bps != null;

  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden transition-colors hover:bg-zinc-800/50 ${
        item.type === "privacy" ? "border-l-4 border-l-violet-500" : ""
      } ${item.type === "governance" ? "border-l-4 border-l-blue-500" : ""} ${item.type === "rebalance" ? "border-l-4 border-l-indigo-500" : ""}`}
    >
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((e) => !e)}
        className="w-full text-left p-3 flex items-start gap-3"
      >
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${config.bg} ${config.text}`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              {formatRelativeTime(item.timestamp)}
            </span>
            {item.trust_delta != null && item.trust_delta !== 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  item.trust_delta > 0 ? "bg-emerald-900/50 text-emerald-400" : "bg-red-900/50 text-red-400"
                }`}
              >
                trust {item.trust_delta > 0 ? "+" : ""}
                {item.trust_delta}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-zinc-100 truncate mt-0.5">{item.title}</p>
          <p className="text-xs text-zinc-400 truncate">{item.subtitle}</p>
          {item.type === "opportunity" && item.apy_bps != null && (
            <p className="text-xs font-medium text-cyan-400 mt-1">
              {(item.apy_bps / 100).toFixed(1)}% APY
            </p>
          )}
          {item.type === "rebalance" && item.venue && (
            <p className="text-xs text-indigo-400 mt-1">{item.venue}</p>
          )}
          {item.type === "brain_check" && item.composite_score != null && (
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-medium ${item.composite_score < 30 ? "text-emerald-400" : item.composite_score < 70 ? "text-amber-400" : "text-red-400"}`}>
                Score: {item.composite_score}/100
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${item.status === "passed" ? "bg-emerald-900/50 text-emerald-400" : "bg-red-900/50 text-red-400"}`}>
                {item.status}
              </span>
            </div>
          )}
        </div>
        {hasDetail && (
          <div className="flex-shrink-0 text-zinc-500">
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        )}
      </button>

      {/* Action buttons */}
      {item.actions.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {item.actions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAction?.(action, item.id);
              }}
              className="text-[10px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors capitalize"
            >
              {action.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {/* Expandable detail */}
      <AnimatePresence>
        {expanded && hasHashes && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-0 border-t border-zinc-800 mt-0">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 mt-2">
                Proof chain
              </p>
              <div className="space-y-1.5 text-xs">
                {Object.entries(item.hashes ?? {}).map(
                  ([key, value]) =>
                    value && (
                      <div
                        key={key}
                        className="flex items-center gap-2 py-1 px-2 rounded bg-zinc-800/50"
                      >
                        <span className="text-zinc-500 w-20 flex-shrink-0 capitalize">
                          {key}:
                        </span>
                        <code className="flex-1 truncate text-zinc-300 font-mono text-[10px]">
                          {value}
                        </code>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(value);
                          }}
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                          title="Copy"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    )
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
