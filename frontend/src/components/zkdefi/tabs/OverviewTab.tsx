"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, Sparkles, TrendingUp, ShieldCheck, ListChecks, ExternalLink, ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { useVaultSummary } from "@/hooks/useVaultSummary";
import { getEkuboPositions } from "@/lib/api/ekubo";
import {
  DEMO_VAULT_SUMMARY,
  DEMO_ACTIVITY,
  DEMO_COMMITMENTS,
  DEMO_ALLOCATION,
} from "@/lib/demoCapitalOS";
import type { VaultCommitment } from "@/hooks/usePrivacyVault";
import { useTokenPrices, priceOf } from "@/hooks/useTokenPrices";

import type { SignalForExecution } from "@/components/zkdefi/mission-control/SignalExecutionDrawer";

interface OverviewTabProps {
  address: string;
  isDemo?: boolean;
  commitments?: VaultCommitment[];
  walletBalance?: string;
  onDeploy?: (signal: SignalForExecution) => void;
}

function usd(v: number) {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

type Allocation = {
  privacy: number;
  ekubo: number;
  idle: number;
};

type HeroSignal = {
  pair: string;
  confidence: number;
  recommendation: string;
};

function buildTargetAllocation(primaryType: string | undefined): Allocation {
  if (primaryType === "lending") return { privacy: 25, ekubo: 30, idle: 45 };
  if (primaryType === "staking") return { privacy: 50, ekubo: 20, idle: 30 };
  if (primaryType === "lp") return { privacy: 30, ekubo: 50, idle: 20 };
  return {
    privacy: DEMO_ALLOCATION.lending + DEMO_ALLOCATION.staking,
    ekubo: DEMO_ALLOCATION.ekubo,
    idle: DEMO_ALLOCATION.idle,
  };
}

export function OverviewTab({ address, isDemo, commitments: commitmentsProp, walletBalance, onDeploy }: OverviewTabProps) {
  const vaultRaw = useVaultSummary(address);
  const { prices } = useTokenPrices();

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
  const [privacyYield, setPrivacyYield] = useState(0);
  const [ekuboTotal, setEkuboTotal] = useState(0);
  const [deployedLoading, setDeployedLoading] = useState(true);

  const [signals, setSignals] = useState<HeroSignal[]>([]);
  const [rawOpps, setRawOpps] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);

  // Compute privacy pool totals from actual user commitments
  const activeCommitments = useMemo(() => isDemo ? DEMO_COMMITMENTS : (commitmentsProp ?? []), [isDemo, commitmentsProp]);

  useEffect(() => {
    // Aggregate privacy pool value from commitments
    let poolTotal = 0;
    let yieldTotal = 0;
    for (const c of activeCommitments) {
      const amt = Number(c.amount_wei) / 1e18;
      const price = priceOf(prices, c.asset ?? "STRK");
      poolTotal += amt * price;
      if (c.yield_accrued) {
        yieldTotal += Number(c.yield_accrued) / 1e18 * price;
      }
    }
    setPrivacyTotal(poolTotal);
    setPrivacyYield(yieldTotal);
  }, [activeCommitments, prices]);

  useEffect(() => {
    if (!address) return;

    // In demo mode, use demo data immediately
    if (isDemo) {
      setEkuboTotal(164.87);
      setDeployedLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setDeployedLoading(true);
      const ekuboRes = await getEkuboPositions(address).catch(() => ({ positions: [], total_value_usd: 0 }));

      if (cancelled) return;

      setEkuboTotal(ekuboRes.total_value_usd ?? 0);
      setDeployedLoading(false);
    })();

    return () => { cancelled = true; };
  }, [address, isDemo]);

  useEffect(() => {
    if (!address) return;

    // In demo mode, use demo data
    if (isDemo) {
      setSignals([
        { pair: "STRK/ETH", confidence: 0.85, recommendation: "22.0% APY" },
        { pair: "ETH/USDC", confidence: 0.9, recommendation: "18.0% APY" },
        { pair: "STRK/USDC", confidence: 0.7, recommendation: "15.0% APY" },
      ]);
      setRawOpps([]);
      setActivity(DEMO_ACTIVITY);
      return;
    }

    let cancelled = false;

    apiFetch<any>(`/api/v1/zkdefi/trade-desk/v2/opportunities?limit=6`)
      .then((res) => {
        if (cancelled) return;
        const opps = Array.isArray(res?.opportunities) ? res.opportunities : Array.isArray(res) ? res : [];
        const mapped: HeroSignal[] = opps.slice(0, 6).map((o: any) => {
          const yld = Number(o.currentYield ?? o.apy ?? o.yield ?? 0);
          const risk = Number(o.riskScore ?? o.risk_score ?? 50);
          const conf = o.confidence > 0 ? Number(o.confidence) : (100 - risk) / 100;
          return {
            pair: o.title ?? o.pair ?? o.pool ?? o.name ?? "Unknown",
            confidence: conf,
            recommendation: o.recommendation ?? o.action ?? `${yld.toFixed(1)}% APY`,
          };
        });
        setSignals(mapped);
        setRawOpps(opps.slice(0, 6));
      })
      .catch((e) => console.warn("Opportunity fetch failed:", e));

    apiFetch<any>(`/api/v1/zkdefi/mc/stream/${address}?limit=5`)
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.events) ? res.events : Array.isArray(res) ? res : [];
        setActivity(items.slice(0, 5));
      })
      .catch(() => setActivity([]));

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

  // Use real prices: STRK ~$0.04, ETH ~$2020 (2026-03-11)
  const totalCapital = vault.total_usd || (vault.strk_balance * priceOf(prices, "STRK") + vault.eth_balance * priceOf(prices, "ETH"));
  const deployed = privacyTotal + ekuboTotal;
  const idle = Math.max(0, totalCapital - deployed);
  const totalWithYield = totalCapital + privacyYield;
  const currentAllocation = totalCapital > 0 ? {
    privacy: (privacyTotal / totalCapital) * 100,
    ekubo: (ekuboTotal / totalCapital) * 100,
    idle: (idle / totalCapital) * 100,
  } : { privacy: 0, ekubo: 0, idle: 100 };

  const primaryOpportunity = rawOpps[0] ?? null;
  const heroSignal = signals[0] ?? {
    pair: "No active signal",
    confidence: 0,
    recommendation: "Waiting for market and policy update",
  };
  const targetAllocation = buildTargetAllocation(primaryOpportunity?.type);
  const planActions = [
    `Allocate ${Math.max(10, Math.round(targetAllocation.ekubo / 2))}% of idle balance to ${heroSignal.pair}.`,
    `Maintain ${Math.round(targetAllocation.privacy)}% in privacy sleeves for stable yield and proof history.`,
    `Keep ${Math.round(targetAllocation.idle)}% liquid to absorb volatility and fast opportunities.`,
  ];

  return (
    <div className="space-y-3 p-3">
      <section className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800/70 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-400">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            Primary Recommendation
          </div>
          <span className="rounded-full border border-cyan-600/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300">
            {(heroSignal.confidence * 100).toFixed(0)}% confidence
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-white">{heroSignal.pair}</h2>
            <p className="text-[13px] text-zinc-300">{heroSignal.recommendation}</p>
            <p className="text-xs text-zinc-500">
              Recommendation fuses risk gates, venue constraints, and live yield snapshots before execution.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!onDeploy) return;
              onDeploy({
                id: primaryOpportunity?.id ?? heroSignal.pair,
                name: heroSignal.pair,
                type: primaryOpportunity?.type ?? "lp",
                venue: primaryOpportunity?.protocol,
                currentYield: Number(primaryOpportunity?.currentYield ?? 0),
                apy_bps: Math.round(Number(primaryOpportunity?.currentYield ?? 0) * 100),
                riskScore: Number(primaryOpportunity?.riskScore ?? 50),
                signal_reason: primaryOpportunity?.aiNarrative ?? heroSignal.recommendation,
              });
            }}
            disabled={!onDeploy}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Open Execution
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SnapshotCard
            title="Total Capital"
            value={usd(totalWithYield)}
            subtitle={privacyYield > 0 ? `Includes +${usd(privacyYield)} accrued yield` : "No realized yield yet"}
          />
          <SnapshotCard
            title="Deployed"
            value={deployedLoading ? "Loading..." : usd(deployed)}
            subtitle="Across privacy pools and Ekubo LP"
          />
          <SnapshotCard
            title="Idle Reserve"
            value={usd(idle)}
            subtitle="Available for immediate plan execution"
          />
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <h3 className="mb-3 text-xs uppercase tracking-wider text-zinc-400">Current vs Target Allocation</h3>
          <div className="space-y-3">
            <AllocationRow label="Privacy" current={currentAllocation.privacy} target={targetAllocation.privacy} color="bg-emerald-500" />
            <AllocationRow label="Ekubo" current={currentAllocation.ekubo} target={targetAllocation.ekubo} color="bg-cyan-500" />
            <AllocationRow label="Idle" current={currentAllocation.idle} target={targetAllocation.idle} color="bg-zinc-500" />
          </div>
        </div>
      </section>

      <details className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <summary className="cursor-pointer list-none text-sm font-medium text-zinc-100">
          <span className="inline-flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-amber-400" />
            Plan Preview
          </span>
        </summary>
        <div className="mt-3 space-y-3 text-sm text-zinc-300">
          {planActions.map((action, index) => (
            <div key={index} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
              <span className="text-zinc-500">Step {index + 1}.</span> {action}
            </div>
          ))}
          <p className="text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5 text-zinc-300">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Execution stays advisory until policy and session constraints pass.
            </span>
          </p>
        </div>
      </details>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-400">Receipt Feed</h3>
        {activity.length === 0 ? (
          <p className="text-xs text-zinc-600 italic">No recent activity</p>
        ) : (
          <div className="space-y-1.5">
            {activity.slice(0, 3).map((ev, i) => {
              const txHash = ev.tx_hash ?? ev.proof_hash ?? null;

              return (
                <div key={i} className="group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 text-xs">
                  <div className="rounded-md bg-zinc-800/70 p-1.5 text-cyan-300">
                    <TrendingUp className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-zinc-200 truncate block">
                      {ev.description ?? ev.event ?? ev.type ?? "Event"}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : "Unknown time"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {txHash && (
                      <a
                        href={sepoliaVoyagerTxUrl(txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-600 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SnapshotCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <p className="text-xs text-zinc-500">{title}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-100">{value}</p>
      <p className="mt-1 text-[11px] text-zinc-500">{subtitle}</p>
    </div>
  );
}

function AllocationRow({
  label,
  current,
  target,
  color,
}: {
  label: string;
  current: number;
  target: number;
  color: string;
}) {
  const delta = target - current;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-300">{label}</span>
        <span className="text-zinc-500">Current {current.toFixed(0)}% · Target {target.toFixed(0)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className={`${color} h-full`} style={{ width: `${Math.max(0, Math.min(100, current))}%` }} />
      </div>
      <p className={`text-[11px] ${delta >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
        {delta >= 0 ? "Increase" : "Reduce"} by {Math.abs(delta).toFixed(0)}%
      </p>
    </div>
  );
}
