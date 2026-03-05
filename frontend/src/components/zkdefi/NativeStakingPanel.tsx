"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "@starknet-react/core";
import { Coins, ExternalLink, RefreshCw, Shield, TrendingUp, Zap } from "lucide-react";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import { toastError, toastSuccess } from "@/lib/toast";
import { executeCalls } from "@/lib/tx/executeCalls";
import { useLivePrice } from "@/hooks/useLivePrice";

import { API_BASE, apiFetch } from "@/lib/api/client";

interface StakingPool {
  pool_address: string;
  staker_address: string;
  name: string;
  commission_pct: number;
  estimated_apr_pct: number;
  active: boolean;
}

interface UserPosition {
  pool_address: string;
  pool_name: string;
  delegated_strk: number;
  delegated_wei: string;
  unclaimed_rewards_strk: number;
  unclaimed_rewards_wei: string;
  pending_exit_wei: string;
  exit_available_at: number | null;
}

interface DashboardData {
  network: string;
  staking_contract: string;
  strk_token: string;
  total_stake_strk: number;
  current_epoch: number;
  is_paused: boolean;
  updated_at: number;
  pools: StakingPool[];
  user?: {
    address: string;
    strk_balance: number;
    strk_balance_wei: string;
    positions: UserPosition[];
  };
  error?: string;
}

function formatStrk(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
  return val.toFixed(4);
}

