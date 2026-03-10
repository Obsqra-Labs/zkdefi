"use client";

/**
 * VaultCenterStage — 5-tab container for the Vault section.
 *
 * Tabs:
 *   Overview  — VaultHealthMeter + Ekubo Summary + PoolIntelligence + Positions
 *   Pools     — PoolIntelligencePanel
 *   Ekubo LP  — EkuboPositionsList
 *   Lending   — LendingConsole
 *   Activity  — EnrichedActivityTab
 */

import { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard,
  Droplets,
  Landmark,
  CreditCard,
  Activity,
  LineChart,
  Radio,
  Store,
} from "lucide-react";
import type { VaultTab } from "@/lib/agentState";
import type { VaultCommitment, PrivacyMethod, ProofStep } from "@/hooks/usePrivacyVault";
import type { UseVaultV2Return } from "@/hooks/useVaultV2";

import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { PoolIntelligencePanel } from "./PoolIntelligencePanel";
import { PoolIntelligence } from "./PoolIntelligence";
import { EkuboPositionsList, computeEkuboStats, formatAmount, tokenLabel } from "@/components/zkdefi/EkuboPositionsList";
import { getEkuboPositions, type EkuboPosition } from "@/lib/api/ekubo";
import { LendingConsole } from "@/components/zkdefi/LendingConsole";
import { EnrichedActivityTab } from "@/components/zkdefi/vault/EnrichedActivityTab";
import { TradeDesk } from "@/components/zkdefi/TradeDesk";
import { OracleSurfaceContainer } from "@/components/zkdefi/surfaces/OracleSurfaceContainer";
import { MarketplaceConsole } from "@/components/zkdefi/MarketplaceConsole";
import { VaultHealthMeter } from "@/components/zkdefi/vault/VaultHealthMeter";
import PositionsOverview from "@/components/zkdefi/vault/PositionsOverview";
import { ConstraintGuard } from "@/components/zkdefi/vault/ConstraintGuard";
import { useAdapterRegistry } from "@/hooks/useAdapterRegistry";
import { useVaultController } from "@/hooks/useVaultController";
import { useVaultSummary } from "@/hooks/useVaultSummary";
import { useHealthPassport } from "@/hooks/useHealthPassport";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultCenterStageProps {
  address: string | undefined;
  initialTab?: VaultTab;
  onTabChange?: (tab: VaultTab) => void;
  onDeposit?: () => void;
  onWithdraw?: () => void;
  /** Vault V2 hook return for positions/balances */
  v2?: UseVaultV2Return;
  /** Privacy vault data for positions overview */
  vaultProps?: {
    method: PrivacyMethod;
    setMethod: (m: PrivacyMethod) => void;
    commitments: VaultCommitment[];
    addCommitment: (c: VaultCommitment) => void;
    removeCommitment: (id: string) => void;
    depositSteps: ProofStep[];
    withdrawSteps: ProofStep[];
    setDepositSteps: React.Dispatch<React.SetStateAction<ProofStep[]>>;
    setWithdrawSteps: React.Dispatch<React.SetStateAction<ProofStep[]>>;
  };
}

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

