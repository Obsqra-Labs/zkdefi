"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers, Lock, ShieldCheck, TrendingUp, Zap, ExternalLink } from "lucide-react";
import type { VaultCommitment } from "@/hooks/usePrivacyVault";
import type { EkuboPosition } from "@/lib/api/ekubo";
import { API_BASE } from "@/lib/api/client";
import { CapitalFlowPipeline } from "./CapitalFlowPipeline";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PositionsOverviewProps {
  commitments: VaultCommitment[];
  onSelectCommitment?: (id: string) => void;
  address?: string;
  walletBalance?: string;
  /** Real Ekubo positions from direct API */
  ekuboPositions?: EkuboPosition[];
}

// ---------------------------------------------------------------------------
// Adapter / Strategy styling
// ---------------------------------------------------------------------------

type AdapterKey = "ekubo_lp" | "lending" | "staking" | "idle";

const ADAPTER_META: Record<
  AdapterKey,
  { label: string; icon: string; color: string; bg: string; text: string; border: string; bar: string }
> = {
  ekubo_lp: {
    label: "Ekubo LP",
    icon: "🔄",
    color: "emerald",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
    bar: "bg-emerald-400",
  },
  lending: {
    label: "Lending",
    icon: "🏦",
    color: "blue",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
    bar: "bg-blue-400",
  },
  staking: {
    label: "Staking",
    icon: "⚡",
    color: "violet",
    bg: "bg-violet-500/10",
    text: "text-violet-400",
    border: "border-violet-500/20",
    bar: "bg-violet-400",
  },
  idle: {
    label: "Idle",
    icon: "💤",
    color: "zinc",
    bg: "bg-zinc-500/10",
    text: "text-zinc-400",
    border: "border-zinc-500/20",
    bar: "bg-zinc-500",
  },
};

const FALLBACK_DEPLOYMENT = [
  { source: "Ekubo LP", pct: 45, color: "bg-emerald-400" },
  { source: "Lending", pct: 30, color: "bg-blue-400" },
  { source: "Staking", pct: 20, color: "bg-violet-400" },
  { source: "Idle", pct: 5, color: "bg-zinc-500" },
];