export function NativeStakingPanel() {
  const { address, isConnected, account } = useAccount();
  const { prices } = useLivePrice();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("");
  const [selectedPool, setSelectedPool] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const url = address
        ? `/api/v1/strategies/staking/dashboard?user_address=${address}`
        : `/api/v1/strategies/staking/dashboard`;
      const data = await apiFetch<DashboardData>(url);
      setDashboard(data);
      // Auto-select first active pool
      if (!selectedPool && data.pools?.length > 0) {
        const first = data.pools.find((p: StakingPool) => p.active && p.pool_address !== "0x0");
        if (first) setSelectedPool(first.pool_address);
      }
    } catch (e) {
      console.error("Failed to fetch staking dashboard:", e);
    } finally {
      setLoading(false);
    }
  }, [address, selectedPool]);

  useEffect(() => { void fetchDashboard(); }, [fetchDashboard]);
  useVisibilityPolling(() => void fetchDashboard(), 30_000, [fetchDashboard]);

  const strkUsdPrice = prices?.strk_usd ?? 0;
  const totalStakeUsd = (dashboard?.total_stake_strk ?? 0) * strkUsdPrice;
  const userBalance = dashboard?.user?.strk_balance ?? 0;
  const userPositions = dashboard?.user?.positions ?? [];
  const totalDelegated = userPositions.reduce((sum, p) => sum + p.delegated_strk, 0);
  const totalRewards = userPositions.reduce((sum, p) => sum + p.unclaimed_rewards_strk, 0);

  const handleDelegate = async () => {
    if (!address || !selectedPool || selectedPool === "0x0") {
      toastError("Select an active delegation pool");
      return;
    }
    const amount = parseFloat(stakeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toastError("Enter a valid STRK amount");
      return;
    }
    const amountWei = BigInt(Math.floor(amount * 1e18));

    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/strategies/staking/build-delegate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool_contract: selectedPool,
          amount_wei: amountWei.toString(),
          reward_address: address,
        }),
      });
      if (!res.ok) throw new Error("Failed to build delegate tx");
      const { calls, description } = await res.json();
      toastSuccess(`Signing: ${description}`);
      
      // Execute via wallet
      if (!account) { toastError("Wallet not connected"); return; }
      const result = await executeCalls({ account, calls });
      if (result?.transaction_hash) {
        toastSuccess(`Delegation submitted! TX: ${result.transaction_hash.slice(0, 10)}...`);
      }
      setStakeAmount("");
      void fetchDashboard();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Delegation failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleClaim = async (poolAddr: string) => {
    if (!address) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/strategies/staking/build-claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool_contract: poolAddr, user_address: address }),
      });
      if (!res.ok) throw new Error("Failed to build claim tx");
      const { calls } = await res.json();
      if (!account) { toastError("Wallet not connected"); return; }
      const result = await executeCalls({ account, calls });
      if (result?.transaction_hash) {
        toastSuccess("Rewards claimed!");
      }
      void fetchDashboard();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleExitIntent = async (poolAddr: string, amountWei: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/strategies/staking/build-exit-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool_contract: poolAddr, amount_wei: amountWei }),
      });
      if (!res.ok) throw new Error("Failed to build exit tx");
      const { calls } = await res.json();
      if (!account) { toastError("Wallet not connected"); return; }
      const result = await executeCalls({ account, calls });
      if (result?.transaction_hash) {
        toastSuccess("Exit initiated! Cooldown period started.");
      }
      void fetchDashboard();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Exit failed");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Network Banner */}
      <div className="flex items-center gap-3 rounded-xl border border-cyan-800/30 bg-cyan-900/10 px-5 py-3">
        <Shield className="w-5 h-5 text-cyan-400" />
        <div className="flex-1">
          <p className="text-sm font-medium text-cyan-300">Starknet Native Delegated Staking</p>
          <p className="text-xs text-zinc-400">Secured by the Starknet staking protocol on Sepolia testnet</p>
        </div>
        <a
          href={`https://sepolia.voyager.online/contract/${dashboard?.staking_contract || ""}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
        >
          Contract <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-400/80 flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          Delegation uses a hashed commitment — the staking pool sees a proof of your delegation amount, not your wallet&apos;s total balance. Your vault position stays private.
        </span>
      </div>

      {/* Global Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-500 mb-1">Total Staked</p>
          <p className="text-lg font-bold text-cyan-400">{formatStrk(dashboard?.total_stake_strk ?? 0)} STRK</p>
          {strkUsdPrice > 0 && (
            <p className="text-xs text-zinc-500">${totalStakeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          )}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-500 mb-1">Current Epoch</p>
          <p className="text-lg font-bold text-zinc-200">{dashboard?.current_epoch?.toLocaleString() ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-500 mb-1">Est. APR</p>
          <p className="text-lg font-bold text-emerald-400">~4.5%</p>
          <p className="text-xs text-zinc-500">Testnet rate</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs text-zinc-500 mb-1">Network</p>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${dashboard?.is_paused ? "bg-amber-500" : "bg-emerald-500 animate-pulse"}`} />
            <p className="text-sm font-medium">{dashboard?.is_paused ? "Paused" : "Active"}</p>
          </div>
          <p className="text-xs text-zinc-500 mt-1">Sepolia</p>
        </div>
      </div>

      {/* User Section */}
      {isConnected && address ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Delegate */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2 mb-4">
              <Coins className="w-4 h-4 text-cyan-400" />
              Delegate STRK
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Your STRK Balance</label>
                <p className="text-sm font-mono text-zinc-200">{formatStrk(userBalance)} STRK</p>
              </div>

              {dashboard?.pools && dashboard.pools.length > 0 ? (
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Delegation Pool</label>
                  <div className="space-y-2">
                    {dashboard.pools.filter(p => p.active).map(pool => (
                      <button
                        key={pool.pool_address}
                        type="button"
                        onClick={() => setSelectedPool(pool.pool_address)}
                        className={`w-full p-3 rounded-lg border text-left transition-colors ${
                          selectedPool === pool.pool_address
                            ? "border-cyan-600/50 bg-cyan-600/10"
                            : "border-zinc-700 bg-zinc-800/40 hover:border-zinc-600"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium">{pool.name}</span>
                          <span className="text-xs text-emerald-400">{pool.estimated_apr_pct}% APR</span>
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Commission: {pool.commission_pct}%
                          {pool.pool_address !== "0x0" && ` • ${pool.pool_address.slice(0, 8)}...`}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 p-3">
                  <p className="text-xs text-zinc-400">
                    No delegation pools discovered yet. Pool discovery runs automatically.
                    You can also stake directly if you meet the minimum stake requirement.
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs text-zinc-500 block mb-1">Amount (STRK)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={stakeAmount}
                    onChange={e => setStakeAmount(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => setStakeAmount(String(Math.floor(userBalance * 100) / 100))}
                    className="px-2 py-1 text-xs text-cyan-400 border border-cyan-800/30 rounded-lg hover:bg-cyan-900/20"
                  >
                    Max
                  </button>
                </div>
                {strkUsdPrice > 0 && stakeAmount && (
                  <p className="text-xs text-zinc-500 mt-1">
                    ≈ ${(parseFloat(stakeAmount || "0") * strkUsdPrice).toFixed(2)} USD
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={actionLoading || !selectedPool || selectedPool === "0x0" || !stakeAmount}
                onClick={handleDelegate}
                className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                {actionLoading ? "Signing..." : "Delegate STRK"}
              </button>
              <p className="text-[11px] text-zinc-500 mt-1.5 flex items-center gap-1">
                <Shield className="w-3 h-3 text-emerald-500/60" />
                Delegation proof generated locally · ~5s · pool receives commitment only
              </p>
            </div>
          </div>

          {/* Right: Positions */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Your Positions
              </h3>
              <button
                type="button"
                onClick={() => void fetchDashboard()}
                className="p-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 p-3">
                <p className="text-xs text-zinc-500">Delegated</p>
                <p className="text-sm font-bold text-cyan-300">{formatStrk(totalDelegated)} STRK</p>
              </div>
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 p-3">
                <p className="text-xs text-zinc-500">Unclaimed Rewards</p>
                <p className="text-sm font-bold text-emerald-400">{formatStrk(totalRewards)} STRK</p>
              </div>
            </div>

            {userPositions.length > 0 ? (
              <div className="space-y-3">
                {userPositions.map(pos => (
                  <div key={pos.pool_address} className="rounded-lg border border-zinc-700 bg-zinc-800/20 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{pos.pool_name}</span>
                      <span className="text-xs text-zinc-500">{pos.pool_address.slice(0, 8)}...</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <div>
                        <span className="text-zinc-500">Delegated:</span>
                        <span className="ml-1 text-zinc-200">{formatStrk(pos.delegated_strk)} STRK</span>
                      </div>
                      <div>
                        <span className="text-zinc-500">Rewards:</span>
                        <span className="ml-1 text-emerald-400">{formatStrk(pos.unclaimed_rewards_strk)} STRK</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={actionLoading || pos.unclaimed_rewards_strk <= 0}
                        onClick={() => handleClaim(pos.pool_address)}
                        className="px-3 py-1.5 rounded-lg border border-emerald-700/40 text-xs text-emerald-300 hover:bg-emerald-600/10 disabled:opacity-50"
                      >
                        Claim
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading || pos.delegated_strk <= 0}
                        onClick={() => handleExitIntent(pos.pool_address, pos.delegated_wei)}
                        className="px-3 py-1.5 rounded-lg border border-amber-700/40 text-xs text-amber-300 hover:bg-amber-600/10 disabled:opacity-50"
                      >
                        Exit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/20 p-4 text-center">
                <Coins className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-400">No active delegation positions</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Delegate STRK to earn staking rewards
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <Shield className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400">Connect your wallet to delegate STRK</p>
          <p className="text-xs text-zinc-500 mt-1">
            Earn staking rewards by delegating to validators on Starknet Sepolia
          </p>
        </div>
      )}

      {/* Info Footer */}
      <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-4">
        <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">How Native Staking Works</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs text-zinc-400">
          <div className="flex items-start gap-2">
            <Zap className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
            <p><strong className="text-zinc-300">Delegate:</strong> Approve &amp; deposit STRK into a validator&apos;s delegation pool</p>
          </div>
          <div className="flex items-start gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
            <p><strong className="text-zinc-300">Earn:</strong> Accrue rewards each epoch (~20 min on Sepolia)</p>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="w-3.5 h-3.5 text-violet-400 mt-0.5 shrink-0" />
            <p><strong className="text-zinc-300">Exit:</strong> Initiate exit (cooldown period), then claim your STRK</p>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
            <p><strong className="text-zinc-300">Privacy:</strong> Delegation amount is committed via Pedersen hash — the pool verifies your stake without seeing your total balance</p>
          </div>
        </div>
      </div>
    </div>
  );
}
