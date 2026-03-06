"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import {
  X,
  ArrowDownUp,
  Layers,
  Landmark,
  Coins,
  Calendar,
  SlidersHorizontal,
  Loader2,
  AlertCircle,
  Shield,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch } from "@/lib/api/client";
import { toastSuccess, toastError } from "@/lib/toast";
import { DexPanel } from "@/components/zkdefi/DexPanel";
import { DCAPanel as VaultDCAPanel } from "@/components/zkdefi/vault/DCAPanel";
import { LendingPanel } from "@/components/zkdefi/LendingPanel";
import { NativeStakingPanel } from "@/components/zkdefi/NativeStakingPanel";

export type DeployMode = "swap" | "lp" | "lend" | "stake" | "dca" | "limits";

export interface DeployOverlayProps {
  address: string | undefined;
  onClose: () => void;
  initialMode?: DeployMode;
}

const TABS: { id: DeployMode; label: string; icon: React.ElementType }[] = [
  { id: "swap", label: "Swap", icon: ArrowDownUp },
  { id: "lp", label: "LP", icon: Layers },
  { id: "lend", label: "Lend/Borrow", icon: Landmark },
  { id: "stake", label: "Stake", icon: Coins },
  { id: "dca", label: "DCA", icon: Calendar },
  { id: "limits", label: "Limits", icon: SlidersHorizontal },
];

// Predefined pairs for Swap (label -> token0, token1)
const SWAP_PAIRS = [
  { label: "STRK/ETH", token0: "STRK", token1: "ETH" },
  { label: "STRK/USDC", token0: "STRK", token1: "USDC" },
  { label: "ETH/USDC", token0: "ETH", token1: "USDC" },
];

function formatCompact(val: string | number, decimals = 4): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (!Number.isFinite(n) || n === 0) return "0";
  const v = n / 1e18;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(2) + "K";
  return v.toFixed(decimals);
}