/** Map deployment source names → adapter keys */
function sourceToAdapter(source: string): AdapterKey {
  const s = source.toLowerCase();
  if (s.includes("ekubo") || s.includes("lp")) return "ekubo_lp";
  if (s.includes("lend")) return "lending";
  if (s.includes("stak")) return "staking";
  return "idle";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatWei(wei: string, asset: string): string {
  const value = Number(BigInt(wei || "0")) / 1e18;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${asset}`;
}

function formatWeiShort(wei: bigint): string {
  const value = Number(wei) / 1e18;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return "<$0.01";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAmount(v: number): string {
  if (v === 0) return "0";
  if (v < 0.0001) return "<0.0001";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 7) return `${Math.floor(days / 7)}w ago`;
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h ago`;
  return "just now";
}

// ---------------------------------------------------------------------------
// Adapter group type
// ---------------------------------------------------------------------------

interface AdapterGroup {
  key: AdapterKey;
  pct: number;
  deployedWei: bigint;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PositionsOverview({
  commitments,
  onSelectCommitment,
  address,
  walletBalance = "0",
  ekuboPositions = [],
}: PositionsOverviewProps) {
  const [deployment, setDeployment] = useState(FALLBACK_DEPLOYMENT);
  const [poolApys, setPoolApys] = useState<Record<string, number>>({});
  const [expandedAdapter, setExpandedAdapter] = useState<AdapterKey | null>(null);
  const [expandedEkubo, setExpandedEkubo] = useState(false);

  // Fetch capital deployment stats
  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    fetch(`${API_BASE}/v1/zkdefi/private-yield/vault/stats`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const ekuboPct = Number(data?.ekubo_pct ?? 0);
        const lendingPct = Number(data?.lending_pct ?? 0);
        const idlePct = Number(data?.idle_pct ?? 0);
        const stakingPct = Math.max(0, 100 - ekuboPct - lendingPct - idlePct);

        if (ekuboPct > 0 || lendingPct > 0 || idlePct > 0) {
          const built: typeof FALLBACK_DEPLOYMENT = [];
          if (ekuboPct > 0) built.push({ source: "Ekubo LP", pct: ekuboPct, color: "bg-emerald-400" });
          if (lendingPct > 0) built.push({ source: "Lending", pct: lendingPct, color: "bg-blue-400" });
          if (stakingPct > 0) built.push({ source: "Staking", pct: stakingPct, color: "bg-violet-400" });
          if (idlePct > 0) built.push({ source: "Idle", pct: idlePct, color: "bg-zinc-500" });
          setDeployment(built);
        }
      })
      .catch((e) => console.warn("Deployment positions fetch failed:", e));
    return () => controller.abort();
  }, [address]);

  // Fetch pool APYs
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/v1/zkdefi/oracle/pool-apys`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const apys: Record<string, number> = {};
        if (Array.isArray(data)) {
          for (const d of data) {
            const pct = d.blended_apy_pct ?? d.blended_apy ?? null;
            const key = (d.pool_type ?? d.name ?? "").toLowerCase();
            if (pct != null && key) apys[key] = Number(pct);
          }
        }
        setPoolApys(apys);
      })
      .catch((e) => console.warn("Pool APY fetch failed:", e));
    return () => controller.abort();
  }, []);

  // ---- Derived data ----

  const totalValueWei = useMemo(
    () => commitments.reduce((sum, c) => sum + BigInt(c.amount_wei || "0"), BigInt(0)),
    [commitments],
  );

  const yieldTotal = useMemo(() => {
    const total = commitments.reduce(
      (sum, c) => sum + BigInt(c.yield_accrued || "0"),
      BigInt(0),
    );
    return total > BigInt(0) ? total : null;
  }, [commitments]);

  const adapterGroups = useMemo<AdapterGroup[]>(() => {
    return deployment.map((d) => {
      const key = sourceToAdapter(d.source);
      const deployedWei =
        totalValueWei > BigInt(0)
          ? (totalValueWei * BigInt(Math.round(d.pct * 100))) / BigInt(10000)
          : BigInt(0);
      return { key, pct: d.pct, deployedWei };
    });
  }, [deployment, totalValueWei]);

  const blendedApy = useMemo(() => {
    const values = Object.values(poolApys);
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [poolApys]);

  // Pipeline balances
  const totalEth = Number(totalValueWei) / 1e18;
  const idlePct = deployment.find((d) => d.source === "Idle")?.pct ?? 0;
  const deployedEth = totalEth * (1 - idlePct / 100);
  const idleEth = totalEth * (idlePct / 100);

  const activeStrategies = deployment.filter((d) => d.pct > 0 && d.source !== "Idle").length;

  // Ekubo aggregations
  const ekuboTotalUsd = useMemo(
    () => ekuboPositions.reduce((s, p) => s + (p.estimated_value_usd ?? 0), 0),
    [ekuboPositions],
  );

  // Group Ekubo positions by token pair
  const ekuboGrouped = useMemo(() => {
    const groups: Record<string, { pair: string; positions: EkuboPosition[]; totalUsd: number }> = {};
    for (const p of ekuboPositions) {
      const pair = `${p.token0Symbol}/${p.token1Symbol}`;
      if (!groups[pair]) groups[pair] = { pair, positions: [], totalUsd: 0 };
      groups[pair].positions.push(p);
      groups[pair].totalUsd += p.estimated_value_usd ?? 0;
    }
    return Object.values(groups).sort((a, b) => b.positions.length - a.positions.length);
  }, [ekuboPositions]);

  const hasContent = commitments.length > 0 || ekuboPositions.length > 0;

  // ---- Render ----

  return (
    <div className="border border-white/10 rounded-xl bg-white/[0.02] p-5 space-y-5">
      <CapitalFlowPipeline
        walletBalance={walletBalance}
        shieldedBalance={totalEth.toFixed(2)}
        deployedBalance={deployedEth.toFixed(2)}
        idleBalance={idleEth.toFixed(2)}
        ekuboPositionCount={ekuboPositions.length}
        ekuboTotalUsd={ekuboTotalUsd}
      />

      {/* ── Shielded Vault Banner ── */}
      <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-400/15">
          <Lock size={16} className="text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-300">Shielded Vault</div>
          <div className="text-[11px] text-amber-400/60">
            All deposits use hashed proofs — your vault is fully shielded by default
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/10 text-amber-400 text-[11px] font-medium">
          <ShieldCheck size={12} />
          100% Shielded
        </div>
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80 tracking-wide uppercase">
          Your Positions
        </h3>
        <div className="flex items-center gap-3">
          {blendedApy != null && (
            <span className="text-emerald-400 text-xs font-medium">
              ~{blendedApy.toFixed(1)}% blended APY
            </span>
          )}
          {ekuboPositions.length > 0 && (
            <span className="text-cyan-400 text-xs font-medium">
              {ekuboPositions.length} Ekubo positions
            </span>
          )}
        </div>
      </div>

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
          <div className="flex items-center gap-1.5 text-white/40 text-[11px] mb-1">
            <Layers size={12} />
            Vault Value
          </div>
          <div className="text-white text-sm font-medium">
            {totalValueWei === BigInt(0) ? "--" : `${formatWeiShort(totalValueWei)} STRK`}
          </div>
        </div>

        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
          <div className="flex items-center gap-1.5 text-white/40 text-[11px] mb-1">
            <Zap size={12} />
            Active Strategies
          </div>
          <div className="text-white text-sm font-medium">
            {!hasContent ? "--" : `${activeStrategies} adapter${activeStrategies !== 1 ? "s" : ""}`}
          </div>
        </div>

        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
          <div className="flex items-center gap-1.5 text-white/40 text-[11px] mb-1">
            <TrendingUp size={12} />
            Ekubo LP Value
          </div>
          <div className="text-white text-sm font-medium">
            {ekuboTotalUsd > 0 ? fmtUsd(ekuboTotalUsd) : ekuboPositions.length > 0 ? `${ekuboPositions.length} active` : "--"}
          </div>
        </div>
      </div>

      {!hasContent ? (
        <p className="text-center text-white/30 text-sm py-6">
          No positions yet — deposit to get started
        </p>
      ) : (
        <div className="space-y-3">
          {/* ═══ Ekubo LP Positions (real on-chain) ═══ */}
          {ekuboPositions.length > 0 && (
            <div className={`rounded-lg border ${ADAPTER_META.ekubo_lp.border} ${ADAPTER_META.ekubo_lp.bg} overflow-hidden`}>
              <button
                onClick={() => setExpandedEkubo((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {expandedEkubo ? (
                    <ChevronDown size={14} className="text-white/30" />
                  ) : (
                    <ChevronRight size={14} className="text-white/30" />
                  )}
                  <span className="text-base">🔄</span>
                  <div>
                    <span className="text-sm font-semibold text-emerald-400">Ekubo LP</span>
                    <span className="text-[11px] text-white/30 ml-2">
                      {ekuboPositions.length} position{ekuboPositions.length !== 1 ? "s" : ""} • {ekuboGrouped.length} pair{ekuboGrouped.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-white/60 font-medium">
                    {ekuboTotalUsd > 0 ? fmtUsd(ekuboTotalUsd) : "Active"}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-400/10 text-emerald-400">On-chain</span>
                </div>
              </button>

              {expandedEkubo && (
                <div className="border-t border-white/[0.06] px-4 pb-3 pt-2 space-y-3">
                  {ekuboGrouped.map((group) => (
                    <div key={group.pair}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-emerald-300">{group.pair}</span>
                        <span className="text-[10px] text-white/30">
                          {group.positions.length} position{group.positions.length !== 1 ? "s" : ""}
                          {group.totalUsd > 0 ? ` • ${fmtUsd(group.totalUsd)}` : ""}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {group.positions.map((p) => (
                          <div
                            key={p.position_id}
                            className="flex items-center justify-between rounded-md px-3 py-2 bg-white/[0.02] hover:bg-white/[0.05] transition-colors text-xs"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-white/70 font-mono">
                                #{p.position_id.replace(/^0x/, "").slice(0, 6)}
                              </span>
                              <span className="text-white/50">
                                {fmtAmount(p.amount0)} {p.token0Symbol} + {fmtAmount(p.amount1)} {p.token1Symbol}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-[10px] text-white/30">
                                ticks {p.bounds.lower}–{p.bounds.upper}
                              </span>
                              {p.estimated_value_usd > 0 && (
                                <span className="text-emerald-400 font-medium">{fmtUsd(p.estimated_value_usd)}</span>
                              )}
                              {p.image && (
                                <a
                                  href={p.image}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-zinc-600 hover:text-cyan-400 transition-colors"
                                  title="View position"
                                >
                                  <ExternalLink size={10} />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Vault Commitments (privacy deposits) ═══ */}
          {commitments.length > 0 && (
            <>
              {/* Adapter allocation bar */}
              <div className="space-y-2">
                <h4 className="text-[11px] text-white/40 uppercase tracking-wide">
                  Capital Deployment
                </h4>
                <div className="flex h-3 rounded-full overflow-hidden bg-white/[0.04]">
                  {adapterGroups.map((ag) => {
                    if (ag.pct <= 0) return null;
                    const meta = ADAPTER_META[ag.key];
                    return (
                      <div
                        key={ag.key}
                        className={`${meta.bar} first:rounded-l-full last:rounded-r-full transition-all`}
                        style={{ width: `${ag.pct}%` }}
                        title={`${meta.label}: ${ag.pct}%`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {adapterGroups
                    .filter((ag) => ag.pct > 0)
                    .map((ag) => {
                      const meta = ADAPTER_META[ag.key];
                      return (
                        <div key={ag.key} className="flex items-center gap-1.5 text-[11px] text-white/50">
                          <span className={`inline-block w-2 h-2 rounded-full ${meta.bar}`} />
                          <span>{meta.label}</span>
                          <span className="text-white/30">{ag.pct}%</span>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Adapter strategy cards */}
              {adapterGroups.map((ag) => {
                if (ag.pct <= 0) return null;
                const meta = ADAPTER_META[ag.key];
                const expanded = expandedAdapter === ag.key;

                return (
                  <div key={ag.key} className={`rounded-lg border ${meta.border} ${meta.bg} overflow-hidden`}>
                    <button
                      onClick={() => setExpandedAdapter(expanded ? null : ag.key)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-3">
                        {expanded ? (
                          <ChevronDown size={14} className="text-white/30" />
                        ) : (
                          <ChevronRight size={14} className="text-white/30" />
                        )}
                        <span className="text-base">{meta.icon}</span>
                        <div>
                          <span className={`text-sm font-semibold ${meta.text}`}>{meta.label}</span>
                          <span className="text-[11px] text-white/30 ml-2">
                            {ag.pct}% of vault
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-white/60 font-medium">
                          {ag.deployedWei > BigInt(0) ? `${formatWeiShort(ag.deployedWei)} STRK` : "--"}
                        </span>
                      </div>
                    </button>

                    {expanded && (
                      <div className="border-t border-white/[0.06] px-4 pb-3 pt-2 space-y-1.5">
                        <div className="text-[11px] text-white/30 mb-2">
                          Positions deployed via {meta.label} adapter
                        </div>
                        {commitments.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => onSelectCommitment?.(c.id)}
                            className="flex items-center justify-between rounded-md px-3 py-2 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-white/80 text-xs font-medium min-w-[100px]">
                                {formatWei(c.amount_wei, c.asset)}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[11px] bg-amber-400/10 text-amber-400">
                                Shielded
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-[11px]">
                              <span className="text-white/40">
                                {c.yield_accrued ? formatWei(c.yield_accrued, c.asset) : "—"}
                              </span>
                              <span className="text-white/30 min-w-[40px] text-right">
                                {timeAgo(c.deposited_at)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Totals row */}
          <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-white/[0.03] border border-white/5 text-xs">
            <span className="text-white/50 font-medium uppercase tracking-wide">
              Total Portfolio
            </span>
            <div className="flex items-center gap-4">
              {totalValueWei > BigInt(0) && (
                <span className="text-white font-semibold">
                  {formatWeiShort(totalValueWei)} STRK
                </span>
              )}
              {ekuboTotalUsd > 0 && (
                <span className="text-emerald-400 font-semibold">
                  {fmtUsd(ekuboTotalUsd)} Ekubo
                </span>
              )}
              <span className="text-white/30">
                {commitments.length + ekuboPositions.length} position{(commitments.length + ekuboPositions.length) !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
