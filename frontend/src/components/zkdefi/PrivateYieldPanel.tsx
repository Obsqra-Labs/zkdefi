"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  TrendingUp,
  Lock,
  Zap,
  RefreshCw,
  BarChart3,
  Coins,
  Info,
} from "lucide-react";
import { Tooltip } from "@/components/zkdefi/Tooltip";
import { API_BASE } from "@/lib/api/client";

interface VaultStats {
  pool_address: string;
  tvl_wei: number;
  tvl_eth: number;
  total_deposits_eth: number;
  total_yield_wei: number;
  total_yield_eth: number;
  ekubo_deployed_eth: number;
  ekubo_pct: number;
  lending_deployed_eth: number;
  lending_pct: number;
  idle_wei: number;
  idle_eth: number;
  idle_pct: number;
  share_price_eth: number;
  ekubo_apy_bps: number;
  lending_apy_bps: number;
  blended_apy_bps: number;
  blended_apy_pct: number;
  deposit_count: number;
  /* Staking fields — optional until backend wires them */
  staking_deployed_strk?: number;
  staking_deployed_eth?: number;
  staking_pct?: number;
  staking_apy_bps?: number;
}

interface YieldPosition {
  position_id: string;
  commitment: string;
  amount_wei: number;
  deposited_at: number;
  yield_earned_wei: number;
}

interface StakingSummary {
  total_delegated_strk: number;
  unclaimed_rewards_strk: number;
  estimated_apr_pct: number;
  pools: number;
}

interface BlendedYield {
  blended_apy_pct: number;
  ekubo_contribution: { deployed_wei: number; apy_bps: number; annual_yield_wei: number };
  lending_contribution: { deployed_wei: number; apy_bps: number; annual_yield_wei: number };
  staking_contribution?: { delegated_strk: number; apy_bps: number; annual_yield_strk: number };
}

interface Props { address?: string; }

