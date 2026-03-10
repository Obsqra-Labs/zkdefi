"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers, ShieldCheck, TrendingUp } from "lucide-react";
import type { PrivacyMethod, VaultCommitment } from "@/hooks/usePrivacyVault";
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
}

// ---------------------------------------------------------------------------
// Pool ordering
// ---------------------------------------------------------------------------

/** Canonical pool keys in display order */
const POOL_ORDER = ["conservative", "moderate", "aggressive"] as const;
type PoolKey = (typeof POOL_ORDER)[number];

// ---------------------------------------------------------------------------
// Styling maps
// ---------------------------------------------------------------------------

const METHOD_COLORS: Record<PrivacyMethod, { bg: string; text: string; bar: string }> = {
  commitment_shield: { bg: "bg-blue-400/10", text: "text-blue-400", bar: "bg-blue-400" },
  nullifier_set: { bg: "bg-emerald-400/10", text: "text-emerald-400", bar: "bg-emerald-400" },
  hashed_proof: { bg: "bg-amber-400/10", text: "text-amber-400", bar: "bg-amber-400" },
};

const METHOD_LABELS: Record<PrivacyMethod, string> = {
  commitment_shield: "Shield",
  nullifier_set: "Full Privacy",
  hashed_proof: "Hashed Proof",
};

const SHIELDED_METHODS: PrivacyMethod[] = ["nullifier_set", "hashed_proof"];

const POOL_COLORS: Record<string, { bg: string; text: string; bar: string; border: string }> = {
  conservative: { bg: "bg-blue-500/10", text: "text-blue-400", bar: "bg-blue-400", border: "border-blue-500/20" },
  moderate:     { bg: "bg-emerald-500/10", text: "text-emerald-400", bar: "bg-emerald-400", border: "border-emerald-500/20" },
  balanced:     { bg: "bg-emerald-500/10", text: "text-emerald-400", bar: "bg-emerald-400", border: "border-emerald-500/20" },
  aggressive:   { bg: "bg-orange-500/10", text: "text-orange-400", bar: "bg-orange-400", border: "border-orange-500/20" },
};

const POOL_LABELS: Record<string, string> = {
  conservative: "Conservative",
  moderate: "Moderate",
  balanced: "Moderate",
  aggressive: "Aggressive",
};

const POOL_DESCRIPTIONS: Record<string, string> = {
  conservative: "80/20 Stablecoin-weighted",
  moderate: "50/50 Balanced allocation",
  aggressive: "20/80 High-yield strategies",
};

