"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, Shield, Layers, Coins, Loader2, AlertTriangle, Radio } from "lucide-react";
import { apiFetch, API_BASE } from "@/lib/api/client";
import { useVaultSummary } from "@/hooks/useVaultSummary";
import { getEkuboPositions } from "@/lib/api/ekubo";
import { InlineOracleCard, type OracleSignal } from "@/components/zkdefi/shared/InlineOracleCard";
import {
  DEMO_VAULT_SUMMARY,
  DEMO_ACTIVITY,
  DEMO_COMMITMENTS,
  DEMO_ALLOCATION,
} from "@/lib/demoCapitalOS";
import type { VaultCommitment } from "@/hooks/usePrivacyVault";
import PositionsOverview from "@/components/zkdefi/vault/PositionsOverview";
import { AgentAllocationStrip } from "@/components/zkdefi/vault/AgentAllocationStrip";

interface OverviewTabProps {
  address: string;
  isDemo?: boolean;
  commitments?: VaultCommitment[];
  walletBalance?: string;
}

function usd(v: number) {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-800/60 ${className}`} />;
}

export function OverviewTab({ address, isDemo, commitments: commitmentsProp, walletBalance }: OverviewTabProps) {
  const vaultRaw = useVaultSummary(address);

  // In demo mode, overlay demo data when API returns nothing
  const vault = useMemo(() => {
    if (!isDemo) return vaultRaw;
    if (vaultRaw.total_usd > 0 || vaultRaw.strk_balance > 0) return vaultRaw;
    return {
      loading: false,
      total_usd: DEMO_VAULT_SUMMARY.total_usd,
      strk_balance: DEMO_VAULT_SUMMARY.strk_balance,
      eth_balance: DEMO_VAULT_SUMMARY.eth_balance,
    };
  }, [isDemo, vaultRaw]);

  const [privacyTotal, setPrivacyTotal] = useState(0);
  const [ekuboTotal, setEkuboTotal] = useState(0);
  const [deployedLoading, setDeployedLoading] = useState(true);

  const [signals, setSignals] = useState<OracleSignal[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [activityError, setActivityError] = useState(false);

  useEffect(() => {
    if (!address) return;

    // In demo mode, use demo data immediately
    if (isDemo) {
      // Compute privacy total from demo commitments
      const pTotal = DEMO_COMMITMENTS.reduce(
        (sum, c) => sum + Number(c.amount_wei) / 1e18 * 0.5, 0
      );
      setPrivacyTotal(pTotal);
      setEkuboTotal(164.87);
      setDeployedLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setDeployedLoading(true);
      const [privRes, ekuboRes] = await Promise.allSettled([
        apiFetch<any>("/api/v1/zkdefi/private-yield/vault/stats"),
        getEkuboPositions(address),
      ]);

      if (cancelled) return;

      if (privRes.status === "fulfilled") {
        setPrivacyTotal(Number(privRes.value?.total_value_usd ?? privRes.value?.tvl ?? 0));
      }
      if (ekuboRes.status === "fulfilled") {
        const positions = ekuboRes.value.positions ?? [];
        const total = positions.reduce((sum: number, p: any) => {
          const a0 = Number(p.amount0 || 0) / 1e18;
          const a1 = Number(p.amount1 || 0) / 1e18;
          return sum + a0 + a1;
        }, 0);
        setEkuboTotal(total);
      }
      setDeployedLoading(false);
    })();

    return () => { cancelled = true; };
  }, [address, isDemo]);

  useEffect(() => {
    if (!address) return;

    // In demo mode, use demo data
    if (isDemo) {
      setSignals([
        { pair: "STRK/ETH", direction: "up", confidence: 0.85, recommendation: "22.0% APY" },
        { pair: "ETH/USDC", direction: "stable", confidence: 0.90, recommendation: "18.0% APY" },
        { pair: "STRK/USDC", direction: "stable", confidence: 0.70, recommendation: "15.0% APY" },
      ]);
      setActivity(DEMO_ACTIVITY);
      return;
    }

    let cancelled = false;

    apiFetch<any>(`/api/v1/zkdefi/trade-desk/v2/opportunities?limit=6`)
      .then((res) => {
        if (cancelled) return;
        const opps = Array.isArray(res?.opportunities) ? res.opportunities : Array.isArray(res) ? res : [];
        const mapped: OracleSignal[] = opps.slice(0, 6).map((o: any) => {
          const yld = Number(o.currentYield ?? o.apy ?? o.yield ?? 0);
          const risk = Number(o.riskScore ?? o.risk_score ?? 50);
          const conf = o.confidence > 0 ? Number(o.confidence) : (100 - risk) / 100;
          const dir: OracleSignal["direction"] = yld > 50 ? "up" : yld > 10 ? "stable" : "down";
          return {
            pair: o.title ?? o.pair ?? o.pool ?? o.name ?? "Unknown",
            direction: (o.signal_direction ?? o.direction ?? dir) as OracleSignal["direction"],
            confidence: conf,
            recommendation: o.recommendation ?? o.action ?? `${yld.toFixed(1)}% APY`,
          };
        });
        setSignals(mapped);
      })
      .catch(() => {});

    apiFetch<any>(`/api/v1/zkdefi/mc/stream/${address}?limit=5`)
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.events) ? res.events : Array.isArray(res) ? res : [];
        setActivity(items.slice(0, 5));
      })
      .catch(() => {
        if (!cancelled) setActivityError(true);
      });

    return () => { cancelled = true; };
  }, [address, isDemo]);

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <Wallet className="w-8 h-8 mb-3 text-zinc-600" />
        <p className="text-sm">Connect wallet to view your overview</p>
      </div>
    );
  }

  const totalCapital = vault.total_usd || (vault.strk_balance * 0.5 + vault.eth_balance * 2400);
  const deployed = privacyTotal + ekuboTotal;
  const idle = Math.max(0, totalCapital - deployed);

  return (
    <div className="space-y-6">
      {/* Balance Hero */}
      <section className="glass rounded-xl p-6">
        {vault.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <div className="flex gap-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total Capital</p>
            <h2 className="text-3xl font-bold text-white">{usd(totalCapital)}</h2>
            <div className="flex flex-wrap gap-4 mt-3 text-sm">
              <span className="text-zinc-400">
                <span className="text-violet-400 font-medium">{vault.strk_balance.toFixed(2)}</span> STRK
              </span>
              <span className="text-zinc-400">
                <span className="text-cyan-400 font-medium">{vault.eth_balance.toFixed(4)}</span> ETH
              </span>
              {vault.total_usd > 0 && (
                <span className="text-zinc-400">
                  <span className="text-emerald-400 font-medium">{usd(vault.total_usd)}</span> USD
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {/* Deployed / Available Breakdown */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {deployedLoading ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <BreakdownCard icon={Shield} label="Privacy Pools" value={usd(privacyTotal)} accent="text-violet-400" />
            <BreakdownCard icon={Layers} label="Ekubo LP" value={usd(ekuboTotal)} accent="text-cyan-400" />
            <BreakdownCard icon={Coins} label="Idle" value={usd(idle)} accent="text-zinc-400" />
          </>
        )}
      </section>

      {/* Pool-Grouped Positions (Phase C) */}
      <PositionsOverview
        commitments={isDemo ? DEMO_COMMITMENTS : (commitmentsProp ?? [])}
        address={address}
        walletBalance={walletBalance}
      />

      {/* Agent Allocation Drift (Phase D) */}
      <AgentAllocationStrip
        address={address}
        commitments={isDemo ? DEMO_COMMITMENTS : (commitmentsProp ?? [])}
      />

      {/* Oracle Command Center (Gap 28) */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs text-zinc-400 uppercase tracking-wider font-semibold flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            Oracle Command Center
          </h3>
          <span className="text-[10px] text-zinc-600">{signals.length} signal{signals.length !== 1 ? "s" : ""}</span>
        </div>
        {signals.length === 0 ? (
          <p className="text-xs text-zinc-600 italic">No active oracle signals</p>
        ) : (
          <div className="space-y-2">
            {signals.map((s, i) => (
              <InlineOracleCard key={i} signal={s} />
            ))}
          </div>
        )}
      </section>

      {/* Recent Activity */}
      <section>
        <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Recent Activity</h3>
        {activityError ? (
          <p className="text-xs text-zinc-600 italic">Unable to load activity</p>
        ) : activity.length === 0 ? (
          <p className="text-xs text-zinc-600 italic">No recent activity</p>
        ) : (
          <div className="space-y-1">
            {activity.map((ev, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-zinc-500 shrink-0">
                    {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </span>
                  <span className="text-zinc-300 truncate">{ev.description ?? ev.event ?? ev.type ?? "Event"}</span>
                </div>
                {(ev.tx_hash ?? ev.proof_hash) && (
                  <span className="text-zinc-600 font-mono ml-2 shrink-0">
                    {(ev.tx_hash ?? ev.proof_hash).slice(0, 8)}…
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function BreakdownCard({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: string; accent: string }) {
  return (
    <div className="glass rounded-xl p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-zinc-800/60 ${accent}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-xs text-zinc-500">{label}</p>
        <p className="text-sm font-semibold text-zinc-100">{value}</p>
      </div>
    </div>
  );
}
