"use client";

import { useState, useEffect, useRef } from "react";
import { Landmark, Eye, TrendingUp, Heart, Lock, Layers, Cpu } from "lucide-react";
import { apiFetch } from "@/lib/api/client";

interface CapitalLedgerProps {
  address: string | undefined;
  onDeposit?: () => void;
  onWithdraw?: () => void;
  onImportDarkLedger?: () => void;
}

interface VaultStats {
  total_usd: number;
  strk_balance: number;
  eth_balance: number;
  strk_usd: number;
  eth_usd: number;
}

interface DeployedPosition {
  venue: string;
  pair: string;
  value_usd: number;
  apy_pct: number;
  status: string;
}

interface HealthData {
  tier: number;
  tier_name: string;
  trust_score: number;
  privacy_coverage_pct: number;
  collateral_ratio_pct: number;
  proof_count: number;
  proofs_required: number;
}

interface ZkdBalance { symbol: string; amount: number; raw_wei: number; }
interface ZkdLpPos { pair: string; position_count: number; total_amount0: number; apy_estimate: number; status: string; }
interface YieldPoint { date: string; cumulative_yield: number; apy_bps: number; }

// Inline yield sparkline — pure SVG, no deps
function YieldSparkline({ points }: { points: YieldPoint[] }) {
  if (points.length < 2) return null;
  const safePoints = points.filter((p) => p && typeof p?.cumulative_yield === "number");
  if (safePoints.length < 2) return null;
  const first = safePoints[0];
  const latest = safePoints[safePoints.length - 1];
  const dateStr = (d: YieldPoint) => (d?.date && String(d.date).length >= 5 ? String(d.date).slice(5) : "—");
  const W = 220; const H = 36; const PAD = 4;
  const ys = safePoints.map(p => p.cumulative_yield);
  const yMin = Math.min(...ys); const yMax = Math.max(...ys); const yR = yMax - yMin || 0.001;
  const toX = (i: number) => PAD + (i / (safePoints.length - 1)) * (W - PAD * 2);
  const toY = (v: number) => PAD + (H - PAD * 2) - ((v - yMin) / yR) * (H - PAD * 2);
  const d = safePoints.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.cumulative_yield).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-9">
        <path d={d} fill="none" stroke="#10b981" strokeWidth="1.5" />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-500 mt-0.5">
        <span>{dateStr(first)}</span>
        <span className="text-emerald-400 font-medium">+{latest.cumulative_yield.toFixed(2)}%</span>
        <span>{dateStr(latest)}</span>
      </div>
    </div>
  );
}