export function DeployOverlay({ address, onClose, initialMode = "swap" }: DeployOverlayProps) {
  const { account } = useAccount();
  const [mode, setMode] = useState<DeployMode>(initialMode);

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  mode === tab.id
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 flex-shrink-0"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {mode === "swap" && (
            <motion.div key="swap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DexPanel />
            </motion.div>
          )}
          {mode === "lp" && <LPPanel key="lp" address={address} />}
          {mode === "lend" && (
            <motion.div key="lend" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LendingPanel address={address} />
            </motion.div>
          )}
          {mode === "stake" && (
            <motion.div key="stake" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <NativeStakingPanel />
            </motion.div>
          )}
          {mode === "dca" && (
            <motion.div key="dca" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <VaultDCAPanel address={address} />
            </motion.div>
          )}
          {mode === "limits" && <LimitsPanel key="limits" address={address} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── LP Panel ───────────────────────────────────────────────────────────────

function LPPanel({ address }: { address: string | undefined }) {
  const [positions, setPositions] = useState<Array<{ pair: string; value_usd: number; apy_pct: number }>>([]);
  const [pools, setPools] = useState<Array<{ label: string; tvl: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPool, setSelectedPool] = useState("");
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setError(null);
      setLoading(true);
      try {
        const [posRes, pairsRes] = await Promise.all([
          apiFetch<{ positions?: Array<{ pair?: string; value_usd?: number; apy_bps?: number }> }>(
            `/api/v1/zkdefi/position/${address}?protocol_id=0`
          ).catch(() => null),
          apiFetch<{ topPairs?: Array<{ token0?: string; token1?: string; tvl0_total?: string; tvl1_total?: string }> }>(
            "/api/v1/zkdefi/dex/pairs?min_tvl_usd=0"
          ).catch(() => null),
        ]);
        if (posRes?.positions) {
          setPositions(
            posRes.positions.map((p) => ({
              pair: p.pair ?? "—",
              value_usd: p.value_usd ?? 0,
              apy_pct: (p.apy_bps ?? 0) / 100,
            }))
          );
        }
        if (pairsRes?.topPairs) {
          const list = (pairsRes.topPairs as any[]).slice(0, 10).map((p) => {
            const tvl =
              parseFloat(p.tvl0_total ?? "0") + parseFloat(p.tvl1_total ?? "0");
            return { label: `${p.token0?.slice(0, 8)}/${p.token1?.slice(0, 8)}`, tvl };
          });
          setPools(list);
          if (list.length > 0 && !selectedPool) setSelectedPool(list[0].label);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load LP data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 flex items-center gap-3">
        <AlertCircle className="w-6 h-6 text-amber-500" />
        <div>
          <p className="font-medium text-zinc-200">Unable to load</p>
          <p className="text-sm text-zinc-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-lg"
    >
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h3 className="font-medium text-zinc-200 mb-3">Current LP Positions</h3>
        {positions.length === 0 ? (
          <p className="text-sm text-zinc-500">No positions yet</p>
        ) : (
          <ul className="space-y-2">
            {positions.map((p, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span className="text-zinc-300">{p.pair}</span>
                <span className="text-zinc-400">${p.value_usd.toFixed(2)} · {p.apy_pct.toFixed(2)}% APY</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-4">
        <h3 className="font-medium text-zinc-200">Add / Remove Liquidity</h3>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Pool</label>
          <select
            value={selectedPool}
            onChange={(e) => setSelectedPool(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          >
            {pools.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label} (TVL ${(p.tvl / 1e6).toFixed(2)}M)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Amount 0</label>
          <input
            type="number"
            min="0"
            step="any"
            value={amount0}
            onChange={(e) => setAmount0(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Amount 1</label>
          <input
            type="number"
            min="0"
            step="any"
            value={amount1}
            onChange={(e) => setAmount1(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          />
        </div>
        <button
          disabled={!amount0 || !amount1 || parseFloat(amount0) <= 0 || parseFloat(amount1) <= 0}
          className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium"
        >
          Add Liquidity
        </button>
      </div>
    </motion.div>
  );
}

// ─── Lend Panel ─────────────────────────────────────────────────────────────

function LendPanel({ address }: { address: string | undefined }) {
  const [pool, setPool] = useState<{
    total_supplied_eth?: number;
    total_borrowed_eth?: number;
    utilization_bps?: number;
    supply_apy_bps?: number;
    borrow_apy_bps?: number;
  } | null>(null);
  const [positions, setPositions] = useState<{
    supplies?: Array<{ amount_wei?: string }>;
    loans?: Array<{ amount_wei?: string; loan_id?: number }>;
  } | null>(null);
  const [passport, setPassport] = useState<{ tier?: number; tier_name?: string; letter_rating?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"supply" | "borrow" | "repay" | "withdraw">("supply");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    const load = async () => {
      setError(null);
      setLoading(true);
      try {
        const [poolRes, posRes, passRes] = await Promise.all([
          apiFetch<Record<string, unknown>>("/api/v1/zkdefi/lending/pool").catch(() => null),
          address
            ? apiFetch<Record<string, unknown>>(`/api/v1/zkdefi/lending/positions/${address}`).catch(() => null)
            : null,
          address
            ? apiFetch<Record<string, unknown>>(`/api/v1/zkdefi/risk_passport/user/${address}`).catch(() => null)
            : null,
        ]);
        setPool(poolRes ?? null);
        setPositions(posRes ?? null);
        setPassport(passRes ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load lending data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 flex items-center gap-3">
        <AlertCircle className="w-6 h-6 text-amber-500" />
        <div>
          <p className="font-medium text-zinc-200">Unable to load</p>
          <p className="text-sm text-zinc-500">{error}</p>
        </div>
      </div>
    );
  }

  const supplied = positions?.supplies?.reduce((a, s) => a + BigInt(s.amount_wei ?? "0"), BigInt(0)) ?? BigInt(0);
  const borrowed = positions?.loans?.reduce((a, l) => a + BigInt(l.amount_wei ?? "0"), BigInt(0)) ?? BigInt(0);
  const healthFactor = 1.5; // Placeholder; real from /health-factor/{address}

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-lg"
    >
      {/* Risk Passport gate */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 flex items-center gap-3">
        <Shield className="w-6 h-6 text-emerald-500" />
        <div>
          <p className="font-medium text-zinc-200">
            Tier {passport?.tier ?? "—"} · {passport?.tier_name ?? "—"}
          </p>
          <p className="text-sm text-zinc-500">
            Letter: {passport?.letter_rating ?? "—"} · Eligible LTV from Risk Passport
          </p>
        </div>
      </div>

      {/* Your positions */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h3 className="font-medium text-zinc-200 mb-3">YOUR POSITIONS</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-zinc-500">Supplied</p>
            <p className="text-zinc-200">{formatCompact(supplied.toString())} ETH</p>
          </div>
          <div>
            <p className="text-zinc-500">Borrowed</p>
            <p className="text-zinc-200">{formatCompact(borrowed.toString())} ETH</p>
          </div>
          <div>
            <p className="text-zinc-500">Health</p>
            <p className="text-zinc-200">{healthFactor.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Pool stats */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h3 className="font-medium text-zinc-200 mb-3">POOL STATS</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-zinc-500">TVL</p>
            <p className="text-zinc-200">{pool?.total_supplied_eth?.toFixed(2) ?? "—"} ETH</p>
          </div>
          <div>
            <p className="text-zinc-500">Utilization</p>
            <p className="text-zinc-200">{((pool?.utilization_bps ?? 0) / 100).toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-zinc-500">Base rate</p>
            <p className="text-zinc-200">DAO-set</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-4">
        <div className="flex gap-2">
          {(["supply", "borrow", "repay", "withdraw"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize ${
                action === a ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <input
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
        />
        <button
          disabled={!amount || parseFloat(amount) <= 0}
          className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium capitalize"
        >
          {action}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Stake Panel ────────────────────────────────────────────────────────────

function StakePanel({ address }: { address: string | undefined }) {
  const [overview, setOverview] = useState<{
    staked_strk?: number;
    apr_pct?: number;
    rewards?: number;
    positions?: Array<{ pool_name?: string; delegated_strk?: number; unclaimed_rewards_strk?: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      setLoading(true);
      try {
        const [apyRes, posRes] = await Promise.all([
          apiFetch<{ average_apr_pct?: number }>("/api/v1/zkdefi/staking/apy").catch(() => null),
          address
            ? apiFetch<{
                positions?: Array<{
                  pool_name?: string;
                  delegated_strk?: number;
                  unclaimed_rewards_strk?: number;
                }>;
              }>(`/api/v1/zkdefi/staking/positions/${address}`).catch(() => null)
            : null,
        ]);
        const positions = posRes?.positions ?? [];
        const totalStaked = positions.reduce((a, p) => a + (p.delegated_strk ?? 0), 0);
        const totalRewards = positions.reduce((a, p) => a + (p.unclaimed_rewards_strk ?? 0), 0);
        setOverview({
          staked_strk: totalStaked,
          apr_pct: apyRes?.average_apr_pct ?? 0,
          rewards: totalRewards,
          positions,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load staking data");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 flex items-center gap-3">
        <AlertCircle className="w-6 h-6 text-amber-500" />
        <div>
          <p className="font-medium text-zinc-200">Unable to load</p>
          <p className="text-sm text-zinc-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-lg"
    >
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h3 className="font-medium text-zinc-200 mb-3">Staking Overview</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-zinc-500">Staked</p>
            <p className="text-zinc-200">{(overview?.staked_strk ?? 0).toFixed(2)} STRK</p>
          </div>
          <div>
            <p className="text-zinc-500">APR</p>
            <p className="text-zinc-200">{(overview?.apr_pct ?? 0).toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-zinc-500">Rewards</p>
            <p className="text-zinc-200">{(overview?.rewards ?? 0).toFixed(4)} STRK</p>
          </div>
        </div>
      </div>
      {overview?.positions && overview.positions.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h3 className="font-medium text-zinc-200 mb-3">Positions</h3>
          <ul className="space-y-2">
            {overview.positions.map((p, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span className="text-zinc-300">{p.pool_name ?? "—"}</span>
                <span className="text-zinc-400">
                  {(p.delegated_strk ?? 0).toFixed(2)} STRK · {(p.unclaimed_rewards_strk ?? 0).toFixed(4)} rewards
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <button className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium">
          Delegate
        </button>
        <button className="flex-1 py-2.5 rounded-lg border border-zinc-600 hover:bg-zinc-800 font-medium">
          Claim
        </button>
        <button className="flex-1 py-2.5 rounded-lg border border-zinc-600 hover:bg-zinc-800 font-medium">
          Exit
        </button>
      </div>
    </motion.div>
  );
}

// ─── DCA Panel ──────────────────────────────────────────────────────────────

function DCAPanel({ address }: { address: string | undefined }) {
  const [schedules, setSchedules] = useState<Array<{ pair: string; amount: string; interval: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pair, setPair] = useState("STRK/ETH");
  const [amountPerInterval, setAmountPerInterval] = useState("");
  const [interval, setInterval] = useState<"hourly" | "daily" | "weekly">("daily");

  useEffect(() => {
    const load = async () => {
      if (!address) {
        setLoading(false);
        return;
      }
      setError(null);
      setLoading(true);
      try {
        const res = await apiFetch<{ schedules?: Array<{ pair?: string; amount?: string; interval?: string }> }>(
          `/api/v1/vault/dca/list/${address}`
        );
        const list = (res?.schedules ?? []).map((s) => ({
          pair: s.pair ?? "—",
          amount: s.amount ?? "0",
          interval: s.interval ?? "—",
        }));
        setSchedules(list);
      } catch {
        setSchedules([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-lg"
    >
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-4">
        <h3 className="font-medium text-zinc-200">Schedule DCA</h3>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Token pair</label>
          <select
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          >
            {SWAP_PAIRS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Amount per interval</label>
          <input
            type="number"
            min="0"
            step="any"
            value={amountPerInterval}
            onChange={(e) => setAmountPerInterval(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Interval</label>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as "hourly" | "daily" | "weekly")}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          >
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <button
          disabled={!amountPerInterval || parseFloat(amountPerInterval) <= 0}
          className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium"
        >
          Start DCA
        </button>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h3 className="font-medium text-zinc-200 mb-3">Active Schedules</h3>
        {schedules.length === 0 ? (
          <p className="text-sm text-zinc-500">No active DCA schedules</p>
        ) : (
          <ul className="space-y-2">
            {schedules.map((s, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span className="text-zinc-300">{s.pair ?? "—"}</span>
                <span className="text-zinc-400">
                  {s.amount ?? "0"} / {s.interval ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  );
}

// ─── Limits Panel ───────────────────────────────────────────────────────────

function LimitsPanel({ address }: { address: string | undefined }) {
  const [orders, setOrders] = useState<Array<{ pair: string; price: string; amount: string; side: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [pair, setPair] = useState("STRK/ETH");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"buy" | "sell">("buy");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{
          orders?: Array<{ pair?: string; price?: string; amount?: string; side?: string }>;
        }>(`/api/v1/zkdefi/dex/limit-orders/${address ?? "0x0"}`).catch(() => ({ orders: [] }));
        const list = (res?.orders ?? []).map((o) => ({
          pair: o.pair ?? "—",
          price: o.price ?? "0",
          amount: o.amount ?? "0",
          side: o.side ?? "—",
        }));
        setOrders(list);
      } catch {
        setOrders([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-lg"
    >
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-4">
        <h3 className="font-medium text-zinc-200">Place Limit Order</h3>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Pair</label>
          <select
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          >
            {SWAP_PAIRS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Direction</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "buy" | "sell")}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Price</label>
          <input
            type="number"
            min="0"
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Amount</label>
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100"
          />
        </div>
        <button
          disabled={!price || !amount || parseFloat(price) <= 0 || parseFloat(amount) <= 0}
          className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium"
        >
          Place Limit Order
        </button>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h3 className="font-medium text-zinc-200 mb-3">Active Orders</h3>
        {orders.length === 0 ? (
          <p className="text-sm text-zinc-500">No active limit orders</p>
        ) : (
          <ul className="space-y-2">
            {orders.map((o, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span className="text-zinc-300">{o.pair ?? "—"} {o.side ?? ""}</span>
                <span className="text-zinc-400">
                  @ {o.price ?? "—"} · {o.amount ?? "0"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  );
}
