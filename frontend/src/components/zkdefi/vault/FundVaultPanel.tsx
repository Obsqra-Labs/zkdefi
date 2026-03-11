"use client";

/**
 * FundVaultPanel — AI-recommended vault funding.
 *
 * This is the primary "Fund" flow: the user enters an amount and the AI
 * recommends an optimal deployment strategy (Ekubo LP, Lending, Staking, etc.)
 * based on their risk profile and current market conditions.
 *
 * Under the hood it uses the same hashed-proof deposit pipeline as DepositPanel
 * but the *presentation* is strategy-forward rather than pool-forward.
 */

import React, { useState, useEffect, useMemo } from "react";
import { useAccount } from "@starknet-react/core";
import { motion } from "framer-motion";
import {
  ArrowDownToLine,
  Brain,
  Clock,
  Coins,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { PrivacyMethod, VaultCommitment, ProofStep } from "@/hooks/usePrivacyVault";
import { getDepositStepsForMethod } from "@/hooks/usePrivacyVault";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Asset = "STRK" | "ETH" | "strkBTC";

interface StrategyPool {
  pool_id: string;
  protocol: string;
  pair: string;
  allocation_percent: number;
  allocation_amount: number;
  expected_apy: number;
  risk_score: number;
}

interface AIRecommendation {
  recommended_pools: StrategyPool[];
  ai_reasoning: string;
  ai_confidence: number;
  expected_portfolio_apy: number;
  risk_profile: string;
}

type DepositResult = {
  commitmentHash: string;
  txHash: string;
  userSecret?: string;
  nonce?: string;
  blinding?: string;
  poolType?: number;
  leafIndex?: number;
  merkleRoot?: string;
  pathElements?: string[];
  pathIndices?: number[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toWei(amount: string): string {
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) return "0";
  // Handle decimals properly
  const wholePart = Math.floor(parsed);
  const fracPart = parsed - wholePart;
  const fracWei = BigInt(Math.round(fracPart * 1e18));
  return (BigInt(wholePart) * BigInt(1e18) + fracWei).toString();
}

function splitU256(wei: string): { low: string; high: string } {
  const big = BigInt(wei);
  const TWO_128 = BigInt(2) ** BigInt(128);
  return {
    low: (big % TWO_128).toString(),
    high: (big / TWO_128).toString(),
  };
}

function resolveTokenAddress(asset: Asset): string {
  if (asset === "ETH") return ETH_TOKEN;
  if (asset === "strkBTC") return STRKBTC_TOKEN;
  return STRK_TOKEN;
}

function updateStep(
  steps: ProofStep[],
  index: number,
  status: ProofStep["status"],
  detail?: string,
): ProofStep[] {
  return steps.map((s, i) => {
    if (i < index) return { ...s, status: "done" };
    if (i === index) return { ...s, status, detail };
    return s;
  });
}

function markError(steps: ProofStep[], failedIndex: number): ProofStep[] {
  return steps.map((s, i) => {
    if (i < failedIndex) return { ...s, status: "done" };
    if (i === failedIndex) return { ...s, status: "error" };
    return s;
  });
}

// Adapter styling
const ADAPTER_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  "Ekubo": { bg: "bg-emerald-500/10", text: "text-emerald-400", bar: "bg-emerald-400" },
  "Lending": { bg: "bg-blue-500/10", text: "text-blue-400", bar: "bg-blue-400" },
  "Staking": { bg: "bg-violet-500/10", text: "text-violet-400", bar: "bg-violet-400" },
  "Idle": { bg: "bg-zinc-500/10", text: "text-zinc-400", bar: "bg-zinc-500" },
};

function getAdapterColor(protocol: string) {
  return ADAPTER_COLORS[protocol] ?? ADAPTER_COLORS["Idle"]!;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FundVaultPanelProps {
  method: PrivacyMethod;
  depositSteps: ProofStep[];
  setDepositSteps: (value: React.SetStateAction<ProofStep[]>) => void;
  addCommitment: (c: VaultCommitment) => void;
  address?: string;
  isDemo?: boolean;
  /** Record deposit in V2 ledger */
  onRecordDeposit?: (amountWei: string, token: string, rail: string, txHash: string, commitmentHash: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FundVaultPanel({
  method,
  depositSteps,
  setDepositSteps,
  addCommitment,
  address,
  isDemo,
  onRecordDeposit,
}: FundVaultPanelProps) {
  const { account } = useAccount();
  const { setActivityFeed } = useApp();

  const [selectedAsset, setSelectedAsset] = useState<Asset>("STRK");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceEpoch, setBalanceEpoch] = useState(0);

  // AI recommendation state
  const [recommendation, setRecommendation] = useState<AIRecommendation | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);

  const amountNum = parseFloat(amount);
  const showPreview = amountNum > 0;

  // Fetch wallet balance
  useEffect(() => {
    if (!address || typeof window === "undefined") {
      setBalance(null);
      return;
    }
    let dead = false;
    const tokenAddr = resolveTokenAddress(selectedAsset);

    (async () => {
      try {
        const { RpcProvider } = await import("starknet");
        const provider = new RpcProvider({
          nodeUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7",
        });
        for (const ep of ["balanceOf", "balance_of"]) {
          try {
            const result = await provider.callContract({
              contractAddress: tokenAddr,
              entrypoint: ep,
              calldata: [address],
            });
            if (dead) return;
            const low = BigInt(result[0] ?? "0");
            const high = BigInt(result[1] ?? "0");
            const total = low + high * (BigInt(2) ** BigInt(128));
            const formatted = (Number(total) / 1e18).toFixed(4);
            setBalance(formatted);
            return;
          } catch { /* try next */ }
        }
        if (!dead) setBalance(null);
      } catch {
        if (!dead) setBalance(null);
      }
    })();

    return () => { dead = true; };
  }, [address, selectedAsset, balanceEpoch]);

  // Fetch AI recommendation when amount changes
  useEffect(() => {
    if (!showPreview || amountNum <= 0) {
      setRecommendation(null);
      return;
    }

    let dead = false;
    setRecLoading(true);
    setRecError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/strategies/recommend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_address: address || "anonymous",
            risk_profile: "balanced", // default — could be wired to user's profile
            amount: amountNum,
            asset: selectedAsset,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok && !dead) {
          const data = await res.json();
          setRecommendation({
            recommended_pools: data.recommended_pools ?? [],
            ai_reasoning: data.ai_reasoning ?? "",
            ai_confidence: data.ai_confidence ?? 0,
            expected_portfolio_apy: data.expected_portfolio_apy ?? 0,
            risk_profile: data.risk_profile ?? "balanced",
          });
        } else if (!dead) {
          setRecError("Could not fetch recommendation");
        }
      } catch {
        if (!dead) setRecError("Strategy recommendation unavailable");
      } finally {
        if (!dead) setRecLoading(false);
      }
    }, 500); // debounce

    return () => { dead = true; clearTimeout(timer); };
  }, [amountNum, selectedAsset, address, showPreview]);

  // -----------------------------------------------------------------------
  // Deposit handler (hashed_proof path — same as DepositPanel)
  // -----------------------------------------------------------------------

  async function handleFund() {
    if (!amount || parseFloat(amount) <= 0) return;
    setBusy(true);

    // Reset proof steps to pending before starting
    setDepositSteps(getDepositStepsForMethod("hashed_proof"));

    try {
      const amountWei = toWei(amount);
      const { low: amountLow, high: amountHigh } = splitU256(amountWei);
      const poolAddr = FULL_PRIVACY_POOL_ADDRESS;
      if (!poolAddr) throw new Error("Private pool address not configured");

      // Step 0 — Generate commitment
      setDepositSteps((prev) => updateStep(prev, 0, "active", "Generating..."));
      const res = await fetch(
        `${API_BASE}/v1/zkdefi/full_privacy/deposit/generate_commitment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_address: address,
            amount: amountWei,
            pool_type: 1, // moderate by default for vault funding
            token: selectedAsset,
          }),
        },
      );
      const data = await res.json();
      if (!data.commitment) throw new Error(data.detail || "Commitment generation failed");

      const commitmentHash: string = data.commitment;
      const commitmentBig = commitmentHash.startsWith("0x")
        ? BigInt(commitmentHash)
        : BigInt("0x" + commitmentHash);
      const { low: cLow, high: cHigh } = splitU256(commitmentBig.toString());

      // Step 1 — Approve & sign deposit
      setDepositSteps((prev) => updateStep(prev, 1, "active", "Sign in wallet..."));
      if (!account) throw new Error("Wallet not connected");

      const tokenAddr = resolveTokenAddress(selectedAsset);
      const calls = [
        {
          contractAddress: tokenAddr as `0x${string}`,
          entrypoint: "approve",
          calldata: [poolAddr, amountLow, amountHigh],
        },
        {
          contractAddress: poolAddr as `0x${string}`,
          entrypoint: "deposit_u256",
          calldata: [cLow, cHigh, amountLow, amountHigh],
        },
      ];

      let result: { transaction_hash: string };
      try {
        result = await account.execute(calls);
      } catch (execErr: unknown) {
        const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
        if (errMsg.includes("NonceTooOld") || errMsg.includes("nonce")) {
          await new Promise((r) => setTimeout(r, 2000));
          result = await account.execute(calls);
        } else {
          throw execErr;
        }
      }
      const txHash = result.transaction_hash;

      // Step 2 — Register commitment in Merkle tree
      setDepositSteps((prev) => updateStep(prev, 2, "active", "Registering in Merkle tree..."));
      let leafIndex: number | undefined;
      let merkleRoot: string | undefined;
      let pathElements: string[] | undefined;
      let pathIndices: number[] | undefined;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 * attempt));
          const regRes = await fetch(
            `${API_BASE}/v1/zkdefi/full_privacy/deposit/register_commitment`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commitment: commitmentHash }),
            },
          );
          const regData = await regRes.json();
          if (regData.leaf_index !== undefined) {
            leafIndex = regData.leaf_index;
            merkleRoot = regData.merkle_root;
            pathElements = regData.path_elements;
            pathIndices = regData.path_indices;
            break;
          }
        } catch {
          if (attempt === 2) break;
        }
      }

      // Step 3 — Confirm
      setDepositSteps((prev) =>
        updateStep(prev, prev.length - 1, leafIndex !== undefined ? "done" : "error",
          leafIndex !== undefined ? "Confirmed" : "Registration pending"),
      );

      // Record commitment locally
      addCommitment({
        id: crypto.randomUUID(),
        method: "hashed_proof",
        asset: selectedAsset,
        amount_wei: amountWei,
        commitment_hash: commitmentHash,
        user_secret: data.user_secret,
        nonce: data.nonce,
        blinding: data.blinding,
        pool_type: 1,
        pool_variant: "moderate",
        merkle_index: leafIndex,
        merkle_root: merkleRoot,
        path_elements: pathElements,
        path_indices: pathIndices,
        deposited_at: new Date().toISOString(),
        strategy_id: recommendation?.recommended_pools?.[0]?.pool_id,
        allocation_source: "ai_recommended",
      });

      onRecordDeposit?.(amountWei, selectedAsset, "HASHED_PROOF", txHash, commitmentHash).catch(() => {});

      addActivityEvent(setActivityFeed, {
        type: "deposit",
        pool: "full_privacy",
        text: `Funded vault with ${amount} ${selectedAsset} via AI strategy`,
        txHash,
      });

      toastSuccess(
        `Vault funded: ${commitmentHash.slice(0, 16)}… | tx: ${txHash.slice(0, 12)}…`,
        {
          action: {
            label: "View tx",
            onClick: () => window.open(sepoliaVoyagerTxUrl(txHash), "_blank"),
          },
        },
      );

      setAmount("");
      setTimeout(() => setBalanceEpoch((e) => e + 1), 5000);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : String(err);
      toastError(`Fund failed: ${msg}`);

      setDepositSteps((prev) => {
        const failedIdx = prev.findIndex((s) => s.status === "active");
        return failedIdx >= 0 ? markError(prev, failedIdx) : prev;
      });
    } finally {
      setBusy(false);
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const canSubmit = !busy && !!amount && parseFloat(amount) > 0;
  const confidencePct = recommendation ? Math.round(recommendation.ai_confidence * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="min-h-[400px] rounded-2xl border border-white/10 bg-gradient-to-b from-violet-900/20 via-slate-900/50 to-slate-900/50 p-5 flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-400" />
          <h3 className="text-lg font-semibold text-white">Fund Vault</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Shielded
          </span>
        </div>
      </div>

      {/* Shielded info */}
      <div className="flex items-start gap-2 rounded-lg border border-violet-500/10 bg-violet-500/[0.03] px-3 py-2">
        <ShieldCheck className="w-3.5 h-3.5 text-violet-400/50 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-violet-400/60 leading-relaxed">
          Your capital enters the shielded vault with hashed proof privacy.
          The AI agent will deploy it across optimal strategies automatically.
        </p>
      </div>

      {/* Asset selector */}
      <div className="flex items-center gap-2">
        <Coins className="w-4 h-4 text-white/40" />
        <div className="flex rounded-lg border border-white/10 overflow-hidden text-sm">
          {(["STRK", "ETH", "strkBTC"] as Asset[]).map((a) => (
            <button
              key={a}
              onClick={() => setSelectedAsset(a)}
              className={`px-3 py-1 transition-colors ${
                selectedAsset === a
                  ? "bg-violet-600/30 text-violet-300"
                  : "bg-white/[0.03] text-white/50 hover:text-white/70"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* Amount input */}
      <div>
        <div className="relative">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 pr-16 text-white text-lg placeholder:text-white/20 focus:outline-none focus:border-violet-500/40"
          />
          <button
            onClick={() => { if (balance) setAmount(balance); }}
            disabled={!balance}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-violet-400 hover:text-violet-300 px-2 py-1 rounded border border-violet-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            MAX
          </button>
        </div>
        <p className="mt-1 text-xs text-white/30">
          Balance: {balance !== null ? `${balance} ${selectedAsset}` : `-- ${selectedAsset}`}
        </p>
      </div>

      {/* ── AI Strategy Recommendation ── */}
      {showPreview && (
        <div className="rounded-lg border border-violet-500/20 bg-zinc-900/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-400" />
              <h4 className="text-sm font-medium text-zinc-200">AI Strategy</h4>
            </div>
            {recommendation && (
              <span className="text-xs text-emerald-400 font-medium">
                {(recommendation.expected_portfolio_apy * 100).toFixed(1)}% APY
              </span>
            )}
          </div>

          {recLoading && !recommendation ? (
            <div className="flex items-center gap-2 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              <span className="text-xs text-zinc-400">Analyzing optimal deployment...</span>
            </div>
          ) : recError && !recommendation ? (
            <div className="text-xs text-zinc-500 py-2">{recError}</div>
          ) : recommendation ? (
            <>
              {/* Pool allocation breakdown */}
              <div className="space-y-2">
                {recommendation.recommended_pools.map((pool) => {
                  const color = getAdapterColor(pool.protocol);
                  return (
                    <div key={pool.pool_id} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${color.bar}`} />
                        <span className="text-zinc-300">{pool.pair}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${color.bg} ${color.text}`}>
                          {pool.protocol}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-400">{pool.allocation_percent.toFixed(0)}%</span>
                        <span className="text-emerald-400/80">{(pool.expected_apy * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Allocation bar */}
              <div className="h-2 flex rounded-full overflow-hidden bg-zinc-800">
                {recommendation.recommended_pools.map((pool) => {
                  const color = getAdapterColor(pool.protocol);
                  return (
                    <div
                      key={pool.pool_id}
                      className={`${color.bar} transition-all`}
                      style={{ width: `${pool.allocation_percent}%` }}
                    />
                  );
                })}
              </div>

              {/* Confidence & reasoning toggle */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">
                  Confidence: {confidencePct}%
                </span>
                <button
                  onClick={() => setShowReasoning(!showReasoning)}
                  className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
                >
                  {showReasoning ? "Hide reasoning" : "Show reasoning"}
                </button>
              </div>

              {showReasoning && (
                <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-3 py-2">
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    {recommendation.ai_reasoning}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-zinc-500 py-2">
              Enter an amount to see AI-recommended strategy
            </div>
          )}
        </div>
      )}

      {/* Proof stepper */}
      <ProofStepper steps={depositSteps} />

      {/* Proof info */}
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-xs text-zinc-400 space-y-1">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-zinc-500" />
            Proof generation
          </span>
          <span className="text-zinc-300">~10-15s (Groth16)</span>
        </div>
        <div className="flex items-center justify-between">
          <span>What happens</span>
          <span className="text-zinc-300">Commitment + Pedersen hash + Merkle insert</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Privacy</span>
          <span className="text-amber-400">Fully shielded — hashed proof commitment</span>
        </div>
      </div>

      {/* Submit */}
      <button
        disabled={!canSubmit}
        onClick={handleFund}
        className={`mt-auto w-full rounded-lg py-3 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
          canSubmit
            ? "bg-gradient-to-r from-violet-600 to-violet-700 text-white hover:from-violet-500 hover:to-violet-600 shadow-lg shadow-violet-900/30"
            : "bg-white/[0.06] text-white/30 cursor-not-allowed"
        }`}
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Funding...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Fund Vault
          </>
        )}
      </button>
    </motion.div>
  );
}