const FALLBACK_DEPLOYMENT = [
  { source: "Ekubo LP", pct: 45, color: "bg-emerald-400" },
  { source: "Lending", pct: 30, color: "bg-blue-400" },
  { source: "Staking", pct: 20, color: "bg-violet-400" },
  { source: "Idle", pct: 5, color: "bg-zinc-500" },
];

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 7) return `${Math.floor(days / 7)}w ago`;
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h ago`;
  return "just now";
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

/** Normalize pool_variant / pool_type to canonical pool key */
function resolvePoolKey(c: VaultCommitment): PoolKey {
  const v = c.pool_variant?.toLowerCase();
  if (v === "conservative" || v === "moderate" || v === "aggressive") return v;
  if (v === "balanced" || v === "neutral") return "moderate";
  // Fallback: pool_type number → key
  if (c.pool_type === 0) return "conservative";
  if (c.pool_type === 2) return "aggressive";
  return "moderate"; // default
}

// ---------------------------------------------------------------------------
// Pool group type
// ---------------------------------------------------------------------------

interface PoolGroup {
  key: PoolKey;
  commitments: VaultCommitment[];
  totalWei: bigint;
  yieldWei: bigint;
  methodCounts: Partial<Record<PrivacyMethod, number>>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PositionsOverview({
  commitments,
  onSelectCommitment,
  address,
  walletBalance = "0",
}: PositionsOverviewProps) {
  const [view, setView] = useState<"privacy" | "public">("privacy");
  const [deployment, setDeployment] = useState(FALLBACK_DEPLOYMENT);
  const [poolApys, setPoolApys] = useState<Record<string, number>>({});
  const [expandedPools, setExpandedPools] = useState<Set<PoolKey>>(new Set(POOL_ORDER));

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
      .catch(() => {
        /* keep fallback */
      });
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
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // ---- Derived data ----

  /** Group commitments by pool */
  const poolGroups = useMemo<PoolGroup[]>(() => {
    const map: Record<PoolKey, PoolGroup> = {
      conservative: { key: "conservative", commitments: [], totalWei: BigInt(0), yieldWei: BigInt(0), methodCounts: {} },
      moderate: { key: "moderate", commitments: [], totalWei: BigInt(0), yieldWei: BigInt(0), methodCounts: {} },
      aggressive: { key: "aggressive", commitments: [], totalWei: BigInt(0), yieldWei: BigInt(0), methodCounts: {} },
    };
    for (const c of commitments) {
      const pk = resolvePoolKey(c);
      const g = map[pk];
      g.commitments.push(c);
      g.totalWei += BigInt(c.amount_wei || "0");
      if (c.yield_accrued) g.yieldWei += BigInt(c.yield_accrued);
      g.methodCounts[c.method] = (g.methodCounts[c.method] ?? 0) + 1;
    }
    return POOL_ORDER.map((k) => map[k]);
  }, [commitments]);

  const totalValueWei = useMemo(
    () => poolGroups.reduce((a, g) => a + g.totalWei, BigInt(0)),
    [poolGroups],
  );

  const privacyCoverage = useMemo(() => {
    if (totalValueWei === BigInt(0)) return 0;
    const shielded = commitments
      .filter((c) => SHIELDED_METHODS.includes(c.method))
      .reduce((sum, c) => sum + BigInt(c.amount_wei || "0"), BigInt(0));
    return Math.round(Number((shielded * BigInt(100)) / totalValueWei));
  }, [commitments, totalValueWei]);

  const yieldTotal = useMemo(() => {
    const total = poolGroups.reduce((a, g) => a + g.yieldWei, BigInt(0));
    return total > BigInt(0) ? total : null;
  }, [poolGroups]);

  // Pipeline balances (ETH strings)
  const totalEth = Number(totalValueWei) / 1e18;
  const idlePct = deployment.find((d) => d.source === "Idle")?.pct ?? 0;
  const deployedEth = totalEth * (1 - idlePct / 100);
  const idleEth = totalEth * (idlePct / 100);

  const togglePool = (k: PoolKey) => {
    setExpandedPools((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  };

  // ---- Render ----

  return (
    <div className="border border-white/10 rounded-xl bg-white/[0.02] p-5 space-y-5">
      <CapitalFlowPipeline
        walletBalance={walletBalance}
        shieldedBalance={totalEth.toFixed(2)}
        deployedBalance={deployedEth.toFixed(2)}
        idleBalance={idleEth.toFixed(2)}
      />

      {/* Privacy / Public toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80 tracking-wide uppercase">
          Your Positions
        </h3>
        <div className="flex gap-1 rounded-lg bg-white/[0.04] p-0.5">
          <button
            onClick={() => setView("privacy")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors ${
              view === "privacy"
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            <EyeOff size={12} />
            Privacy View
          </button>
          <button
            onClick={() => setView("public")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors ${
              view === "public"
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            <Eye size={12} />
            Public View
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
          <div className="flex items-center gap-1.5 text-white/40 text-[11px] mb-1">
            <Layers size={12} />
            Total Value
          </div>
          <div className="text-white text-sm font-medium">
            {totalValueWei === BigInt(0)
              ? "--"
              : `${formatWeiShort(totalValueWei)} STRK`}
          </div>
        </div>

        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
          <div className="flex items-center gap-1.5 text-white/40 text-[11px] mb-1">
            <ShieldCheck size={12} />
            Privacy Coverage
          </div>
          <div className="text-white text-sm font-medium">
            {commitments.length === 0 ? "--" : `${privacyCoverage}% shielded`}
          </div>
        </div>

        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
          <div className="flex items-center gap-1.5 text-white/40 text-[11px] mb-1">
            <TrendingUp size={12} />
            Yield Earned (30d)
          </div>
          <div className="text-white text-sm font-medium">
            {yieldTotal !== null ? formatWei(yieldTotal.toString(), "STRK") : "--"}
          </div>
        </div>
      </div>

      {/* ── Pool-centric position groups ── */}
      {commitments.length === 0 ? (
        <p className="text-center text-white/30 text-sm py-6">No positions yet — deposit to get started</p>
      ) : (
        <div className="space-y-3">
          {/* Pool allocation bar */}
          <div className="space-y-2">
            <div className="flex h-2.5 rounded-full overflow-hidden bg-white/[0.04]">
              {poolGroups.map((g) => {
                if (g.totalWei === BigInt(0) || totalValueWei === BigInt(0)) return null;
                const pct = Number((g.totalWei * BigInt(10000)) / totalValueWei) / 100;
                return (
                  <div
                    key={g.key}
                    className={`${POOL_COLORS[g.key].bar} first:rounded-l-full last:rounded-r-full`}
                    style={{ width: `${pct}%` }}
                    title={`${POOL_LABELS[g.key]}: ${pct.toFixed(1)}%`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {poolGroups.filter((g) => g.totalWei > BigInt(0)).map((g) => (
                <div key={g.key} className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <span className={`inline-block w-2 h-2 rounded-full ${POOL_COLORS[g.key].bar}`} />
                  <span>{POOL_LABELS[g.key]}</span>
                  <span className="text-white/30">
                    {formatWeiShort(g.totalWei)} STRK
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Pool groups */}
          {poolGroups.map((g) => {
            const apy = poolApys[g.key] ?? poolApys[POOL_LABELS[g.key]?.toLowerCase() ?? ""] ?? null;
            const colors = POOL_COLORS[g.key];
            const expanded = expandedPools.has(g.key);
            const hasPositions = g.commitments.length > 0;

            return (
              <div key={g.key} className={`rounded-lg border ${colors.border} ${colors.bg} overflow-hidden`}>
                {/* Pool header — always shown */}
                <button
                  onClick={() => hasPositions && togglePool(g.key)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-3">
                    {hasPositions ? (
                      expanded ? <ChevronDown size={14} className="text-white/30" /> : <ChevronRight size={14} className="text-white/30" />
                    ) : (
                      <div className="w-3.5" />
                    )}
                    <div>
                      <span className={`text-sm font-semibold ${colors.text}`}>
                        {POOL_LABELS[g.key]}
                      </span>
                      <span className="text-[11px] text-white/30 ml-2">
                        {POOL_DESCRIPTIONS[g.key]}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    {apy != null && (
                      <span className="text-emerald-400 font-medium">{apy.toFixed(1)}% APY</span>
                    )}
                    {hasPositions ? (
                      <>
                        <span className="text-white/60 font-medium">
                          {formatWeiShort(g.totalWei)} STRK
                        </span>
                        <span className="text-white/30">
                          {g.commitments.length} position{g.commitments.length > 1 ? "s" : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-white/20">No positions</span>
                    )}
                  </div>
                </button>

                {/* Expanded: show commitments */}
                {hasPositions && expanded && (
                  <div className="border-t border-white/[0.06] px-4 pb-3 pt-2 space-y-1.5">
                    {/* Privacy View — aggregated only */}
                    {view === "privacy" ? (
                      <div className="flex flex-wrap gap-2 py-1">
                        {(Object.entries(g.methodCounts) as [PrivacyMethod, number][]).map(([m, count]) => (
                          <div key={m} className="flex items-center gap-1.5 text-xs">
                            <span className={`px-2 py-0.5 rounded ${METHOD_COLORS[m].bg} ${METHOD_COLORS[m].text}`}>
                              {METHOD_LABELS[m]}
                            </span>
                            <span className="text-white/40">
                              {count} position{count > 1 ? "s" : ""}
                            </span>
                          </div>
                        ))}
                        <div className="ml-auto text-[11px] text-white/30 self-center">
                          aggregated — individual positions hidden
                        </div>
                      </div>
                    ) : (
                      /* Public View — per-commitment rows */
                      <div className="space-y-1">
                        {g.commitments.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => onSelectCommitment?.(c.id)}
                            className="flex items-center justify-between rounded-md px-3 py-2 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-white/80 text-xs font-medium min-w-[100px]">
                                {formatWei(c.amount_wei, c.asset)}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[11px] ${METHOD_COLORS[c.method].bg} ${METHOD_COLORS[c.method].text}`}>
                                {METHOD_LABELS[c.method]}
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
                )}
              </div>
            );
          })}

          {/* Totals row */}
          <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-white/[0.03] border border-white/5 text-xs">
            <span className="text-white/50 font-medium uppercase tracking-wide">Total Portfolio</span>
            <div className="flex items-center gap-4">
              <span className="text-white font-semibold">
                {formatWeiShort(totalValueWei)} STRK
              </span>
              <span className="text-white/30">
                {commitments.length} commitment{commitments.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Capital Deployed */}
      <div className="space-y-2">
        <h4 className="text-[11px] text-white/40 uppercase tracking-wide">Capital Deployed</h4>
        <div className="grid grid-cols-2 gap-2">
          {deployment.map((d) => (
            <div
              key={d.source}
              className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-white/60 truncate">{d.source}</span>
                  <span className="text-white/40 ml-2">{d.pct}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${d.color}`}
                    style={{ width: `${d.pct}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