const TABS: Array<{ id: VaultTab; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { id: "pools", label: "Pools", icon: <Droplets className="w-3.5 h-3.5" /> },
  { id: "ekubo", label: "Ekubo LP", icon: <CreditCard className="w-3.5 h-3.5" /> },
  { id: "lending", label: "Lending", icon: <Landmark className="w-3.5 h-3.5" /> },
  { id: "trade", label: "Trade", icon: <LineChart className="w-3.5 h-3.5" /> },
  { id: "oracle", label: "Oracle", icon: <Radio className="w-3.5 h-3.5" /> },
  { id: "marketplace", label: "Marketplace", icon: <Store className="w-3.5 h-3.5" /> },
  { id: "activity", label: "Activity", icon: <Activity className="w-3.5 h-3.5" /> },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VaultCenterStage({
  address,
  initialTab = "overview",
  onTabChange,
  onDeposit,
  onWithdraw,
  v2,
  vaultProps,
}: VaultCenterStageProps) {
  const [tab, setTab] = useState<VaultTab>(initialTab);

  // Sync from URL/parent when params change
  useEffect(() => {
    if (initialTab && initialTab !== tab) {
      setTab(initialTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  const switchTab = (t: VaultTab) => {
    setTab(t);
    onTabChange?.(t);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex-shrink-0 px-3 py-1.5 flex items-center gap-1 border-b border-zinc-800/60 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
              tab === t.id
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "overview" && (
          <VaultOverviewTab
            address={address}
            commitments={vaultProps?.commitments ?? []}
            onDeposit={onDeposit}
            onWithdraw={onWithdraw}
            v2={v2}
          />
        )}
        {tab === "pools" && (
          <ErrorBoundary>
            <PoolIntelligencePanel
              address={address}
              onDeposit={() => onDeposit?.()}
              embedded
            />
          </ErrorBoundary>
        )}
        {tab === "ekubo" && (
          <ErrorBoundary>
            <div className="p-4">
              <h3 className="text-sm font-semibold text-zinc-200 mb-3">Ekubo LP Positions</h3>
              <EkuboPositionsList ownerAddress={address} />
            </div>
          </ErrorBoundary>
        )}
        {tab === "lending" && (
          <ErrorBoundary>
            {address ? (
              <LendingConsole address={address} />
            ) : (
              <div className="p-4 text-sm text-zinc-500">Connect wallet to access lending.</div>
            )}
          </ErrorBoundary>
        )}
        {tab === "trade" && (
          <ErrorBoundary>
            <TradeDesk userAddress={address} />
          </ErrorBoundary>
        )}
        {tab === "oracle" && (
          <ErrorBoundary>
            <OracleSurfaceContainer address={address} />
          </ErrorBoundary>
        )}
        {tab === "marketplace" && (
          <ErrorBoundary>
            <MarketplaceConsole address={address} />
          </ErrorBoundary>
        )}
        {tab === "activity" && (
          <ErrorBoundary>
            <EnrichedActivityTab address={address} />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview sub-section — balance hero + constraint guard + health + oracle + positions
// ---------------------------------------------------------------------------

function VaultOverviewTab({
  address,
  commitments,
  onDeposit,
  onWithdraw,
  v2,
}: {
  address: string | undefined;
  commitments: VaultCommitment[];
  onDeposit?: () => void;
  onWithdraw?: () => void;
  v2?: UseVaultV2Return;
}) {
  const adapters = useAdapterRegistry();
  const controller = useVaultController(address);
  const vaultSummary = useVaultSummary(address, v2);
  const healthPassport = useHealthPassport(address);

  // Ekubo position summary
  const [ekuboPositions, setEkuboPositions] = useState<EkuboPosition[]>([]);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getEkuboPositions(address)
      .then((res) => { if (!cancelled) setEkuboPositions(res.positions ?? []); })
      .catch(() => { if (!cancelled) setEkuboPositions([]); });
    return () => { cancelled = true; };
  }, [address]);
  const ekuboStats = useMemo(() => computeEkuboStats(ekuboPositions), [ekuboPositions]);

  const healthAdapters = (adapters.adapters ?? []).map((a) => ({
    name: a.name ?? "Unknown",
    health: a.health ?? "HEALTHY",
    value: typeof a.value === "number" ? a.value : 0,
  }));

  const healthTierLabel = healthPassport.tier >= 3
    ? "Excellent"
    : healthPassport.tier >= 2
      ? "Good"
      : healthPassport.tier >= 1
        ? "Fair"
        : "New";

  const healthTierColor = healthPassport.tier >= 3
    ? "text-emerald-400"
    : healthPassport.tier >= 2
      ? "text-amber-400"
      : "text-zinc-400";

  return (
    <div className="space-y-4 p-4 max-w-4xl mx-auto">

      {/* ── Hero: Balance + Health + Actions — single unified card ── */}
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900/90 via-zinc-900/50 to-zinc-900/90 overflow-hidden">
        {/* Top row: balance + actions */}
        <div className="p-5 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Vault Balance</div>
            <div className="text-2xl font-bold text-white leading-tight">
              {vaultSummary.loading ? (
                <span className="inline-block w-32 h-7 bg-zinc-800 rounded animate-pulse" />
              ) : vaultSummary.strk_balance > 0 || vaultSummary.eth_balance > 0 ? (
                <>
                  {vaultSummary.strk_balance > 0 && (
                    <span>{vaultSummary.strk_balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} STRK</span>
                  )}
                  {vaultSummary.eth_balance > 0 && (
                    <span className="text-base text-zinc-400 ml-2">
                      + {vaultSummary.eth_balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH
                    </span>
                  )}
                </>
              ) : (
                <span className="text-zinc-500">No deposits yet</span>
              )}
            </div>
            {!vaultSummary.loading && vaultSummary.total_usd > 0 && (
              <div className="text-sm text-zinc-400 mt-0.5">
                ≈ ${vaultSummary.total_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {onDeposit && (
              <button
                onClick={onDeposit}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
              >
                Fund Vault
              </button>
            )}
            {onWithdraw && (
              <button
                onClick={onWithdraw}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs font-semibold transition-colors"
              >
                Withdraw
              </button>
            )}
          </div>
        </div>

        {/* Bottom strip: health stats */}
        {!healthPassport.loading && (
          <div className="border-t border-zinc-800/50 bg-zinc-900/30 px-5 py-2.5 flex items-center gap-6 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500">Health</span>
              <span className={`font-semibold ${healthTierColor}`}>T{healthPassport.tier} {healthTierLabel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500">Trust</span>
              <span className="text-zinc-200 font-medium">
                {healthPassport.trust_score > 0 ? healthPassport.trust_score : "—"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500">Proofs</span>
              <span className="text-zinc-200 font-medium">
                {healthPassport.proof_count}/{healthPassport.proofs_required}
              </span>
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-zinc-500">Cooldown</span>
              <span className={`font-medium ${(controller.cooldownRemaining ?? 0) > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {(controller.cooldownRemaining ?? 0) > 0
                  ? `${Math.ceil((controller.cooldownRemaining ?? 0) / 60)}m`
                  : "Ready"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Constraint Guard + Health Meter — side by side ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConstraintGuard address={address} />
        <VaultHealthMeter
          adapters={healthAdapters}
          cooldownRemaining={controller.cooldownRemaining ?? 0}
        />
      </div>

      {/* ── Ekubo LP Summary ── */}
      {ekuboStats.totalPositions > 0 && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-300">Ekubo LP Summary</h3>
            <span className="text-xs text-zinc-500">{ekuboStats.totalPositions} positions across {ekuboStats.groups.length} pairs</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg bg-zinc-800/40 p-3">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Earning</div>
              <div className="text-lg font-bold text-emerald-400">{ekuboStats.earningCount}</div>
              <div className="text-[10px] text-zinc-600">of {ekuboStats.totalPositions} positions</div>
            </div>
            <div className="rounded-lg bg-zinc-800/40 p-3">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Idle</div>
              <div className="text-lg font-bold text-zinc-400">{ekuboStats.idleCount}</div>
              <div className="text-[10px] text-zinc-600">out of range</div>
            </div>
            <div className="rounded-lg bg-zinc-800/40 p-3">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Avg APR</div>
              <div className="text-lg font-bold text-white">{ekuboStats.avgApr > 0 ? `${ekuboStats.avgApr.toFixed(1)}%` : "—"}</div>
              <div className="text-[10px] text-zinc-600">estimated fees</div>
            </div>
            <div className="rounded-lg bg-zinc-800/40 p-3">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Top Pairs</div>
              <div className="text-sm font-medium text-white truncate">
                {ekuboStats.groups.slice(0, 2).map(g => g.pair).join(", ")}
              </div>
              <div className="text-[10px] text-zinc-600">{ekuboStats.groups.length > 2 ? `+${ekuboStats.groups.length - 2} more` : ""}</div>
            </div>
          </div>
          {/* Earning ratio */}
          <div className="mt-3">
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500/60 rounded-full transition-all"
                style={{ width: `${(ekuboStats.earningCount / Math.max(1, ekuboStats.totalPositions)) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-zinc-600">
              <span>{Math.round((ekuboStats.earningCount / Math.max(1, ekuboStats.totalPositions)) * 100)}% actively earning fees</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Pool Intelligence — oracle signal + pool cards + circuits ── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 overflow-hidden">
        <PoolIntelligence address={address} />
      </div>

      {/* ── Positions Overview ── */}
      <PositionsOverview
        commitments={commitments}
        address={address}
      />
    </div>
  );
}
