"use client";

import { useState, useEffect } from "react";
import { Shield } from "lucide-react";
import { usePrivacyVault } from "@/hooks/usePrivacyVault";
import { useVaultController } from "@/hooks/useVaultController";
import { useAdapterRegistry } from "@/hooks/useAdapterRegistry";
import { API_BASE } from "@/lib/api/client";
import { VaultTab } from "./VaultTab";
import { YieldTab } from "./YieldTab";
import { ActivityTab } from "./ActivityTab";
import { LendingPanel } from "@/components/zkdefi/LendingPanel";
import { NativeStakingPanel } from "@/components/zkdefi/NativeStakingPanel";
import { VaultTradeTab } from "./VaultTradeTab";
import { VaultBanner } from "./VaultBanner";
import { VaultHealthMeter } from "./VaultHealthMeter";
import { NextRebalanceStrip } from "./NextRebalanceStrip";

export interface VaultSurfaceProps {
  address: string | undefined;
  initialSubTab?: string;
  onNavigateToTrade?: (sub?: string) => void;
  onNavigateToOracle?: () => void;
  isDemo?: boolean;
}

type Tab = "portfolio" | "yield" | "trade" | "lending" | "staking" | "activity";

interface PriceTicker {
  strk_eth: number | null;
  strk_usd: number | null;
}

function formatWei(wei: string | undefined): string {
  try {
    return (Number(BigInt(wei || "0")) / 1e18).toFixed(2);
  } catch {
    return "0.00";
  }
}

