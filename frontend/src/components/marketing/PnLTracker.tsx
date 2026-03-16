"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Layers,
  Clock,
  Loader2,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";

/* ─── types ────────────────────────────────────────────────────────── */

interface Position {
  position_id: string;
  protocol: string;
  pool_name: string;
  asset_symbol: string;
  position_type: string;
  amount_usd: number;
  apy_at_entry: number;
  current_apy: number;
  pnl_usd: number;
  entered_at: string;
  closed: boolean;
}

interface SessionData {
  session_id: string;
  wallet_address: string;
  total_value_usd: number;
  starting_value_usd: number;
  total_pnl_usd: number;
  total_pnl_pct: number;
  last_snapshot_hash: string;
  positions: Position[];
}

interface PnlSnapshot {
  timestamp: number;
  value: number;
  pnl: number;
  pnlPct: number;
}

interface PnLTrackerProps {
  sessionId: string;
  /** Called with updated session data on each poll */
  onUpdate?: (data: { value: number; pnl: number; pnlPct: number; positionCount: number }) => void;
  /** Poll interval in ms (default: 30s) */
  pollInterval?: number;
}

/* ─── helpers ──────────────────────────────────────────────────────── */

const PROTOCOL_COLORS: Record<string, string> = {
  ekubo: "text-cyan-400",
  vesu: "text-emerald-400",
  endur: "text-amber-400",
  nostra: "text-rose-400",
  troves: "text-indigo-400",
  wallet: "text-zinc-400",
};

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function elapsed(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/* ─── mini sparkline SVG ───────────────────────────────────────────── */

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-8 w-[120px]"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─── component ────────────────────────────────────────────────────── */

export function PnLTracker({
  sessionId,
  onUpdate,
  pollInterval = 30_000,
}: PnLTrackerProps) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [history, setHistory] = useState<PnlSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastPoll, setLastPoll] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAndUpdate = useCallback(async () => {
    try {
      setLoading(true);
      // Mark-to-market first, then fetch session
      await apiFetch(`/api/v1/demo/sessions/${sessionId}/mtm`, {
        method: "POST",
        timeoutMs: 15_000,
      });
      const data = await apiFetch<SessionData>(
        `/api/v1/demo/sessions/${sessionId}`,
        { timeoutMs: 15_000 },
      );
      setSession(data);
      setLastPoll(Date.now());

      // Append to history
      const snap: PnlSnapshot = {
        timestamp: Date.now(),
        value: data.total_value_usd,
        pnl: data.total_pnl_usd,
        pnlPct: data.total_pnl_pct,
      };
      setHistory((prev) => [...prev.slice(-59), snap]);

      // Notify parent
      onUpdate?.({
        value: data.total_value_usd,
        pnl: data.total_pnl_usd,
        pnlPct: data.total_pnl_pct,
        positionCount: (data.positions ?? []).filter((p: Position) => !p.closed).length,
      });
    } catch {
      // Silently handle — we'll try again next poll
    } finally {
      setLoading(false);
    }
  }, [sessionId, onUpdate]);

  // Fetch on mount
  useEffect(() => {
    fetchAndUpdate();
  }, [fetchAndUpdate]);

  // Polling
  useEffect(() => {
    timerRef.current = setInterval(fetchAndUpdate, pollInterval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchAndUpdate, pollInterval]);

  if (!session) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  const openPositions = (session.positions ?? []).filter((p) => !p.closed);
  const pnlColor = session.total_pnl_usd >= 0 ? "text-emerald-400" : "text-rose-400";
  const pnlBg = session.total_pnl_usd >= 0 ? "bg-emerald-500" : "bg-rose-500";
  const sparkColor = session.total_pnl_usd >= 0 ? "#34d399" : "#fb7185";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-semibold text-zinc-300">Live P&amp;L Tracker</span>
          {loading && <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-600">
            <Clock className="inline h-2.5 w-2.5 mr-0.5" />
            {lastPoll > 0 ? `${Math.round((Date.now() - lastPoll) / 1000)}s ago` : "—"}
          </span>
          <button
            onClick={fetchAndUpdate}
            disabled={loading}
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Value + sparkline ── */}
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-lg font-bold text-zinc-100 tabular-nums">
            {fmtUsd(session.total_value_usd)}
          </p>
          <p className={`text-sm font-semibold ${pnlColor} tabular-nums`}>
            {session.total_pnl_usd >= 0 ? "+" : ""}{fmtUsd(session.total_pnl_usd)}
            <span className="ml-1 text-xs font-normal">
              ({fmtPct(session.total_pnl_pct)})
            </span>
          </p>
        </div>
        <Sparkline data={history.map((h) => h.value)} color={sparkColor} />
      </div>

      {/* ── Positions grid ── */}
      {openPositions.length > 0 && (
        <div className="border-t border-zinc-800/30">
          <div className="px-4 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-zinc-600">
              Open Positions ({openPositions.length})
            </p>
          </div>
          <div className="divide-y divide-zinc-800/30">
            {openPositions.map((pos) => {
              const protocolColor = PROTOCOL_COLORS[pos.protocol] ?? "text-zinc-400";
              const posPnlColor = pos.pnl_usd >= 0 ? "text-emerald-400" : "text-rose-400";
              return (
                <div
                  key={pos.position_id}
                  className="flex items-center justify-between px-4 py-2 hover:bg-zinc-800/20 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-zinc-300 truncate">
                      {pos.pool_name}
                    </p>
                    <p className={`text-[10px] ${protocolColor}`}>
                      {pos.protocol} · {pos.asset_symbol} · {pos.position_type}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-xs font-medium text-zinc-300 tabular-nums">
                      {fmtUsd(pos.amount_usd)}
                    </p>
                    <div className="flex items-center justify-end gap-2 text-[10px]">
                      <span className={`font-semibold tabular-nums ${posPnlColor}`}>
                        {pos.pnl_usd >= 0 ? "+" : ""}{fmtUsd(pos.pnl_usd)}
                      </span>
                      <span className="text-zinc-600 tabular-nums">
                        {((pos.current_apy ?? 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Footer: snapshot hash ── */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-800/30">
        <div className="flex items-center gap-1.5 text-[9px] text-zinc-600">
          <Layers className="h-2.5 w-2.5" />
          <span className="font-mono">{session.last_snapshot_hash?.slice(0, 18)}…</span>
        </div>
        <span className="text-[9px] text-zinc-600">
          {openPositions.length > 0 && elapsed(openPositions[0].entered_at)} running
        </span>
      </div>
    </div>
  );
}
