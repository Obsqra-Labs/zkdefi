"use client";

/**
 * VaultStrategyDeposit — "Personal Strategy" deposit path.
 *
 * At deposit time, the AI recommends an allocation split across the 3
 * privacy pools (Conservative / Balanced / Aggressive) based on the
 * user's risk profile, current positions, and market conditions.
 *
 * The user can accept the AI recommendation or manually adjust sliders.
 * Optionally enables auto-rebalance for ongoing AI management.
 *
 * On deposit: splits the total amount across pools by allocation %,
 * executing one ZK commitment per pool. All commitments share a
 * `strategy_id` UUID linking them as a single personal strategy deposit.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAccount } from "@starknet-react/core";
import {
  Brain,
  Loader2,
  Sparkles,
  Check,
  ArrowDownToLine,
  Shield,
  Layers,
  Zap,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Info,
} from "lucide-react";
import type { VaultCommitment, ProofStep, PrivacyMethod } from "@/hooks/usePrivacyVault";
import { ProofStepper } from "@/components/zkdefi/vault/ProofStepper";
import { API_BASE } from "@/lib/api/client";
import { toastSuccess, toastError } from "@/lib/toast";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { useApp } from "@/lib/AppContext";
import { addActivityEvent } from "@/components/zkdefi/ActivityLog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRK_TOKEN =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH_TOKEN =
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRKBTC_TOKEN =
  process.env.NEXT_PUBLIC_STRKBTC_ADDRESS ||
  "0x0714c3f541490e1847b77d799499ef01af7937ed0182f3b27a5b6226d993ab55";

const FULL_PRIVACY_POOL_ADDRESS =
  process.env.NEXT_PUBLIC_FULL_PRIVACY_POOL_V2_ADDRESS ||
  process.env.NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS ||
  "";

const FULL_PRIVACY_TOKEN =
  process.env.NEXT_PUBLIC_FULL_PRIVACY_TOKEN_ADDRESS || STRK_TOKEN;

type Asset = "STRK" | "ETH" | "strkBTC";

interface AllocationSlice {
  pool: "conservative" | "moderate" | "aggressive";
  pct: number;
  reasoning: string;
  apy: number;
}

interface AIRecommendation {
  allocations: AllocationSlice[];
  overall_reasoning: string;
  confidence: number;
  risk_score: number;
}

interface VaultStrategyDepositProps {
  method: PrivacyMethod;
  depositSteps: ProofStep[];
  setDepositSteps: (value: React.SetStateAction<ProofStep[]>) => void;
  addCommitment: (c: VaultCommitment) => void;
  address?: string;
  onRecordDeposit?: (
    amountWei: string,
    token: string,
    rail: string,
    txHash: string,
    commitmentHash: string,
  ) => Promise<void>;
}

// Pool metadata
const POOLS = [
  { id: "conservative" as const, label: "Conservative", icon: Shield, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", tickWidth: 6000 },
  { id: "moderate" as const, label: "Moderate", icon: Layers, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", tickWidth: 3000 },
  { id: "aggressive" as const, label: "Aggressive", icon: Zap, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", tickWidth: 1200 },
] as const;

function poolTypeValue(pool: string): number {
  if (pool === "conservative") return 0;
  if (pool === "moderate") return 1;
  return 2;
}

function resolveTokenAddress(asset: Asset): string {
  if (asset === "ETH") return ETH_TOKEN;
  if (asset === "strkBTC") return STRKBTC_TOKEN;
  return STRK_TOKEN;
}

function toWei(amount: string): string {
  return (BigInt(Math.floor(parseFloat(amount))) * BigInt(1e18)).toString();
}

function splitU256(wei: string): { low: string; high: string } {
  const big = BigInt(wei);
  const TWO_128 = BigInt(2) ** BigInt(128);
  return { low: (big % TWO_128).toString(), high: (big / TWO_128).toString() };
}

function generateId(): string {
  return `strategy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VaultStrategyDeposit({
  method,
  depositSteps,
  setDepositSteps,
  addCommitment,
  address,
  onRecordDeposit,
}: VaultStrategyDepositProps) {
  const { account } = useAccount();
  const { setActivityFeed } = useApp();

  const [selectedAsset, setSelectedAsset] = useState<Asset>("STRK");
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoRebalance, setAutoRebalance] = useState(false);

  // AI recommendation
  const [aiLoading, setAiLoading] = useState(false);
  const [recommendation, setRecommendation] = useState<AIRecommendation | null>(null);
  const [isCustom, setIsCustom] = useState(false);

  // Allocation sliders — [conservative, moderate, aggressive]
  const [alloc, setAlloc] = useState<[number, number, number]>([40, 35, 25]);

  // Pool APYs
  const [apys, setApys] = useState<Record<string, number>>({ conservative: 0, moderate: 0, aggressive: 0 });

  // Fetch on-chain balance
  useEffect(() => {
    if (!account || !address) return;
    let dead = false;
    (async () => {
      try {
        const tokenAddr = resolveTokenAddress(selectedAsset);
        const res = await account.callContract({
          contractAddress: tokenAddr,
          entrypoint: "balanceOf",
          calldata: [address],
        });
        const low = BigInt(res[0] || "0");
        const high = BigInt(res[1] || "0");
        const full = low + (high << BigInt(128));
        if (!dead) setBalance((Number(full) / 1e18).toFixed(4));
      } catch {
        if (!dead) setBalance(null);
      }
    })();
    return () => { dead = true; };
  }, [account, address, selectedAsset]);

  // Fetch APYs
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/zkdefi/oracle/pool-apys`, { signal: AbortSignal.timeout(6000) });
        if (res.ok && !dead) {
          const d = await res.json();
          setApys({
            conservative: (d.conservative ?? 0) / 100,
            moderate: (d.neutral ?? 0) / 100,
            aggressive: (d.aggressive ?? 0) / 100,
          });
        }
      } catch { /* best-effort */ }
    })();
    return () => { dead = true; };
  }, []);

  // Fetch AI recommendation
  const fetchRecommendation = useCallback(async () => {
    if (!address) return;
    setAiLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/zkdefi/ai/allocation/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          amount_wei: amount ? toWei(amount) : "0",
          asset: selectedAsset,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data: AIRecommendation = await res.json();
        setRecommendation(data);
        // Apply AI recommendation to sliders
        const con = data.allocations.find((a) => a.pool === "conservative")?.pct ?? 40;
        const bal = data.allocations.find((a) => a.pool === "moderate")?.pct ?? 35;
        const agg = data.allocations.find((a) => a.pool === "aggressive")?.pct ?? 25;
        setAlloc([con, bal, agg]);
        setIsCustom(false);
      }
    } catch {
      // Fallback: use default allocation
      setRecommendation({
        allocations: [
          { pool: "conservative", pct: 40, reasoning: "Steady yield, low IL risk", apy: apys.conservative },
          { pool: "moderate", pct: 35, reasoning: "Optimal risk/reward", apy: apys.moderate },
          { pool: "aggressive", pct: 25, reasoning: "Higher yield opportunity", apy: apys.aggressive },
        ],
        overall_reasoning: "Default moderate allocation based on current market conditions.",
        confidence: 0.7,
        risk_score: 45,
      });
      setAlloc([40, 35, 25]);
      setIsCustom(false);
    } finally {
      setAiLoading(false);
    }
  }, [address, amount, selectedAsset, apys]);

  // Fetch recommendation on mount and when amount changes significantly
  const prevAmountRef = useRef("");
  useEffect(() => {
    if (!address) return;
    const cur = amount || "0";
    const prev = prevAmountRef.current || "0";
    // Only re-fetch if amount changes by >10% or on first load
    const curNum = parseFloat(cur) || 0;
    const prevNum = parseFloat(prev) || 0;
    if (prevNum === 0 || Math.abs(curNum - prevNum) / Math.max(prevNum, 1) > 0.1) {
      prevAmountRef.current = cur;
      fetchRecommendation();
    }
  }, [address, amount, fetchRecommendation]);

  // Slider change handler — adjusts other sliders to maintain sum=100
  const handleSliderChange = (idx: number, value: number) => {
    setIsCustom(true);
    setAlloc((prev) => {
      const newAlloc = [...prev] as [number, number, number];
      const oldVal = newAlloc[idx];
      const delta = value - oldVal;
      newAlloc[idx] = value;

      // Distribute delta across other two sliders proportionally
      const others = [0, 1, 2].filter((i) => i !== idx);
      const othersSum = others.reduce((s, i) => s + newAlloc[i], 0);
      if (othersSum > 0) {
        for (const i of others) {
          const share = newAlloc[i] / othersSum;
          newAlloc[i] = Math.max(0, Math.round(newAlloc[i] - delta * share));
        }
      }

      // Fix rounding
      const total = newAlloc[0] + newAlloc[1] + newAlloc[2];
      if (total !== 100) {
        const diff = 100 - total;
        const otherIdx = others.find((i) => newAlloc[i] + diff >= 0) ?? others[0];
        newAlloc[otherIdx] = Math.max(0, newAlloc[otherIdx] + diff);
      }

      return newAlloc;
    });
  };

  const resetToAI = () => {
    if (!recommendation) return;
    const con = recommendation.allocations.find((a) => a.pool === "conservative")?.pct ?? 40;
    const bal = recommendation.allocations.find((a) => a.pool === "moderate")?.pct ?? 35;
    const agg = recommendation.allocations.find((a) => a.pool === "aggressive")?.pct ?? 25;
    setAlloc([con, bal, agg]);
    setIsCustom(false);
  };

  // Compute blended APY
  const blendedApy = (alloc[0] * apys.conservative + alloc[1] * apys.moderate + alloc[2] * apys.aggressive) / 100;

  // ---------------------------------------------------------------------------
  // Deposit execution — split across pools
  // ---------------------------------------------------------------------------

  const handleDeposit = async () => {
    if (!account || !address || !amount || parseFloat(amount) <= 0) return;
    setBusy(true);

    const strategyId = generateId();
    const totalWei = toWei(amount);
    const totalBig = BigInt(totalWei);
    const tokenAddr = resolveTokenAddress(selectedAsset);

    // Build per-pool amounts
    const poolDeposits: Array<{
      pool: "conservative" | "moderate" | "aggressive";
      pct: number;
      amountWei: string;
      poolType: number;
    }> = [];

    let allocated = BigInt(0);
    for (let i = 0; i < 3; i++) {
      const pct = alloc[i];
      if (pct <= 0) continue;
      const poolId = POOLS[i].id;
      const amt = i === 2 // last pool gets remainder to avoid rounding loss
        ? totalBig - allocated
        : (totalBig * BigInt(pct)) / BigInt(100);
      allocated += amt;
      poolDeposits.push({
        pool: poolId,
        pct,
        amountWei: amt.toString(),
        poolType: poolTypeValue(poolId),
      });
    }

    // Build steps
    const steps: ProofStep[] = [];
    for (const pd of poolDeposits) {
      steps.push(
        { label: `Generate commitment (${pd.pool})`, status: "pending" },
        { label: `Approve + deposit (${pd.pool})`, status: "pending" },
        { label: `Register merkle (${pd.pool})`, status: "pending" },
      );
    }
    steps.push({ label: "Record strategy", status: "pending" });
    setDepositSteps(steps);

    try {
      let stepIdx = 0;

      for (const pd of poolDeposits) {
        // Step 1: Generate commitment
        setDepositSteps((prev) => prev.map((s, i) => i === stepIdx ? { ...s, status: "active" } : i < stepIdx ? { ...s, status: "done" } : s));

        const commitRes = await fetch(`${API_BASE}/v1/zkdefi/full_privacy/deposit/generate_commitment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_address: address,
            amount: pd.amountWei,
            pool_type: pd.poolType,
          }),
        });
        if (!commitRes.ok) throw new Error(`Commitment generation failed for ${pd.pool}`);
        const commitData = await commitRes.json();

        setDepositSteps((prev) => prev.map((s, i) => i === stepIdx ? { ...s, status: "done" } : s));
        stepIdx++;

        // Step 2: Approve + on-chain deposit
        setDepositSteps((prev) => prev.map((s, i) => i === stepIdx ? { ...s, status: "active", detail: "Awaiting wallet approval..." } : s));

        const { low, high } = splitU256(commitData.commitment);
        const poolAddress = FULL_PRIVACY_POOL_ADDRESS;

        const txResult = await account.execute([
          {
            contractAddress: tokenAddr,
            entrypoint: "approve",
            calldata: [poolAddress, pd.amountWei, "0"],
          },
          {
            contractAddress: poolAddress,
            entrypoint: "deposit_u256",
            calldata: [low, high, pd.amountWei, "0"],
          },
        ]);

        const txHash = typeof txResult === "object" && txResult !== null
          ? (txResult as any).transaction_hash ?? ""
          : "";

        if (txHash) {
          await account.waitForTransaction(txHash);
        }

        setDepositSteps((prev) => prev.map((s, i) => i === stepIdx ? { ...s, status: "done", detail: txHash ? `tx: ${txHash.slice(0, 10)}…` : "confirmed" } : s));
        stepIdx++;

        // Step 3: Register commitment in Merkle tree
        setDepositSteps((prev) => prev.map((s, i) => i === stepIdx ? { ...s, status: "active" } : s));

        let merkleData: any = {};
        try {
          const regRes = await fetch(`${API_BASE}/v1/zkdefi/full_privacy/deposit/register_commitment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_address: address,
              commitment: commitData.commitment,
              amount: pd.amountWei,
              pool_type: pd.poolType,
              tx_hash: txHash,
            }),
          });
          if (regRes.ok) merkleData = await regRes.json();
        } catch { /* best effort */ }

        setDepositSteps((prev) => prev.map((s, i) => i === stepIdx ? { ...s, status: "done" } : s));
        stepIdx++;

        // Save commitment to localStorage
        addCommitment({
          id: `${strategyId}_${pd.pool}`,
          method,
          asset: selectedAsset,
          amount_wei: pd.amountWei,
          commitment_hash: commitData.commitment,
          user_secret: commitData.user_secret,
          nonce: commitData.nonce,
          blinding: commitData.blinding,
          pool_type: pd.poolType,
          pool_variant: pd.pool,
          merkle_index: merkleData.leaf_index,
          merkle_root: merkleData.merkle_root,
          path_elements: merkleData.path_elements,
          path_indices: merkleData.path_indices,
          deposited_at: new Date().toISOString(),
          strategy_id: strategyId,
          allocation_source: "personal_strategy",
        });

        // Record in V2 ledger (best-effort)
        try {
          await onRecordDeposit?.(pd.amountWei, selectedAsset, method, txHash, commitData.commitment);
        } catch { /* best-effort */ }
      }

      // Final step: Record strategy on backend
      setDepositSteps((prev) => prev.map((s, i) => i === stepIdx ? { ...s, status: "active" } : s));

      try {
        await fetch(`${API_BASE}/v1/zkdefi/vault/strategy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            strategy_id: strategyId,
            allocations: {
              conservative: alloc[0],
              moderate: alloc[1],
              aggressive: alloc[2],
            },
            auto_rebalance: autoRebalance,
            total_amount_wei: totalWei,
            asset: selectedAsset,
          }),
        });
      } catch { /* best-effort */ }

      setDepositSteps((prev) => prev.map((s) => ({ ...s, status: "done" })));

      toastSuccess("Strategy deposit complete!");
      addActivityEvent(setActivityFeed, {
        type: "deposit",
        text: `Deposited ${amount} ${selectedAsset} via Personal Strategy`,
        details: `Split: ${alloc[0]}% Conservative, ${alloc[1]}% Balanced, ${alloc[2]}% Aggressive`,
      });

      setAmount("");
    } catch (err: any) {
      const msg = err?.message || "Deposit failed";
      toastError(msg);
      setDepositSteps((prev) => {
        const activeIdx = prev.findIndex((s) => s.status === "active");
        return prev.map((s, i) => {
          if (i < activeIdx) return { ...s, status: "done" };
          if (i === activeIdx) return { ...s, status: "error", detail: msg };
          return s;
        });
      });
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const numAmount = parseFloat(amount) || 0;
  const canDeposit = numAmount > 0 && !busy && address && account;

  return (
    <div className="space-y-5">
      {/* AI Recommendation Banner */}
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-violet-200">AI Strategy Recommendation</span>
            {recommendation && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 font-medium">
                {Math.round(recommendation.confidence * 100)}% confidence
              </span>
            )}
          </div>
          <button
            onClick={fetchRecommendation}
            disabled={aiLoading}
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${aiLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        {aiLoading ? (
          <div className="flex items-center gap-2 py-3">
            <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
            <span className="text-xs text-zinc-400">Analyzing market conditions...</span>
          </div>
        ) : recommendation ? (
          <div>
            <p className="text-xs text-zinc-400 mb-2">{recommendation.overall_reasoning}</p>
            {isCustom && (
              <button
                onClick={resetToAI}
                className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 mb-2"
              >
                <Sparkles className="w-3 h-3" />
                Reset to AI recommendation
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Asset Selector */}
      <div>
        <label className="text-xs text-zinc-500 mb-1.5 block">Asset</label>
        <div className="flex gap-2">
          {(["STRK", "ETH", "strkBTC"] as Asset[]).map((a) => (
            <button
              key={a}
              onClick={() => setSelectedAsset(a)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                selectedAsset === a
                  ? "bg-zinc-700 text-white border-zinc-600"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* Amount Input */}
      <div>
        <div className="flex justify-between mb-1.5">
          <label className="text-xs text-zinc-500">Amount</label>
          {balance !== null && (
            <button
              onClick={() => setAmount(balance)}
              className="text-[11px] text-zinc-500 hover:text-white"
            >
              Balance: {balance} {selectedAsset}
            </button>
          )}
        </div>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      {/* Allocation Sliders */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <label className="text-xs text-zinc-500">Pool Allocation</label>
          <div className="text-[11px] text-zinc-400">
            Blended APY: <span className="text-emerald-400 font-medium">{blendedApy.toFixed(1)}%</span>
          </div>
        </div>
        <div className="space-y-3">
          {POOLS.map((pool, idx) => {
            const Icon = pool.icon;
            return (
              <div key={pool.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${pool.color}`} />
                    <span className="text-xs text-zinc-300">{pool.label}</span>
                    {apys[pool.id] > 0 && (
                      <span className="text-[10px] text-zinc-500">{apys[pool.id].toFixed(1)}% APY</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white font-medium w-8 text-right">{alloc[idx]}%</span>
                    {numAmount > 0 && alloc[idx] > 0 && (
                      <span className="text-[10px] text-zinc-500">
                        ({((numAmount * alloc[idx]) / 100).toFixed(2)} {selectedAsset})
                      </span>
                    )}
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={alloc[idx]}
                  onChange={(e) => handleSliderChange(idx, parseInt(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-zinc-800 cursor-pointer accent-emerald-500
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:cursor-pointer"
                />
                {recommendation?.allocations?.find((a) => a.pool === pool.id)?.reasoning && (
                  <p className="text-[10px] text-zinc-600 pl-5">
                    {recommendation.allocations.find((a) => a.pool === pool.id)?.reasoning}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Allocation visualization bar */}
        <div className="flex h-2 rounded-full overflow-hidden mt-3 bg-zinc-800">
          {alloc[0] > 0 && (
            <div className="bg-blue-400 transition-all" style={{ width: `${alloc[0]}%` }} />
          )}
          {alloc[1] > 0 && (
            <div className="bg-emerald-400 transition-all" style={{ width: `${alloc[1]}%` }} />
          )}
          {alloc[2] > 0 && (
            <div className="bg-amber-400 transition-all" style={{ width: `${alloc[2]}%` }} />
          )}
        </div>
      </div>

      {/* Auto-rebalance toggle */}
      <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-zinc-500" />
          <div>
            <div className="text-xs text-zinc-300">Auto-rebalance</div>
            <div className="text-[10px] text-zinc-600">AI automatically rebalances when allocation drifts &gt;10%</div>
          </div>
        </div>
        <button
          onClick={() => setAutoRebalance(!autoRebalance)}
          className="flex-shrink-0"
        >
          {autoRebalance ? (
            <ToggleRight className="w-8 h-8 text-emerald-400" />
          ) : (
            <ToggleLeft className="w-8 h-8 text-zinc-600" />
          )}
        </button>
      </div>

      {/* Risk score */}
      {recommendation && (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-500">Risk Score:</span>
          <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                recommendation.risk_score < 35
                  ? "bg-blue-400"
                  : recommendation.risk_score < 60
                    ? "bg-emerald-400"
                    : "bg-amber-400"
              }`}
              style={{ width: `${recommendation.risk_score}%` }}
            />
          </div>
          <span className="text-zinc-400">{recommendation.risk_score}/100</span>
        </div>
      )}

      {/* Deposit Button */}
      <button
        onClick={handleDeposit}
        disabled={!canDeposit}
        className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Depositing...
          </>
        ) : (
          <>
            <ArrowDownToLine className="w-4 h-4" />
            Deposit with AI Strategy
          </>
        )}
      </button>

      {/* Proof Stepper */}
      {depositSteps.length > 0 && (
        <div className="mt-4">
          <ProofStepper steps={depositSteps} />
        </div>
      )}
    </div>
  );
}