export function VaultSurface({ address, initialSubTab, onNavigateToOracle, isDemo }: VaultSurfaceProps) {
  const {
    method,
    setMethod,
    commitments,
    addCommitment,
    removeCommitment,
    depositSteps,
    withdrawSteps,
    setDepositSteps,
    setWithdrawSteps,
    migrateOldStorage,
  } = usePrivacyVault(address);

  const {
    vaultState,
    cooldownRemaining,
    pendingProposal,
  } = useVaultController(address);

  const { adapters } = useAdapterRegistry();

  const resolveTab = (subTab?: string): Tab => {
    const value = String(subTab || "").trim().toLowerCase();
    if (value === "portfolio" || value === "vault") return "portfolio";
    if (value === "lending") return "lending";
    if (value === "yield" || value === "performance" || value === "private_yield") return "yield";
    if (value === "trade") return "trade";
    if (value === "staking") return "staking";
    if (value === "activity" || value === "ledger") return "activity";
    return "portfolio";
  };

  const [tab, setTab] = useState<Tab>(() => resolveTab(initialSubTab));

  const [prices, setPrices] = useState<PriceTicker>({
    strk_eth: null,
    strk_usd: null,
  });

  const [topPool, setTopPool] = useState<string | null>(null);
  const [vaultTvl, setVaultTvl] = useState<string | null>(null);

  const [sessionKeyActive, setSessionKeyActive] = useState<boolean | null>(null);

  useEffect(() => {
    if (!address) return;
    migrateOldStorage();
  }, [address, migrateOldStorage]);

  useEffect(() => {
    if (!address) {
      setSessionKeyActive(null);
      return;
    }
    let dead = false;
    fetch(`${API_BASE}/v1/zkdefi/session_keys/list/${address}`, {
      signal: AbortSignal.timeout(6000),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (dead) return;
        const sessions: Array<{ revoked_at?: string | null; expires_at?: string }> =
          Array.isArray(data?.sessions) ? data.sessions : [];
        const now = Date.now();
        const active = sessions.some((s) => {
          if (s.revoked_at) return false;
          if (s.expires_at && new Date(s.expires_at).getTime() < now) return false;
          return true;
        });
        setSessionKeyActive(active);
      })
      .catch(() => {
        if (!dead) setSessionKeyActive(null);
      });
    return () => { dead = true; };
  }, [address]);

  useEffect(() => {
    setTab(resolveTab(initialSubTab));
  }, [initialSubTab]);

  useEffect(() => {
    let cancelled = false;

    const fetchPrices = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/strategies/price/live`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setPrices({
          strk_eth: data.strk_eth ?? null,
          strk_usd: data.strk_usd ?? null,
        });
      } catch {
        if (!cancelled) setPrices({ strk_eth: null, strk_usd: null });
      }

      try {
        const surfaceRes = await fetch(`${API_BASE}/v1/zkdefi/market/surface`, {
          signal: AbortSignal.timeout(6000),
        });
        if (surfaceRes.ok && !cancelled) {
          const sd = await surfaceRes.json();
          const opps: Array<{ pair?: string; estimated_apy_pct?: number }> =
            Array.isArray(sd.opportunities) ? sd.opportunities : [];
          if (opps.length > 0) {
            const sorted = [...opps].sort(
              (a, b) => (b.estimated_apy_pct ?? 0) - (a.estimated_apy_pct ?? 0),
            );
            setTopPool(`${sorted[0].pair ?? "Top pool"} ${(sorted[0].estimated_apy_pct ?? 0).toFixed(1)}%`);
          }
        }
      } catch { /* best effort */ }

      try {
        const statsRes = await fetch(`${API_BASE}/v1/zkdefi/private-yield/vault/stats`, {
          signal: AbortSignal.timeout(6000),
        });
        if (statsRes.ok && !cancelled) {
          const vd = await statsRes.json();
          if (vd.tvl_eth != null && vd.tvl_eth > 0) {
            setVaultTvl(`${Number(vd.tvl_eth).toFixed(2)} ETH`);
          }
        }
      } catch { /* best effort */ }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const totalPosition = commitments.reduce((sum, c) => {
    try {
      return sum + Number(BigInt(c.amount_wei || "0")) / 1e18;
    } catch {
      return sum;
    }
  }, 0);

  const privacyCoverage = (() => {
    if (commitments.length === 0) return 0;
    const nonShield = commitments.filter(
      (c) => c.method !== "commitment_shield",
    );
    return Math.round((nonShield.length / commitments.length) * 100);
  })();

  const totalEarned = (() => {
    const vals = commitments
      .filter((c) => c.yield_accrued)
      .map((c) => {
        try {
          return Number(BigInt(c.yield_accrued || "0")) / 1e18;
        } catch {
          return 0;
        }
      });
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0);
  })();

  const tabs: { key: Tab; label: string }[] = [
    { key: "portfolio", label: "Portfolio" },
    { key: "yield", label: "Yield" },
    { key: "trade", label: "Trade" },
    { key: "lending", label: "Lending" },
    { key: "staking", label: "Staking" },
    { key: "activity", label: "Activity" },
  ];

  return (
    <div className="space-y-6">
      {/* Banner (top-level alerts) */}
      <VaultBanner vaultState={vaultState} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-white">Privacy Vault</h2>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-white/40">STRK/ETH</span>
          <span className="text-white">
            {prices.strk_eth != null ? prices.strk_eth.toFixed(6) : "--"}
          </span>
          <span className="text-white/20">|</span>
          <span className="text-white/40">STRK/USD</span>
          <span className="text-white">
            {prices.strk_usd != null ? `$${prices.strk_usd.toFixed(4)}` : "--"}
          </span>
          <span className="text-white/20">|</span>
          <span className="text-white/40">Top Pool</span>
          <span className="text-white">{topPool ?? "--"}</span>
          <span className="text-white/20">|</span>
          <span className="text-white/40">TVL</span>
          <span className="text-white">{vaultTvl ?? "--"}</span>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-white/10 rounded-xl bg-white/[0.02] p-4">
          <p className="text-xs text-white/40">Total Position</p>
          <p className="text-lg font-semibold text-white">
            {totalPosition.toFixed(2)} STRK
          </p>
        </div>
        <div className="border border-white/10 rounded-xl bg-white/[0.02] p-4">
          <p className="text-xs text-white/40">Privacy Coverage</p>
          <p className="text-lg font-semibold text-white">
            {commitments.length > 0 ? `${privacyCoverage}%` : "--"}
          </p>
        </div>
        <div className="border border-white/10 rounded-xl bg-white/[0.02] p-4">
          <p className="text-xs text-white/40">Total Earned</p>
          <p className="text-lg font-semibold text-white">
            {totalEarned != null ? `${totalEarned.toFixed(2)} STRK` : "--"}
          </p>
        </div>
        <div className="border border-white/10 rounded-xl bg-white/[0.02] p-4">
          <p className="text-xs text-white/40">Session Key</p>
          <p className={`text-lg font-semibold ${sessionKeyActive === true ? "text-emerald-400" : sessionKeyActive === false ? "text-rose-400" : "text-white/30"}`}>
            {sessionKeyActive === true ? "Active" : sessionKeyActive === false ? "Inactive" : "--"}
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-4 border-b border-white/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`pb-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-blue-500 text-white"
                : "text-white/50 hover:text-white/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Vault Health Meter */}
      <VaultHealthMeter
        adapters={adapters}
        cooldownRemaining={cooldownRemaining}
      />

      {/* Next Rebalance Strip */}
      <NextRebalanceStrip
        pendingProposal={pendingProposal}
        cooldownRemaining={cooldownRemaining}
        vaultState={vaultState}
      />

      {/* Tab Content */}
      {tab === "portfolio" && (
        <VaultTab
          method={method}
          setMethod={setMethod}
          commitments={commitments}
          addCommitment={addCommitment}
          removeCommitment={removeCommitment}
          depositSteps={depositSteps}
          withdrawSteps={withdrawSteps}
          setDepositSteps={setDepositSteps}
          setWithdrawSteps={setWithdrawSteps}
          address={address}
          isDemo={isDemo}
        />
      )}

      {tab === "yield" && (
        <YieldTab address={address} />
      )}

      {tab === "trade" && (
        <VaultTradeTab
          address={address}
          initialSubTab={initialSubTab === "trade" ? "swap" : undefined}
          onNavigateToOracle={onNavigateToOracle}
          isDemo={isDemo}
        />
      )}

      {tab === "lending" && <LendingPanel address={address} />}

      {tab === "staking" && (
        <div>
          {address ? (
            <NativeStakingPanel />
          ) : (
            <div className="glass rounded-xl border border-zinc-800 p-8 text-center">
              <p className="font-semibold text-zinc-200 mb-2">Connect Wallet</p>
              <p className="text-sm text-zinc-500">Connect your wallet to manage staking.</p>
            </div>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div id="vault-activity-section" className="scroll-mt-4">
          <ActivityTab address={address} />
        </div>
      )}
    </div>
  );
}
