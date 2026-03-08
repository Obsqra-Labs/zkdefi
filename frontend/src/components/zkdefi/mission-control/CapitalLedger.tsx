"use client";

import { useState, useEffect, useMemo } from "react";
import { Landmark, Eye, TrendingUp, Heart, Lock, Layers, Cpu, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { VaultCommitment } from "@/hooks/usePrivacyVault";
import type { RiskProfileV2 } from "@/hooks/useProfile";
import { ShieldedBreakdown, formatWei, METHOD_LABELS } from "@/components/zkdefi/vault/ShieldedBreakdown";
import { useTokenPrices, priceOf } from "@/hooks/useTokenPrices";

interface CapitalLedgerProps {
  address: string | undefined;
  /** Privacy vault commitments from usePrivacyVault (localStorage) */
  privacyCommitments?: VaultCommitment[];
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

export function CapitalLedger({ address, privacyCommitments = [], onDeposit, onWithdraw, onImportDarkLedger }: CapitalLedgerProps) {
  const [vault, setVault] = useState<VaultStats>({ total_usd: 0, strk_balance: 0, eth_balance: 0, strk_usd: 0, eth_usd: 0 });
  const [darkLedger, setDarkLedger] = useState({ note_count: 0, sweep_available_usd: 0, l3_block: 0 });
  interface BackendNote { note_hash: string; amount_wei: string; token: string; rail_type: string; }
  const [backendDarkNotes, setBackendDarkNotes] = useState<BackendNote[]>([]);
  const [positions, setPositions] = useState<DeployedPosition[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [zkdBalances, setZkdBalances] = useState<ZkdBalance[]>([]);
  const [zkdLp, setZkdLp] = useState<ZkdLpPos[]>([]);
  const [yieldPoints, setYieldPoints] = useState<YieldPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const { prices } = useTokenPrices();

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

        // Vault stats (private-yield pool stats)
        const stats = await apiFetch<any>("/api/v1/zkdefi/private-yield/vault/stats").catch(() => null);
        if (stats) {
          // The pool is currently ETH-denominated; token field tells us which asset.
          const isEth = !stats.token || stats.token?.toLowerCase().includes("049d365");
          const tvl = stats.tvl_eth ?? stats.tvl ?? stats.total_deposits_eth ?? 0;
          setVault({
            total_usd: stats.total_value_usd ?? 0, // not yet provided by backend
            strk_balance: isEth ? 0 : tvl,
            eth_balance: isEth ? tvl : 0,
            strk_usd: 0,
            eth_usd: 0,
          });
        }

        // Dark Ledger notes from backend (if endpoint is available)
        const darkNotes = await apiFetch<any>(`/api/v1/zkdefi/ledger/notes/${address}`).catch(() => null);
        setDarkLedger({
          note_count: darkNotes?.note_count ?? 0,
          sweep_available_usd: darkNotes?.sweep_available_usd ?? 0,
          l3_block: darkNotes?.l3_block ?? 0,
        });
        if (darkNotes?.notes && Array.isArray(darkNotes.notes)) {
          setBackendDarkNotes(darkNotes.notes.map((n: any) => ({
            note_hash: n.note_hash || "",
            amount_wei: n.amount_wei || "0",
            token: n.token || "STRK",
            rail_type: n.rail_type || "unknown",
          })));
        }

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

        // Health / Reputation (canonical V2 first, legacy fallback)
        const profile = await apiFetch<RiskProfileV2>(`/api/v1/zkdefi/risk_profile/v2/${address}`).catch(() => null);
        if (profile) {
          const linked = Array.isArray(profile.identity?.linked_addresses) ? profile.identity.linked_addresses : [];
          const linkedVerified = linked.filter((entry) => Boolean(entry?.verified)).length;
          const privacyCoveragePct = linked.length > 0
            ? Math.round((linkedVerified / linked.length) * 100)
            : profile.identity?.dual_wallet_session?.active
              ? 100
              : 0;
          const collateralEth = Number(profile.reputation?.collateral_eth ?? 0);
          const creditLineEth = Number(profile.predictive_credit?.credit_line_eth ?? 0);
          const collateralRatioPct = creditLineEth > 0
            ? Math.round((collateralEth / creditLineEth) * 100)
            : 0;

          setHealth({
            tier: Number(profile.reputation?.tier ?? 0),
            tier_name: String(profile.reputation?.tier_name ?? "Strict"),
            trust_score: Number(profile.passport?.composite_score ?? 0),
            privacy_coverage_pct: privacyCoveragePct,
            collateral_ratio_pct: collateralRatioPct,
            proof_count: Number(profile.passport?.receipt_summary?.count ?? 0),
            proofs_required: 5,
          });
        } else {
          const rep = await apiFetch<any>(`/api/v1/zkdefi/reputation/user/${address}`).catch(() => null);
          const passport = await apiFetch<any>(`/api/v1/zkdefi/risk_passport/user/${address}`).catch(() => null);
          setHealth({
            tier: Number(rep?.tier ?? 0),
            tier_name: String(rep?.tier_name ?? "Strict"),
            trust_score: Number(passport?.composite_score ?? rep?.trust_score ?? 0),
            privacy_coverage_pct: Number(passport?.privacy_coverage_pct ?? 0),
            collateral_ratio_pct: Number(passport?.collateral_ratio_pct ?? 0),
            proof_count: Number(passport?.proof_count ?? 0),
            proofs_required: Number(passport?.proofs_required ?? 5),
          });
        }
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

  // ---------------------------------------------------------------------------
  // Aggregate privacy commitments from localStorage
  // ---------------------------------------------------------------------------
  const shieldedCommitments = useMemo(
    () => privacyCommitments.filter((c) => c.method !== "dark_ledger"),
    [privacyCommitments],
  );
  const darkLedgerCommitments = useMemo(
    () => privacyCommitments.filter((c) => c.method === "dark_ledger"),
    [privacyCommitments],
  );

  // Use shared component for shielded breakdown (rendered in Vault section)

  // ---------------------------------------------------------------------------
  // Unified per-asset totals (API balances + all local commitments + backend notes)
  // ---------------------------------------------------------------------------

  // Deduplicate: localStorage dark_ledger commits that also exist in backend notes
  const localOnlyDarkCommitments = useMemo(() => {
    if (backendDarkNotes.length === 0) return darkLedgerCommitments;
    const backendHashes = new Set(backendDarkNotes.map((n) => n.note_hash));
    return darkLedgerCommitments.filter((c) => !backendHashes.has(c.id) && !backendHashes.has(c.commitment_hash));
  }, [darkLedgerCommitments, backendDarkNotes]);

  const totalDarkNotes = darkLedger.note_count + localOnlyDarkCommitments.length;

  const assetTotals = useMemo(() => {
    const map = new Map<string, { asset: string; api_balance: number; shielded_wei: bigint; dark_wei: bigint; total_notes: number }>();
    const ensure = (asset: string) => {
      if (!map.has(asset)) map.set(asset, { asset, api_balance: 0, shielded_wei: BigInt(0), dark_wei: BigInt(0), total_notes: 0 });
      return map.get(asset)!;
    };
    // API public balances (private-yield pool)
    if (vault.strk_balance > 0) { const e = ensure("STRK"); e.api_balance = vault.strk_balance; }
    if (vault.eth_balance > 0) { const e = ensure("ETH"); e.api_balance = vault.eth_balance; }
    // Shielded commits (localStorage)
    for (const c of shieldedCommitments) {
      const e = ensure(c.asset);
      e.shielded_wei += BigInt(c.amount_wei);
      e.total_notes += 1;
    }
    // Backend dark-ledger notes
    for (const n of backendDarkNotes) {
      const e = ensure(n.token);
      e.dark_wei += BigInt(n.amount_wei);
      e.total_notes += 1;
    }
    // Local-only dark-ledger commits (not already in backend)
    for (const c of localOnlyDarkCommitments) {
      const e = ensure(c.asset);
      e.dark_wei += BigInt(c.amount_wei);
      e.total_notes += 1;
    }
    return Array.from(map.values());
  }, [vault.strk_balance, vault.eth_balance, shieldedCommitments, backendDarkNotes, localOnlyDarkCommitments]);

  const totalPrivateNotes = privacyCommitments.length + backendDarkNotes.length;

  // Compute per-asset USD and grand total
  const assetRows = useMemo(() => {
    return assetTotals.map((a) => {
      const shieldedFloat = Number(a.shielded_wei) / 1e18;
      const darkFloat = Number(a.dark_wei) / 1e18;
      const totalFloat = a.api_balance + shieldedFloat + darkFloat;
      const usdPrice = priceOf(prices, a.asset);
      const totalUsd = totalFloat * usdPrice;
      return { ...a, shieldedFloat, darkFloat, totalFloat, usdPrice, totalUsd };
    });
  }, [assetTotals, prices]);

  const grandTotalUsd = useMemo(
    () => assetRows.reduce((s, r) => s + r.totalUsd, 0),
    [assetRows],
  );

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
      {/* ── Vault — canonical private identity ── */}
      <section className="rounded-lg border border-zinc-800 p-3">
        <div className="flex items-center gap-2 mb-1">
          <Landmark className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Vault</h3>
          {totalPrivateNotes > 0 && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400/80">
              <ShieldCheck className="w-3 h-3" />
              {totalPrivateNotes} note{totalPrivateNotes !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Grand total USD */}
        <div className="mb-3 text-right">
          <span className="text-lg font-semibold text-zinc-100 font-mono">
            ${grandTotalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Per-asset rows: API balance + shielded + dark-ledger */}
        {assetRows.length > 0 ? (
          <div className="space-y-2">
            {assetRows.map((a) => (
              <div key={a.asset}>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-300 font-medium">{a.asset}</span>
                  <div className="text-right">
                    <span className="text-zinc-100 font-mono">{a.totalFloat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                    <span className="text-zinc-500 font-mono ml-1.5 text-[10px]">${a.totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
                {/* Breakdown when there's more than one source */}
                {(a.api_balance > 0 && (a.shielded_wei > BigInt(0) || a.dark_wei > BigInt(0))) || (a.shielded_wei > BigInt(0) && a.dark_wei > BigInt(0)) ? (
                  <div className="ml-3 mt-0.5 space-y-0.5 text-[10px] text-zinc-500">
                    {a.api_balance > 0 && <div className="flex justify-between"><span>Public</span><span>{a.api_balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>}
                    {a.shielded_wei > BigInt(0) && <div className="flex justify-between"><span className="text-emerald-400/70">Shielded</span><span>{formatWei(a.shielded_wei.toString(), a.asset)}</span></div>}
                    {a.dark_wei > BigInt(0) && <div className="flex justify-between"><span className="text-violet-400/70">Dark Ledger</span><span>{formatWei(a.dark_wei.toString(), a.asset)}</span></div>}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500 py-1">No balances</p>
        )}

        {/* Shielded breakdown by method */}
        <ShieldedBreakdown
          commitments={privacyCommitments}
          className="mt-3 pt-2 border-t border-zinc-800/60"
        />

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
            <span>Notes</span>
            <span>{totalDarkNotes}</span>
          </div>
          {/* Backend notes */}
          {backendDarkNotes.length > 0 && (
            <div className="space-y-1 pl-2 border-l border-violet-800/30">
              {backendDarkNotes.map((n) => (
                <div key={n.note_hash} className="flex justify-between text-[11px]">
                  <span className="text-violet-300">{n.token} <span className="text-zinc-600">({METHOD_LABELS[n.rail_type] || n.rail_type})</span></span>
                  <span className="text-zinc-300 font-mono">{formatWei(n.amount_wei, n.token)}</span>
                </div>
              ))}
            </div>
          )}
          {/* Local-only (not yet synced to backend) */}
          {localOnlyDarkCommitments.length > 0 && (
            <div className="space-y-1 pl-2 border-l border-violet-800/30">
              {localOnlyDarkCommitments.map((c) => (
                <div key={c.id} className="flex justify-between text-[11px]">
                  <span className="text-violet-300">{c.asset} <span className="text-zinc-600">(local)</span></span>
                  <span className="text-zinc-300 font-mono">{formatWei(c.amount_wei, c.asset)}</span>
                </div>
              ))}
            </div>
          )}
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
