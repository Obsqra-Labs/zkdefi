"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  KeyRound,
  Lock,
  ShieldCheck,
  TrendingUp,
  Layers,
  Zap,
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

export interface StreamEvent {
  id: string;
  type: string;
  detail: string;
  meta: Record<string, unknown>;
  ts: number;
}

interface IntelligentStreamProps {
  walletAddress: string;
  pollIntervalMs?: number;
  maxVisible?: number;
}

/* ─── event config ─────────────────────────────────────────────────── */

const EVENT_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string; bg: string }
> = {
  onboarded: { icon: Zap, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  session_key_issued: { icon: KeyRound, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  vault_deposit: { icon: Lock, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  vault_withdraw: { icon: Lock, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
  proof_generated: { icon: ShieldCheck, color: "text-fuchsia-400", bg: "bg-fuchsia-500/10 border-fuchsia-500/20" },
  trade: { icon: TrendingUp, color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20" },
  snapshot: { icon: Layers, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
};

const DEFAULT_META = { icon: Activity, color: "text-zinc-400", bg: "bg-zinc-800 border-zinc-700" };

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/* ─── component ────────────────────────────────────────────────────── */

export function IntelligentStream({
  walletAddress,
  pollIntervalMs = 8000,
  maxVisible = 20,
}: IntelligentStreamProps) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenIds = useRef(new Set<string>());
  const [newFlash, setNewFlash] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch<{ events: StreamEvent[]; count: number }>(
        `/api/v1/demo/stream/${walletAddress}?limit=${maxVisible}`,
        { timeoutMs: 10_000 }
      );
      const incoming = res.events ?? [];
      // Detect new events for flash animation
      for (const ev of incoming) {
        if (!seenIds.current.has(ev.id)) {
          seenIds.current.add(ev.id);
          setNewFlash(ev.id);
          setTimeout(() => setNewFlash(null), 1200);
        }
      }
      setEvents(incoming.slice(0, maxVisible));
    } catch {
      /* silent — keep existing list */
    } finally {
      setLoading(false);
    }
  }, [walletAddress, maxVisible]);

  // Initial load + polling
  useEffect(() => {
    fetchEvents();
    pollRef.current = setInterval(fetchEvents, pollIntervalMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchEvents, pollIntervalMs]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/50 bg-zinc-900/50">
        <Activity className="h-4 w-4 text-cyan-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
          Intelligent Stream
        </span>
        <span className="ml-auto flex items-center gap-1 text-[9px] text-zinc-600">
          {loading && <RefreshCw className="h-2.5 w-2.5 animate-spin text-zinc-600" />}
          {events.length} events
        </span>
      </div>

      {/* Event list */}
      <div className="max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800">
        {events.length === 0 && !loading && (
          <div className="px-4 py-6 text-center text-xs text-zinc-600">
            No activity yet — onboard &amp; trade to see events stream in.
          </div>
        )}

        {events.map((ev) => {
          const meta = EVENT_META[ev.type] ?? DEFAULT_META;
          const Icon = meta.icon;
          const isNew = newFlash === ev.id;
          return (
            <div
              key={ev.id}
              className={`flex items-start gap-3 px-4 py-2.5 border-b border-zinc-800/20 transition-colors ${
                isNew ? "bg-cyan-500/5" : "hover:bg-zinc-900/50"
              }`}
            >
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${meta.bg}`}>
                <Icon className={`h-3 w-3 ${meta.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-zinc-300 leading-snug">{ev.detail}</p>
                <p className="mt-0.5 text-[9px] text-zinc-600 font-mono">{ev.type}</p>
              </div>
              <span className="shrink-0 text-[9px] text-zinc-600">
                {relativeTime(ev.ts)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