export function CapitalLedger({ address, onDeposit, onWithdraw, onImportDarkLedger }: CapitalLedgerProps) {
  const [vault, setVault] = useState<VaultStats>({ total_usd: 0, strk_balance: 0, eth_balance: 0, strk_usd: 0, eth_usd: 0 });
  const [darkLedger, setDarkLedger] = useState({ note_count: 0, sweep_available_usd: 0, l3_block: 0 });
  const [positions, setPositions] = useState<DeployedPosition[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [zkdBalances, setZkdBalances] = useState<ZkdBalance[]>([]);
  const [zkdLp, setZkdLp] = useState<ZkdLpPos[]>([]);
  const [yieldPoints, setYieldPoints] = useState<YieldPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) { setLoading(false); return; }

    const load = async () => {
      try {
        // zkd on-chain balances + LP positions (parallel)
        const [zkdPortfolio, yieldChart] = await Promise.all([
          apiFetch<any>(`/api/v1/zkdefi/zkd/portfolio/${address}`).catch(() => null),
          apiFetch<any>("/api/v1/zkdefi/zkd/yield-chart?days=30").catch(() => null),
        ]);
        if (zkdPortfolio?.balances) {
          setZkdBalances(zkdPortfolio.balances.filter((b: any) => b.amount > 0));
        }
        if (zkdPortfolio?.lp_positions) {
          setZkdLp(zkdPortfolio.lp_positions.filter((p: any) => p.status === "active"));
        }
        if (yieldChart?.points && Array.isArray(yieldChart.points)) {
          setYieldPoints(yieldChart.points);
        }

        // Vault stats
        const stats = await apiFetch<any>("/api/v1/zkdefi/private-yield/vault/stats").catch(() => null);
        if (stats) {
          setVault({
            total_usd: stats.total_value_usd || stats.tvl || 0,
            strk_balance: stats.strk_balance || 0,
            eth_balance: stats.eth_balance || 0,
            strk_usd: stats.strk_value_usd || 0,
            eth_usd: stats.eth_value_usd || 0,
          });
        }

        // Dark Ledger (notes) - endpoint not yet implemented, keeping data as zeroes
        setDarkLedger({
          note_count: 0,
          sweep_available_usd: 0,
          l3_block: 0,
        });

        // Positions
        const pos = await apiFetch<any>(`/api/v1/zkdefi/position/${address}?protocol_id=0`).catch(() => null);
        if (pos?.positions && Array.isArray(pos.positions)) {
          setPositions(pos.positions.map((p: any) => ({
            venue: p.venue || p.protocol || "Unknown",
            pair: p.pair || p.token || "",
            value_usd: p.value_usd || 0,
            apy_pct: (p.apy_bps || 0) / 100,
            status: p.status || "active",
          })));
        }

        // Health / Reputation
        const rep = await apiFetch<any>(`/api/v1/zkdefi/reputation/user/${address}`).catch(() => null);
        const passport = await apiFetch<any>(`/api/v1/zkdefi/risk_passport/user/${address}`).catch(() => null);
        const tierNames = ["Anon", "Express", "Trusted"];
        setHealth({
          tier: rep?.current_tier ?? 0,
          tier_name: tierNames[rep?.current_tier ?? 0] || "Anon",
          trust_score: rep?.trust_score ?? 0,
          privacy_coverage_pct: passport?.privacy_coverage_pct ?? 0,
          collateral_ratio_pct: passport?.collateral_ratio_pct ?? 0,
          proof_count: passport?.proof_count ?? rep?.completed_proofs ?? 0,
          proofs_required: passport?.proofs_required ?? 5,
        });
      } finally {
        setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [address]);

  const idle = Math.max(0, vault.total_usd - positions.reduce((s, p) => s + p.value_usd, 0));
  const blendedApy = positions.length > 0
    ? positions.reduce((s, p) => s + p.value_usd * p.apy_pct, 0) / Math.max(1, positions.reduce((s, p) => s + p.value_usd, 0))
    : 0;

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-zinc-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-1">
      {/* Vault Balance */}
      <section className="rounded-lg border border-zinc-800 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Landmark className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Vault</h3>
        </div>
        <p className="text-xl font-bold">${vault.total_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        <div className="mt-2 space-y-1 text-xs text-zinc-400">
          <div className="flex justify-between">
            <span>STRK</span>
            <span>{vault.strk_balance.toLocaleString()} (${vault.strk_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span>
          </div>
          <div className="flex justify-between">
            <span>ETH</span>
            <span>{vault.eth_balance.toFixed(4)} (${vault.eth_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={onDeposit} className="flex-1 py-1.5 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-500 transition-colors">
            Deposit
          </button>
          <button onClick={onWithdraw} className="flex-1 py-1.5 text-xs font-medium rounded border border-zinc-700 hover:bg-zinc-800 transition-colors">
            Withdraw
          </button>
        </div>
      </section>

      {/* Yield Performance Chart */}
      {yieldPoints.length >= 2 && (
        <section className="rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Performance (30d)</h3>
          </div>
          <YieldSparkline points={yieldPoints} />
        </section>
      )}

      {/* zkd Synthetic Tokens — on-chain balances + LP positions */}
      {(zkdBalances.length > 0 || zkdLp.length > 0) && (
        <section className="rounded-lg border border-cyan-800/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">zkd Synthetic</h3>
            <span className="ml-auto text-[10px] text-cyan-400/60">Sepolia</span>
          </div>
          {zkdBalances.length > 0 && (
            <div className="space-y-1 mb-2">
              {zkdBalances.map((b) => (
                <div key={b.symbol} className="flex justify-between text-xs">
                  <span className="text-zinc-400">{b.symbol}</span>
                  <span className="text-zinc-200 font-mono">{b.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          )}
          {zkdLp.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-zinc-800">
              {zkdLp.slice(0, 4).map((p) => (
                <div key={p.pair} className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-300">{p.pair}</span>
                  <div className="text-right">
                    <span className="text-zinc-500">{p.position_count} pos</span>
                    <span className="text-emerald-400 ml-2">{p.apy_estimate.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Dark Ledger */}
      <section className="rounded-lg border border-violet-800/40 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="w-4 h-4 text-violet-400" />
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Dark Ledger</h3>
          <span className="ml-auto text-[10px] text-violet-400/60">L3 Madara</span>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between text-zinc-300">
            <span>Shielded Notes</span>
            <span>{darkLedger.note_count}</span>
          </div>
          <div className="flex justify-between text-zinc-300">
            <span>Sweep Available</span>
            <span>${darkLedger.sweep_available_usd.toLocaleString()}</span>
          </div>
          {darkLedger.l3_block > 0 && (
            <div className="flex justify-between text-zinc-500">
              <span>L3 Block</span>
              <span>#{darkLedger.l3_block.toLocaleString()}</span>
            </div>
          )}
          <div className="flex items-center gap-1 text-violet-400/80">
            <Eye className="w-3 h-3" />
            <span className="text-[10px]">Commitment-shielded, L3-verified</span>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={onImportDarkLedger}
            className="flex-1 py-1 text-[10px] font-medium rounded border border-violet-700/50 text-violet-300 hover:bg-violet-900/30 transition-colors"
          >
            Import
          </button>
          <button className="flex-1 py-1 text-[10px] font-medium rounded border border-violet-700/50 text-violet-300 hover:bg-violet-900/30 transition-colors">
            Sweep to Vault
          </button>
        </div>
      </section>

      {/* Deployed Capital */}
      <section className="rounded-lg border border-zinc-800 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Deployed</h3>
          {blendedApy > 0 && (
            <span className="ml-auto text-[10px] text-emerald-400">{blendedApy.toFixed(1)}% blended</span>
          )}
        </div>
        {positions.length > 0 ? (
          <div className="space-y-1.5">
            {positions.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-zinc-800/40 hover:bg-zinc-800/70 cursor-pointer transition-colors">
                <div>
                  <span className="text-zinc-200">{p.venue}</span>
                  {p.pair && <span className="text-zinc-500 ml-1">{p.pair}</span>}
                </div>
                <div className="text-right">
                  <span className="text-zinc-200">${p.value_usd.toLocaleString()}</span>
                  <span className="text-emerald-400 ml-2">{p.apy_pct.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500 py-2">No active positions</p>
        )}
        <div className="flex justify-between text-xs mt-2 pt-2 border-t border-zinc-800">
          <span className="text-zinc-500">Idle</span>
          <span className="text-zinc-300">${idle.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
      </section>

      {/* Health */}
      {health && (
        <section className="rounded-lg border border-zinc-800 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4 text-rose-400" />
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Health</h3>
          </div>
          <div className="space-y-2">
            {/* Tier progress */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className={`font-medium ${
                  health.tier === 0 ? "text-zinc-300" : health.tier === 1 ? "text-emerald-400" : "text-amber-400"
                }`}>{health.tier_name}</span>
                <span className="text-zinc-500">Tier {health.tier}</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    health.tier === 0 ? "bg-zinc-500" : health.tier === 1 ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                  style={{ width: `${Math.min(100, (health.proof_count / Math.max(1, health.proofs_required)) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-zinc-500 mt-0.5">{health.proof_count}/{health.proofs_required} proofs</p>
            </div>
            {/* Metrics */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-zinc-500">Trust</p>
                <p className="font-medium">{health.trust_score}</p>
              </div>
              <div>
                <p className="text-zinc-500">Privacy</p>
                <p className="font-medium">{health.privacy_coverage_pct}%</p>
              </div>
              {health.collateral_ratio_pct > 0 && (
                <div>
                  <p className="text-zinc-500">Collateral</p>
                  <p className="font-medium">{health.collateral_ratio_pct}%</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
