"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileCheck,
  Brain,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Lock,
  Vote,
  Server,
  Landmark,
  Coins,
  Shuffle,
  Flame,
  Star,
  Activity,
  Copy,
  ChevronRight,
  Zap,
  ShieldCheck,
  ShieldX,
  Loader2,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

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
  signal?: string;
}

type ProofStatus = "idle" | "proving" | "proved" | "flagged" | "unavailable";

interface ProofState {
  status: ProofStatus;
  hashes?: Record<string, string | null>;
}

interface StreamCardProps {
  item: StreamItem;
  onAction?: (action: string, itemId: string) => void;
}

const TYPE_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; bg: string }
> = {
  receipt:    { icon: FileCheck,   color: "text-emerald-400", bg: "bg-emerald-500/10" },
  decision:   { icon: Brain,       color: "text-amber-400",   bg: "bg-amber-500/10"   },
  opportunity:{ icon: TrendingUp,  color: "text-cyan-400",    bg: "bg-cyan-500/10"    },
  policy:     { icon: ShieldAlert, color: "text-red-400",     bg: "bg-red-500/10"     },
  privacy:    { icon: Lock,        color: "text-violet-400",  bg: "bg-violet-500/10"  },
  governance: { icon: Vote,        color: "text-blue-400",    bg: "bg-blue-500/10"    },
  system:     { icon: Server,      color: "text-zinc-400",    bg: "bg-zinc-500/10"    },
  lending:    { icon: Landmark,    color: "text-green-400",   bg: "bg-green-500/10"   },
  staking:    { icon: Coins,       color: "text-orange-400",  bg: "bg-orange-500/10"  },
  rebalance:  { icon: Shuffle,     color: "text-indigo-400",  bg: "bg-indigo-500/10"  },
  brain_check:{ icon: Brain,       color: "text-purple-400",  bg: "bg-purple-500/10"  },
};

const SIGNAL_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  top_pick: { icon: Star,      label: "Top Pick",     color: "text-yellow-400" },
  trending: { icon: Flame,     label: "Trending",     color: "text-orange-400" },
  rising:   { icon: TrendingUp,label: "Rising",       color: "text-cyan-400"   },
  active:   { icon: Activity,  label: "Active",       color: "text-emerald-400"},
  stable:   { icon: TrendingDown,label: "Stable",     color: "text-zinc-500"   },
};

const RISK_COLOR: Record<string, string> = {
  low:    "text-emerald-400",
  medium: "text-amber-400",
  high:   "text-red-400",
};

function formatRelativeTime(iso: string): string {
  if (!iso) return "—";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
    return new Date(iso).toLocaleDateString();
  } catch { return "—"; }
}

