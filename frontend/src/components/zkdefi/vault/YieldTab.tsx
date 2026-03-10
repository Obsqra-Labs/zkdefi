"use client";

import { useEffect, useState } from "react";
import {
  Percent,
  TrendingUp,
  Clock,
  Zap,
  CheckCircle2,
  Shield,
} from "lucide-react";
import { API_BASE } from "@/lib/api/client";
import { DeployToEkuboCard } from "@/components/zkdefi/DeployToEkuboCard";
import { useAdapterRegistry, type AdapterHealth } from "@/hooks/useAdapterRegistry";

interface YieldChartPoint {
  date: string;
  timestamp: string;
  cumulative_yield: number;
  apy_bps: number;
}

function YieldChart() {
  const [points, setPoints] = useState<YieldChartPoint[]>([]);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/zkdefi/vault/yield-chart?days=30`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok || dead) return;
        const data = await res.json();
        if (!dead && Array.isArray(data.points)) setPoints(data.points);
      } catch { /* best-effort */ }
    })();
    return () => { dead = true; };
  }, []);

  if (points.length < 2) {
    return (
      <div className="border border-white/10 rounded-xl bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-white/40" />
          <span className="text-sm font-medium text-white/70">Performance (30d)</span>
        </div>
        <div className="h-32 flex items-center justify-center">
          <span className="text-xs text-white/30">Loading chart data...</span>
        </div>
      </div>
    );
  }

  const W = 600;
  const H = 120;
  const PAD = { t: 8, b: 20, l: 0, r: 0 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const yValues = points.map((p) => p.cumulative_yield);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const yRange = yMax - yMin || 1;

  function toX(i: number) { return PAD.l + (i / (points.length - 1)) * chartW; }
  function toY(v: number) { return PAD.t + chartH - ((v - yMin) / yRange) * chartH; }

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.cumulative_yield).toFixed(1)}`)
    .join(" ");

  const gradPath = `${linePath} L${toX(points.length - 1).toFixed(1)},${H - PAD.b} L${PAD.l},${H - PAD.b} Z`;

  const latest = points[points.length - 1];
  const hoverPt = hover !== null ? points[hover] : null;

  return (
    <div className="border border-white/10 rounded-xl bg-white/[0.02] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-white/40" />
          <span className="text-sm font-medium text-white/70">Performance (30d)</span>
        </div>
        <span className="text-sm font-semibold text-emerald-400">
          +{latest.cumulative_yield.toFixed(2)}%
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-32"
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * W;
            const idx = Math.round(((x - PAD.l) / chartW) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, idx)));
          }}
        >
          <defs>
            <linearGradient id="yieldFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((frac) => (
            <line
              key={frac}
              x1={PAD.l}
              x2={W - PAD.r}
              y1={PAD.t + chartH * (1 - frac)}
              y2={PAD.t + chartH * (1 - frac)}
              stroke="rgba(255,255,255,0.04)"
              strokeDasharray="4 4"
            />
          ))}

          <path d={gradPath} fill="url(#yieldFill)" />
          <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />

          {hover !== null && (
            <>
              <line
                x1={toX(hover)}
                x2={toX(hover)}
                y1={PAD.t}
                y2={H - PAD.b}
                stroke="rgba(255,255,255,0.15)"
                strokeDasharray="3 3"
              />
              <circle
                cx={toX(hover)}
                cy={toY(points[hover].cumulative_yield)}
                r={4}
                fill="#10b981"
                stroke="#0f172a"
                strokeWidth={2}
              />
            </>
          )}
        </svg>

        {hoverPt && (
          <div
            className="absolute top-0 bg-slate-800/95 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs pointer-events-none z-10"
            style={{
              left: `${(toX(hover!) / W) * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            <div className="text-white/40">{hoverPt.date}</div>
            <div className="text-emerald-400 font-medium">+{hoverPt.cumulative_yield.toFixed(3)}%</div>
            <div className="text-white/50">{(hoverPt.apy_bps / 100).toFixed(1)}% APY</div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-6 text-xs text-white/40 mt-2">
        <span>{points[0].date}</span>
        <span className="flex-1 border-t border-dashed border-white/5" />
        <span>{latest.date}</span>
      </div>
    </div>
  );
}

interface YieldTabProps {
  address?: string;
}

interface SourceRow {
  name: string;
  allocation: number;
  apy: number;
  earned: number;
  status: "earning" | "available" | "paused";
}

const FALLBACK_SOURCES: SourceRow[] = [
  { name: "Ekubo LP", allocation: 45, apy: 12.4, earned: 67.2, status: "earning" },
  { name: "Lending", allocation: 30, apy: 6.8, earned: 32.1, status: "earning" },
  { name: "Staking", allocation: 20, apy: 4.2, earned: 21.3, status: "earning" },
  { name: "Idle", allocation: 5, apy: 0, earned: 0, status: "available" },
];

const FIRST_PARTY_NAMES = new Set(["Ekubo LP", "Lending", "Staking"]);

function healthDotColor(health: AdapterHealth | undefined): string {
  switch (health) {
    case "HEALTHY":
      return "bg-emerald-500";
    case "DEGRADED":
      return "bg-amber-500";
    case "CIRCUIT_BREAKER":
    case "DISABLED":
      return "bg-red-500";
    default:
      return "bg-emerald-500";
  }
}

export function YieldTab({ address }: YieldTabProps) {
  const { adapters } = useAdapterRegistry();
  const [allowExternalAdapters, setAllowExternalAdapters] = useState(false);
  const [blendedApy, setBlendedApy] = useState<number | null>(null);
  const [totalEarned, setTotalEarned] = useState<number | null>(null);
  const [sources, setSources] = useState<SourceRow[]>(FALLBACK_SOURCES);

  useEffect(() => {
    if (!address) return;
    let dead = false;

    (async () => {
      const statsUrl = API_BASE + "/v1/zkdefi/private-yield/vault/stats";
      const blendedUrl = API_BASE + "/v1/zkdefi/private-yield/yield/blended";
      const [vr, br] = await Promise.allSettled([
        fetch(statsUrl, { signal: AbortSignal.timeout(6000) }),
        fetch(blendedUrl, { signal: AbortSignal.timeout(6000) }),
      ]);
      if (dead) return;
      if (vr.status === "fulfilled" && vr.value.ok) {
        const d = await vr.value.json();
        const yieldVal = d.total_yield_eth ?? d.total_yield ?? null;
        if (yieldVal != null) setTotalEarned(Number(yieldVal));

        const ekuboPct = Number(d.ekubo_pct ?? 0);
        const lendingPct = Number(d.lending_pct ?? 0);
        const idlePct = Number(d.idle_pct ?? 0);
        const stakingPct = Math.max(0, 100 - ekuboPct - lendingPct - idlePct);
        const ekuboApyBps = Number(d.ekubo_apy_bps ?? 0);
        const lendingApyBps = Number(d.lending_apy_bps ?? 0);

        if (ekuboPct > 0 || lendingPct > 0 || idlePct > 0) {
          const built: SourceRow[] = [];
          if (ekuboPct > 0) built.push({ name: "Ekubo LP", allocation: ekuboPct, apy: ekuboApyBps / 100, earned: 0, status: "earning" });
          if (lendingPct > 0) built.push({ name: "Lending", allocation: lendingPct, apy: lendingApyBps / 100, earned: 0, status: "earning" });
          if (stakingPct > 0) built.push({ name: "Staking", allocation: stakingPct, apy: 0, earned: 0, status: "earning" });
          if (idlePct > 0) built.push({ name: "Idle", allocation: idlePct, apy: 0, earned: 0, status: "available" });
          setSources(built);
        }
      }
      if (br.status === "fulfilled" && br.value.ok) {
        const d = await br.value.json();
        const apyVal = d.blended_apy_pct ?? d.blended_apy ?? null;
        if (apyVal != null) setBlendedApy(Number(apyVal));

        const ekubo = d.ekubo_contribution;
        const lending = d.lending_contribution;
        if (ekubo || lending) {
          const apyBpsEkubo = Number(ekubo?.apy_bps ?? 0);
          const apyBpsLending = Number(lending?.apy_bps ?? 0);
          setSources((prev) => prev.map((s) => {
            if (s.name === "Ekubo LP" && apyBpsEkubo > 0) return { ...s, apy: apyBpsEkubo / 100 };
            if (s.name === "Lending" && apyBpsLending > 0) return { ...s, apy: apyBpsLending / 100 };
            return s;
          }));
        }
      }
    })();

    return () => {
      dead = true;
    };
  }, [address]);

  const statusDot = (s: string) =>
    s === "earning"
      ? "bg-emerald-400"
      : s === "available"
        ? "bg-white/30"
        : "bg-amber-400";

  const adapterHealthMap = Object.fromEntries(adapters.map((a) => [a.name, a.health]));
  const visibleSources = allowExternalAdapters
    ? sources
    : sources.filter((s) => FIRST_PARTY_NAMES.has(s.name) || s.name === "Idle");

  const cards = [
    { icon: Percent, label: "Blended APY", value: blendedApy != null ? blendedApy.toFixed(1) + "%" : "--" },
    { icon: TrendingUp, label: "Total Earned", value: totalEarned != null ? "+" + totalEarned.toFixed(2) + " ETH" : "--" },
    { icon: Clock, label: "Next Harvest", value: blendedApy != null && blendedApy > 0 ? `est. ${(blendedApy / 365 * 30).toFixed(2)}% /mo` : "--" },
  ];

  // Show Deploy to Ekubo card if user has vault balance but no active Ekubo position
  const hasVaultBalance = totalEarned !== null || sources.some((s) => s.allocation > 0);
  const hasEkuboPosition = sources.some((s) => s.name === "Ekubo LP" && s.allocation > 0);
  const showDeployCard = hasVaultBalance && !hasEkuboPosition;

  return (
    <div className="space-y-5">
      {/* Deploy to Ekubo promotion (shown when user has balance but no Ekubo position) */}
      {showDeployCard && address && (
        <DeployToEkuboCard
          userAddress={address}
          onEvent={() => {
            // Refetch sources after deployment
            window.location.reload();
          }}
        />
      )}

      {/* summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="border border-white/10 rounded-xl bg-white/[0.02] p-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <c.icon className="w-4 h-4 text-white/40" />
              <span className="text-xs text-white/40">{c.label}</span>
            </div>
            <div className="text-xl font-semibold text-white">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-400/80 flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          Capital deployed to Ekubo and lending adapters remains shielded. Yield is harvested to your vault without exposing position sizes or strategy allocation.
        </span>
      </div>

      {/* sources table */}
      <div className="border border-white/10 rounded-xl bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5">
          <span className="text-sm font-medium text-white/70">Yield Sources</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-white/40 border-b border-white/5">
              <th className="text-left px-4 py-2 font-medium">Source</th>
              <th className="text-right px-4 py-2 font-medium">Allocation</th>
              <th className="text-right px-4 py-2 font-medium">APY</th>
              <th className="text-right px-4 py-2 font-medium">Earned (30d)</th>
              <th className="text-right px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleSources.map((s) => (
              <tr key={s.name} className="border-b border-white/[0.03] last:border-0">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 shrink-0 rounded-full ${healthDotColor(adapterHealthMap[s.name])}`}
                      title={adapterHealthMap[s.name] ?? "HEALTHY"}
                    />
                    <span className="text-white/80">{s.name}</span>
                    {FIRST_PARTY_NAMES.has(s.name) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />
                        Verified by Obsqra
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right text-white/60">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-400"
                        style={{ width: s.allocation + "%" }}
                      />
                    </div>
                    <span>{s.allocation}%</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right text-emerald-400">
                  {s.apy > 0 ? s.apy + "%" : "--"}
                </td>
                <td className="px-4 py-2.5 text-right text-white/60">
                  {s.earned > 0 ? "+" + s.earned.toFixed(1) + " STRK" : "--"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className={"w-1.5 h-1.5 rounded-full " + statusDot(s.status)} />
                    <span className="text-white/40 capitalize">{s.status}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between gap-3">
          <span className="text-xs text-white/50">Allow external adapters (advanced)</span>
          <button
            type="button"
            role="switch"
            aria-checked={allowExternalAdapters}
            onClick={() => setAllowExternalAdapters((v) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-white/20 ${
              allowExternalAdapters ? "border-emerald-500/50 bg-emerald-500/20" : "border-white/20 bg-white/5"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                allowExternalAdapters ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* deploy to ekubo */}
      {address && (
        <div className="border border-emerald-500/20 rounded-xl bg-emerald-500/[0.03] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">Deploy Capital to Ekubo</span>
          </div>
          <DeployToEkuboCard userAddress={address} />
        </div>
      )}

      {/* performance */}
      <YieldChart />
    </div>
  );
}
