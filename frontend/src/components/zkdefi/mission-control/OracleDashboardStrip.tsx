"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown, RotateCw, Loader2 } from "lucide-react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiFetch } from "@/lib/api/client";

interface Opportunity {
  id: string;
  name: string;
  venue?: string;
  apy_bps?: number;
  risk_level?: string;
  volatility?: number;
  liquidity_score?: number;
  efficiency?: number;
  signal?: string;
  signal_strength?: number;
  signal_reason?: string;
  signal_features?: Record<string, unknown>;
}

interface OracleDashboardStripProps {
  address: string | undefined;
  onDeploy?: (id: string) => void;
}

const LS_KEY = "zkdefi_oracle_collapsed";

const SIGNAL_META: Record<string, { label: string; dot: string; text: string }> = {
  top_pick: { label: "Top Pick", dot: "bg-fuchsia-400", text: "text-fuchsia-300" },
  trending: { label: "Trending", dot: "bg-orange-400", text: "text-orange-300" },
  rising: { label: "Rising", dot: "bg-cyan-400", text: "text-cyan-300" },
  active: { label: "Active", dot: "bg-emerald-400", text: "text-emerald-300" },
  stable: { label: "Stable", dot: "bg-zinc-500", text: "text-zinc-400" },
};

function signalMeta(signal?: string) {
  return SIGNAL_META[signal ?? ""] ?? SIGNAL_META.stable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function normalizeOpportunity(raw: unknown, index: number): Opportunity | null {
  if (!isRecord(raw)) return null;
  const id = asText(raw.id) || `opp-${index}`;
  const name = asText(raw.name) || asText(raw.pair) || `Opportunity ${index + 1}`;
  return {
    id,
    name,
    venue: asText(raw.venue) || undefined,
    apy_bps: asNumber(raw.apy_bps, asNumber(raw.currentYield, 0) * 100),
    risk_level: asText(raw.risk_level).toLowerCase() || undefined,
    volatility: asOptionalNumber(raw.volatility),
    liquidity_score: asOptionalNumber(raw.liquidity_score),
    efficiency: asOptionalNumber(raw.efficiency),
    signal: asText(raw.signal) || undefined,
    signal_strength: asOptionalNumber(raw.signal_strength),
    signal_reason: asText(raw.signal_reason) || undefined,
    signal_features: isRecord(raw.signal_features) ? raw.signal_features : undefined,
  };
}

function riskScore(level?: string): number {
  if (level === "low") return 25;
  if (level === "medium") return 55;
  if (level === "high") return 85;
  return 50;
}

function apyPercent(bps?: unknown): number {
  return asNumber(bps, 0) / 100;
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(LS_KEY, String(v));
  } catch {}
}

// ---------- Genome bar config ----------

const GENOME_BARS = [
  { key: "yield", label: "Yield", color: "bg-cyan-400" },
  { key: "risk", label: "Risk", color: "bg-red-400", invert: true },
  { key: "volatility", label: "Volatility", color: "bg-amber-400", invert: true },
  { key: "liquidity", label: "Liquidity", color: "bg-emerald-400" },
  { key: "efficiency", label: "Efficiency", color: "bg-violet-400" },
] as const;

function genomeValue(opp: Opportunity, key: string): number {
  if (key === "yield") return Math.min(apyPercent(opp.apy_bps), 100);
  if (key === "risk") return riskScore(opp.risk_level);
  if (key === "volatility") return opp.volatility ?? 50;
  if (key === "liquidity") return opp.liquidity_score ?? 50;
  if (key === "efficiency") return opp.efficiency ?? 50;
  return 50;
}

// ---------- Radar tooltip ----------

function RadarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] shadow-lg">
      <p className="text-zinc-200 font-medium">{d.name}</p>
      <p className="text-cyan-400">{d.y.toFixed(1)}% APY</p>
      <p className="text-zinc-400">Risk {d.x}</p>
    </div>
  );
}

// ---------- Main component ----------