/** Avoid React "Objects are not valid as a React child" — never render raw objects. */
function toDisplayString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export function StreamCard({ item, onAction }: StreamCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [proof, setProof] = useState<ProofState>({ status: "idle" });

  const config = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.system;
  const Icon = config.icon;
  const signal = item.signal ? SIGNAL_CONFIG[item.signal] : null;
  const SignalIcon = signal?.icon;

  const isOpportunity = ["opportunity", "lending", "staking"].includes(item.type);
  const hasHashes = item.hashes && Object.values(item.hashes).some(Boolean);
  const hasDetail = hasHashes || isOpportunity;

  // Auto-trigger async proof screening for top opportunities
  const runProof = useCallback(async () => {
    if (!isOpportunity || proof.status !== "idle") return;
    if ((item.signal === "stable" || !item.apy_bps || item.apy_bps < 200)) return;
    setProof({ status: "proving" });
    try {
      const result = await apiFetch<{
        is_proved: boolean;
        proof_status: string;
        proof_hashes: Record<string, string | null>;
      }>("/api/v1/zkdefi/skills/screen/opportunity", {
        method: "POST",
        body: JSON.stringify({
          pool_id: item.id,
          apy_bps: item.apy_bps,
          risk_level: item.risk_level,
          user_address: "0x0",
        }),
      });
      setProof({
        status: result.proof_status as ProofStatus,
        hashes: result.proof_hashes,
      });
    } catch {
      setProof({ status: "unavailable" });
    }
  }, [item, isOpportunity, proof.status]);

  // Trigger proof ~1s after mount for trending/rising items
  useEffect(() => {
    if (!isOpportunity) return;
    const delay = item.signal === "top_pick" ? 800 : item.signal === "trending" ? 1500 : 3000;
    const t = setTimeout(runProof, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <div
      className={`group rounded border border-zinc-800/60 bg-zinc-900/40 hover:bg-zinc-800/50 transition-colors overflow-hidden ${
        item.type === "privacy" ? "border-l-2 border-l-violet-500" : ""
      } ${item.type === "governance" ? "border-l-2 border-l-blue-500" : ""}`}
    >
      {/* Main row */}
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((e) => !e)}
        className="w-full text-left px-3 py-2 flex items-center gap-2.5 min-h-0"
      >
        {/* Type icon — small, tight */}
        <div className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center ${config.bg} ${config.color}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-sm font-medium text-zinc-100 truncate">
            {toDisplayString(item.title)}
          </span>
          {item.trust_delta != null && item.trust_delta !== 0 && (
            <span className={`flex-shrink-0 text-[10px] px-1 py-0.5 rounded font-medium ${
              item.trust_delta > 0 ? "bg-emerald-900/40 text-emerald-400" : "bg-red-900/40 text-red-400"
            }`}>
              {item.trust_delta > 0 ? "+" : ""}{item.trust_delta}
            </span>
          )}
        </div>

        {/* Right metadata cluster */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {/* APY badge for opportunities */}
          {isOpportunity && item.apy_bps != null && item.apy_bps > 0 && (
            <span className={`text-[11px] font-semibold tabular-nums ${config.color}`}>
              {(item.apy_bps / 100).toFixed(1)}%
            </span>
          )}

          {/* Signal badge */}
          {signal && SignalIcon && item.signal !== "stable" && (
            <span className={`flex items-center gap-0.5 text-[10px] font-medium ${signal.color}`}>
              <SignalIcon className="w-3 h-3" />
              {signal.label}
            </span>
          )}

          {/* Async proof badge */}
          {isOpportunity && proof.status === "proving" && (
            <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              proving
            </span>
          )}
          {isOpportunity && proof.status === "proved" && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 font-medium">
              <ShieldCheck className="w-3 h-3" />
              proved
            </span>
          )}
          {isOpportunity && proof.status === "flagged" && (
            <span className="flex items-center gap-0.5 text-[10px] text-red-400 font-medium">
              <ShieldX className="w-3 h-3" />
              flagged
            </span>
          )}

          {/* Risk dot */}
          {item.risk_level && isOpportunity && (
            <span className={`text-[10px] ${RISK_COLOR[item.risk_level] ?? "text-zinc-500"}`}>
              ●
            </span>
          )}

          {/* Timestamp */}
          <span className="text-[10px] text-zinc-600">
            {formatRelativeTime(item.timestamp)}
          </span>

          {/* Expand chevron */}
          {hasDetail && (
            <ChevronRight
              className={`w-3 h-3 text-zinc-600 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          )}
        </div>
      </button>

      {/* Subtitle — secondary line, only when there's something to say */}
      {item.subtitle != null && toDisplayString(item.subtitle) && (
        <div className="px-3 pb-1.5 -mt-0.5">
          <p className="text-[11px] text-zinc-500 truncate">{toDisplayString(item.subtitle)}</p>
        </div>
      )}

      {/* Action buttons — inline, compact */}
      {(item.actions ?? []).length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {(item.actions ?? []).map((action) => (
            <button
              key={action}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAction?.(action, item.id);
              }}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                action === "deploy"
                  ? "border-cyan-700 text-cyan-400 hover:bg-cyan-900/30"
                  : "border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {action === "deploy" && <Zap className="inline w-2.5 h-2.5 mr-0.5 -mt-px" />}
              {action.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {/* Expandable proof chain */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-zinc-800"
          >
            <div className="px-3 py-2 space-y-1">
              {hasHashes && (
                <>
                  <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Proof chain</p>
                  {Object.entries(item.hashes ?? {}).map(([key, value]) =>
                    value ? (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <span className="text-zinc-600 w-16 flex-shrink-0 text-[10px] capitalize">{key}</span>
                        <code className="flex-1 truncate text-zinc-400 font-mono text-[10px]">{value}</code>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(value); }}
                          className="p-0.5 rounded hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300"
                        >
                          <Copy className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ) : null
                  )}
                </>
              )}
              {isOpportunity && (
                <div className="space-y-1 pt-0.5">
                  <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                    {item.venue != null && toDisplayString(item.venue) && <span>via {toDisplayString(item.venue)}</span>}
                    {item.source != null && toDisplayString(item.source) && <span>src: {toDisplayString(item.source)}</span>}
                    {item.composite_score != null && typeof item.composite_score === "number" && <span>score: {item.composite_score.toFixed(0)}</span>}
                  </div>
                  {proof.status === "proved" && proof.hashes && (
                    <div className="space-y-0.5">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-wider">Circuit proofs</p>
                      {Object.entries(proof.hashes).map(([circuit, hash]) =>
                        hash ? (
                          <div key={circuit} className="flex items-center gap-2 text-[10px]">
                            <ShieldCheck className="w-2.5 h-2.5 text-emerald-400 flex-shrink-0" />
                            <span className="text-zinc-600 w-24 flex-shrink-0">{circuit}</span>
                            <code className="flex-1 truncate text-zinc-500 font-mono">{hash}</code>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
