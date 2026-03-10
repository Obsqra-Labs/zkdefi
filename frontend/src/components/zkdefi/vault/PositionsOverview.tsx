"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Layers, ShieldCheck, TrendingUp } from "lucide-react";
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

const POOL_VARIANT_COLORS: Record<string, { bg: string; text: string }> = {
  conservative: { bg: "bg-blue-500/15", text: "text-blue-400" },
  moderate: { bg: "bg-emerald-500/15", text: "text-emerald-400" },
  balanced: { bg: "bg-emerald-500/15", text: "text-emerald-400" },
  aggressive: { bg: "bg-orange-500/15", text: "text-orange-400" },
};

const POOL_VARIANT_LABELS: Record<string, string> = {
  conservative: "Conservative",
  moderate: "Moderate",
  balanced: "Moderate",
  aggressive: "Aggressive",
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

  // ---- Derived data ----

  const totalByAsset = useMemo(() => {
    const map: Record<string, bigint> = {};
    for (const c of commitments) {
      map[c.asset] = (map[c.asset] ?? BigInt(0)) + BigInt(c.amount_wei || "0");
    }
    return map;
  }, [commitments]);

  const totalValueWei = useMemo(
    () => Object.values(totalByAsset).reduce((a, b) => a + b, BigInt(0)),
    [totalByAsset],
  );

  const privacyCoverage = useMemo(() => {
    if (totalValueWei === BigInt(0)) return 0;
    const shielded = commitments
      .filter((c) => SHIELDED_METHODS.includes(c.method))
      .reduce((sum, c) => sum + BigInt(c.amount_wei || "0"), BigInt(0));
    return Math.round(Number((shielded * BigInt(100)) / totalValueWei));
  }, [commitments, totalValueWei]);

  const yieldTotal = useMemo(() => {
    let total = BigInt(0);
    let hasYield = false;
    for (const c of commitments) {
      if (c.yield_accrued) {
        total += BigInt(c.yield_accrued);
        hasYield = true;
      }
    }
    return hasYield ? total : null;
  }, [commitments]);

  const byMethod = useMemo(() => {
    const map: Partial<Record<PrivacyMethod, { count: number; total: bigint }>> = {};
    for (const c of commitments) {
      const entry = map[c.method] ?? { count: 0, total: BigInt(0) };
      entry.count += 1;
      entry.total += BigInt(c.amount_wei || "0");
      map[c.method] = entry;
    }
    return map;
  }, [commitments]);

  const methodKeys = (Object.keys(byMethod) as PrivacyMethod[]).filter(
    (m) => byMethod[m]!.total > BigInt(0),
  );

  // Pipeline balances (ETH strings)
  const totalEth = Number(totalValueWei) / 1e18;
  const idlePct = deployment.find((d) => d.source === "Idle")?.pct ?? 0;
  const deployedEth = totalEth * (1 - idlePct / 100);
  const idleEth = totalEth * (idlePct / 100);

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
          Positions Overview
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
            {Object.keys(totalByAsset).length === 0
              ? "--"
              : Object.entries(totalByAsset).map(([asset, wei]) => (
                  <span key={asset} className="block">
                    {formatWei(wei.toString(), asset as "STRK" | "ETH")}
                  </span>
                ))}
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

      {/* Allocation bar */}
      {methodKeys.length > 0 && (
        <div className="space-y-2">
          <div className="flex h-2.5 rounded-full overflow-hidden bg-white/[0.04]">
            {methodKeys.map((m) => {
              const pct =
                totalValueWei > BigInt(0)
                  ? Number((byMethod[m]!.total * BigInt(10000)) / totalValueWei) / 100
                  : 0;
              return (
                <div
                  key={m}
                  className={`${METHOD_COLORS[m].bar} first:rounded-l-full last:rounded-r-full`}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {methodKeys.map((m) => (
              <div key={m} className="flex items-center gap-1.5 text-[11px] text-white/50">
                <span className={`inline-block w-2 h-2 rounded-full ${METHOD_COLORS[m].bar}`} />
                <span>{METHOD_LABELS[m]}</span>
                <span className="text-white/30">
                  {formatWei(byMethod[m]!.total.toString(), "STRK")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Privacy View: aggregated only */}
      {view === "privacy" && commitments.length > 0 && (
        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 space-y-2">
          <p className="text-xs text-white/40">
            Aggregated view — individual positions hidden
          </p>
          <div className="flex flex-wrap gap-3">
            {methodKeys.map((m) => (
              <div key={m} className="flex items-center gap-2 text-xs">
                <span
                  className={`px-2 py-0.5 rounded ${METHOD_COLORS[m].bg} ${METHOD_COLORS[m].text}`}
                >
                  {METHOD_LABELS[m]}
                </span>
                <span className="text-white/50">
                  {byMethod[m]!.count} position{byMethod[m]!.count > 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Public View: full table */}
      {view === "public" && (
        <>
          {commitments.length === 0 ? (
            <p className="text-center text-white/30 text-sm py-6">No positions yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-white/30 text-left border-b border-white/5">
                    <th className="pb-2 font-medium">Position</th>
                    <th className="pb-2 font-medium">Method</th>
                    <th className="pb-2 font-medium">Pool</th>
                    <th className="pb-2 font-medium">Deposited</th>
                    <th className="pb-2 font-medium text-right">Yield</th>
                    <th className="pb-2 font-medium text-right">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {commitments.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => onSelectCommitment?.(c.id)}
                      className="border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-2 text-white/80 font-medium">
                        {formatWei(c.amount_wei, c.asset)}
                      </td>
                      <td className="py-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] ${METHOD_COLORS[c.method].bg} ${METHOD_COLORS[c.method].text}`}
                        >
                          {METHOD_LABELS[c.method]}
                        </span>
                      </td>
                      <td className="py-2">
                        {c.pool_variant ? (
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] ${(POOL_VARIANT_COLORS[c.pool_variant] ?? POOL_VARIANT_COLORS.balanced).bg} ${(POOL_VARIANT_COLORS[c.pool_variant] ?? POOL_VARIANT_COLORS.balanced).text}`}
                          >
                            {POOL_VARIANT_LABELS[c.pool_variant] ?? c.pool_variant}
                          </span>
                        ) : (
                          <span className="text-white/20 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="py-2 text-white/40">{timeAgo(c.deposited_at)}</td>
                      <td className="py-2 text-right text-white/50">
                        {c.yield_accrued
                          ? formatWei(c.yield_accrued, c.asset)
                          : "--"}
                      </td>
                      <td className="py-2 text-right text-white/40">
                        {daysSince(c.deposited_at)}d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
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