export function OracleDashboardStrip({ address, onDeploy }: OracleDashboardStripProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [data, setData] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      writeCollapsed(!prev);
      return !prev;
    });
  }, []);

  const fetchData = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      // Prefer unified signals endpoint (phase-1-placeholder with predictions ready)
      const signalRes = await apiFetch<{ signals?: any[]; metadata?: any }>(
        "/api/v1/zkdefi/signals/top?limit=12",
      ).catch(() => null);
      
      const signalData = Array.isArray(signalRes?.signals)
        ? signalRes.signals
            .map((sig: any, idx: number) => {
              // Transform signals to opportunities format
              const opportunity: Opportunity = {
                id: sig.id,
                name: sig.name,
                venue: sig.constitution?.entity || "zkdefi",
                apy_bps: Math.round((sig.currentYield || 0) * 100),
                risk_level: sig.riskScore <= 35 ? "safe" : sig.riskScore <= 65 ? "medium" : "elevated",
                volatility: sig.type === "dex" ? 45 : 25,
                liquidity_score: 85,
                efficiency: sig.predictions?.reputationScore?.score || 75,
                signal: sig.riskScore <= 35 ? "top_pick" : sig.currentYield > 5 ? "trending" : "rising",
                signal_strength: sig.predictions?.reputationScore?.score || 80,
                signal_reason: `${sig.type} opportunity with ${sig.currentYield.toFixed(1)}% yield`,
                signal_features: sig.predictions,
              };
              return normalizeOpportunity(opportunity, idx);
            })
            .filter((opp): opp is Opportunity => opp !== null)
        : [];
      
      if (signalData.length > 0) {
        setData(signalData);
        return;
      }
      
      // Fallback: mission-control signal/top
      const mcSignalRes = await apiFetch<{ opportunities?: Opportunity[]; count?: number }>(
        "/api/v1/zkdefi/mc/signal/top?limit=12",
      ).catch(() => null);
      const mcSignalData = Array.isArray(mcSignalRes?.opportunities)
        ? mcSignalRes.opportunities
            .map((opp, idx) => normalizeOpportunity(opp, idx))
            .filter((opp): opp is Opportunity => opp !== null)
        : [];
      if (mcSignalData.length > 0) {
        setData(mcSignalData);
        return;
      }
      
      // Fallback: strategies/opportunities
      const res = await apiFetch<Opportunity[] | { opportunities?: Opportunity[] }>(
        "/api/v1/strategies/opportunities",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_address: address,
            risk_profile: "balanced",
            limit: 20,
          }),
        },
      );
      const list = Array.isArray(res) ? res : res?.opportunities ?? [];
      const normalized = list
        .map((opp, idx) => normalizeOpportunity(opp, idx))
        .filter((opp): opp is Opportunity => opp !== null);
      setData(normalized);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ---------- Collapsed view ----------

  if (collapsed) {
    const top = data[0];
    const count = data.length;
    return (
      <div className="flex-shrink-0 bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-1.5 flex items-center gap-3 text-xs text-zinc-400">
        <button onClick={toggle} className="hover:text-zinc-200 transition-colors" aria-label="Expand">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <span>
          {count} signal{count !== 1 && "s"}
        </span>
        {top && (
          <>
            <span className="text-zinc-600">|</span>
            <span>
              Top: <span className="text-zinc-200">{asText(top.name)}</span>{" "}
              <span className="text-cyan-400">{apyPercent(top.apy_bps).toFixed(1)}%</span>
            </span>
            <span className="text-zinc-600">|</span>
            <span>
              Signal:{" "}
              <span className={`font-medium ${signalMeta(top.signal).text}`}>{signalMeta(top.signal).label}</span>
            </span>
          </>
        )}
      </div>
    );
  }

  // ---------- Expanded view ----------

  const scatterData = data.map((o) => ({
    x: riskScore(o.risk_level),
    y: apyPercent(o.apy_bps),
    z: o.liquidity_score ?? 50,
    name: o.name,
    id: o.id,
  }));

  const topOpp = data[0];
  const signalSlice = data.slice(0, 4);

  return (
    <div className="flex-shrink-0 bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/60">
        <button onClick={toggle} className="text-zinc-400 hover:text-zinc-200 transition-colors" aria-label="Collapse">
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-medium text-zinc-300">Market Intelligence</span>
        <div className="flex-1" />
        <button
          onClick={fetchData}
          disabled={loading}
          className="text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-40"
          aria-label="Refresh"
        >
          <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Body */}
      <div className="h-[200px]">
        {loading && data.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <span className="text-xs text-zinc-500">Intelligence unavailable</span>
            <button
              onClick={fetchData}
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-xs text-zinc-500">No signals</span>
          </div>
        ) : (
          <div className="flex h-full">
            {/* LEFT: Signal Feed (~40%) */}
            <div className="w-[40%] border-r border-zinc-800 px-3 py-2 flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                Signals
              </span>
              <div className="flex-1 flex flex-col gap-1 overflow-hidden">
                {signalSlice.map((opp) => (
                  <button
                    key={opp.id}
                    onClick={() => onDeploy?.(opp.id)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/60 transition-colors text-left group"
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${signalMeta(opp.signal).dot}`}
                    />
                    <span className="text-xs text-zinc-300 truncate flex-1">
                      {opp.venue ? `${asText(opp.venue)} / ` : ""}
                      {asText(opp.name)}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`text-[10px] uppercase tracking-wide ${signalMeta(opp.signal).text}`}
                        title={asText(opp.signal_reason) || "Signal tier from ranked composite score"}
                      >
                        {signalMeta(opp.signal).label}
                      </span>
                      {typeof opp.signal_strength === "number" && (
                        <span className="text-[10px] text-zinc-500">
                          {Math.max(0, Math.min(100, opp.signal_strength))}%
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-cyan-400">
                        {apyPercent(opp.apy_bps).toFixed(1)}%
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {topOpp?.signal_reason && (
                <div className="text-[10px] text-zinc-500 border-t border-zinc-800 mt-1 pt-1 line-clamp-2">
                  {asText(topOpp.signal_reason)}
                </div>
              )}
            </div>

            {/* CENTER: Radar (~30%) */}
            <div className="w-[30%] border-r border-zinc-800 px-2 py-2 flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                Radar
              </span>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 9, fill: "#71717a" }}
                      axisLine={{ stroke: "#3f3f46" }}
                      tickLine={false}
                      name="Risk"
                    />
                    <YAxis
                      dataKey="y"
                      type="number"
                      tick={{ fontSize: 9, fill: "#71717a" }}
                      axisLine={{ stroke: "#3f3f46" }}
                      tickLine={false}
                      name="APY"
                      unit="%"
                      width={30}
                    />
                    <ZAxis dataKey="z" range={[30, 200]} name="Liquidity" />
                    <Tooltip content={<RadarTooltip />} cursor={false} />
                    <Scatter
                      data={scatterData}
                      fill="#22d3ee"
                      fillOpacity={0.7}
                      onClick={(point: any) => {
                        if (point?.id) onDeploy?.(point.id);
                      }}
                      style={{ cursor: "pointer" }}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* RIGHT: Genome (~30%) */}
            <div className="w-[30%] px-3 py-2 flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                Genome
              </span>
              {topOpp ? (
                <div className="flex-1 flex flex-col justify-center gap-1.5">
                  {GENOME_BARS.map((bar) => {
                    const raw = genomeValue(topOpp, bar.key);
                    const display = ("invert" in bar && bar.invert) ? 100 - raw : raw;
                    return (
                      <div key={bar.key} className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-500 w-14 text-right">
                          {bar.label}
                        </span>
                        <div className="flex-1 h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${bar.color}`}
                            style={{ width: `${Math.max(display, 2)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-zinc-400 w-8 text-right font-mono">
                          {Math.round(display)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
                  No data
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