export function PrivateYieldPanel({ address }: Props) {
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [positions, setPositions] = useState<YieldPosition[]>([]);
  const [blended, setBlended] = useState<BlendedYield | null>(null);
  const [staking, setStaking] = useState<StakingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const fetches: Promise<any>[] = [
        fetch(`${API_BASE}/api/v1/zkdefi/private-yield/vault/stats`).then(r => r.json()),
        fetch(`${API_BASE}/api/v1/zkdefi/private-yield/yield/blended`).then(r => r.json()),
      ];
      // Fetch staking summary (graceful fallback if not available yet)
      const stakingUrl = address
        ? `${API_BASE}/api/v1/strategies/staking/dashboard?user_address=${address}`
        : `${API_BASE}/api/v1/strategies/staking/dashboard`;
      fetches.push(fetch(stakingUrl).then(r => r.ok ? r.json() : null).catch(() => null));

      const [s, b, stakingData] = await Promise.all(fetches);
      setStats(s); setBlended(b);

      // Derive staking summary from dashboard data
      if (stakingData && !stakingData.error) {
        const userPositions = stakingData.user?.positions ?? [];
        const totalDel = userPositions.reduce((a: number, p: any) => a + (p.delegated_strk || 0), 0);
        const totalRewards = userPositions.reduce((a: number, p: any) => a + (p.unclaimed_rewards_strk || 0), 0);
        const avgApr = stakingData.pools?.length > 0
          ? stakingData.pools.reduce((s: number, p: any) => s + (p.estimated_apr_pct || 0), 0) / stakingData.pools.length
          : 4.5;
        setStaking({
          total_delegated_strk: totalDel,
          unclaimed_rewards_strk: totalRewards,
          estimated_apr_pct: avgApr,
          pools: stakingData.pools?.filter((p: any) => p.active)?.length ?? 0,
        });
      }

      if (address) {
        const p = await fetch(`${API_BASE}/api/v1/zkdefi/private-yield/positions/${address}`).then(r => r.json());
        setPositions(p.positions || []);
      }
    } catch (e) { console.warn("Private yield fetch:", e); }
    finally { setLoading(false); }
  }, [address]);

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 30000); return () => clearInterval(iv); }, [fetchData]);

  const handleDeploy = async () => {
    setDeploying(true); setDeployResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/private-yield/deploy`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ risk_profile: "balanced" }),
      });
      const d = await res.json();
      setDeployResult(d.deployed ? `Deployed: Ekubo ${d.allocation?.ekubo_pct||0}%, Lending ${d.allocation?.lending_pct||0}%` : (d.reason || "Nothing deployed"));
      if (d.deployed) fetchData();
    } catch { setDeployResult("Deploy failed"); }
    finally { setDeploying(false); }
  };

  const handleAccrue = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/private-yield/yield/accrue`, { method: "POST" });
      const d = await res.json();
      if (d.total_yield_wei > 0) setDeployResult(`Accrued: ${d.total_yield_eth} ETH`);
      fetchData();
    } catch { /* non-fatal */ }
  };

  const wei2eth = (w: number) => (w / 1e18).toFixed(6);
  const bps2pct = (b: number) => (b / 100).toFixed(2);

  if (loading && !stats) return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="glass rounded-xl border border-violet-800/30 bg-gradient-to-br from-violet-950/20 to-zinc-900/0 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Shield className="w-5 h-5 text-violet-400" /> Private Yield Vault
            </h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">Privacy-preserving yield from LP, Lending &amp; Staking</p>
          </div>
          <button type="button" onClick={fetchData} className="px-2 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 text-xs">
            <RefreshCw className={`w-3 h-3 inline ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-violet-700/30 bg-violet-950/20 p-4">
            <Tooltip content="Total value locked across all vault strategies including LP, lending and idle reserves.">
              <p className="text-[10px] uppercase tracking-wider text-violet-500 mb-1 flex items-center gap-1 cursor-help">TVL <Info className="w-2.5 h-2.5" /></p>
            </Tooltip>
            <p className="text-xl font-bold text-violet-300 font-mono">{stats ? stats.tvl_eth.toFixed(4) : "---"}</p>
            <p className="text-[9px] text-zinc-500 mt-1">ETH</p>
          </div>
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 p-4">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Deposits</p>
            <p className="text-xl font-bold text-zinc-200 font-mono">{stats?.deposit_count ?? 0}</p>
            <p className="text-[9px] text-zinc-500 mt-1">commitments</p>
          </div>
          <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/20 p-4">
            <Tooltip content="Total yield accrued from all active strategies (LP fees + lending interest).">
              <p className="text-[10px] uppercase tracking-wider text-emerald-500 mb-1 flex items-center gap-1 cursor-help">Yield Earned <Info className="w-2.5 h-2.5" /></p>
            </Tooltip>
            <p className="text-xl font-bold text-emerald-400 font-mono">{stats ? stats.total_yield_eth.toFixed(6) : "---"}</p>
            <p className="text-[9px] text-zinc-500 mt-1">ETH</p>
          </div>
          <div className="rounded-xl border border-cyan-700/30 bg-cyan-950/20 p-4">
            <Tooltip content="Blended annual yield from Ekubo LP fees, lending interest, and staking rewards weighted by allocation.">
              <p className="text-[10px] uppercase tracking-wider text-cyan-500 mb-1 flex items-center gap-1 cursor-help">Blended APY <Info className="w-2.5 h-2.5" /></p>
            </Tooltip>
            <p className="text-xl font-bold text-cyan-400 font-mono">{blended ? `${blended.blended_apy_pct}%` : stats ? `${stats.blended_apy_pct}%` : "---"}</p>
            <p className="text-[9px] text-zinc-500 mt-1">annualized</p>
          </div>
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 p-4">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Share Price</p>
            <p className="text-xl font-bold text-zinc-200 font-mono">{stats ? stats.share_price_eth.toFixed(6) : "---"}</p>
            <p className="text-[9px] text-zinc-500 mt-1">ETH</p>
          </div>
          <div className="rounded-xl border border-green-700/30 bg-green-950/20 p-4">
            <Tooltip content="STRK delegated to Starknet validators. Earns staking rewards each epoch.">
              <p className="text-[10px] uppercase tracking-wider text-green-500 mb-1 flex items-center gap-1 cursor-help">Staked STRK <Coins className="w-2.5 h-2.5" /></p>
            </Tooltip>
            <p className="text-xl font-bold text-green-400 font-mono">{staking ? staking.total_delegated_strk.toFixed(2) : "---"}</p>
            <p className="text-[9px] text-zinc-500 mt-1">{staking ? `${staking.estimated_apr_pct.toFixed(1)}% APR` : "STRK"}</p>
          </div>
        </div>
      </div>

      {stats && stats.tvl_wei > 0 && (
        <div className="glass rounded-xl border border-zinc-800 p-5">
          <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" /> Capital Allocation
          </h4>
          <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-zinc-800 mb-3">
            {stats.ekubo_pct > 0 && <div className="bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${stats.ekubo_pct}%` }} />}
            {stats.lending_pct > 0 && <div className="bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${stats.lending_pct}%` }} />}
            {(stats.staking_pct ?? 0) > 0 && <div className="bg-green-500 rounded-full transition-all duration-500" style={{ width: `${stats.staking_pct}%` }} />}
            {stats.idle_pct > 0 && <div className="bg-zinc-600 rounded-full transition-all duration-500" style={{ width: `${stats.idle_pct}%` }} />}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <div>
                <span className="text-zinc-400">Ekubo LP</span>
                <p className="text-zinc-200 font-mono">{stats.ekubo_deployed_eth.toFixed(4)} ETH ({stats.ekubo_pct}%)</p>
                <p className="text-blue-400 text-[10px]">{bps2pct(stats.ekubo_apy_bps)}% APY</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <div>
                <span className="text-zinc-400">Lending</span>
                <p className="text-zinc-200 font-mono">{stats.lending_deployed_eth.toFixed(4)} ETH ({stats.lending_pct}%)</p>
                <p className="text-amber-400 text-[10px]">{bps2pct(stats.lending_apy_bps)}% APY</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <div>
                <span className="text-zinc-400">Staking</span>
                <p className="text-zinc-200 font-mono">{staking ? `${staking.total_delegated_strk.toFixed(2)} STRK` : "—"} ({stats.staking_pct ?? 0}%)</p>
                <p className="text-green-400 text-[10px]">{staking ? `${staking.estimated_apr_pct.toFixed(1)}% APR` : "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
              <div>
                <span className="text-zinc-400">Idle</span>
                <p className="text-zinc-200 font-mono">{stats.idle_eth.toFixed(4)} ETH ({stats.idle_pct}%)</p>
                <p className="text-zinc-500 text-[10px]">awaiting deployment</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass rounded-xl border border-cyan-800/30 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-5 h-5 text-cyan-400" />
            <h4 className="text-sm font-semibold">Deploy Idle Capital</h4>
          </div>
          <p className="text-xs text-zinc-500 mb-3">Deploy vault idle balance across Ekubo LP, LendingPool, and STRK staking via AI allocation.</p>
          <button type="button" onClick={handleDeploy} disabled={deploying || !stats || stats.idle_wei < 10000000000000000}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors">
            {deploying ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Zap className="w-4 h-4" />}
            {deploying ? "Deploying..." : "Deploy Capital"}
          </button>
        </div>
        <div className="glass rounded-xl border border-emerald-800/30 p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <h4 className="text-sm font-semibold">Accrue Yield</h4>
          </div>
          <p className="text-xs text-zinc-500 mb-3">Trigger yield accrual from active LP, lending, and staking deployments.</p>
          <button type="button" onClick={handleAccrue}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-medium text-sm transition-colors">
            <TrendingUp className="w-4 h-4" /> Accrue Yield
          </button>
        </div>
      </div>

      {deployResult && (
        <div className="rounded-lg border border-emerald-700/50 bg-emerald-900/20 p-3 text-sm text-emerald-300">{deployResult}</div>
      )}

      {(blended || staking) && (
        <div className="glass rounded-xl border border-zinc-800 p-5">
          <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" /> Yield Sources
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {blended && (
              <div className="rounded-lg border border-blue-700/30 bg-blue-950/10 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-blue-400 font-medium">Ekubo LP Fees</span>
                  <span className="text-xs text-blue-300 font-mono">{bps2pct(blended.ekubo_contribution.apy_bps)}% APY</span>
                </div>
                <p className="text-sm text-zinc-300">{wei2eth(blended.ekubo_contribution.deployed_wei)} ETH deployed</p>
                <p className="text-xs text-zinc-500 mt-1">~{wei2eth(blended.ekubo_contribution.annual_yield_wei)} ETH/yr</p>
              </div>
            )}
            {blended && (
              <div className="rounded-lg border border-amber-700/30 bg-amber-950/10 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-amber-400 font-medium">Lending Interest</span>
                  <span className="text-xs text-amber-300 font-mono">{bps2pct(blended.lending_contribution.apy_bps)}% APY</span>
                </div>
                <p className="text-sm text-zinc-300">{wei2eth(blended.lending_contribution.deployed_wei)} ETH supplied</p>
                <p className="text-xs text-zinc-500 mt-1">~{wei2eth(blended.lending_contribution.annual_yield_wei)} ETH/yr</p>
              </div>
            )}
            <div className="rounded-lg border border-green-700/30 bg-green-950/10 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-green-400 font-medium flex items-center gap-1"><Coins className="w-3 h-3" /> STRK Staking</span>
                <span className="text-xs text-green-300 font-mono">{staking ? `${staking.estimated_apr_pct.toFixed(1)}%` : "—"} APR</span>
              </div>
              <p className="text-sm text-zinc-300">{staking ? `${staking.total_delegated_strk.toFixed(2)} STRK delegated` : "Not delegated"}</p>
              <p className="text-xs text-zinc-500 mt-1">
                {staking && staking.unclaimed_rewards_strk > 0
                  ? `${staking.unclaimed_rewards_strk.toFixed(4)} STRK unclaimed`
                  : staking?.pools ? `${staking.pools} active pool${staking.pools !== 1 ? "s" : ""}` : "Epoch rewards"}
              </p>
            </div>
          </div>
        </div>
      )}

      {positions.length > 0 && (
        <div className="glass rounded-xl border border-zinc-800 p-5">
          <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
            <Lock className="w-4 h-4 text-violet-400" /> Your Positions
          </h4>
          <div className="space-y-2">
            {positions.map((pos) => (
              <div key={pos.position_id} className="flex items-center justify-between rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-4 py-3">
                <div>
                  <p className="text-xs text-zinc-300 font-mono">{pos.commitment.slice(0,12)}...{pos.commitment.slice(-8)}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Deposited {new Date(pos.deposited_at * 1000).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-zinc-200 font-mono">{wei2eth(pos.amount_wei)} ETH</p>
                  {pos.yield_earned_wei > 0 && <p className="text-[10px] text-emerald-400">+{wei2eth(pos.yield_earned_wei)} yield</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass rounded-xl border border-violet-800/30 p-6 text-center">
        <Shield className="w-8 h-8 text-violet-400 mx-auto mb-3" />
        <h4 className="font-semibold text-zinc-200 mb-1">Deposit Privately to Earn Yield</h4>
        <p className="text-xs text-zinc-500 mb-4 max-w-md mx-auto">
          Deposit ETH via the privacy pool. Your funds are split across Ekubo LP
          (trading fees), LendingPool (borrow interest), and STRK Staking
          (validator rewards) for blended yield — all privacy-preserving.
        </p>
        <p className="text-[10px] text-zinc-600">
          Pool: <span className="font-mono text-zinc-400">{stats?.pool_address?.slice(0,14)}...{stats?.pool_address?.slice(-8)}</span>
        </p>
      </div>
    </div>
  );
}
